// Traducción sobre la imagen (estilo "Lens"): borra el texto original de la foto
// rellenando el fondo y escribe la traducción en el mismo lugar, tamaño y color.
import { loadCV } from './cv';
import { newCanvas } from './imaging';
import type { OcrLine } from './ocr';

export interface LensUnit {
  /** Índice del párrafo de OCR al que pertenece */
  para: number;
  lines: OcrLine[];
  text: string;
}

interface UnitStyle {
  color: string;
  bg: [number, number, number];
  weight: number;
  upper: boolean;
}

export interface LensPrep {
  erased: HTMLCanvasElement;
  styles: UnitStyle[];
}

/** Las líneas de un párrafo se juntan cuando la frase continúa; listas y títulos quedan separados. */
export function continues(prev: string, next: string) {
  return !/[.:;!?)]$/.test(prev.trim()) && /^[a-záéíóúñüàèìòùâêîôûçäöß(“"']/.test(next.trim());
}

export function buildUnits(paras: OcrLine[][]): LensUnit[] {
  const out: LensUnit[] = [];
  paras.forEach((lines, pi) => {
    let cur: LensUnit | null = null;
    for (const l of lines) {
      if (cur && continues(cur.lines[cur.lines.length - 1].text, l.text)) {
        cur.lines.push(l);
        cur.text = /\w-$/.test(cur.text) ? cur.text.slice(0, -1) + l.text : cur.text + ' ' + l.text;
      } else {
        cur = { para: pi, lines: [l], text: l.text };
        out.push(cur);
      }
    }
  });
  return out.filter((u) => u.text.trim().length > 0);
}

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function otsu(hist: number[], total: number) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) {
      best = v;
      th = t;
    }
  }
  return th;
}

/** Calcula colores y grosor de cada bloque y borra el texto original de la imagen. */
export async function prepareLens(src: HTMLCanvasElement, units: LensUnit[]): Promise<LensPrep> {
  const W = src.width, H = src.height;
  const img = src.getContext('2d')!.getImageData(0, 0, W, H);
  const d = img.data;
  const mask = new Uint8Array(W * H);
  const styles: UnitStyle[] = [];

  for (const u of units) {
    let tr = 0, tg = 0, tb = 0, tn = 0, br = 0, bgG = 0, bb = 0, bn = 0, area = 0;
    for (const l of u.lines.flatMap((ln) => ln.words)) {
      const pad = Math.max(2, Math.round((l.y1 - l.y0) * 0.12));
      const x0 = Math.max(0, Math.floor(l.x0 - pad)), x1 = Math.min(W, Math.ceil(l.x1 + pad));
      const y0 = Math.max(0, Math.floor(l.y0 - pad)), y1 = Math.min(H, Math.ceil(l.y1 + pad));
      const hist = new Array(256).fill(0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[Math.round(lum(d, (y * W + x) * 4))]++;
      const total = (x1 - x0) * (y1 - y0);
      if (!total) continue;
      const th = otsu(hist, total);
      let dark = 0;
      for (let i = 0; i <= th; i++) dark += hist[i];
      const textIsDark = dark < total / 2; // el texto es la parte minoritaria
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          const v = lum(d, i);
          const isText = textIsDark ? v <= th : v > th;
          if (isText) {
            mask[y * W + x] = 255;
            tr += d[i];
            tg += d[i + 1];
            tb += d[i + 2];
            tn++;
          } else {
            br += d[i];
            bgG += d[i + 1];
            bb += d[i + 2];
            bn++;
          }
        }
      area += (l.x1 - l.x0) * (l.y1 - l.y0);
    }
    const t = tn ? [tr / tn, tg / tn, tb / tn] : [20, 20, 20];
    const bg: [number, number, number] = bn ? [br / bn, bgG / bn, bb / bn] : [255, 255, 255];
    // Se refuerza un poco el color del texto para que no quede apagado tras el promedio
    const k = 0.25;
    const col = t.map((c, i) => Math.round(Math.max(0, Math.min(255, c + (c - bg[i]) * k))));
    const ink = area ? tn / area : 0;
    const letters = u.text.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
    const upper = letters.length > 3 && letters === letters.toUpperCase();
    styles.push({ color: `rgb(${col[0]},${col[1]},${col[2]})`, bg, weight: ink > 0.39 ? 700 : 400, upper });
  }

  const erased = newCanvas(W, H);
  const ectx = erased.getContext('2d')!;
  ectx.drawImage(src, 0, 0);
  try {
    const cv = await loadCV();
    const s = cv.matFromImageData(img);
    const rgb = new cv.Mat();
    cv.cvtColor(s, rgb, cv.COLOR_RGBA2RGB);
    const m = cv.matFromArray(H, W, cv.CV_8UC1, mask);
    const kk = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
    cv.dilate(m, m, kk, new cv.Point(-1, -1), 2);
    const dst = new cv.Mat();
    cv.inpaint(rgb, m, dst, 5, cv.INPAINT_TELEA);
    const rgba = new cv.Mat();
    cv.cvtColor(dst, rgba, cv.COLOR_RGB2RGBA);
    ectx.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), W, H), 0, 0);
    [s, rgb, m, kk, dst, rgba].forEach((x) => x.delete());
  } catch {
    // Sin OpenCV: se tapa cada línea con el color del fondo
    units.forEach((u, i) => {
      ectx.fillStyle = `rgb(${styles[i].bg.map(Math.round).join(',')})`;
      for (const l of u.lines.flatMap((ln) => ln.words)) {
        const pad = Math.max(2, (l.y1 - l.y0) * 0.15);
        ectx.fillRect(l.x0 - pad, l.y0 - pad, l.x1 - l.x0 + pad * 2, l.y1 - l.y0 + pad * 2);
      }
    });
  }
  return { erased, styles };
}

