// Detección de los bordes del documento con OpenCV.
import type { Pt, Quad } from './scanTypes';

export interface Detection {
  quad: Quad;
  curve: [Pt, Pt, Pt, Pt] | null;
  area: number; // fracción del cuadro
}

export function orderQuad(pts: Pt[]): Quad {
  const s = pts.map((p) => p.x + p.y);
  const d = pts.map((p) => p.x - p.y);
  const tl = pts[s.indexOf(Math.min(...s))];
  const br = pts[s.indexOf(Math.max(...s))];
  const tr = pts[d.indexOf(Math.max(...d))];
  const bl = pts[d.indexOf(Math.min(...d))];
  return [tl, tr, br, bl];
}

function polyArea(q: Pt[]) {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const n = q[(i + 1) % q.length];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

function isConvex(q: Pt[]) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (z !== 0) {
      if (sign === 0) sign = Math.sign(z);
      else if (Math.sign(z) !== sign) return false;
    }
  }
  return true;
}

function matToPts(m: any): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < m.rows; i++) out.push({ x: m.data32S[i * 2], y: m.data32S[i * 2 + 1] });
  return out;
}

/** Calcula los puntos medios curvos de cada borde a partir del contorno real. */
function edgeMids(quad: Quad, contour: Pt[]): [Pt, Pt, Pt, Pt] {
  const mids: Pt[] = [];
  for (let e = 0; e < 4; e++) {
    const a = quad[e];
    const b = quad[(e + 1) % 4];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const offs: number[] = [];
    for (const p of contour) {
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
      if (t < 0.42 || t > 0.58) continue;
      const dist = (p.x - a.x) * nx + (p.y - a.y) * ny;
      if (Math.abs(dist) < len * 0.2) offs.push(dist);
    }
    let off = 0;
    if (offs.length) {
      offs.sort((x, y) => Math.abs(y) - Math.abs(x));
      off = offs[Math.floor(offs.length / 3)];
    }
    if (Math.abs(off) < len * 0.012) off = 0;
    mids.push({ x: a.x + dx / 2 + nx * off, y: a.y + dy / 2 + ny * off });
  }
  return mids as [Pt, Pt, Pt, Pt];
}

/**
 * Busca el contorno de documento más grande en un canvas pequeño (≈ 400 px).
 * Devuelve las esquinas normalizadas 0..1.
 */
export function detectDocument(cv: any, canvas: HTMLCanvasElement, opts: { curve?: boolean; minArea?: number } = {}): Detection | null {
  const W = canvas.width, H = canvas.height;
  const frameArea = W * H;
  const minArea = (opts.minArea ?? 0.12) * frameArea;
  const mats: any[] = [];
  const keep = <T,>(m: T) => (mats.push(m), m);
  try {
    const src = keep(cv.imread(canvas));
    const gray = keep(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const k = Math.max(5, Math.round(Math.min(W, H) / 45) | 1);
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k)));
    // Cierre morfológico: borra el texto para que el papel se vea uniforme
    cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, kernel);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    let best: { quad: Pt[]; area: number; contour: Pt[] } | null = null;

    const tryEdges = (edges: any) => {
      const contours = keep(new cv.MatVector());
      const hier = keep(new cv.Mat());
      cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area < minArea) {
          c.delete();
          continue;
        }
        const hull = new cv.Mat();
        cv.convexHull(c, hull, false, true);
        const peri = cv.arcLength(hull, true);
        let quad: Pt[] | null = null;
        for (const eps of [0.015, 0.025, 0.035, 0.05, 0.07, 0.09]) {
          const approx = new cv.Mat();
          cv.approxPolyDP(hull, approx, eps * peri, true);
          if (approx.rows === 4) quad = matToPts(approx);
          approx.delete();
          if (quad) break;
        }
        if (!quad && area > frameArea * 0.2) {
          const r = cv.minAreaRect(hull);
          const pts = cv.RotatedRect.points(r);
          quad = pts.map((p: any) => ({ x: p.x, y: p.y }));
        }
        if (quad && isConvex(orderQuad(quad))) {
          const qa = polyArea(orderQuad(quad));
          if (qa >= minArea && (!best || qa > best.area)) best = { quad, area: qa, contour: matToPts(c) };
        }
        hull.delete();
        c.delete();
      }
    };

    // 1) Bordes (Canny)
    const edges = keep(new cv.Mat());
    cv.Canny(gray, edges, 30, 110);
    const k3 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.dilate(edges, edges, k3, new cv.Point(-1, -1), 2);
    tryEdges(edges);

    // 2) Papel claro sobre fondo oscuro (umbral de Otsu)
    if (!best) {
      const th = keep(new cv.Mat());
      cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      tryEdges(th);
    }

    if (!best) return null;
    const b = best as { quad: Pt[]; area: number; contour: Pt[] };
    // El contorno queda un poco por fuera del papel (por la dilatación): lo encogemos levemente
    const oq = orderQuad(b.quad);
    const cx = oq.reduce((s, p) => s + p.x, 0) / 4, cy = oq.reduce((s, p) => s + p.y, 0) / 4;
    const inset = Math.max(1.5, Math.min(W, H) * 0.006);
    const q = oq.map((p) => {
      const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * inset * 1.41, y: p.y + (dy / d) * inset * 1.41 };
    }) as Quad;
    const curve = opts.curve ? edgeMids(q, b.contour) : null;
    const norm = (p: Pt): Pt => ({ x: Math.min(1, Math.max(0, p.x / W)), y: Math.min(1, Math.max(0, p.y / H)) });
    return {
      quad: q.map(norm) as Quad,
      curve: curve ? (curve.map(norm) as [Pt, Pt, Pt, Pt]) : null,
      area: b.area / frameArea,
    };
  } catch (e) {
    console.warn('detect', e);
    return null;
  } finally {
    for (const m of mats) {
      try {
        m.delete();
      } catch {}
    }
  }
}

/** Detecta sobre una imagen (archivo/foto) reduciéndola primero. */
export async function detectInBlob(cv: any, blob: Blob, curve = false): Promise<Detection | null> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return detectDocument(cv, c, { curve, minArea: 0.08 });
}

export function quadDistance(a: Quad, b: Quad) {
  let d = 0;
  for (let i = 0; i < 4; i++) d = Math.max(d, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  return d;
}

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function insetQuad(m = 0.08): Quad {
  return [
    { x: m, y: m },
    { x: 1 - m, y: m },
    { x: 1 - m, y: 1 - m },
    { x: m, y: 1 - m },
  ];
}
