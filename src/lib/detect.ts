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
// Motivo de descarte (útil para depurar)
const rej = (_reason: string, _q: Pt[]) => 0;

export function detectDocument(cv: any, canvas: HTMLCanvasElement, opts: { curve?: boolean; minArea?: number; strict?: boolean } = {}): Detection | null {
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

    let best: { quad: Pt[]; area: number; contour: Pt[]; score: number } | null = null;
    let edgeMap: any = null;
    let edgeMap2: any = null;
    const frameCands: Pt[][] = [];
    const strict = !!opts.strict;

    /**
     * Evalúa si un cuadrilátero parece de verdad una hoja: ángulos razonables,
     * lados opuestos parecidos, bordes visibles a lo largo de los 4 lados y
     * diferencia de luz entre el papel y lo que lo rodea. Devuelve 0 si no sirve.
     */
    const judge = (q: Pt[], qa: number): number => {
      const L = (i: number) => Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y);
      for (let i = 0; i < 4; i++) {
        const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
        const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
        const cos = (v1x * v2x + v1y * v2y) / ((Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1);
        const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        if (ang < (strict ? 55 : 40) || ang > (strict ? 125 : 140)) return rej("angle", q);
      }
      const r1 = Math.min(L(0), L(2)) / (Math.max(L(0), L(2)) || 1);
      const r2 = Math.min(L(1), L(3)) / (Math.max(L(1), L(3)) || 1);
      if (r1 < (strict ? 0.55 : 0.35) || r2 < (strict ? 0.55 : 0.35)) return rej("sides", q);
      if (Math.min(L(0), L(1)) / (Math.max(L(0), L(1)) || 1) < 0.12) return rej("aspect", q);
      if (!strict) return qa;
      // En vivo: la hoja debe verse completa dentro del cuadro
      const m = Math.min(W, H) * 0.012;
      if (q.some((p) => p.x < m || p.y < m || p.x > W - m || p.y > H - m)) {
        frameCands.push(q);
        return rej("frame", q);
      }
      // Bordes reales a lo largo de los lados
      let hits = 0, total = 0;
      if (edgeMap) {
        for (let i = 0; i < 4; i++) {
          const a = q[i], b = q[(i + 1) % 4];
          for (let t = 0.1; t <= 0.9; t += 0.04) {
            const x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
            let on = false;
            for (let dy = -2; dy <= 2 && !on; dy++)
              for (let dx = -2; dx <= 2 && !on; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx >= 0 && yy >= 0 && xx < W && yy < H && (edgeMap.ucharPtr(yy, xx)[0] || (edgeMap2 && edgeMap2.ucharPtr(yy, xx)[0]))) on = true;
              }
            total++;
            if (on) hits++;
          }
        }
      }
      const support = total ? hits / total : 0;
      if (support < 0.55) return rej("support " + support.toFixed(2), q);
      // Contraste papel / alrededor
      const inside = cv.Mat.zeros(H, W, cv.CV_8U);
      const ring = new cv.Mat();
      const poly = cv.matFromArray(4, 1, cv.CV_32SC2, q.flatMap((p) => [Math.round(p.x), Math.round(p.y)]));
      const pv = new cv.MatVector();
      pv.push_back(poly);
      cv.fillPoly(inside, pv, new cv.Scalar(255));
      const rk = Math.max(5, Math.round(Math.min(W, H) * 0.05) | 1);
      const kr = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(rk, rk));
      cv.dilate(inside, ring, kr);
      cv.subtract(ring, inside, ring);
      const mIn = cv.mean(gray, inside)[0];
      const mOut = cv.mean(gray, ring)[0];
      [inside, ring, poly, pv, kr].forEach((x) => x.delete());
      const contrast = Math.abs(mIn - mOut);
      if (contrast < 9 && support < 0.8) return rej("contrast " + contrast.toFixed(1) + " sup " + support.toFixed(2), q);
      return qa * support * Math.min(1.5, 0.6 + contrast / 40);
    };

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
          const oq = orderQuad(quad);
          const qa = polyArea(oq);
          const score = qa >= minArea ? judge(oq, qa) : 0;
          if (score > 0 && (!best || score > best.score)) best = { quad, area: qa, contour: matToPts(c), score };
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
    edgeMap = edges;
    tryEdges(edges);

    // 2) Papel claro sobre fondo oscuro (umbral de Otsu)
    if (!best) {
      const th = keep(new cv.Mat());
      cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      tryEdges(th);
    }

    // 3) En vivo: búsqueda por líneas rectas. Sirve para libros abiertos, donde el
    //    borde del lomo es una sombra suave y el contorno se junta con la otra página.
    if (!best && strict) {
      const g2 = keep(new cv.Mat());
      cv.cvtColor(src, g2, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(g2, g2, new cv.Size(3, 3), 0);
      const e2 = keep(new cv.Mat());
      cv.Canny(g2, e2, 20, 60);
      edgeMap2 = e2;
      const hl = keep(new cv.Mat());
      cv.HoughLinesP(e2, hl, 1, Math.PI / 180, 30, Math.min(W, H) * 0.25, 10);
      type Ln = { a: Pt; b: Pt; len: number };
      const V: Ln[] = [];
      const Hz: Ln[] = [];
      const addLine = (a: Pt, b: Pt) => {
        const ang = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < Math.min(W, H) * 0.2) return;
        if (ang < 35 || ang > 145) Hz.push({ a, b, len });
        else if (ang > 55 && ang < 125) V.push({ a, b, len });
      };
      for (let i = 0; i < hl.rows; i++) {
        const d = hl.data32S;
        addLine({ x: d[i * 4], y: d[i * 4 + 1] }, { x: d[i * 4 + 2], y: d[i * 4 + 3] });
      }
      // Lados útiles de los contornos que se salían del cuadro (se descarta el lado pegado al borde)
      const mb = Math.min(W, H) * 0.02;
      const onBorder = (p: Pt) => p.x < mb || p.y < mb || p.x > W - mb || p.y > H - mb;
      for (const q of frameCands)
        for (let i = 0; i < 4; i++) {
          const a = q[i], b = q[(i + 1) % 4];
          if (onBorder(a) && onBorder(b) && (Math.abs(a.x - b.x) < mb * 2 || Math.abs(a.y - b.y) < mb * 2)) continue;
          addLine(a, b);
        }
      // Lado pegado al borde del cuadro: se desliza hacia adentro buscando el borde más marcado (p. ej. el lomo)
      const gx = keep(new cv.Mat()), gy = keep(new cv.Mat()), mag = keep(new cv.Mat());
      cv.Sobel(g2, gx, cv.CV_16S, 1, 0);
      cv.Sobel(g2, gy, cv.CV_16S, 0, 1);
      cv.convertScaleAbs(gx, gx);
      cv.convertScaleAbs(gy, gy);
      cv.addWeighted(gx, 0.5, gy, 0.5, 0, mag);
      const md: Uint8Array = mag.data;
      // Puntaje: borde fuerte sobre la línea y poca textura justo hacia adentro (el margen
      // blanco de la hoja). Así no se confunde con una columna de texto.
      const lineScore = (P: Pt, Q: Pt, C: Pt) => {
        const lx = Q.x - P.x, ly = Q.y - P.y, ll = Math.hypot(lx, ly) || 1;
        let nx = -ly / ll, ny = lx / ll;
        const mx = (P.x + Q.x) / 2, my = (P.y + Q.y) / 2;
        if ((C.x - mx) * nx + (C.y - my) * ny < 0) { nx = -nx; ny = -ny; }
        const off = Math.max(3, Math.min(W, H) * 0.015);
        let s = 0, inner = 0, n = 0;
        for (let k = 0.1; k <= 0.9; k += 0.025) {
          const x = Math.round(P.x + lx * k), y = Math.round(P.y + ly * k);
          const ix = Math.round(x + nx * off), iy = Math.round(y + ny * off);
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
          let m = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, md[(y + dy) * W + x + dx]);
          s += m;
          inner += md[iy * W + ix];
          n++;
        }
        return n > 10 ? (s - inner * 0.8) / n : 0;
      };
      const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      for (const q of frameCands) {
        const borderSides = [0, 1, 2, 3].filter((i) => onBorder(q[i]) && onBorder(q[(i + 1) % 4]));
        if (borderSides.length !== 1) continue;
        const i = borderSides[0];
        const A0 = q[(i + 3) % 4], A1 = q[i]; // lado vecino que termina en q[i]
        const B0 = q[(i + 2) % 4], B1 = q[(i + 1) % 4]; // lado vecino que termina en q[i+1]
        const C = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
        let bestL: { P: Pt; Q: Pt; s: number } | null = null;
        const scores: number[] = [];
        for (let s = 0.5; s <= 1.0001; s += 0.02)
          for (let t = 0.5; t <= 1.0001; t += 0.02) {
            const P = lerp(A0, A1, s), Q = lerp(B0, B1, t);
            if (onBorder(P) && onBorder(Q)) continue;
            const sc = lineScore(P, Q, C);
            scores.push(sc);
            if (!bestL || sc > bestL.s) bestL = { P, Q, s: sc };
          }
        if (!bestL || !scores.length) continue;
        const med = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)];
        if (bestL.s < 10 || bestL.s < med * 1.5 + 4) continue;
        const nq = [...q];
        nq[i] = bestL.P;
        nq[(i + 1) % 4] = bestL.Q;
        const oq = orderQuad(nq);
        if (!isConvex(oq)) continue;
        const qa = polyArea(oq);
        if (qa < minArea) continue;
        const score = judge(oq, qa);
        if (score > 0 && (!best || score > best.score)) best = { quad: oq, area: qa, contour: oq, score };
      }

      const xAt = (l: Ln, y: number) => l.a.x + ((l.b.x - l.a.x) * (y - l.a.y)) / (l.b.y - l.a.y || 1e-6);
      const yAt = (l: Ln, x: number) => l.a.y + ((l.b.y - l.a.y) * (x - l.a.x)) / (l.b.x - l.a.x || 1e-6);
      const top5 = (arr: Ln[]) => arr.sort((p, q) => q.len - p.len).slice(0, 5);
      const Ls = top5(V.filter((l) => xAt(l, H / 2) < W / 2));
      const Rs = top5(V.filter((l) => xAt(l, H / 2) >= W / 2));
      const Ts = top5(Hz.filter((l) => yAt(l, W / 2) < H / 2));
      const Bs = top5(Hz.filter((l) => yAt(l, W / 2) >= H / 2));
      const inter = (l1: Ln, l2: Ln): Pt | null => {
        const x1 = l1.a.x, y1 = l1.a.y, x2 = l1.b.x, y2 = l1.b.y, x3 = l2.a.x, y3 = l2.a.y, x4 = l2.b.x, y4 = l2.b.y;
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(den) < 1e-6) return null;
        const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;
        const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;
        return { x: px, y: py };
      };
      for (const t of Ts)
        for (const bt of Bs)
          for (const l of Ls)
            for (const r of Rs) {
              const cs = [inter(t, l), inter(t, r), inter(bt, r), inter(bt, l)];
              if (cs.some((p) => !p)) continue;
              const oq = orderQuad(cs as Pt[]);
              if (!isConvex(oq)) continue;
              const qa = polyArea(oq);
              if (qa < minArea) continue;
              const score = judge(oq, qa);
              if (score > 0 && (!best || score > best.score)) best = { quad: oq, area: qa, contour: oq, score };
            }
    }

    if (!best) return null;
    const b = best as { quad: Pt[]; area: number; contour: Pt[]; score: number };
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
  // Primero la búsqueda estricta (la misma de la cámara); si no encuentra nada, una más permisiva
  return detectDocument(cv, c, { curve, minArea: 0.08, strict: true }) || detectDocument(cv, c, { curve, minArea: 0.08 });
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
