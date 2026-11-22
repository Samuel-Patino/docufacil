// Detección de los bordes del documento con OpenCV.
//
// 1) Se buscan candidatos de varias maneras (bordes fuertes, bordes suaves, bordes de
//    color, umbral de luz y líneas rectas) porque cada foto es distinta.
// 2) Cada candidato se califica lado por lado: en un documento real, a lo largo de
//    cada borde hay un cambio claro y parejo entre "adentro" (el papel, uniforme)
//    y "afuera" (la mesa). Un cuadro que mezcla teclado, libro y mesa no lo cumple.
// 3) Se prefieren superficies que parecen papel (claras, con poco color y texto fino)
//    sobre objetos grandes como un portátil, sin depender tanto del tamaño.
import type { Pt, Quad } from './scanTypes';

export interface Detection {
  quad: Quad;
  curve: [Pt, Pt, Pt, Pt] | null;
  area: number; // fracción del cuadro
}

export interface DetectOpts {
  curve?: boolean;
  minArea?: number;
  /** Cámara en vivo: más exigente (la hoja debe verse completa) */
  strict?: boolean;
  /** Solo para pruebas: recibe cada candidato con su calificación */
  debug?: (info: any) => void;
}

type ImageLike = HTMLCanvasElement | { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export function orderQuad(pts: Pt[]): Quad {
  const s = pts.map((p) => p.x + p.y);
  const d = pts.map((p) => p.x - p.y);
  const tl = pts[s.indexOf(Math.min(...s))];
  const br = pts[s.indexOf(Math.max(...s))];
  const tr = pts[d.indexOf(Math.max(...d))];
  const bl = pts[d.indexOf(Math.min(...d))];
  return [tl, tr, br, bl];
}

export function polyArea(q: Pt[]) {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const n = q[(i + 1) % q.length];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function isConvex(q: Pt[]) {
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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

interface Cand {
  q: Quad; // ordenado, en píxeles
  contour: Pt[] | null;
}

/** Busca el documento en una imagen pequeña (≈ 320-640 px). Devuelve esquinas normalizadas 0..1. */
export function detectDocument(cv: any, input: ImageLike, opts: DetectOpts = {}): Detection | null {
  const W = input.width, H = input.height;
  const frameArea = W * H;
  const minArea = (opts.minArea ?? 0.1) * frameArea;
  const strict = !!opts.strict;
  const mats: any[] = [];
  const keep = <T,>(m: T) => (mats.push(m), m);
  try {
    const src = keep(
      typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement ? cv.imread(input) : cv.matFromArray(H, W, cv.CV_8UC4, (input as any).data),
    );
    // Color suavizado: se usa para calificar los bordes y medir si parece papel
    const colBlur = keep(new cv.Mat());
    cv.GaussianBlur(src, colBlur, new cv.Size(5, 5), 0);
    const col: Uint8Array = colBlur.data;

    const grayRaw = keep(new cv.Mat());
    cv.cvtColor(src, grayRaw, cv.COLOR_RGBA2GRAY);
    // Cierre morfológico: borra el texto para que el papel se vea uniforme
    const gray = keep(new cv.Mat());
    const k = Math.max(5, Math.round(Math.min(W, H) / 45) | 1);
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k)));
    cv.morphologyEx(grayRaw, gray, cv.MORPH_CLOSE, kernel);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    const k3 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));

    const T0 = performance.now();
    const mark = (name: string) => opts.debug?.({ t: name, ms: Math.round(performance.now() - T0) });
    const cands: Cand[] = [];
    const frameCands: Quad[] = []; // contornos que se salen del cuadro por un lado
    const mb = Math.max(1.5, Math.min(W, H) * 0.012);
    const onBorder = (p: Pt) => p.x < mb || p.y < mb || p.x > W - 1 - mb || p.y > H - 1 - mb;

    const addQuad = (pts: Pt[], contour: Pt[] | null) => {
      const q = orderQuad(pts);
      if (!isConvex(q)) return;
      if (polyArea(q) < minArea) return;
      const touching = q.filter(onBorder).length;
      if (touching) {
        if (touching === 2) frameCands.push(q);
        if (strict) return;
      }
      cands.push({ q, contour });
    };

    const fromEdges = (edges: any) => {
      const contours = keep(new cv.MatVector());
      const hier = keep(new cv.Mat());
      cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area < minArea * 0.6) {
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
        if (!quad) {
          const r = cv.minAreaRect(hull);
          quad = cv.RotatedRect.points(r).map((p: any) => ({ x: p.x, y: p.y }));
        }
        if (quad) addQuad(quad, matToPts(c));
        hull.delete();
        c.delete();
      }
    };

    // 1) Bordes fuertes y suaves
    const strong = keep(new cv.Mat());
    cv.Canny(gray, strong, 30, 110);
    cv.dilate(strong, strong, k3, new cv.Point(-1, -1), 2);
    fromEdges(strong);
    const soft = keep(new cv.Mat());
    cv.Canny(gray, soft, 12, 45);
    cv.dilate(soft, soft, k3, new cv.Point(-1, -1), 2);
    fromEdges(soft);
    // 2) Bordes de color (objetos de distinto color pero igual brillo que el fondo)
    {
      const ch = keep(new cv.MatVector());
      cv.split(src, ch);
      const colorEdges = keep(cv.Mat.zeros(H, W, cv.CV_8U));
      const one = keep(new cv.Mat());
      for (let i = 0; i < 3; i++) {
        const c = ch.get(i);
        cv.morphologyEx(c, c, cv.MORPH_CLOSE, kernel);
        cv.GaussianBlur(c, c, new cv.Size(5, 5), 0);
        cv.Canny(c, one, 20, 70);
        cv.bitwise_or(colorEdges, one, colorEdges);
        c.delete();
      }
      cv.dilate(colorEdges, colorEdges, k3, new cv.Point(-1, -1), 2);
      fromEdges(colorEdges);
    }
    mark('contornos');
    // 3) Papel claro sobre fondo oscuro (umbral de Otsu)
    {
      const th = keep(new cv.Mat());
      cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      fromEdges(th);
    }

    mark('otsu');
    // ----- calificación -----
    const at = (x: number, y: number) => {
      const xi = Math.max(0, Math.min(W - 1, Math.round(x))), yi = Math.max(0, Math.min(H - 1, Math.round(y)));
      return (yi * W + xi) * 4;
    };
    const lumAt = (i: number) => 0.299 * col[i] + 0.587 * col[i + 1] + 0.114 * col[i + 2];
    const dOff = Math.max(2, Math.round(Math.min(W, H) * 0.012));

    /** Qué tan claro y parejo es el cambio adentro/afuera a lo largo de un lado (0..1). */
    const sideScore = (a: Pt, b: Pt, cx: number, cy: number, fine = true) => {
      const lx = b.x - a.x, ly = b.y - a.y, len = Math.hypot(lx, ly) || 1;
      let nx = -ly / len, ny = lx / len;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) {
        nx = -nx;
        ny = -ny;
      } // normal hacia afuera
      const steps = fine ? Math.max(14, Math.min(40, Math.round(len / 4))) : 12;
      const ins: number[] = [];
      const diffs: number[] = [];
      for (let s = 1; s < steps; s++) {
        const t = 0.06 + (0.88 * s) / steps;
        const px = a.x + lx * t, py = a.y + ly * t;
        const xi = px - nx * dOff, yi = py - ny * dOff, xo = px + nx * dOff, yo = py + ny * dOff;
        if (xo < 0 || yo < 0 || xo > W - 1 || yo > H - 1) {
          ins.push(NaN);
          diffs.push(0);
          continue;
        }
        const i = at(xi, yi), o = at(xo, yo);
        const dr = col[i] - col[o], dg = col[i + 1] - col[o + 1], db = col[i + 2] - col[o + 2];
        diffs.push(Math.sqrt(dr * dr + dg * dg + db * db));
        ins.push(lumAt(i));
      }
      const valid = ins.filter((v) => !isNaN(v)).sort((p, q) => p - q);
      const med = valid[Math.floor(valid.length / 2)] ?? 0;
      let ok = 0;
      for (let j = 0; j < diffs.length; j++) if (diffs[j] > 22 && Math.abs(ins[j] - med) < 32) ok++;
      return ok / diffs.length;
    };

    /** Qué tanto parece papel: claro, poco color y poca superficie oscura (0.35..1). */
    const paperness = (q: Quad) => {
      const lums: number[] = [];
      let sat = 0;
      const n = 14;
      for (let u = 1; u < n; u++)
        for (let v = 1; v < n; v++) {
          const s = u / n, t = v / n;
          const x = (1 - t) * ((1 - s) * q[0].x + s * q[1].x) + t * ((1 - s) * q[3].x + s * q[2].x);
          const y = (1 - t) * ((1 - s) * q[0].y + s * q[1].y) + t * ((1 - s) * q[3].y + s * q[2].y);
          const i = at(x, y);
          const mx = Math.max(col[i], col[i + 1], col[i + 2]), mn = Math.min(col[i], col[i + 1], col[i + 2]);
          sat += mx ? (mx - mn) / mx : 0;
          lums.push(lumAt(i));
        }
      lums.sort((p, q) => p - q);
      const p85 = lums[Math.floor(lums.length * 0.85)];
      const dark = lums.filter((l) => l < p85 * 0.6).length / lums.length;
      sat /= lums.length;
      const bright = clamp01((p85 - 70) / 130);
      const clean = clamp01(1 - dark / 0.35);
      const plain = 1 - 0.6 * clamp01(sat / 0.5);
      return 0.35 + 0.65 * bright * clean * plain;
    };

    const shapeOK = (q: Quad) => {
      const L = (i: number) => Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y);
      let cosSum = 0;
      for (let i = 0; i < 4; i++) {
        const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
        const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
        const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
        if (Math.abs(cos) > 0.77) return 0; // ángulos entre ~40° y ~140°
        cosSum += Math.abs(cos);
      }
      const r1 = Math.min(L(0), L(2)) / (Math.max(L(0), L(2)) || 1);
      const r2 = Math.min(L(1), L(3)) / (Math.max(L(1), L(3)) || 1);
      if (r1 < 0.4 || r2 < 0.4) return 0;
      if (Math.min(L(0), L(1)) / (Math.max(L(0), L(1)) || 1) < 0.12) return 0;
      return 1 - 0.6 * (cosSum / 4);
    };

    // 4) Líneas rectas: en escenas con muchas cosas el contorno de la hoja se junta con
    //    otros objetos, pero sus 4 bordes siguen siendo líneas. Se combinan de a pares.
    {
      const thin = keep(new cv.Mat());
      cv.Canny(gray, thin, 15, 50);
      const ch = keep(new cv.MatVector());
      cv.split(colBlur, ch);
      const one = keep(new cv.Mat());
      for (let i = 0; i < 3; i++) {
        const c = ch.get(i);
        cv.morphologyEx(c, c, cv.MORPH_CLOSE, kernel);
        cv.Canny(c, one, 25, 80);
        cv.bitwise_or(thin, one, thin);
        c.delete();
      }
      const hl = keep(new cv.Mat());
      const minLen = Math.min(W, H) * 0.12;
      cv.HoughLinesP(thin, hl, 1, Math.PI / 180, 22, minLen, 8);
      type Seg = { a: Pt; b: Pt; ang: number; len: number };
      const segs: Seg[] = [];
      // Esta versión de OpenCV devuelve las líneas como columnas: se lee todo el arreglo
      const nLines = Math.floor(hl.data32S.length / 4);
      for (let i = 0; i < nLines; i++) {
        const d = hl.data32S;
        const a = { x: d[i * 4], y: d[i * 4 + 1] }, b = { x: d[i * 4 + 2], y: d[i * 4 + 3] };
        let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        if (ang < 0) ang += 180;
        segs.push({ a, b, ang, len: Math.hypot(b.x - a.x, b.y - a.y) });
      }
      // Une segmentos de la misma recta (bordes cortados por sombras o reflejos)
      segs.sort((p, q) => q.len - p.len);
      const lines: Seg[] = [];
      const angDiff = (x: number, y: number) => Math.min(Math.abs(x - y), 180 - Math.abs(x - y));
      const distToLine = (p: Pt, s: Seg) => {
        const lx = s.b.x - s.a.x, ly = s.b.y - s.a.y, l = Math.hypot(lx, ly) || 1;
        return Math.abs((p.x - s.a.x) * ly - (p.y - s.a.y) * lx) / l;
      };
      for (const s of segs) {
        const m = lines.find((l) => angDiff(l.ang, s.ang) < 5 && distToLine(s.a, l) < 4 && distToLine(s.b, l) < 4);
        if (!m) {
          lines.push({ ...s });
          continue;
        }
        const ux = (m.b.x - m.a.x) / (m.len || 1), uy = (m.b.y - m.a.y) / (m.len || 1);
        const proj = (p: Pt) => (p.x - m.a.x) * ux + (p.y - m.a.y) * uy;
        const ts = [0, m.len, proj(s.a), proj(s.b)];
        const t0 = Math.min(...ts), t1 = Math.max(...ts);
        const a = { x: m.a.x + ux * t0, y: m.a.y + uy * t0 }, b = { x: m.a.x + ux * t1, y: m.a.y + uy * t1 };
        m.a = a;
        m.b = b;
        m.len = t1 - t0;
      }
      opts.debug?.({ lines: lines.map((l) => [Math.round(l.a.x), Math.round(l.a.y), Math.round(l.b.x), Math.round(l.b.y)]) });
      const horiz = lines.filter((l) => l.ang < 45 || l.ang > 135).sort((p, q) => q.len - p.len).slice(0, 32);
      const vert = lines.filter((l) => l.ang >= 45 && l.ang <= 135).sort((p, q) => q.len - p.len).slice(0, 32);
      opts.debug?.({ horiz: horiz.map((l) => [l.a, l.b].map((p) => [Math.round(p.x), Math.round(p.y)])), vert: vert.map((l) => [l.a, l.b].map((p) => [Math.round(p.x), Math.round(p.y)])) });
      const inter = (l1: Seg, l2: Seg): Pt | null => {
        const x1 = l1.a.x, y1 = l1.a.y, x2 = l1.b.x, y2 = l1.b.y, x3 = l2.a.x, y3 = l2.a.y, x4 = l2.b.x, y4 = l2.b.y;
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(den) < 1e-6) return null;
        return {
          x: ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den,
          y: ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den,
        };
      };
      // Qué parte del lado P→Q cubre la línea detectada
      const cover = (l: Seg, P: Pt, Q: Pt) => {
        const lx = Q.x - P.x, ly = Q.y - P.y, ll = Math.hypot(lx, ly) || 1;
        const t = (p: Pt) => ((p.x - P.x) * lx + (p.y - P.y) * ly) / (ll * ll);
        const a = Math.max(0, Math.min(t(l.a), t(l.b))), b = Math.min(1, Math.max(t(l.a), t(l.b)));
        return Math.max(0, b - a);
      };
      const midY = (l: Seg) => (l.a.y + l.b.y) / 2, midX = (l: Seg) => (l.a.x + l.b.x) / 2;
      // Esquinas posibles: el cruce debe quedar cerca de los dos segmentos que lo forman
      const along = (l: Seg, p: Pt) => ((p.x - l.a.x) * (l.b.x - l.a.x) + (p.y - l.a.y) * (l.b.y - l.a.y)) / (l.len * l.len || 1);
      const corner: (Pt | null)[][] = horiz.map((h) =>
        vert.map((v) => {
          const p = inter(h, v);
          if (!p || p.x < -2 || p.y < -2 || p.x > W + 1 || p.y > H + 1) return null;
          const th = along(h, p), tv = along(v, p);
          return th > -0.35 && th < 1.35 && tv > -0.35 && tv < 1.35 ? p : null;
        }),
      );
      const lineQuads: { pts: Pt[]; pre: number }[] = [];
      for (let i = 0; i < horiz.length; i++) {
        const top = horiz[i];
        for (let u = 0; u < vert.length; u++) {
          const tl = corner[i][u];
          if (!tl) continue;
          const left = vert[u];
          for (let v = 0; v < vert.length; v++) {
            const tr = corner[i][v];
            if (!tr || v === u) continue;
            const right = vert[v];
            if (midX(right) - midX(left) < W * 0.12) continue;
            for (let j = 0; j < horiz.length; j++) {
              if (j === i) continue;
              const bl = corner[j][u], br = corner[j][v];
              if (!bl || !br) continue;
              const bot = horiz[j];
              if (midY(bot) - midY(top) < H * 0.12) continue;
              const c1 = cover(top, tl, tr), c2 = cover(bot, bl, br), c3 = cover(left, tl, bl), c4 = cover(right, tr, br);
              const mc = Math.min(c1, c2, c3, c4);
              if (mc < 0.35) continue;
              lineQuads.push({ pts: [tl, tr, br, bl], pre: (c1 + c2 + c3 + c4) * (0.5 + mc) });
              if (lineQuads.length > 3000) break;
            }
          }
        }
      }
      // Sólo se califican en detalle los más prometedores
      // Revisión rápida de los bordes (pocas muestras) para elegir cuáles calificar en detalle
      for (const lq of lineQuads) {
        const q = orderQuad(lq.pts);
        const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
        const s = [0, 1, 2, 3].map((i) => sideScore(q[i], q[(i + 1) % 4], cx, cy, false));
        lq.pre = (s[0] + s[1] + s[2] + s[3]) * (0.3 + Math.min(...s));
      }
      lineQuads.sort((p, q) => q.pre - p.pre);
      for (const lq of lineQuads.slice(0, 80)) if (lq.pre > 0.6) addQuad(lq.pts, null);
    }

    mark('lineas');
    /** Diferencia de color entre el interior y una franja justo por fuera (0..~440). */
    const regionContrast = (q: Quad, cx: number, cy: number) => {
      let ir = 0, ig = 0, ib = 0, ni = 0, or = 0, og = 0, ob = 0, no = 0;
      const n = 10;
      for (let u = 1; u < n; u++)
        for (let v = 1; v < n; v++) {
          const s = u / n, t = v / n;
          const x = (1 - t) * ((1 - s) * q[0].x + s * q[1].x) + t * ((1 - s) * q[3].x + s * q[2].x);
          const y = (1 - t) * ((1 - s) * q[0].y + s * q[1].y) + t * ((1 - s) * q[3].y + s * q[2].y);
          const i = at(x, y);
          ir += col[i];
          ig += col[i + 1];
          ib += col[i + 2];
          ni++;
        }
      const off = dOff * 3;
      for (let k = 0; k < 4; k++) {
        const a = q[k], b = q[(k + 1) % 4];
        const lx = b.x - a.x, ly = b.y - a.y, len = Math.hypot(lx, ly) || 1;
        let nx = -ly / len, ny = lx / len;
        if (((a.x + b.x) / 2 - cx) * nx + ((a.y + b.y) / 2 - cy) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        for (let t = 0.1; t <= 0.9; t += 0.1) {
          const x = a.x + lx * t + nx * off, y = a.y + ly * t + ny * off;
          if (x < 0 || y < 0 || x > W - 1 || y > H - 1) continue;
          const i = at(x, y);
          or += col[i];
          og += col[i + 1];
          ob += col[i + 2];
          no++;
        }
      }
      if (!ni || !no) return 0;
      return Math.hypot(ir / ni - or / no, ig / ni - og / no, ib / ni - ob / no);
    };

    const ranked: { c: Cand; score: number }[] = [];
    /** Calificación de un cuadrilátero (0 = no sirve). */
    const scoreOf = (q: Quad, log = false): number => {
      const shape = shapeOK(q);
      if (!shape) {
        if (log) opts.debug?.({ q, why: 'shape' });
        return 0;
      }
      const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
      const sides = [0, 1, 2, 3].map((i) => sideScore(q[i], q[(i + 1) % 4], cx, cy));
      const sorted = [...sides].sort((a, b) => b - a);
      const mean = sides.reduce((a, b) => a + b, 0) / 4;
      // Tres lados claros y el cuarto al menos visible (p. ej. el lomo de un libro)
      if (strict ? sorted[2] < 0.5 || sorted[3] < 0.22 || mean < 0.55 : mean < 0.4) return 0;
      // El objeto debe verse distinto de lo que lo rodea (color promedio adentro vs. afuera)
      if (strict && regionContrast(q, cx, cy) < 22) return 0;
      const areaF = polyArea(q) / frameArea;
      const paper = paperness(q);
      const score = mean * mean * (0.6 + 0.4 * clamp01(sorted[3] / 0.6)) * Math.sqrt(areaF) * paper * paper * shape;
      if (log) opts.debug?.({ q, final: +score.toFixed(4), sides: sides.map((s) => +s.toFixed(2)), paper: +paper.toFixed(2), shape: +shape.toFixed(2), areaF: +areaF.toFixed(3) });
      return score;
    };
    const evaluate = (c: Cand) => {
      const s = scoreOf(c.q, true);
      if (s > 0) ranked.push({ c, score: s });
    };
    cands.forEach(evaluate);
    mark('evaluar ' + cands.length);

    // 4) Lado pegado al borde del cuadro (libro abierto: la otra página se junta con esta).
    //    Se desliza ese lado hacia adentro hasta el borde más marcado (el lomo).
    if (frameCands.length) {
      const gx = keep(new cv.Mat()), gy = keep(new cv.Mat()), mag = keep(new cv.Mat());
      cv.Sobel(grayRaw, gx, cv.CV_16S, 1, 0);
      cv.Sobel(grayRaw, gy, cv.CV_16S, 0, 1);
      cv.convertScaleAbs(gx, gx);
      cv.convertScaleAbs(gy, gy);
      cv.addWeighted(gx, 0.5, gy, 0.5, 0, mag);
      const md: Uint8Array = mag.data;
      const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const lineScore = (P: Pt, Q: Pt, C: Pt) => {
        const lx = Q.x - P.x, ly = Q.y - P.y, ll = Math.hypot(lx, ly) || 1;
        let nx = -ly / ll, ny = lx / ll;
        const mx = (P.x + Q.x) / 2, my = (P.y + Q.y) / 2;
        if ((C.x - mx) * nx + (C.y - my) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        const off = Math.max(3, Math.min(W, H) * 0.015);
        let s = 0, inner = 0, n = 0;
        for (let t = 0.1; t <= 0.9; t += 0.025) {
          const x = Math.round(P.x + lx * t), y = Math.round(P.y + ly * t);
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
      for (const q of frameCands) {
        const bs = [0, 1, 2, 3].filter((i) => onBorder(q[i]) && onBorder(q[(i + 1) % 4]));
        if (bs.length !== 1) continue;
        const i = bs[0];
        const A0 = q[(i + 3) % 4], A1 = q[i];
        const B0 = q[(i + 2) % 4], B1 = q[(i + 1) % 4];
        const C = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
        let bestL: { P: Pt; Q: Pt; s: number } | null = null;
        const scores: number[] = [];
        for (let s = 0.5; s <= 1.0001; s += 0.025)
          for (let t = 0.5; t <= 1.0001; t += 0.025) {
            const P = lerp(A0, A1, s), Q = lerp(B0, B1, t);
            if (onBorder(P) && onBorder(Q)) continue;
            const sc = lineScore(P, Q, C);
            scores.push(sc);
            if (!bestL || sc > bestL.s) bestL = { P, Q, s: sc };
          }
        if (!bestL) continue;
        const med = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)];
        if (bestL.s < 10 || bestL.s < med * 1.5 + 4) continue;
        const nq = [...q];
        nq[i] = bestL.P;
        nq[(i + 1) % 4] = bestL.Q;
        const oq = orderQuad(nq);
        if (isConvex(oq) && polyArea(oq) >= minArea && !oq.some(onBorder)) evaluate({ q: oq, contour: null });
      }
    }

    mark('lomo');
    if (!ranked.length) return null;
    // Ajuste fino: cada esquina se mueve unos píxeles hasta que sus dos lados caen justo
    // sobre el borde real. Se hace con los 3 mejores y se queda el que mejor califique.
    ranked.sort((p, q) => q.score - p.score);
    const refine = (q0: Quad): Quad => {
      const q = q0.map((p) => ({ ...p })) as Quad;
      const step = Math.max(1, Math.round(Math.min(W, H) * 0.006));
      for (let round = 0; round < 2; round++)
        for (let i = 0; i < 4; i++) {
          const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
          const prev = q[(i + 3) % 4], next = q[(i + 1) % 4];
          let bestP = q[i];
          let bestS = sideScore(prev, q[i], cx, cy) + sideScore(q[i], next, cx, cy);
          const orig = q[i];
          for (let dy = -3; dy <= 3; dy++)
            for (let dx = -3; dx <= 3; dx++) {
              if (!dx && !dy) continue;
              const p = { x: orig.x + dx * step, y: orig.y + dy * step };
              if (p.x < 0 || p.y < 0 || p.x > W - 1 || p.y > H - 1) continue;
              const s = sideScore(prev, p, cx, cy) + sideScore(p, next, cx, cy);
              if (s > bestS + 0.01) {
                bestS = s;
                bestP = p;
              }
            }
          q[i] = bestP;
        }
      return q;
    };
    for (const r of ranked.slice(0, 3)) {
      const rq = refine(r.c.q);
      const s = scoreOf(rq);
      if (s > r.score) {
        r.c = { q: rq, contour: r.c.contour };
        r.score = s;
      }
    }
    ranked.sort((p, q) => q.score - p.score);
    mark('ajuste');
    const b = ranked[0];
    // El contorno queda un poco por fuera del papel (por la dilatación): lo encogemos levemente
    const oq = b.c.q;
    const cx = oq.reduce((s, p) => s + p.x, 0) / 4, cy = oq.reduce((s, p) => s + p.y, 0) / 4;
    const inset = Math.max(1, Math.min(W, H) * 0.004);
    const q = oq.map((p) => {
      const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * inset * 1.41, y: p.y + (dy / d) * inset * 1.41 };
    }) as Quad;
    const curve = opts.curve && b.c.contour ? edgeMids(q, b.c.contour) : null;
    const norm = (p: Pt): Pt => ({ x: Math.min(1, Math.max(0, p.x / W)), y: Math.min(1, Math.max(0, p.y / H)) });
    return {
      quad: q.map(norm) as Quad,
      curve: curve ? (curve.map(norm) as [Pt, Pt, Pt, Pt]) : null,
      area: polyArea(oq) / frameArea,
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
  const s = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  // Primero la búsqueda exigente (la misma de la cámara); si no encuentra nada, una más permisiva
  return detectDocument(cv, c, { curve, minArea: 0.08, strict: true }) || detectDocument(cv, c, { curve, minArea: 0.08 });
}

export function quadDistance(a: Quad, b: Quad) {
  let d = 0;
  for (let i = 0; i < 4; i++) d = Math.max(d, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  return d;
}

/** Aplica una homografía 3×3 (en píxeles de un cuadro W×H) a un cuadrilátero normalizado. */
export function warpQuad(q: Quad, h: number[], W: number, H: number): Quad | null {
  const out: Pt[] = [];
  for (const p of q) {
    const x = p.x * W, y = p.y * H;
    const w = h[6] * x + h[7] * y + h[8];
    if (Math.abs(w) < 1e-6) return null;
    out.push({ x: (h[0] * x + h[1] * y + h[2]) / w / W, y: (h[3] * x + h[4] * y + h[5]) / w / H });
  }
  return out as Quad;
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
