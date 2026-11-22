// Procesamiento de imagen: recorte con perspectiva, páginas curvas, filtros, ajustes y borrado inteligente.
import { loadCV } from './cv';
import type { Adjust, EraseStroke, FilterId, Pt, Quad, ScanPage } from './scanTypes';
import { canvasToBlob } from './util';

export function newCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export async function blobToCanvas(blob: Blob, maxDim = Infinity): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as any);
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = newCanvas(bmp.width * s, bmp.height * s);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export function scaleCanvas(src: HTMLCanvasElement, maxDim: number) {
  const s = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (s >= 1) return src;
  const c = newCanvas(src.width * s, src.height * s);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const r = ((deg % 360) + 360) % 360;
  if (!r) return src;
  const swap = r === 90 || r === 270;
  const c = newCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function outSize(p: Pt[], aspect: number | undefined, maxOut: number) {
  let w = Math.max(dist(p[0], p[1]), dist(p[3], p[2]));
  let h = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
  if (aspect) {
    const landscape = w >= h;
    const a = landscape ? aspect : 1 / aspect;
    h = w / a;
  }
  const s = Math.min(1, maxOut / Math.max(w, h));
  return { w: Math.max(8, Math.round(w * s)), h: Math.max(8, Math.round(h * s)) };
}

const isStraight = (q: Pt[], c: Pt[] | null) => {
  if (!c) return true;
  for (let e = 0; e < 4; e++) {
    const a = q[e], b = q[(e + 1) % 4];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (dist(m, c[e]) > 0.004) return false;
  }
  return true;
};

/** Recorta y endereza el documento. quad/curve en coordenadas normalizadas. */
export async function warp(
  src: HTMLCanvasElement,
  quad: Quad,
  curve: [Pt, Pt, Pt, Pt] | null,
  aspect?: number,
  maxOut = 3200,
): Promise<HTMLCanvasElement> {
  const cv = await loadCV();
  const W = src.width, H = src.height;
  const p = quad.map((q) => ({ x: q.x * W, y: q.y * H }));
  const { w, h } = outSize(p, aspect, maxOut);
  const out = newCanvas(w, h);
  const s = cv.imread(src);
  const d = new cv.Mat();
  try {
    if (isStraight(quad, curve)) {
      const from = cv.matFromArray(4, 1, cv.CV_32FC2, p.flatMap((q) => [q.x, q.y]));
      const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
      const M = cv.getPerspectiveTransform(from, to);
      cv.warpPerspective(s, d, M, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
      from.delete();
      to.delete();
      M.delete();
    } else {
      // Página curva: parche de Coons con bordes curvos (Bézier cuadráticas)
      const c = curve!.map((q) => ({ x: q.x * W, y: q.y * H }));
      const ctrl = (a: Pt, b: Pt, m: Pt): Pt => ({ x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 });
      const [TL, TR, BR, BL] = p;
      const cT = ctrl(TL, TR, c[0]);
      const cR = ctrl(TR, BR, c[1]);
      const cB = ctrl(BL, BR, c[2]); // abajo: de BL a BR
      const cL = ctrl(TL, BL, c[3]); // izquierda: de TL a BL
      const bez = (a: Pt, k: Pt, b: Pt, t: number) => {
        const u = 1 - t;
        return { x: u * u * a.x + 2 * u * t * k.x + t * t * b.x, y: u * u * a.y + 2 * u * t * k.y + t * t * b.y };
      };
      const mx = new Float32Array(w * h);
      const my = new Float32Array(w * h);
      const top: Pt[] = [], bot: Pt[] = [];
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        top.push(bez(TL, cT, TR, u));
        bot.push(bez(BL, cB, BR, u));
      }
      for (let y = 0; y < h; y++) {
        const v = y / (h - 1);
        const L = bez(TL, cL, BL, v);
        const R = bez(TR, cR, BR, v);
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const u = x / (w - 1);
          const T = top[x], B = bot[x];
          const bx = (1 - u) * (1 - v) * TL.x + u * (1 - v) * TR.x + (1 - u) * v * BL.x + u * v * BR.x;
          const by = (1 - u) * (1 - v) * TL.y + u * (1 - v) * TR.y + (1 - u) * v * BL.y + u * v * BR.y;
          mx[row + x] = (1 - v) * T.x + v * B.x + (1 - u) * L.x + u * R.x - bx;
          my[row + x] = (1 - v) * T.y + v * B.y + (1 - u) * L.y + u * R.y - by;
        }
      }
      const MX = new cv.Mat(h, w, cv.CV_32FC1);
      const MY = new cv.Mat(h, w, cv.CV_32FC1);
      MX.data32F.set(mx);
      MY.data32F.set(my);
      cv.remap(s, d, MX, MY, cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
      MX.delete();
      MY.delete();
    }
    cv.imshow(out, d);
    return out;
  } finally {
    s.delete();
    d.delete();
  }
}

// ---------- filtros ----------

function lut(cv: any, mat: any, fn: (v: number) => number) {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = Math.max(0, Math.min(255, Math.round(fn(i))));
  const L = cv.matFromArray(1, 256, cv.CV_8UC1, Array.from(table));
  cv.LUT(mat, L, mat);
  L.delete();
}

function percentile(mat: any, p: number): number {
  // mat 8UC1
  const data: Uint8Array = mat.data;
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(data.length / 200000));
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    hist[data[i]]++;
    n++;
  }
  const target = n * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

