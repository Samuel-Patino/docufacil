// Reconocimiento de texto (OCR) con Tesseract.js, gratis y en el dispositivo.
import type { Worker } from 'tesseract.js';

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  conf: number;
}
export interface OcrLine {
  text: string;
  words: OcrWord[];
  y0: number;
  y1: number;
}
export interface OcrResult {
  text: string;
  lines: OcrLine[];
  paragraphs: string[];
  width: number;
  height: number;
  confidence: number;
}

export const OCR_LANGS: { id: string; label: string }[] = [
  { id: 'spa+eng', label: 'Español + Inglés' },
  { id: 'spa', label: 'Español' },
  { id: 'eng', label: 'Inglés' },
  { id: 'por', label: 'Portugués' },
  { id: 'fra', label: 'Francés' },
  { id: 'ita', label: 'Italiano' },
  { id: 'deu', label: 'Alemán' },
];

let worker: Worker | null = null;
let workerLang = '';
let progressCb: ((p: number, status: string) => void) | null = null;

const STATUS: Record<string, string> = {
  'loading tesseract core': 'Preparando el lector de texto…',
  'initializing tesseract': 'Preparando el lector de texto…',
  'loading language traineddata': 'Descargando idioma (sólo la primera vez)…',
  'initializing api': 'Preparando…',
  'recognizing text': 'Leyendo el texto…',
};

async function getWorker(lang: string): Promise<Worker> {
  if (worker && workerLang === lang) return worker;
  if (worker) await worker.terminate();
  const T = await import('tesseract.js');
  worker = await T.createWorker(lang.split('+'), T.OEM.LSTM_ONLY, {
    logger: (m: any) => progressCb?.(m.progress ?? 0, STATUS[m.status] || 'Leyendo el texto…'),
  });
  workerLang = lang;
  return worker;
}

async function sizeOf(img: Blob | HTMLCanvasElement) {
  if (img instanceof HTMLCanvasElement) return { width: img.width, height: img.height };
  const b = await createImageBitmap(img);
  const r = { width: b.width, height: b.height };
  b.close();
  return r;
}

export async function ocrImage(
  img: Blob | HTMLCanvasElement,
  lang = 'spa+eng',
  onProgress?: (p: number, status: string) => void,
): Promise<OcrResult> {
  progressCb = onProgress || null;
  try {
    const w = await getWorker(lang);
    const { width, height } = await sizeOf(img);
    const r = await w.recognize(img as any, {}, { text: true, blocks: true } as any);
    const data: any = r.data;
    const lines: OcrLine[] = [];
    const paragraphs: string[] = [];
    for (const b of data.blocks || []) {
      for (const p of b.paragraphs || []) {
        const ptxt: string[] = [];
        for (const l of p.lines || []) {
          const words: OcrWord[] = (l.words || [])
            .filter((wd: any) => wd.text?.trim() && wd.confidence > 20)
            .map((wd: any) => ({ text: wd.text, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1, conf: wd.confidence }));
          if (!words.length) continue;
          const text = words.map((x) => x.text).join(' ');
          lines.push({ text, words, y0: l.bbox.y0, y1: l.bbox.y1 });
          ptxt.push(text);
        }
        // Conservamos los saltos de línea (recibos, listas, direcciones)
        if (ptxt.length) paragraphs.push(ptxt.join('\n'));
      }
    }
    return { text: (data.text || '').trim(), lines, paragraphs, width, height, confidence: data.confidence || 0 };
  } finally {
    progressCb = null;
  }
}

export async function terminateOcr() {
  if (worker) await worker.terminate();
  worker = null;
  workerLang = '';
}

// ---------- Zona MRZ (pasaportes y cédulas con zona de lectura mecánica) ----------

export interface MrzData {
  valid: boolean;
  format: string;
  fields: Record<string, string | null>;
  lines: string[];
}

