// Conversiones entre formatos, gratis y en el navegador.
import { openPdf, pageLines, linesToParagraphs, renderPage, closePdf, type Line } from './pdf';
import { ocrImage, type OcrResult } from './ocr';
import { blobToDataURL, canvasToBlob, baseName } from './util';

type Progress = (p: number, text?: string) => void;

// ---------- pdfmake (para generar PDF con texto real) ----------

let pm: any = null;
async function pdfMake() {
  if (pm) return pm;
  const mod: any = await import('pdfmake/build/pdfmake');
  const vfsMod: any = await import('pdfmake/build/vfs_fonts');
  pm = mod.default || mod;
  const vfs = vfsMod.default || vfsMod.vfs || vfsMod;
  if (pm.addVirtualFileSystem) pm.addVirtualFileSystem(vfs);
  else pm.vfs = vfs;
  return pm;
}

async function makePdf(docDef: any): Promise<Blob> {
  const p = await pdfMake();
  const doc = p.createPdf({ defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.2 }, pageMargins: [48, 48, 48, 48], ...docDef });
  const b = await doc.getBlob();
  return b instanceof Blob ? b : new Blob([b], { type: 'application/pdf' });
}

async function htmlToContent(html: string) {
  const htmlToPdfmake: any = (await import('html-to-pdfmake')).default;
  return htmlToPdfmake(html, {
    window,
    imagesByReference: false,
    removeExtraBlanks: true,
    defaultStyles: { h1: { fontSize: 22, bold: true, marginBottom: 8 }, h2: { fontSize: 18, bold: true, marginBottom: 6 }, h3: { fontSize: 15, bold: true }, p: { margin: [0, 3, 0, 6] }, td: { margin: [3, 2, 3, 2] } },
  });
}

/** Limpia HTML: quita scripts, estilos e imágenes externas (no se pueden descargar sin servidor). */
function sanitizeHtml(html: string, keepExternalImages = false) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,iframe,object,embed,svg,video,audio,form,button,input,select,textarea,nav,footer,link,meta').forEach((n) => n.remove());
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:') && !keepExternalImages) img.remove();
  });
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) if (!['src', 'href', 'colspan', 'rowspan', 'width', 'height'].includes(a.name)) el.removeAttribute(a.name);
  });
  return doc.body.innerHTML;
}

// ---------- Office / texto → PDF ----------

export async function docxToPdf(file: Blob): Promise<Blob> {
  const mammoth: any = await import('mammoth');
  const res = await (mammoth.default || mammoth).convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    { convertImage: (mammoth.default || mammoth).images.dataUri },
  );
  const content = await htmlToContent(sanitizeHtml(res.value));
  return makePdf({ content });
}

export async function docxToHtml(file: Blob): Promise<string> {
  const mammoth: any = await import('mammoth');
  const m = mammoth.default || mammoth;
  const res = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { convertImage: m.images.dataUri });
  return res.value;
}

export async function readSheets(file: Blob): Promise<{ name: string; rows: any[][] }[]> {
  const XLSX: any = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return wb.SheetNames.map((name: string) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }) as any[][],
  }));
}

export async function sheetToPdf(file: Blob): Promise<Blob> {
  const sheets = await readSheets(file);
  const content: any[] = [];
  sheets.forEach((s, si) => {
    const rows = s.rows.filter((r) => r.some((c) => String(c).trim()));
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.length));
    const body = rows.map((r) => Array.from({ length: cols }, (_, i) => ({ text: String(r[i] ?? ''), fontSize: cols > 10 ? 6.5 : cols > 6 ? 8 : 9.5 })));
    body[0] = body[0].map((c) => ({ ...c, bold: true, fillColor: '#e8eefc' }));
    if (sheets.length > 1) content.push({ text: s.name, style: 'h', pageBreak: si > 0 ? 'before' : undefined, margin: [0, 0, 0, 8] });
    content.push({ table: { headerRows: 1, widths: Array(cols).fill('*'), body }, layout: 'lightHorizontalLines' });
  });
  if (!content.length) content.push({ text: '(Hoja vacía)' });
  const maxCols = Math.max(...sheets.map((s) => Math.max(0, ...s.rows.map((r) => r.length))));
  return makePdf({
    content,
    pageOrientation: maxCols > 6 ? 'landscape' : 'portrait',
    pageMargins: [28, 32, 28, 32],
    styles: { h: { fontSize: 15, bold: true } },
  });
}

