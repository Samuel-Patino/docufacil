export const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');

export function formatBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Hoy, ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString())
    return 'Ayer, ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function defaultScanName(prefix = 'Escaneo'): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'documento';
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any;
  return (...a: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Rangos tipo "1-3, 5, 8-10" → índices base 0. */
export function parseRanges(input: string, total: number): number[][] | null {
  const parts = input.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: number[][] = [];
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*(?:-\s*(\d+|fin|final|n))?$/i);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = m[2] ? (/^\d+$/.test(m[2]) ? parseInt(m[2], 10) : total) : a;
    if (a < 1 || b < a || b > total) return null;
    const r: number[] = [];
    for (let i = a; i <= b; i++) r.push(i - 1);
    out.push(r);
  }
  return out;
}

export function pagesLabel(n: number) {
  return n === 1 ? '1 página' : `${n} páginas`;
}

export async function blobToDataURL(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

export function dataURLToBlob(url: string): Blob {
  const [head, data] = url.split(',');
  const mime = head.match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.9): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar la imagen'))), type, q),
  );
}

export function u8(b: ArrayBuffer | Uint8Array): Uint8Array {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

export function bytesToBlob(bytes: Uint8Array | ArrayBuffer, type: string) {
  return new Blob([bytes as BlobPart], { type });
}

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const isTouch = () => matchMedia('(pointer: coarse)').matches;