/** Elimina sombras e iluminación desigual dividiendo por el fondo estimado. */
function normalizeBackground(cv: any, ch: any) {
  const small = new cv.Mat();
  const sc = Math.min(1, 700 / Math.max(ch.cols, ch.rows));
  cv.resize(ch, small, new cv.Size(Math.max(1, Math.round(ch.cols * sc)), Math.max(1, Math.round(ch.rows * sc))), 0, 0, cv.INTER_AREA);
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9));
  cv.dilate(small, small, k);
  cv.medianBlur(small, small, 21);
  const bg = new cv.Mat();
  cv.resize(small, bg, new cv.Size(ch.cols, ch.rows), 0, 0, cv.INTER_LINEAR);
  cv.divide(ch, bg, ch, 255);
  small.delete();
  k.delete();
  bg.delete();
}

function stretch(cv: any, gray: any, lowP = 0.01, hi = 250, gamma = 1) {
  const lo = Math.min(percentile(gray, lowP), hi - 40);
  lut(cv, gray, (v) => {
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    return 255 * Math.pow(t, gamma);
  });
}

function unsharp(cv: any, mat: any, amount: number, sigma = 1.6) {
  const blur = new cv.Mat();
  cv.GaussianBlur(mat, blur, new cv.Size(0, 0), sigma);
  cv.addWeighted(mat, 1 + amount, blur, -amount, 0, mat);
  blur.delete();
}

function saturate(cv: any, rgb: any, f: number) {
  const hsv = new cv.Mat();
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  const ch = new cv.MatVector();
  cv.split(hsv, ch);
  const s = ch.get(1);
  lut(cv, s, (v) => v * f);
  ch.set(1, s);
  cv.merge(ch, hsv);
  cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB);
  s.delete();
  ch.delete();
  hsv.delete();
}

function perChannel(cv: any, rgb: any, fn: (c: any) => void) {
  const ch = new cv.MatVector();
  cv.split(rgb, ch);
  for (let i = 0; i < 3; i++) {
    const c = ch.get(i);
    fn(c);
    ch.set(i, c);
    c.delete();
  }
  cv.merge(ch, rgb);
  ch.delete();
}

