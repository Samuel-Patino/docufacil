// Operaciones de PDF con pdf-lib (todo en el dispositivo).
import {
  PDFDocument, PDFPage, PDFName, PDFRawStream, PDFDict, PDFRef, PDFArray, PDFNumber, PDFHexString,
  StandardFonts, rgb, degrees, BlendMode, LineCapStyle, decodePDFRawStream,
  pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode,
  TextRenderingMode, setCharacterSqueeze, setTextMatrix, showText, type PDFFont,
} from '@cantoo/pdf-lib';
import type { OcrResult } from './ocr';
import { canvasToBlob } from './util';

export class PdfPasswordError extends Error {
  constructor(incorrect = false) {
    super(incorrect ? 'Contraseña incorrecta' : 'Este PDF tiene contraseña');
  }
}

export async function loadPdf(bytes: Uint8Array | ArrayBuffer | Blob, password?: string): Promise<PDFDocument> {
  const data = bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes;
  try {
    return await PDFDocument.load(data, { password, updateMetadata: false, ignoreEncryption: false } as any);
  } catch (e: any) {
    const m = String(e?.message || e);
    if (/encrypt/i.test(m) || e?.name === 'EncryptedPDFError') throw new PdfPasswordError(false);
    if (/password/i.test(m)) throw new PdfPasswordError(true);
    throw e;
  }
}

export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return d.isEncrypted;
  } catch {
    return false;
  }
}

export const save = (d: PDFDocument) => d.save({ useObjectStreams: true });

// ---------- utilidades de coordenadas ----------

export function pageBox(page: PDFPage) {
  const b = page.getCropBox();
  const rot = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const swap = rot === 90 || rot === 270;
  return { x0: b.x, y0: b.y, w: b.width, h: b.height, rot, dw: swap ? b.height : b.width, dh: swap ? b.width : b.height };
}

/** Coordenadas de pantalla (origen arriba-izquierda, en puntos) → espacio del PDF. */
export function toUser(page: PDFPage, dx: number, dy: number) {
  const { x0, y0, w, h, rot } = pageBox(page);
  switch (rot) {
    case 90:
      return { x: x0 + dy, y: y0 + dx };
    case 180:
      return { x: x0 + w - dx, y: y0 + dy };
    case 270:
      return { x: x0 + w - dy, y: y0 + h - dx };
    default:
      return { x: x0 + dx, y: y0 + h - dy };
  }
}

export function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
/** Las fuentes estándar sólo admiten Latin-1; reemplazamos lo demás. */
export function winAnsi(s: string) {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.charCodeAt(0);
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) out += ch;
    else if (ch === '\t') out += ' ';
    else if (ch !== '\n' && ch !== '\r') {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += base && base.charCodeAt(0) < 0x7f ? base : '?';
    }
  }
  return out;
}

// ---------- imágenes → PDF ----------

export type PageSize = 'fit' | 'a4' | 'letter';
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

async function toJpegOrPng(b: Blob): Promise<{ bytes: Uint8Array; png: boolean }> {
  if (b.type === 'image/jpeg' || b.type === 'image/png') return { bytes: new Uint8Array(await b.arrayBuffer()), png: b.type === 'image/png' };
  const bmp = await createImageBitmap(b);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const out = await canvasToBlob(c, 'image/jpeg', 0.9);
  return { bytes: new Uint8Array(await out.arrayBuffer()), png: false };
}

