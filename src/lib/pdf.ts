// Lectura y renderizado de PDF con pdf.js
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { canvasToBlob } from './util';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const vendor = new URL('vendor/pdfjs/', document.baseURI).href;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy, TextItem };

export class NeedPasswordError extends Error {
  incorrect: boolean;
  constructor(incorrect: boolean) {
    super(incorrect ? 'Contraseña incorrecta' : 'Este PDF tiene contraseña');
    this.incorrect = incorrect;
  }
}

/** Contraseñas recordadas durante la sesión (por id de documento). */
export const sessionPasswords = new Map<string, string>();

export async function toBytes(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

export async function openPdf(data: Blob | ArrayBuffer | Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  // pdf.js transfiere el buffer al worker: siempre enviamos una copia
  const bytes = (await toBytes(data)).slice();
  const task = pdfjs.getDocument({
    data: bytes,
    password,
    cMapUrl: vendor + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: vendor + 'standard_fonts/',
    wasmUrl: vendor + 'wasm/',
    iccUrl: vendor + 'iccs/',
    isEvalSupported: false,
    // conserva el archivo de cada letra: "Editar texto" lee de ahí el nombre real de la fuente
    fontExtraProperties: true,
  } as any);
  try {
    return await task.promise;
  } catch (e: any) {
    if (e?.name === 'PasswordException') throw new NeedPasswordError(e.code === 2);
    throw e;
  }
}

export async function renderPage(
  page: PDFPageProxy,
  scale: number,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
  opts: { background?: string; annotations?: boolean } = {},
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({
    canvas,
    viewport,
    background: opts.background ?? 'white',
    annotationMode: opts.annotations === false ? 0 : 1,
  } as any);
  await task.promise;
  return canvas;
}

/** Renderiza una página con un ancho máximo en píxeles. */
export async function renderPageWidth(page: PDFPageProxy, width: number) {
  const vp = page.getViewport({ scale: 1 });
  return renderPage(page, width / vp.width);
}

export async function pdfThumbnail(data: Blob | Uint8Array, width = 260, password?: string): Promise<{ thumb: Blob; pages: number }> {
  const doc = await openPdf(data, password);
  try {
    const page = await doc.getPage(1);
    const c = await renderPageWidth(page, width);
    return { thumb: await canvasToBlob(c, 'image/jpeg', 0.8), pages: doc.numPages };
  } finally {
    closePdf(doc);
  }
}

export interface Line {
  text: string;
  x: number;
  y: number; // arriba de la línea (coordenadas de vista, escala 1)
  w: number;
  h: number; // tamaño de letra aprox.
  items: { str: string; x: number; w: number }[];
}

/** Agrupa el texto de una página en líneas ordenadas (coordenadas de vista, escala 1). */
export async function pageLines(page: PDFPageProxy): Promise<{ lines: Line[]; width: number; height: number }> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  type It = { str: string; x: number; y: number; w: number; h: number };
  const its: It[] = [];
  for (const raw of tc.items as any[]) {
    if (!('str' in raw) || !raw.str) continue;
    const it = raw as TextItem;
    const tx = pdfjs.Util.transform(vp.transform, it.transform);
    const h = Math.hypot(tx[2], tx[3]) || Math.abs(it.height) || 10;
    const x = tx[4];
    const yBase = tx[5];
    const w = it.width * (vp.scale || 1);
    its.push({ str: it.str, x, y: yBase - h, w, h });
  }
  its.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of its) {
    const mid = it.y + it.h / 2;
    let line = lines.find((l) => Math.abs(l.y + l.h / 2 - mid) < Math.max(3, Math.min(l.h, it.h) * 0.5));
    if (!line) {
      line = { text: '', x: it.x, y: it.y, w: 0, h: it.h, items: [] };
      lines.push(line);
    }
    line.items.push({ str: it.str, x: it.x, w: it.w });
    line.h = Math.max(line.h, it.h);
    line.y = Math.min(line.y, it.y);
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = -Infinity;
    for (const i of l.items) {
      if (text && i.x - end > l.h * 0.25 && !text.endsWith(' ') && !i.str.startsWith(' ')) text += ' ';
      text += i.str;
      end = i.x + i.w;
    }
    l.text = text.replace(/\s+/g, ' ').trim();
    l.x = l.items[0].x;
    l.w = end - l.x;
  }
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  return { lines: lines.filter((l) => l.text), width: vp.width, height: vp.height };
}

export interface Para {
  text: string;
  size: number;
  heading: boolean;
}

/** Une líneas en párrafos para lectura / exportación. */
export function linesToParagraphs(lines: Line[]): Para[] {
  if (!lines.length) return [];
  const sizes = lines.map((l) => l.h).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 11;
  const paras: Para[] = [];
  let cur: { lines: Line[] } | null = null;
  let prev: Line | null = null;
  for (const l of lines) {
    const gap = prev ? l.y - (prev.y + prev.h) : 0;
    const sizeJump = prev ? Math.abs(l.h - prev.h) > body * 0.25 : false;
    const newPara = !cur || gap > body * 0.9 || sizeJump || /[.:!?]$/.test(prev!.text) && l.x - prev!.x > body;
    if (newPara) {
      if (cur) paras.push(finish(cur.lines));
      cur = { lines: [l] };
    } else cur!.lines.push(l);
    prev = l;
  }
  if (cur) paras.push(finish(cur.lines));
  return paras;

  function finish(ls: Line[]): Para {
    let text = '';
    for (const l of ls) {
      if (text.endsWith('-') && /^[a-záéíóúñü]/.test(l.text)) text = text.slice(0, -1) + l.text;
      else text += (text ? ' ' : '') + l.text;
    }
    const size = Math.max(...ls.map((l) => l.h));
    return { text, size, heading: size > body * 1.25 && text.length < 160 };
  }
}

export async function pdfPlainText(doc: PDFDocumentProxy, onPage?: (i: number) => void): Promise<string[]> {
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onPage?.(i);
    const page = await doc.getPage(i);
    const { lines } = await pageLines(page);
    out.push(linesToParagraphs(lines).map((p) => p.text).join('\n\n'));
  }
  return out;
}

export function closePdf(doc: PDFDocumentProxy) {
  try {
    doc.loadingTask.destroy();
  } catch {}
}
