// "Editar texto": tapa una línea del PDF reconstruyendo sólo el fondo que hay detrás de las letras
// (no un rectángulo de un color fijo). Así funciona sobre fondos de color, degradados o texturas.
import type { PDFPageProxy } from 'pdfjs-dist';

export interface CoverResult {
  /** rectángulo tapado (coordenadas de la página a escala 1) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** fondo liso: basta un rectángulo de este color */
  color?: string;
  /** fondo con dibujo: imagen del fondo reconstruido */
  src?: string;
  /** color de las letras originales */
  ink: string;
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Filtro de máximo/mínimo separable (para estimar el fondo quitando las letras). */
function rankFilter(src: Float32Array, W: number, H: number, r: number, max: boolean) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pick = max ? Math.max : Math.min;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = src[y * W + x];
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) v = pick(v, src[y * W + k]);
      tmp[y * W + x] = v;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = tmp[y * W + x];
      for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) v = pick(v, tmp[k * W + x]);
      out[y * W + x] = v;
    }
  return out;
}

/**
 * Reconstruye el fondo de una línea de texto.
 * line: x (izquierda), base (línea base), w (ancho) y size (tamaño de letra), en coordenadas de la página a escala 1.
 */
export async function makeCover(page: PDFPageProxy, line: { x: number; base: number; w: number; size: number }): Promise<CoverResult> {
  const vp1 = page.getViewport({ scale: 1 });
  const { x, base, w, size } = line;
  const s = Math.min(8, Math.max(3, 60 / size)); // píxeles por punto
  // zona de trabajo (un poco más grande que la línea, para tener fondo alrededor)
  const rx0 = Math.max(0, x - size * 0.4), rx1 = Math.min(vp1.width, x + w + size * 0.4);
  const ry0 = Math.max(0, base - size * 1.25), ry1 = Math.min(vp1.height, base + size * 0.5);
  const W = Math.max(4, Math.ceil((rx1 - rx0) * s)), H = Math.max(4, Math.ceil((ry1 - ry0) * s));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const vp = page.getViewport({ scale: s });
  await page.render({ canvas, viewport: vp, transform: [1, 0, 0, 1, -rx0 * s, -ry0 * s], background: 'white', annotationMode: 1 } as any).promise;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const N = W * H;
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

  // franja donde pueden estar las letras de esta línea (no tocar las líneas de arriba/abajo)
  const bx0 = Math.max(0, Math.floor((x - 1.5 - rx0) * s)), bx1 = Math.min(W, Math.ceil((x + w + 1.5 - rx0) * s));
  const by0 = Math.max(0, Math.floor((base - size * 1.02 - ry0) * s)), by1 = Math.min(H, Math.ceil((base + size * 0.33 - ry0) * s));

  // ¿letras oscuras sobre fondo claro, o al revés? (las letras son la minoría)
  const band: number[] = [];
  for (let y = by0; y < by1; y++) for (let xx = bx0; xx < bx1; xx++) band.push(L[y * W + xx]);
  band.sort((a, b) => a - b);
  const q = (p: number) => band[Math.min(band.length - 1, Math.max(0, Math.floor(band.length * p)))] ?? 255;
  const med = q(0.5);
  const dark = med - q(0.02) >= q(0.98) - med;

  // fondo estimado: se "borra" el trazo de las letras con un cierre/apertura morfológico
  const r = Math.max(2, Math.round(size * s * 0.13));
  const bg = dark ? rankFilter(rankFilter(L, W, H, r, true), W, H, r, false) : rankFilter(rankFilter(L, W, H, r, false), W, H, r, true);

  // máscara de letras (con un pequeño margen para el suavizado del borde)
  const raw = new Uint8Array(N);
  let maxDiff = 0;
  for (let y = by0; y < by1; y++)
    for (let xx = bx0; xx < bx1; xx++) {
      const i = y * W + xx;
      const diff = dark ? bg[i] - L[i] : L[i] - bg[i];
      if (diff > 16) raw[i] = 1;
      if (diff > maxDiff) maxDiff = diff;
    }
  const grow = Math.max(1, Math.round(s * 0.35));
  const mask = new Uint8Array(N);
  let mx0 = W, my0 = H, mx1 = -1, my1 = -1;
  for (let y = 0; y < H; y++)
    for (let xx = 0; xx < W; xx++) {
      if (!raw[y * W + xx]) continue;
      for (let yy = Math.max(0, y - grow); yy <= Math.min(H - 1, y + grow); yy++)
        for (let k = Math.max(0, xx - grow); k <= Math.min(W - 1, xx + grow); k++) mask[yy * W + k] = 1;
      if (xx < mx0) mx0 = xx;
      if (xx > mx1) mx1 = xx;
      if (y < my0) my0 = y;
      if (y > my1) my1 = y;
    }
  if (mx1 < 0) {
    // no se encontró tinta: tapar la franja completa
    mx0 = bx0; mx1 = bx1 - 1; my0 = by0; my1 = by1 - 1;
    for (let y = by0; y < by1; y++) for (let xx = bx0; xx < bx1; xx++) mask[y * W + xx] = 1;
  }
  const pad = grow + 1;
  mx0 = Math.max(0, mx0 - pad); my0 = Math.max(0, my0 - pad);
  mx1 = Math.min(W - 1, mx1 + pad); my1 = Math.min(H - 1, my1 + pad);

  // color de las letras: promedio de los píxeles más "de tinta"
  let ir = 0, ig = 0, ib = 0, ic = 0;
  for (let y = by0; y < by1; y++)
    for (let xx = bx0; xx < bx1; xx++) {
      const i = y * W + xx;
      const diff = dark ? bg[i] - L[i] : L[i] - bg[i];
      if (diff > maxDiff * 0.7) {
        ir += d[i * 4]; ig += d[i * 4 + 1]; ib += d[i * 4 + 2]; ic++;
      }
    }
  const ink = ic ? hex(ir / ic, ig / ic, ib / ic) : dark ? '#111111' : '#ffffff';

  // rellenar los píxeles de las letras con el fondo de alrededor:
  // primero interpolando en vertical (arriba/abajo de la letra) y luego suavizando
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2]; }
  for (let xx = mx0; xx <= mx1; xx++) {
    let y = my0;
    while (y <= my1) {
      if (!mask[y * W + xx]) { y++; continue; }
      let y2 = y;
      while (y2 < H && mask[y2 * W + xx]) y2++;
      const up = y - 1 >= 0 ? (y - 1) * W + xx : -1;
      const dn = y2 < H ? y2 * W + xx : -1;
      for (let yy = y; yy < y2; yy++) {
        const i = yy * W + xx;
        const t = (yy - y + 1) / (y2 - y + 1);
        const a = up >= 0 ? up : dn, b = dn >= 0 ? dn : up;
        if (a < 0) continue;
        R[i] = R[a] * (1 - t) + R[b] * t;
        G[i] = G[a] * (1 - t) + G[b] * t;
        B[i] = B[a] * (1 - t) + B[b] * t;
      }
      y = y2;
    }
  }
  for (let it = 0; it < 12; it++)
    for (let y = my0; y <= my1; y++)
      for (let xx = mx0; xx <= mx1; xx++) {
        const i = y * W + xx;
        if (!mask[i]) continue;
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (j < 0 || j >= N) continue;
          sr += R[j]; sg += G[j]; sb += B[j]; n++;
        }
        if (n) { R[i] = sr / n; G[i] = sg / n; B[i] = sb / n; }
      }

  // ¿fondo liso? → un rectángulo del color exacto (más nítido y liviano)
  let mr = 0, mg = 0, mb = 0, cnt = 0;
  for (let y = my0; y <= my1; y++) for (let xx = mx0; xx <= mx1; xx++) { const i = y * W + xx; mr += R[i]; mg += G[i]; mb += B[i]; cnt++; }
  mr /= cnt; mg /= cnt; mb /= cnt;
  let dev = 0;
  for (let y = my0; y <= my1; y++) for (let xx = mx0; xx <= mx1; xx++) { const i = y * W + xx; dev = Math.max(dev, Math.abs(R[i] - mr) + Math.abs(G[i] - mg) + Math.abs(B[i] - mb)); }

  const out = { x: rx0 + mx0 / s, y: ry0 + my0 / s, w: (mx1 - mx0 + 1) / s, h: (my1 - my0 + 1) / s, ink };
  if (dev < 14) return { ...out, color: hex(mr, mg, mb) };

  const pw = mx1 - mx0 + 1, ph = my1 - my0 + 1;
  const pc = document.createElement('canvas');
  pc.width = pw;
  pc.height = ph;
  const pctx = pc.getContext('2d')!;
  const pimg = pctx.createImageData(pw, ph);
  for (let y = 0; y < ph; y++)
    for (let xx = 0; xx < pw; xx++) {
      const i = (y + my0) * W + xx + mx0, o = (y * pw + xx) * 4;
      pimg.data[o] = R[i]; pimg.data[o + 1] = G[i]; pimg.data[o + 2] = B[i]; pimg.data[o + 3] = 255;
    }
  pctx.putImageData(pimg, 0, 0);
  return { ...out, src: pc.toDataURL('image/png') };
}