export async function textToPdf(text: string, title?: string): Promise<Blob> {
  const content: any[] = [];
  if (title) content.push({ text: title, fontSize: 16, bold: true, margin: [0, 0, 0, 10] });
  content.push({ text, preserveLeadingSpaces: true });
  return makePdf({ content });
}

export async function csvToPdf(file: Blob) {
  return sheetToPdf(file);
}

export async function htmlToPdf(html: string, title?: string): Promise<Blob> {
  const content = await htmlToContent(sanitizeHtml(html));
  return makePdf({ content, info: { title } });
}

/** Intenta descargar una página web (sólo funciona si el sitio lo permite). */
export async function fetchWebPage(url: string): Promise<{ html: string; title: string }> {
  const u = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const res = await fetch(u, { mode: 'cors' });
  if (!res.ok) throw new Error('No se pudo abrir la página (' + res.status + ')');
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('article') || doc.querySelector('main') || doc.body;
  return { html: main?.innerHTML || html, title: doc.title || u };
}

export async function pptxToPdf(file: Blob, onProgress?: Progress): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const pres = await zip.file('ppt/presentation.xml')?.async('string');
  const parser = new DOMParser();
  let cx = 9144000, cy = 5143500; // 16:9 por defecto (EMU)
  if (pres) {
    const sz = parser.parseFromString(pres, 'application/xml').getElementsByTagName('p:sldSz')[0];
    if (sz) {
      cx = parseInt(sz.getAttribute('cx') || '9144000', 10);
      cy = parseInt(sz.getAttribute('cy') || '5143500', 10);
    }
  }
  const EMU = 12700; // EMU por punto
  const pw = cx / EMU, ph = cy / EMU;
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)![1]) - parseInt(b.match(/(\d+)\.xml$/)![1]));
  const content: any[] = [];
  for (let si = 0; si < slides.length; si++) {
    onProgress?.(si / slides.length, `Diapositiva ${si + 1} de ${slides.length}`);
    const xml = parser.parseFromString(await zip.file(slides[si])!.async('string'), 'application/xml');
    const relsPath = slides[si].replace('slides/', 'slides/_rels/') + '.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    const rels = new Map<string, string>();
    if (relsXml) {
      for (const r of Array.from(parser.parseFromString(relsXml, 'application/xml').getElementsByTagName('Relationship'))) {
        rels.set(r.getAttribute('Id')!, r.getAttribute('Target')!);
      }
    }
    const items: any[] = [];
    const pos = (el: Element) => {
      const off = el.getElementsByTagName('a:off')[0];
      const ext = el.getElementsByTagName('a:ext')[0];
      return {
        x: off ? parseInt(off.getAttribute('x') || '0') / EMU : 0,
        y: off ? parseInt(off.getAttribute('y') || '0') / EMU : 0,
        w: ext ? parseInt(ext.getAttribute('cx') || '0') / EMU : pw,
        h: ext ? parseInt(ext.getAttribute('cy') || '0') / EMU : 40,
      };
    };
    for (const pic of Array.from(xml.getElementsByTagName('p:pic'))) {
      const blip = pic.getElementsByTagName('a:blip')[0];
      const rid = blip?.getAttribute('r:embed');
      const target = rid && rels.get(rid);
      if (!target) continue;
      const path = 'ppt/' + target.replace(/^\.\.\//, '');
      const f = zip.file(path);
      if (!f || !/\.(png|jpe?g)$/i.test(path)) continue;
      const b64 = await f.async('base64');
      const p = pos(pic);
      items.push({ image: `data:image/${/png$/i.test(path) ? 'png' : 'jpeg'};base64,${b64}`, width: p.w, height: p.h, absolutePosition: { x: p.x, y: p.y } });
    }
    for (const sp of Array.from(xml.getElementsByTagName('p:sp'))) {
      const paras = Array.from(sp.getElementsByTagName('a:p'));
      const texts = paras.map((p) => Array.from(p.getElementsByTagName('a:t')).map((t) => t.textContent).join('')).filter((t) => t.trim());
      if (!texts.length) continue;
      const p = pos(sp);
      const rPr = sp.getElementsByTagName('a:rPr')[0];
      const szAttr = rPr?.getAttribute('sz');
      const isTitle = !!sp.getElementsByTagName('p:ph')[0]?.getAttribute('type')?.match(/title|ctrTitle/);
      const fontSize = szAttr ? parseInt(szAttr) / 100 : isTitle ? 30 : 16;
      items.push({
        text: texts.join('\n'),
        fontSize: Math.min(60, fontSize),
        bold: isTitle || rPr?.getAttribute('b') === '1',
        absolutePosition: { x: p.x + 4, y: p.y + 4 },
        width: p.w,
      });
    }
    content.push({ stack: items.length ? items : [{ text: ' ' }], pageBreak: si > 0 ? 'before' : undefined });
  }
  if (!content.length) throw new Error('No se encontraron diapositivas.');
  return makePdf({ content, pageSize: { width: pw, height: ph }, pageMargins: [0, 0, 0, 0] });
}