export async function applyFilterAdjust(src: HTMLCanvasElement, filter: FilterId, adj: Adjust): Promise<HTMLCanvasElement> {
  const noAdj = !adj.brightness && !adj.contrast && !adj.sharpen && !adj.denoise;
  if (filter === 'original' && noAdj) return src;
  const cv = await loadCV();
  const rgba = cv.imread(src);
  let m = new cv.Mat();
  cv.cvtColor(rgba, m, cv.COLOR_RGBA2RGB);
  rgba.delete();
  try {
    switch (filter) {
      case 'auto': {
        perChannel(cv, m, (c) => normalizeBackground(cv, c));
        const g = new cv.Mat();
        cv.cvtColor(m, g, cv.COLOR_RGB2GRAY);
        const lo = Math.min(percentile(g, 0.01), 200);
        g.delete();
        lut(cv, m, (v) => (255 * Math.max(0, v - lo)) / (248 - lo));
        saturate(cv, m, 1.15);
        break;
      }
      case 'enhanced': {
        const lab = new cv.Mat();
        cv.cvtColor(m, lab, cv.COLOR_RGB2Lab);
        const ch = new cv.MatVector();
        cv.split(lab, ch);
        const L = ch.get(0);
        if (cv.CLAHE) {
          const clahe = new cv.CLAHE(2.2, new cv.Size(8, 8));
          clahe.apply(L, L);
          clahe.delete();
        } else cv.equalizeHist(L, L);
        ch.set(0, L);
        cv.merge(ch, lab);
        cv.cvtColor(lab, m, cv.COLOR_Lab2RGB);
        L.delete();
        ch.delete();
        lab.delete();
        saturate(cv, m, 1.3);
        break;
      }
      case 'gray': {
        const g = new cv.Mat();
        cv.cvtColor(m, g, cv.COLOR_RGB2GRAY);
        normalizeBackground(cv, g);
        stretch(cv, g, 0.01, 248, 1.1);
        m.delete();
        m = g;
        break;
      }
      case 'bw': {
        const g = new cv.Mat();
        cv.cvtColor(m, g, cv.COLOR_RGB2GRAY);
        normalizeBackground(cv, g);
        stretch(cv, g, 0.01, 245, 1.2);
        const block = Math.max(15, (Math.round(Math.max(g.cols, g.rows) / 45) | 1));
        cv.adaptiveThreshold(g, g, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, 14);
        cv.medianBlur(g, g, 3);
        m.delete();
        m = g;
        break;
      }
      case 'receipt': {
        // Recibos térmicos desteñidos: normaliza, oscurece el texto y aumenta nitidez
        const g = new cv.Mat();
        cv.cvtColor(m, g, cv.COLOR_RGB2GRAY);
        normalizeBackground(cv, g);
        if (cv.CLAHE) {
          const clahe = new cv.CLAHE(2.5, new cv.Size(8, 8));
          clahe.apply(g, g);
          clahe.delete();
        }
        stretch(cv, g, 0.005, 232, 1.8);
        unsharp(cv, g, 0.9, 1.2);
        m.delete();
        m = g;
        break;
      }
      case 'whiteboard': {
        perChannel(cv, m, (c) => normalizeBackground(cv, c));
        lut(cv, m, (v) => 255 * Math.pow(Math.max(0, Math.min(1, (v - 30) / 200)), 1.4));
        saturate(cv, m, 1.7);
        break;
      }
    }

    // Ajustes manuales
    if (adj.denoise > 0) {
      const k = adj.denoise < 50 ? 3 : 5;
      cv.medianBlur(m, m, k);
      if (adj.denoise > 75) cv.GaussianBlur(m, m, new cv.Size(3, 3), 0);
    }
    if (adj.brightness || adj.contrast) {
      const alpha = Math.pow(2, adj.contrast / 70);
      const beta = 128 * (1 - alpha) + adj.brightness * 1.4;
      m.convertTo(m, -1, alpha, beta);
    }
    if (adj.sharpen > 0) unsharp(cv, m, (adj.sharpen / 100) * 1.6);

    const out = newCanvas(m.cols, m.rows);
    cv.imshow(out, m);
    return out;
  } finally {
    m.delete();
  }
}

// ---------- borrado inteligente ----------