const FAMILY = '"Helvetica Neue", Helvetica, Arial, "Noto Sans", sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  const spaced = /\s/.test(text.trim());
  const tokens = spaced ? text.split(/\s+/).filter(Boolean) : Array.from(text);
  let cur = '';
  for (const tk of tokens) {
    const tryS = cur ? cur + (spaced ? ' ' : '') + tk : tk;
    if (ctx.measureText(tryS).width <= maxW || !cur) cur = tryS;
    else {
      out.push(cur);
      cur = tk;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 0;
};

/** Escribe la traducción sobre la imagen ya borrada. */
export function drawLens(prep: LensPrep, units: LensUnit[], translated: string[]): HTMLCanvasElement {
  const { erased, styles } = prep;
  const W = erased.width, H = erased.height;
  const out = newCanvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(erased, 0, 0);
  units.forEach((u, i) => {
    let text = (translated[i] || '').trim();
    if (!text) return;
    const st = styles[i];
    if (st.upper) text = text.toUpperCase();
    const L = u.lines;
    const x = Math.min(...L.map((l) => l.x0));
    const y = Math.min(...L.map((l) => l.y0));
    const w = Math.max(...L.map((l) => l.x1)) - x;
    const h = Math.max(...L.map((l) => l.y1)) - y;
    const lineH = median(L.map((l) => l.y1 - l.y0));
    // Tamaño de letra según la altura de las palabras (más fiable que la caja de la línea)
    const wh = L.flatMap((l) => l.words.map((wd) => wd.y1 - wd.y0)).sort((a, b) => a - b);
    const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
    const fsW = st.upper ? median(wh) / 0.72 : pct(wh, 0.8) / 0.92;
    const fs0 = fsW > 0 ? Math.min(lineH * 1.05, fsW) : lineH * 0.86;
    // Distancia entre líneas tomada de las líneas base reales
    const base = (l: OcrLine) => pct(l.words.map((wd) => wd.y1).sort((a, b) => a - b), 0.3);
    const adv = L.length > 1 ? (base(L[L.length - 1]) - base(L[0])) / (L.length - 1) : fs0 * 1.25;
    const spacing = Math.max(1.08, adv / fs0);
    // Alineación: centrada si los centros coinciden y los bordes izquierdos no
    const lefts = L.map((l) => l.x0), centers = L.map((l) => (l.x0 + l.x1) / 2);
    const spreadOf = (a: number[]) => Math.max(...a) - Math.min(...a);
    const centered = L.length > 1 && spreadOf(centers) < w * 0.06 && spreadOf(lefts) > w * 0.08;
    const maxW = Math.min(W - x - 2, Math.max(w * 1.06, lineH * 2));
    let fs = fs0;
    let rows: string[] = [];
    for (let k = 0; k < 14; k++) {
      ctx.font = `${st.weight} ${fs}px ${FAMILY}`;
      rows = wrap(ctx, text, maxW);
      const total = rows.length * fs * spacing;
      if (total <= h + fs * 0.6 || fs <= fs0 * 0.55) break;
      fs *= 0.94;
    }
    ctx.font = `${st.weight} ${fs}px ${FAMILY}`;
    ctx.fillStyle = st.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = centered ? 'center' : 'left';
    const ax = centered ? x + w / 2 : x;
    // Primera línea base: la de la línea original (se ajusta si la letra se achicó)
    const first = base(L[0]) - (fs0 - fs) * 0.25;
    rows.forEach((r, j) => ctx.fillText(r, ax, first + j * fs * spacing));
  });
  return out;
}

/**
 * El lector de texto falla con letras claras sobre fondo oscuro (p. ej. blanco sobre rojo).
 * Esos bloques se recortan, se invierten los colores y se vuelven a leer.
 */
export async function refineLightText(src: HTMLCanvasElement, units: LensUnit[], lang: string): Promise<LensUnit[]> {
  const { ocrImage } = await import('./ocr');
  const W = src.width, H = src.height;
  const ctx = src.getContext('2d')!;
  const out: LensUnit[] = [];
  for (const u of units) {
    const x0 = Math.min(...u.lines.map((l) => l.x0)), x1 = Math.max(...u.lines.map((l) => l.x1));
    const y0 = Math.min(...u.lines.map((l) => l.y0)), y1 = Math.max(...u.lines.map((l) => l.y1));
    const pad = 4;
    const bx = Math.max(0, x0 - pad), by = Math.max(0, y0 - pad);
    const bw = Math.min(W, x1 + pad) - bx, bh = Math.min(H, y1 + pad) - by;
    if (bw < 4 || bh < 4) {
      out.push(u);
      continue;
    }
    // Se decide con la caja exacta del texto (sin margen, que puede incluir papel claro)
    const ix = Math.max(0, Math.floor(x0)), iy = Math.max(0, Math.floor(y0));
    const iw = Math.max(1, Math.min(W, Math.ceil(x1)) - ix), ih = Math.max(1, Math.min(H, Math.ceil(y1)) - iy);
    const d = ctx.getImageData(ix, iy, iw, ih).data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) hist[Math.round(lum(d, i))]++;
    const th = otsu(hist, iw * ih);
    let dark = 0;
    for (let i = 0; i <= th; i++) dark += hist[i];
    const lightText = dark > (iw * ih) / 2; // el fondo (mayoría) es oscuro
    if (!lightText) {
      out.push(u);
      continue;
    }
    const k = 2;
    const c = newCanvas(bw * k, bh * k);
    const cc = c.getContext('2d')!;
    cc.drawImage(src, bx, by, bw, bh, 0, 0, bw * k, bh * k);
    // gris invertido con más contraste (Safari no admite ctx.filter)
    const im = cc.getImageData(0, 0, bw * k, bh * k);
    const px = im.data;
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(0, Math.min(255, (255 - lum(px, i) - 128) * 1.4 + 128));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    cc.putImageData(im, 0, 0);
    try {
      const r = await ocrImage(c, lang);
      const lines: OcrLine[] = r.lines.map((l) => ({
        text: l.text,
        words: l.words.map((w) => ({ ...w, x0: bx + w.x0 / k, x1: bx + w.x1 / k, y0: by + w.y0 / k, y1: by + w.y1 / k })),
        x0: bx + l.x0 / k,
        x1: bx + l.x1 / k,
        y0: by + l.y0 / k,
        y1: by + l.y1 / k,
      }));
      if (lines.length) {
        out.push({ para: u.para, lines, text: lines.map((l) => l.text).join(' ') });
        continue;
      }
    } catch {}
    out.push(u);
  }
  return out;
}