// ---------- PDF → otros ----------

async function pageTextOrOcr(page: any, useOcr: boolean, lang: string): Promise<{ lines: Line[]; width: number; height: number; ocr?: OcrResult }> {
  const r = await pageLines(page);
  if (r.lines.length || !useOcr) return r;
  const c = await renderPage(page, 2);
  const ocr = await ocrImage(c, lang);
  const s = 0.5;
  const lines: Line[] = ocr.lines.map((l) => ({
    text: l.text,
    x: l.words[0].x0 * s,
    y: l.y0 * s,
    w: (l.words[l.words.length - 1].x1 - l.words[0].x0) * s,
    h: (l.y1 - l.y0) * s,
    items: l.words.map((w) => ({ str: w.text, x: w.x0 * s, w: (w.x1 - w.x0) * s })),
  }));
  return { lines, width: r.width, height: r.height, ocr };
}

export async function pdfToDocx(
  bytes: Uint8Array,
  opts: { ocr: boolean; lang: string; includeImages: boolean; password?: string },
  onProgress?: Progress,
): Promise<Blob> {
  const docx = await import('docx');
  const doc = await openPdf(bytes, opts.password);
  const children: any[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.((i - 1) / doc.numPages, `Página ${i} de ${doc.numPages}`);
    const page = await doc.getPage(i);
    const r = await pageTextOrOcr(page, opts.ocr, opts.lang);
    if (opts.includeImages && !r.lines.length) {
      const c = await renderPage(page, 1.5);
      const data = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.85)).arrayBuffer());
      const w = 600, h = Math.round((c.height / c.width) * 600);
      children.push(new docx.Paragraph({ children: [new docx.ImageRun({ data, transformation: { width: w, height: h }, type: 'jpg' } as any)] }));
    }
    for (const p of linesToParagraphs(r.lines)) {
      children.push(
        new docx.Paragraph({
          heading: p.heading ? (p.size > 20 ? docx.HeadingLevel.HEADING_1 : docx.HeadingLevel.HEADING_2) : undefined,
          spacing: { after: 120 },
          children: [new docx.TextRun({ text: p.text, size: Math.round(Math.min(48, Math.max(16, p.size * 2))) })],
        }),
      );
    }
    if (i < doc.numPages) children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
  }
  closePdf(doc);
  const d = new docx.Document({ creator: 'DocuFácil', sections: [{ children }] });
  return docx.Packer.toBlob(d);
}

