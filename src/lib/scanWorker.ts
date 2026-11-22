/// <reference lib="webworker" />
// Trabajo pesado de la cámara en un hilo aparte (así la pantalla no se traba):
// - Seguimiento: estima cómo se movió la cámara entre un cuadro y el siguiente
//   (flujo óptico de puntos con textura + homografía) para mover el marco con ella.
// - Detección: cada cierto tiempo busca de nuevo los bordes del documento.
import { detectDocument, type DetectOpts } from './detect';
import type { Quad } from './scanTypes';

let cv: any = null;
let prevGray: any = null;
let prevPts: any = null;
let frameNo = 0;

async function init(url: string) {
  const code = await (await fetch(url)).text();
  // Se evalúa en el ámbito global del worker (OpenCV.js deja "cv" en globalThis)
  (0, eval)(code);
  let c = (self as any).cv;
  if (c && typeof c.then === 'function' && !c.Mat) c = await c;
  if (!c.Mat)
    await new Promise<void>((res) => {
      const t = setInterval(() => {
        if (c.Mat) {
          clearInterval(t);
          res();
        }
      }, 50);
    });
  cv = c;
}

/** Puntos con buena textura para seguir (equivalente a goodFeaturesToTrack). */
function features(gray: any, quad: Quad | null): any {
  const W = gray.cols, H = gray.rows;
  const eig = new cv.Mat();
  cv.cornerMinEigenVal(gray, eig, 3, 3);
  const e: Float32Array = eig.data32F;
  let max = 0;
  for (let i = 0; i < e.length; i++) if (e[i] > max) max = e[i];
  const thr = max * 0.015;
  const pick = (x0: number, y0: number, x1: number, y1: number, gx: number, gy: number) => {
    const pts: number[] = [];
    const cw = (x1 - x0) / gx, ch = (y1 - y0) / gy;
    for (let cy = 0; cy < gy; cy++)
      for (let cx = 0; cx < gx; cx++) {
        let best = thr, bx = -1, by = -1;
        const xa = Math.max(6, Math.floor(x0 + cx * cw)), xb = Math.min(W - 6, Math.floor(x0 + (cx + 1) * cw));
        const ya = Math.max(6, Math.floor(y0 + cy * ch)), yb = Math.min(H - 6, Math.floor(y0 + (cy + 1) * ch));
        for (let y = ya; y < yb; y++)
          for (let x = xa; x < xb; x++) {
            const v = e[y * W + x];
            if (v > best) {
              best = v;
              bx = x;
              by = y;
            }
          }
        if (bx >= 0) pts.push(bx, by);
      }
    return pts;
  };
  let pts: number[] = [];
  if (quad) {
    // Preferimos puntos sobre el documento y su alrededor inmediato
    const xs = quad.map((p) => p.x * W), ys = quad.map((p) => p.y * H);
    const mx = (Math.max(...xs) - Math.min(...xs)) * 0.15, my = (Math.max(...ys) - Math.min(...ys)) * 0.15;
    pts = pick(Math.max(0, Math.min(...xs) - mx), Math.max(0, Math.min(...ys) - my), Math.min(W, Math.max(...xs) + mx), Math.min(H, Math.max(...ys) + my), 8, 10);
  }
  if (pts.length < 40) pts = pts.concat(pick(0, 0, W, H, 10, 13));
  eig.delete();
  return pts.length ? cv.matFromArray(pts.length / 2, 1, cv.CV_32FC2, pts) : null;
}

/** Movimiento de la cámara desde el cuadro anterior (homografía 3×3) o null. */
function track(gray: any): number[] | null {
  if (!prevGray || !prevPts || prevPts.rows < 8) return null;
  const next = new cv.Mat(), status = new cv.Mat(), err = new cv.Mat();
  let H: number[] | null = null;
  try {
    cv.calcOpticalFlowPyrLK(prevGray, gray, prevPts, next, status, err, new cv.Size(21, 21), 3, new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 20, 0.03));
    const src: number[] = [], dst: number[] = [];
    const st: Uint8Array = status.data, a: Float32Array = prevPts.data32F, b: Float32Array = next.data32F;
    for (let i = 0; i < st.length; i++)
      if (st[i] === 1) {
        src.push(a[i * 2], a[i * 2 + 1]);
        dst.push(b[i * 2], b[i * 2 + 1]);
      }
    if (src.length / 2 >= 8) {
      const sM = cv.matFromArray(src.length / 2, 1, cv.CV_32FC2, src);
      const dM = cv.matFromArray(dst.length / 2, 1, cv.CV_32FC2, dst);
      const mask = new cv.Mat();
      const Hm = cv.findHomography(sM, dM, cv.RANSAC, 3, mask);
      if (!Hm.empty()) {
        const h = Array.from(Hm.data64F as Float64Array);
        // Se descartan movimientos absurdos (el marco no puede deformarse de golpe)
        const W = gray.cols, Hh = gray.rows;
        const corners = [
          [0, 0],
          [W, 0],
          [W, Hh],
          [0, Hh],
        ].map(([x, y]) => {
          const w = h[6] * x + h[7] * y + h[8];
          return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
        });
        let area = 0;
        for (let i = 0; i < 4; i++) area += corners[i][0] * corners[(i + 1) % 4][1] - corners[(i + 1) % 4][0] * corners[i][1];
        const ratio = Math.abs(area / 2) / (W * Hh);
        let inl = 0;
        for (let i = 0; i < mask.rows; i++) if (mask.data[i]) inl++;
        if (ratio > 0.6 && ratio < 1.6 && inl >= 8) H = h;
        // seguimos sólo los puntos que encajaron con el movimiento
        const keepPts: number[] = [];
        for (let i = 0; i < mask.rows; i++) if (mask.data[i]) keepPts.push(dst[i * 2], dst[i * 2 + 1]);
        prevPts.delete();
        prevPts = keepPts.length ? cv.matFromArray(keepPts.length / 2, 1, cv.CV_32FC2, keepPts) : null;
      }
      [sM, dM, mask, Hm].forEach((m) => m.delete());
    }
  } catch {
    H = null;
  } finally {
    [next, status, err].forEach((m) => m.delete());
  }
  return H;
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'init') {
    try {
      await init(m.url);
      (self as any).postMessage({ type: 'ready' });
    } catch (e: any) {
      (self as any).postMessage({ type: 'error', message: String(e?.message || e) });
    }
    return;
  }
  if (m.type === 'reset') {
    prevGray?.delete();
    prevPts?.delete();
    prevGray = prevPts = null;
    return;
  }
  if (m.type !== 'frame' || !cv) return;
  const { w, h, buf, detect, quad, opts } = m as { w: number; h: number; buf: ArrayBuffer; detect: boolean; quad: Quad | null; opts: DetectOpts };
  const data = new Uint8Array(buf);
  const rgba = cv.matFromArray(h, w, cv.CV_8UC4, data);
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  rgba.delete();
  frameNo++;
  const t0 = performance.now();
  const H = track(gray);
  if (!prevPts || prevPts.rows < 35 || frameNo % 12 === 0) {
    prevPts?.delete();
    prevPts = features(gray, quad);
  }
  prevGray?.delete();
  prevGray = gray;
  const trackMs = performance.now() - t0;
  let det = null;
  let detMs = 0;
  if (detect) {
    const t1 = performance.now();
    det = detectDocument(cv, { data, width: w, height: h }, opts);
    detMs = performance.now() - t1;
  }
  (self as any).postMessage({ type: 'result', id: m.id, H, w, h, ran: detect, det, trackMs, detMs });
};