/** Agrega texto invisible (OCR) encima de la imagen para que el PDF sea buscable. */
export function addTextLayer(doc: PDFDocument, page: PDFPage, font: PDFFont, ocr: OcrResult, rect: { x: number; y: number; w: number; h: number }) {
  const sx = rect.w / ocr.width;
  const sy = rect.h / ocr.height;
  const key = (page.node as any).newFontDictionary(font.name, (font as any).ref);
  const ops: any[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const line of ocr.lines) {
    for (const w of line.words) {
      const text = winAnsi(w.text);
      if (!text.trim()) continue;
      const hpt = Math.max(1, (w.y1 - w.y0) * sy);
      const wpt = Math.max(1, (w.x1 - w.x0) * sx);
      const size = hpt * 0.95;
      let tw = 1;
      try {
        tw = font.widthOfTextAtSize(text, size);
      } catch {
        continue;
      }
      const squeeze = Math.max(10, Math.min(400, (wpt / tw) * 100));
      const x = rect.x + w.x0 * sx;
      const y = rect.y + rect.h - w.y1 * sy + hpt * 0.18;
      ops.push(setFontAndSize(key, size), setCharacterSqueeze(squeeze), setTextMatrix(1, 0, 0, 1, x, y), showText(font.encodeText(text)));
    }
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

export async function imagesToPdf(
  images: { blob: Blob; ocr?: OcrResult | null }[],
  opts: { pageSize?: PageSize; margin?: number; title?: string } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer('DocuFácil');
  doc.setCreator('DocuFácil');
  if (opts.title) doc.setTitle(opts.title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.pageSize ?? 'fit';
  for (const im of images) {
    const { bytes, png } = await toJpegOrPng(im.blob);
    const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const ar = img.width / img.height;
    let pw: number, ph: number, x: number, y: number, w: number, h: number;
    if (size === 'fit') {
      // Ancho tipo A4 (8,27") manteniendo la proporción de la imagen
      w = ar >= 1 ? 841.89 : 595.28;
      h = w / ar;
      pw = w;
      ph = h;
      x = 0;
      y = 0;
    } else {
      const [sw, sh] = SIZES[size];
      const land = ar > 1;
      pw = land ? sh : sw;
      ph = land ? sw : sh;
      const m = opts.margin ?? 18;
      const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
      w = img.width * s;
      h = img.height * s;
      x = (pw - w) / 2;
      y = (ph - h) / 2;
    }
    const page = doc.addPage([pw, ph]);
    page.drawImage(img, { x, y, width: w, height: h });
    if (im.ocr?.lines.length) addTextLayer(doc, page, font, im.ocr, { x, y, w, h });
  }
  return save(doc);
}

// ---------- organizar ----------

export async function mergePdfs(files: { bytes: Uint8Array; password?: string }[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await loadPdf(f.bytes, f.password);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return save(out);
}

export async function pickPages(bytes: Uint8Array, indices: number[], password?: string, rotations?: Record<number, number>): Promise<Uint8Array> {
  const src = await loadPdf(bytes, password);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p, i) => {
    const extra = rotations?.[i] ?? 0;
    if (extra) p.setRotation(degrees((p.getRotation().angle + extra + 360) % 360));
    out.addPage(p);
  });
  return save(out);
}

export async function splitPdf(bytes: Uint8Array, groups: number[][], password?: string): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const g of groups) out.push(await pickPages(bytes, g, password));
  return out;
}