export async function textToDocx(paragraphs: string[][], images?: Blob[]): Promise<Blob> {
  const docx = await import('docx');
  const children: any[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    if (images?.[i]) {
      const bmp = await createImageBitmap(images[i]);
      const w = 600, h = Math.round((bmp.height / bmp.width) * 600);
      bmp.close();
      const data = new Uint8Array(await images[i].arrayBuffer());
      children.push(new docx.Paragraph({ children: [new docx.ImageRun({ data, transformation: { width: w, height: h }, type: 'jpg' } as any)] }));
    }
    for (const p of paragraphs[i])
      children.push(
        new docx.Paragraph({
          spacing: { after: 120 },
          children: p.split('\n').map((ln, k) => new docx.TextRun({ text: ln, break: k > 0 ? 1 : undefined })),
        }),
      );
    if (i < paragraphs.length - 1) children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
  }
  const d = new docx.Document({ creator: 'DocuFácil', sections: [{ children }] });
  return docx.Packer.toBlob(d);
}

export async function pdfToXlsx(bytes: Uint8Array, opts: { ocr: boolean; lang: string; password?: string }, onProgress?: Progress): Promise<Blob> {
  const XLSX: any = await import('xlsx');
  const doc = await openPdf(bytes, opts.password);
  const wb = XLSX.utils.book_new();
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.((i - 1) / doc.numPages, `Página ${i} de ${doc.numPages}`);
    const page = await doc.getPage(i);
    const { lines, width } = await pageTextOrOcr(page, opts.ocr, opts.lang);
    // Agrupa los fragmentos en columnas según su posición horizontal
    const segs: { x: number; text: string; line: number }[] = [];
    lines.forEach((l, li) => {
      let cur: { x: number; text: string; end: number } | null = null;
      for (const it of l.items) {
        if (cur && it.x - cur.end < l.h * 0.9) {
          cur.text += (it.x - cur.end > l.h * 0.2 ? ' ' : '') + it.str;
          cur.end = it.x + it.w;
        } else {
          if (cur) segs.push({ x: cur.x, text: cur.text.trim(), line: li });
          cur = { x: it.x, text: it.str, end: it.x + it.w };
        }
      }
      if (cur) segs.push({ x: cur.x, text: cur.text.trim(), line: li });
    });
    const xs = segs.map((s) => s.x).sort((a, b) => a - b);
    const cols: number[] = [];
    const tol = width * 0.025;
    for (const x of xs) if (!cols.length || x - cols[cols.length - 1] > tol) cols.push(x);
    const colOf = (x: number) => {
      let best = 0;
      for (let c = 0; c < cols.length; c++) if (Math.abs(cols[c] - x) < Math.abs(cols[best] - x)) best = c;
      return best;
    };
    const rows: string[][] = lines.map(() => Array(cols.length).fill(''));
    for (const s of segs) {
      const c = colOf(s.x);
      rows[s.line][c] = rows[s.line][c] ? rows[s.line][c] + ' ' + s.text : s.text;
    }
    const clean = rows.map((r) => r.map((v) => (/^-?[\d.,]+$/.test(v) && !/^0\d/.test(v) ? toNumber(v) : v)));
    const ws = XLSX.utils.aoa_to_sheet(clean.length ? clean : [['']]);
    XLSX.utils.book_append_sheet(wb, ws, `Página ${i}`);
  }
  closePdf(doc);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function toNumber(v: string): number | string {
  let s = v;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return isFinite(n) ? n : v;
}

export async function pdfToPptx(bytes: Uint8Array, opts: { mode: 'image' | 'text'; ocr: boolean; lang: string; password?: string }, onProgress?: Progress): Promise<Blob> {
  const PptxGenJS: any = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  const doc = await openPdf(bytes, opts.password);
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const W = 10, H = (first.height / first.width) * 10;
  pptx.defineLayout({ name: 'PDF', width: W, height: H });
  pptx.layout = 'PDF';
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.((i - 1) / doc.numPages, `Página ${i} de ${doc.numPages}`);
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const slide = pptx.addSlide();
    const k = W / vp.width; // pulgadas por punto
    if (opts.mode === 'image') {
      const c = await renderPage(page, 2);
      slide.addImage({ data: c.toDataURL('image/jpeg', 0.88), x: 0, y: 0, w: W, h: (vp.height / vp.width) * W });
    } else {
      const { lines } = await pageTextOrOcr(page, opts.ocr, opts.lang);
      for (const l of lines) {
        slide.addText(l.text, {
          x: l.x * k,
          y: l.y * k,
          w: Math.max(0.5, l.w * k + 0.3),
          h: Math.max(0.2, l.h * k * 1.5),
          fontSize: Math.max(6, l.h * 0.95),
          margin: 0,
          valign: 'top',
          fit: 'none',
        });
      }
    }
  }
  closePdf(doc);
  const out = await pptx.write({ outputType: 'blob' });
  return out as Blob;
}