export async function readMRZ(canvas: HTMLCanvasElement): Promise<MrzData | null> {
  const T = await import('tesseract.js');
  const { parse } = await import('mrz');
  // Tomamos el 40% inferior, ampliado, en blanco y negro y con margen
  const h = Math.round(canvas.height * 0.4);
  const scale = 2000 / canvas.width;
  const pad = 40;
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * scale) + pad * 2;
  c.height = Math.round(h * scale) + pad * 2;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.filter = 'grayscale(1) contrast(1.6)';
  ctx.drawImage(canvas, 0, canvas.height - h, canvas.width, h, pad, pad, c.width - pad * 2, c.height - pad * 2);
  ctx.filter = 'none';
  const id = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  for (let i = 0; i < id.data.length; i += 4) sum += id.data[i];
  const thr = Math.min(170, (sum / (id.data.length / 4)) * 0.72);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = id.data[i] < thr ? 0 : 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  const w = await T.createWorker('eng', T.OEM.LSTM_ONLY);
  try {
    await w.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      tessedit_pageseg_mode: T.PSM.SINGLE_BLOCK,
    } as any);
    const r = await w.recognize(c, {}, { text: true, blocks: true } as any);
    // Símbolos de cada línea con su posición: la MRZ usa letras de ancho fijo,
    // así que alineamos cada símbolo a su casilla (corrige "<" leído como "<K" o "L").
    type Sym = { ch: string; x0: number; x1: number };
    const symLines: Sym[][] = [];
    for (const b of (r.data as any).blocks || [])
      for (const p of b.paragraphs || [])
        for (const l of p.lines || []) {
          const syms: Sym[] = [];
          for (const wd of l.words || []) for (const s of wd.symbols || []) if (s.text?.trim()) syms.push({ ch: s.text.toUpperCase(), x0: s.bbox.x0, x1: s.bbox.x1 });
          if (syms.length >= 20) symLines.push(syms);
        }
    if (!symLines.length) return null;
    const align = (syms: Sym[], n: number): string => {
      const x0 = syms[0].x0, x1 = syms[syms.length - 1].x1;
      const cw = (x1 - x0) / n;
      const cells: string[][] = Array.from({ length: n }, () => []);
      for (const s of syms) {
        const k = Math.min(n - 1, Math.max(0, Math.floor(((s.x0 + s.x1) / 2 - x0) / cw)));
        cells[k].push(s.ch);
      }
      let out = cells.map((c) => (!c.length || c.includes('<') ? '<' : c[0])).join('');
      // relleno final mal leído (LLLL / KKK) → <<<<
      out = out.replace(/[<LK]{3,}$/, (m) => '<'.repeat(m.length));
      return out;
    };
    const tries: string[][] = [];
    // Pasaporte (TD3): corrige letras/números confundidos usando los dígitos de control
    const td3 = symLines.slice(-2);
    if (td3.length === 2) {
      const [a, b] = td3.map((l) => align(l, 44));
      tries.push([a, fixTd3Line2(b)]);
    }
    const last3 = symLines.slice(-3);
    if (last3.length === 3) tries.push(last3.map((l) => align(l, 30)));
    const two = symLines.slice(-2);
    if (two.length === 2) {
      tries.push(two.map((l) => align(l, 44)));
      tries.push(two.map((l) => align(l, 36)));
    }
    let best: MrzData | null = null;
    for (const t of tries) {
      try {
        const p: any = parse(t, { autocorrect: true });
        const cand: MrzData = { valid: p.valid, format: p.format, fields: p.fields, lines: t };
        if (p.valid) return cand;
        const score = Object.values(p.fields || {}).filter(Boolean).length;
        const bs = best ? Object.values(best.fields).filter(Boolean).length : -1;
        if (score > bs) best = cand;
      } catch {}
    }
    return best;
  } finally {
    await w.terminate();
  }
}

const TO_DIGIT: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '7': 'T' };
const CONFUSE: Record<string, string[]> = {
  '0': ['O', 'D'], O: ['0', 'D'], D: ['0', 'O'], '1': ['I', 'L'], I: ['1', 'L'], L: ['1', 'I'],
  '2': ['Z'], Z: ['2', '7'], '5': ['S'], S: ['5'], '8': ['B'], B: ['8'], '6': ['G'], G: ['6'], '7': ['T', 'Z'], T: ['7'],
};

function checkDigit(s: string): string {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const v = c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
    sum += v * w[i % 3];
  }
  return String(sum % 10);
}

/** Prueba sustituciones de caracteres parecidos hasta que cuadre el dígito de control. */
function solveField(field: string, check: string): string {
  if (checkDigit(field) === check) return field;
  const idx = [...field].map((c, i) => (CONFUSE[c] ? i : -1)).filter((i) => i >= 0);
  for (const i of idx)
    for (const alt of CONFUSE[field[i]]) {
      const f = field.slice(0, i) + alt + field.slice(i + 1);
      if (checkDigit(f) === check) return f;
    }
  for (let a = 0; a < idx.length; a++)
    for (let b = a + 1; b < idx.length; b++)
      for (const x of CONFUSE[field[idx[a]]])
        for (const y of CONFUSE[field[idx[b]]]) {
          const arr = [...field];
          arr[idx[a]] = x;
          arr[idx[b]] = y;
          const f = arr.join('');
          if (checkDigit(f) === check) return f;
        }
  return field;
}

function fixTd3Line2(l: string): string {
  const ch = [...l.padEnd(44, '<').slice(0, 44)];
  const digits = [9, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 42, 43];
  const letters = [10, 11, 12];
  for (const i of digits) if (TO_DIGIT[ch[i]]) ch[i] = TO_DIGIT[ch[i]];
  for (const i of letters) if (TO_LETTER[ch[i]]) ch[i] = TO_LETTER[ch[i]];
  if (!/[MF<]/.test(ch[20])) ch[20] = '<';
  let s = ch.join('');
  const doc = solveField(s.slice(0, 9), s[9]);
  const opt = solveField(s.slice(28, 42), s[42]);
  s = doc + s.slice(9, 28) + opt + s.slice(42);
  return s;
}

export function formatMrzDate(v: string | null | undefined) {
  if (!v || !/^\d{6}$/.test(v)) return v || '';
  const yy = parseInt(v.slice(0, 2), 10);
  const now = new Date().getFullYear() % 100;
  const century = yy > now + 15 ? 1900 : 2000;
  return `${v.slice(4, 6)}/${v.slice(2, 4)}/${century + yy}`;
}