export async function rotatePages(bytes: Uint8Array, indices: number[], delta: number, password?: string) {
  const d = await loadPdf(bytes, password);
  for (const i of indices) {
    const p = d.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return save(d);
}

export interface Margins {
  left: number;
  top: number;
  right: number;
  bottom: number;
} // fracciones 0..1 en la orientación que se ve

export async function cropPages(bytes: Uint8Array, crops: Map<number, Margins>, password?: string) {
  const d = await loadPdf(bytes, password);
  for (const [i, m] of crops) {
    const p = d.getPage(i);
    const { x0, y0, w, h, rot } = pageBox(p);
    let L = m.left, T = m.top, R = m.right, B = m.bottom;
    if (rot === 90) [L, T, R, B] = [m.top, m.right, m.bottom, m.left];
    else if (rot === 180) [L, T, R, B] = [m.right, m.bottom, m.left, m.top];
    else if (rot === 270) [L, T, R, B] = [m.bottom, m.left, m.top, m.right];
    const nx = x0 + L * w, ny = y0 + B * h;
    const nw = w * (1 - L - R), nh = h * (1 - T - B);
    if (nw < 10 || nh < 10) continue;
    p.setCropBox(nx, ny, nw, nh);
    p.setMediaBox(nx, ny, nw, nh);
  }
  return save(d);
}

// ---------- numeración ----------

export type Pos = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

export interface NumberOpts {
  position: Pos;
  format: 'n' | 'n/N' | 'Página n' | 'Página n de N' | '- n -';
  start: number;
  fontSize: number;
  color: string;
  margin: number;
  pages: number[]; // índices a numerar
  bold?: boolean;
}

function anchor(pos: Pos, dw: number, dh: number, tw: number, th: number, m: number) {
  const col = pos[1], row = pos[0];
  const x = col === 'l' ? m : col === 'r' ? dw - m - tw : (dw - tw) / 2;
  const top = row === 't' ? m : row === 'b' ? dh - m - th : (dh - th) / 2;
  return { x, top };
}

export async function addPageNumbers(bytes: Uint8Array, o: NumberOpts, password?: string) {
  const d = await loadPdf(bytes, password);
  const font = await d.embedFont(o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const total = o.pages.length;
  const color = hexToRgb(o.color);
  o.pages.forEach((idx, k) => {
    const n = o.start + k;
    const N = o.start + total - 1;
    const label = o.format.replace('n de N', `${n} de ${N}`).replace('n/N', `${n}/${N}`).replace(/\bn\b/, String(n));
    const p = d.getPage(idx);
    const { dw, dh, rot } = pageBox(p);
    const tw = font.widthOfTextAtSize(label, o.fontSize);
    const th = font.heightAtSize(o.fontSize, { descender: false });
    const a = anchor(o.position, dw, dh, tw, th, o.margin);
    const pt = toUser(p, a.x, a.top + th);
    p.drawText(label, { x: pt.x, y: pt.y, size: o.fontSize, font, color, rotate: degrees(rot) });
  });
  return save(d);
}

// ---------- marca de agua ----------

export interface WatermarkOpts {
  kind: 'text' | 'image';
  text?: string;
  image?: Blob;
  fontSize: number;
  color: string;
  opacity: number;
  angle: number; // grados (antihorario)
  layout: 'center' | 'tile' | Pos;
  scale: number; // imagen: fracción del lado menor
  pages: number[];
}

export async function addWatermark(bytes: Uint8Array, o: WatermarkOpts, password?: string) {
  const d = await loadPdf(bytes, password);
  const font = await d.embedFont(StandardFonts.HelveticaBold);
  let img: any = null;
  if (o.kind === 'image' && o.image) {
    const { bytes: ib, png } = await toJpegOrPng(o.image);
    img = png ? await d.embedPng(ib) : await d.embedJpg(ib);
  }
  const text = winAnsi(o.text || '');
  const color = hexToRgb(o.color);
  const th = (rad: number) => ({ c: Math.cos(rad), s: Math.sin(rad) });
  for (const idx of o.pages) {
    const p = d.getPage(idx);
    const { dw, dh, rot } = pageBox(p);
    let iw = 0, ih = 0;
    if (o.kind === 'text') {
      iw = font.widthOfTextAtSize(text, o.fontSize);
      ih = font.heightAtSize(o.fontSize, { descender: false });
    } else if (img) {
      const s = (Math.min(dw, dh) * o.scale) / Math.max(img.width, img.height);
      iw = img.width * s;
      ih = img.height * s;
    }
    const centers: { x: number; y: number }[] = [];
    if (o.layout === 'center') centers.push({ x: dw / 2, y: dh / 2 });
    else if (o.layout === 'tile') {
      const stepX = Math.max(iw * 1.4, 120), stepY = Math.max(ih * 4, 110);
      for (let y = stepY / 2; y < dh + stepY; y += stepY)
        for (let x = ((Math.round(y / stepY) % 2) * stepX) / 2; x < dw + stepX; x += stepX) centers.push({ x, y });
    } else {
      const a = anchor(o.layout, dw, dh, iw, ih, 24);
      centers.push({ x: a.x + iw / 2, y: a.top + ih / 2 });
    }
    const ang = o.layout === 'center' || o.layout === 'tile' ? o.angle : 0;
    const { c, s } = th((ang * Math.PI) / 180);
    for (const ctr of centers) {
      // vectores en pantalla (y hacia abajo)
      const ox = ctr.x - c * (iw / 2) + s * (ih / 2);
      const oy = ctr.y + s * (iw / 2) + c * (ih / 2);
      const pt = toUser(p, ox, oy);
      if (o.kind === 'text') {
        p.drawText(text, { x: pt.x, y: pt.y, size: o.fontSize, font, color, opacity: o.opacity, rotate: degrees(ang + rot) });
      } else if (img) {
        p.drawImage(img, { x: pt.x, y: pt.y, width: iw, height: ih, opacity: o.opacity, rotate: degrees(ang + rot) });
      }
    }
  }
  return save(d);
}

// ---------- comprimir ----------

export type CompressLevel = 'low' | 'medium' | 'high';
const LEVELS = { low: { max: 2600, q: 0.82 }, medium: { max: 1800, q: 0.7 }, high: { max: 1250, q: 0.55 } };

async function reencode(pixelsOrJpeg: { jpeg?: Uint8Array; raw?: { data: Uint8Array; w: number; h: number; comps: number } }, max: number, q: number) {
  let c: HTMLCanvasElement;
  if (pixelsOrJpeg.jpeg) {
    const bmp = await createImageBitmap(new Blob([pixelsOrJpeg.jpeg as BlobPart], { type: 'image/jpeg' }));
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
  } else {
    const { data, w, h, comps } = pixelsOrJpeg.raw!;
    const full = document.createElement('canvas');
    full.width = w;
    full.height = h;
    const ctx = full.getContext('2d')!;
    const id = ctx.createImageData(w, h);
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      const r = data[j], g = comps === 3 ? data[j + 1] : r, b = comps === 3 ? data[j + 2] : r;
      id.data[i * 4] = r;
      id.data[i * 4 + 1] = g;
      id.data[i * 4 + 2] = b;
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    const s = Math.min(1, max / Math.max(w, h));
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    const c2 = c.getContext('2d')!;
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(full, 0, 0, c.width, c.height);
  }
  const blob = await canvasToBlob(c, 'image/jpeg', q);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
}

function componentsOf(d: PDFDocument, cs: any): number | null {
  const v = cs instanceof PDFRef ? d.context.lookup(cs) : cs;
  if (v instanceof PDFName) {
    const n = v.asString();
    if (n === '/DeviceRGB') return 3;
    if (n === '/DeviceGray') return 1;
    return null;
  }
  if (v instanceof PDFArray) {
    const kind = (v.get(0) as any)?.asString?.();
    if (kind === '/ICCBased') {
      const st: any = d.context.lookup(v.get(1));
      const N = st?.dict?.lookup?.(PDFName.of('N'));
      const n = N instanceof PDFNumber ? N.asNumber() : null;
      return n === 3 || n === 1 ? n : null;
    }
  }
  return null;
}

export async function compressPdf(bytes: Uint8Array, level: CompressLevel, password?: string, onProgress?: (p: number) => void) {
  const d = await loadPdf(bytes, password);
  const { max, q } = LEVELS[level];
  const objs = d.context.enumerateIndirectObjects();
  const images = objs.filter(([, o]) => o instanceof PDFRawStream && (o as PDFRawStream).dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'));
  let i = 0;
  for (const [ref, obj] of images) {
    onProgress?.(i++ / Math.max(1, images.length));
    const st = obj as PDFRawStream;
    const dict = st.dict;
    try {
      if (dict.lookup(PDFName.of('ImageMask')) || dict.lookup(PDFName.of('Decode'))) continue;
      const filter = dict.lookup(PDFName.of('Filter'));
      const fname = filter instanceof PDFName ? filter.asString() : filter instanceof PDFArray && filter.size() === 1 ? (filter.get(0) as any).asString() : null;
      const W = (dict.lookup(PDFName.of('Width')) as PDFNumber)?.asNumber();
      const H = (dict.lookup(PDFName.of('Height')) as PDFNumber)?.asNumber();
      const bpc = (dict.lookup(PDFName.of('BitsPerComponent')) as PDFNumber)?.asNumber();
      const comps = componentsOf(d, dict.get(PDFName.of('ColorSpace')));
      if (!W || !H || W * H < 120 * 120 || !comps) continue;
      let res: { bytes: Uint8Array; w: number; h: number } | null = null;
      if (fname === '/DCTDecode') {
        res = await reencode({ jpeg: st.contents }, max, q);
      } else if (fname === '/FlateDecode' && bpc === 8 && !dict.lookup(PDFName.of('DecodeParms'))) {
        const raw = decodePDFRawStream(st).decode();
        if (raw.length < W * H * comps) continue;
        res = await reencode({ raw: { data: raw, w: W, h: H, comps } }, max, q);
      } else continue;
      if (!res || res.bytes.length > st.contents.length * 0.9) continue;
      const smask = dict.get(PDFName.of('SMask'));
      const nd: any = {
        Type: 'XObject',
        Subtype: 'Image',
        Width: res.w,
        Height: res.h,
        BitsPerComponent: 8,
        ColorSpace: 'DeviceRGB',
        Filter: 'DCTDecode',
      };
      if (smask) nd.SMask = smask;
      d.context.assign(ref, d.context.stream(res.bytes, nd));
    } catch (e) {
      console.warn('compress image', e);
    }
  }
  onProgress?.(1);
  return save(d);
}

// ---------- seguridad ----------

export interface Perms {
  print: boolean;
  copy: boolean;
  modify: boolean;
}

export async function protectPdf(bytes: Uint8Array, userPassword: string, perms: Perms, currentPassword?: string) {
  const d = await loadPdf(bytes, currentPassword);
  const restricted = !perms.print || !perms.copy || !perms.modify;
  const owner = restricted ? crypto.getRandomValues(new Uint32Array(4)).join('-') : userPassword;
  d.encrypt({
    userPassword,
    ownerPassword: owner,
    permissions: {
      printing: perms.print ? 'highResolution' : false,
      modifying: perms.modify,
      copying: perms.copy,
      annotating: perms.modify,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: perms.modify,
    } as any,
  });
  return d.save({ useObjectStreams: false });
}

export async function unprotectPdf(bytes: Uint8Array, password: string) {
  const d = await loadPdf(bytes, password);
  return save(d);
}

// ---------- formularios ----------

export type FormValue = string | boolean;

export async function fillForm(bytes: Uint8Array, values: Record<string, FormValue>, flatten: boolean, password?: string) {
  const d = await loadPdf(bytes, password);
  const form = d.getForm();
  for (const [name, v] of Object.entries(values)) {
    try {
      const f: any = form.getField(name);
      const type = f.constructor?.name || '';
      if (/TextField/.test(type)) f.setText(winAnsi(String(v ?? '')));
      else if (/CheckBox/.test(type)) v ? f.check() : f.uncheck();
      else if (/RadioGroup/.test(type)) {
        if (typeof v === 'string' && v) f.select(v);
      } else if (/Dropdown|OptionList/.test(type)) {
        if (typeof v === 'string' && v) f.select(v);
      }
    } catch (e) {
      console.warn('campo', name, e);
    }
  }
  if (flatten) {
    try {
      form.flatten();
    } catch (e) {
      console.warn('flatten', e);
    }
  }
  return save(d);
}

// ---------- anotaciones ----------

export type Annot =
  | { id: string; page: number; type: 'ink'; pts: { x: number; y: number }[]; color: string; width: number; opacity: number }
  | { id: string; page: number; type: 'highlight' | 'whiteout' | 'rect'; x: number; y: number; w: number; h: number; color: string; width?: number }
  | { id: string; page: number; type: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { id: string; page: number; type: 'text'; x: number; y: number; w: number; text: string; size: number; color: string; bold?: boolean }
  | { id: string; page: number; type: 'note'; x: number; y: number; text: string; color: string }
  | { id: string; page: number; type: 'image'; x: number; y: number; w: number; h: number; src: string; signature?: boolean };

/** Escribe las anotaciones dentro del PDF (coordenadas de pantalla a escala 1). */
export async function applyAnnotations(bytes: Uint8Array, annots: Annot[], password?: string) {
  const d = await loadPdf(bytes, password);
  const font = await d.embedFont(StandardFonts.Helvetica);
  const bold = await d.embedFont(StandardFonts.HelveticaBold);
  const imgCache = new Map<string, any>();
  for (const a of annots) {
    const p = d.getPage(a.page);
    const { rot } = pageBox(p);
    const U = (x: number, y: number) => toUser(p, x, y);
    const rectUser = (x: number, y: number, w: number, h: number) => {
      const c = [U(x, y), U(x + w, y), U(x, y + h), U(x + w, y + h)];
      const xs = c.map((q) => q.x), ys = c.map((q) => q.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    };
    switch (a.type) {
      case 'ink': {
        if (a.pts.length < 2) break;
        const path = a.pts.map((q, i) => {
          const u = U(q.x, q.y);
          return `${i ? 'L' : 'M'}${u.x.toFixed(2)},${(-u.y).toFixed(2)}`;
        }).join(' ');
        p.drawSvgPath(path, {
          x: 0,
          y: 0,
          borderColor: hexToRgb(a.color),
          borderWidth: a.width,
          borderOpacity: a.opacity,
          borderLineCap: LineCapStyle.Round,
          blendMode: a.opacity < 1 ? BlendMode.Multiply : undefined,
        } as any);
        break;
      }
      case 'highlight':
        p.drawRectangle({ ...rectUser(a.x, a.y, a.w, a.h), color: hexToRgb(a.color), opacity: 0.4, blendMode: BlendMode.Multiply });
        break;
      case 'whiteout':
        p.drawRectangle({ ...rectUser(a.x, a.y, a.w, a.h), color: hexToRgb(a.color || '#ffffff') });
        break;
      case 'rect':
        p.drawRectangle({ ...rectUser(a.x, a.y, a.w, a.h), borderColor: hexToRgb(a.color), borderWidth: a.width || 2 });
        break;
      case 'line':
      case 'arrow': {
        const s = U(a.x1, a.y1), e = U(a.x2, a.y2);
        const col = hexToRgb(a.color);
        p.drawLine({ start: s, end: e, thickness: a.width, color: col, lineCap: LineCapStyle.Round });
        if (a.type === 'arrow') {
          const ang = Math.atan2(e.y - s.y, e.x - s.x);
          const L = Math.max(10, a.width * 4);
          for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
            p.drawLine({ start: e, end: { x: e.x + L * Math.cos(ang + da), y: e.y + L * Math.sin(ang + da) }, thickness: a.width, color: col, lineCap: LineCapStyle.Round });
          }
        }
        break;
      }
      case 'text': {
        const f = a.bold ? bold : font;
        const lines = a.text.split('\n');
        lines.forEach((ln, i) => {
          const pt = U(a.x, a.y + a.size * (i * 1.25 + 0.92));
          p.drawText(winAnsi(ln), { x: pt.x, y: pt.y, size: a.size, font: f, color: hexToRgb(a.color), rotate: degrees(rot) });
        });
        break;
      }
      case 'note': {
        const pt = U(a.x, a.y + 22);
        const c = hexToRgb(a.color);
        const annot = d.context.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [pt.x, pt.y, pt.x + 22, pt.y + 22],
          Contents: PDFHexString.fromText(a.text),
          T: PDFHexString.fromText('DocuFácil'),
          Name: 'Comment',
          C: [(c as any).red, (c as any).green, (c as any).blue],
          F: 4,
          Open: false,
        } as any);
        p.node.addAnnot(d.context.register(annot));
        // icono visible también al imprimir
        const r = rectUser(a.x, a.y, 20, 20);
        p.drawRectangle({ ...r, color: c, opacity: 0.85, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.5 });
        break;
      }
      case 'image': {
        let img = imgCache.get(a.src);
        if (!img) {
          const b = await (await fetch(a.src)).blob();
          const { bytes: ib, png } = await toJpegOrPng(b);
          img = png ? await d.embedPng(ib) : await d.embedJpg(ib);
          imgCache.set(a.src, img);
        }
        const pt = U(a.x, a.y + a.h);
        p.drawImage(img, { x: pt.x, y: pt.y, width: a.w, height: a.h, rotate: degrees(rot) });
        break;
      }
    }
  }
  return save(d);
}

/** Hace buscable un PDF escaneado: añade texto invisible sobre las páginas sin texto. */
export async function addOcrLayers(bytes: Uint8Array, layers: Map<number, OcrResult>, password?: string) {
  const d = await loadPdf(bytes, password);
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (const [idx, ocr] of layers) {
    const p = d.getPage(idx);
    const { dw, dh, rot } = pageBox(p);
    if (rot === 0) {
      const { x0, y0 } = pageBox(p);
      addTextLayer(d, p, font, ocr, { x: x0, y: y0, w: dw, h: dh });
    } else {
      // Páginas giradas: usamos texto con opacidad 0 posicionado en pantalla
      const sx = dw / ocr.width, sy = dh / ocr.height;
      for (const l of ocr.lines)
        for (const w of l.words) {
          const t = winAnsi(w.text);
          if (!t.trim()) continue;
          const hpt = (w.y1 - w.y0) * sy;
          const pt = toUser(p, w.x0 * sx, w.y1 * sy - hpt * 0.18);
          p.drawText(t, { x: pt.x, y: pt.y, size: hpt * 0.95, font, opacity: 0, rotate: degrees(rot) });
        }
    }
  }
  return save(d);
}

export { PDFDocument, PDFDict };