export async function pdfToImages(bytes: Uint8Array, dpi: number, format: 'jpg' | 'png', password?: string, onProgress?: Progress, pages?: number[]): Promise<Blob[]> {
  const doc = await openPdf(bytes, password);
  const out: Blob[] = [];
  const list = pages ?? Array.from({ length: doc.numPages }, (_, i) => i);
  for (let k = 0; k < list.length; k++) {
    onProgress?.(k / list.length, `Página ${k + 1} de ${list.length}`);
    const page = await doc.getPage(list[k] + 1);
    const c = await renderPage(page, dpi / 72);
    out.push(await canvasToBlob(c, format === 'png' ? 'image/png' : 'image/jpeg', 0.92));
    c.width = c.height = 0;
  }
  closePdf(doc);
  return out;
}

/** Extrae las imágenes incrustadas en el PDF a su resolución original. */
export async function extractImages(bytes: Uint8Array, password?: string, onProgress?: Progress): Promise<Blob[]> {
  const { pdfjs } = await import('./pdf');
  const doc = await openPdf(bytes, password);
  const out: Blob[] = [];
  const seen = new Set<string>();
  const OPS = pdfjs.OPS as any;
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.((i - 1) / doc.numPages, `Página ${i} de ${doc.numPages}`);
    const page: any = await doc.getPage(i);
    const ops = await page.getOperatorList();
    for (let j = 0; j < ops.fnArray.length; j++) {
      const fn = ops.fnArray[j];
      let img: any = null;
      let key = '';
      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        key = ops.argsArray[j][0];
        if (seen.has(key)) continue;
        const store = key.startsWith('g_') ? page.commonObjs : page.objs;
        img = await new Promise((res) => {
          try {
            if (store.has(key)) res(store.get(key));
            else store.get(key, res);
          } catch {
            res(null);
          }
        });
      } else if (fn === OPS.paintInlineImageXObject) {
        img = ops.argsArray[j][0];
        key = 'inline-' + i + '-' + j;
      } else continue;
      seen.add(key);
      if (!img || (img.width || img.bitmap?.width || 0) < 24) continue;
      const blob = await imageObjToBlob(img);
      if (blob) out.push(blob);
    }
  }
  closePdf(doc);
  return out;
}

async function imageObjToBlob(img: any): Promise<Blob | null> {
  const w = img.bitmap?.width ?? img.width;
  const h = img.bitmap?.height ?? img.height;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const id = ctx.createImageData(w, h);
    const src: Uint8Array = img.data;
    if (img.kind === 3) id.data.set(src.subarray(0, w * h * 4));
    else if (img.kind === 2) {
      for (let i = 0, j = 0; i < w * h; i++, j += 3) {
        id.data[i * 4] = src[j];
        id.data[i * 4 + 1] = src[j + 1];
        id.data[i * 4 + 2] = src[j + 2];
        id.data[i * 4 + 3] = 255;
      }
    } else if (img.kind === 1) {
      const rowBytes = (w + 7) >> 3;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0;
          const k = (y * w + x) * 4;
          id.data[k] = id.data[k + 1] = id.data[k + 2] = v;
          id.data[k + 3] = 255;
        }
    } else return null;
    ctx.putImageData(id, 0, 0);
  } else return null;
  return canvasToBlob(c, 'image/png');
}

export async function imageToDataURL(b: Blob) {
  return blobToDataURL(b);
}

export function outName(src: string, ext: string, suffix = '') {
  return `${baseName(src)}${suffix}.${ext}`;
}