export async function inpaintStrokes(src: HTMLCanvasElement, strokes: EraseStroke[]): Promise<HTMLCanvasElement> {
  if (!strokes.length) return src;
  const cv = await loadCV();
  const W = src.width, H = src.height;
  const mc = newCanvas(W, H);
  const ctx = mc.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (const s of strokes) {
    const lw = Math.max(2, s.size * W);
    ctx.lineWidth = lw;
    ctx.beginPath();
    s.pts.forEach((p, i) => {
      const x = p.x * W, y = p.y * H;
      minX = Math.min(minX, x - lw);
      minY = Math.min(minY, y - lw);
      maxX = Math.max(maxX, x + lw);
      maxY = Math.max(maxY, y + lw);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (s.pts.length === 1) {
      ctx.arc(s.pts[0].x * W, s.pts[0].y * H, lw / 2, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.stroke();
  }
  const pad = Math.round(Math.max(W, H) * 0.03);
  const x0 = Math.max(0, Math.floor(minX - pad)), y0 = Math.max(0, Math.floor(minY - pad));
  const x1 = Math.min(W, Math.ceil(maxX + pad)), y1 = Math.min(H, Math.ceil(maxY + pad));
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < 2 || rh < 2) return src;

  const regionC = newCanvas(rw, rh);
  regionC.getContext('2d')!.drawImage(src, x0, y0, rw, rh, 0, 0, rw, rh);
  const maskC = newCanvas(rw, rh);
  maskC.getContext('2d')!.drawImage(mc, x0, y0, rw, rh, 0, 0, rw, rh);

  const r = cv.imread(regionC);
  const rgb = new cv.Mat();
  cv.cvtColor(r, rgb, cv.COLOR_RGBA2RGB);
  const mk = cv.imread(maskC);
  const mask = new cv.Mat();
  cv.cvtColor(mk, mask, cv.COLOR_RGBA2GRAY);
  cv.threshold(mask, mask, 127, 255, cv.THRESH_BINARY);
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.dilate(mask, mask, k);
  const dst = new cv.Mat();
  try {
    const radius = Math.max(3, Math.round(Math.max(rw, rh) / 60));
    cv.inpaint(rgb, mask, dst, radius, cv.INPAINT_TELEA);
    const outR = newCanvas(rw, rh);
    cv.imshow(outR, dst);
    const out = newCanvas(W, H);
    const octx = out.getContext('2d')!;
    octx.drawImage(src, 0, 0);
    octx.drawImage(outR, x0, y0);
    return out;
  } finally {
    [r, rgb, mk, mask, k, dst].forEach((m) => m.delete());
  }
}

// ---------- canal completo de una página ----------

const origCache = new Map<string, HTMLCanvasElement>();
async function origCanvas(page: ScanPage, maxDim: number) {
  const key = page.id + ':' + maxDim + ':' + page.orig.size;
  let c = origCache.get(key);
  if (!c) {
    c = await blobToCanvas(page.orig, maxDim);
    origCache.set(key, c);
    if (origCache.size > 8) origCache.delete(origCache.keys().next().value!);
  }
  return c;
}

/** Recorte + borrado (sin filtro): base para el editor. */
export async function croppedCanvas(page: ScanPage, maxDim: number) {
  const src = await origCanvas(page, maxDim);
  let c = page.quad ? await warp(src, page.quad, page.curve, page.aspect, maxDim) : src;
  if (page.erase.length) c = await inpaintStrokes(c, page.erase);
  return c;
}

export async function renderScanPage(page: ScanPage, maxDim: number): Promise<HTMLCanvasElement> {
  const c = await croppedCanvas(page, maxDim);
  const f = await applyFilterAdjust(c, page.filter, page.adj);
  return rotateCanvas(f, page.rotation);
}

export const QUALITY = {
  high: { dim: 3000, q: 0.9 },
  medium: { dim: 2200, q: 0.82 },
  low: { dim: 1500, q: 0.72 },
};

export async function finalizePage(page: ScanPage, quality: keyof typeof QUALITY = 'high'): Promise<ScanPage> {
  if (page.processed) return page;
  const { dim, q } = QUALITY[quality];
  const c = await renderScanPage(page, dim);
  const processed = await canvasToBlob(c, 'image/jpeg', q);
  return { ...page, processed };
}

export async function pageThumb(page: ScanPage): Promise<string> {
  const c = await renderScanPage(page, 1000);
  return URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.86));
}

/** Vista previa de un filtro (miniatura). */
export async function filterPreview(base: HTMLCanvasElement, f: FilterId): Promise<string> {
  const small = scaleCanvas(base, 220);
  const c = await applyFilterAdjust(small, f, { brightness: 0, contrast: 0, sharpen: 0, denoise: 0 });
  return c.toDataURL('image/jpeg', 0.75);
}

/** Convierte una foto de firma en PNG con fondo transparente. */
export async function signatureFromPhoto(blob: Blob): Promise<Blob> {
  const cv = await loadCV();
  const c = await blobToCanvas(blob, 1600);
  const s = cv.imread(c);
  const g = new cv.Mat();
  cv.cvtColor(s, g, cv.COLOR_RGBA2GRAY);
  normalizeBackground(cv, g);
  cv.threshold(g, g, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  const data: Uint8Array = g.data;
  const W = g.cols, H = g.rows;
  const out = newCanvas(W, H);
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ink = data[i] < 128;
      img.data[i * 4] = 20;
      img.data[i * 4 + 1] = 30;
      img.data[i * 4 + 2] = 60;
      img.data[i * 4 + 3] = ink ? 255 : 0;
      if (ink) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  s.delete();
  g.delete();
  ctx.putImageData(img, 0, 0);
  if (maxX <= minX) return canvasToBlob(out, 'image/png');
  const pad = 10;
  const cw = maxX - minX + pad * 2, ch = maxY - minY + pad * 2;
  const crop = newCanvas(cw, ch);
  crop.getContext('2d')!.drawImage(out, minX - pad, minY - pad, cw, ch, 0, 0, cw, ch);
  return canvasToBlob(crop, 'image/png');
}
