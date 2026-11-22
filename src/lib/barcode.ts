// Lector de códigos QR y de barras (BarcodeDetector nativo o ZXing).
let zx: any = null;
let reader: any = null;
let nativeDet: any = null;
let nativeChecked = false;

async function native() {
  if (nativeChecked) return nativeDet;
  nativeChecked = true;
  try {
    const BD = (window as any).BarcodeDetector;
    if (BD) {
      const formats = await BD.getSupportedFormats();
      if (formats?.includes('qr_code')) nativeDet = new BD({ formats });
    }
  } catch {}
  return nativeDet;
}

async function zxing() {
  if (reader) return reader;
  zx = await import('@zxing/library');
  const hints = new Map();
  hints.set(zx.DecodeHintType.TRY_HARDER, true);
  hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
    zx.BarcodeFormat.QR_CODE, zx.BarcodeFormat.DATA_MATRIX, zx.BarcodeFormat.AZTEC, zx.BarcodeFormat.PDF_417,
    zx.BarcodeFormat.EAN_13, zx.BarcodeFormat.EAN_8, zx.BarcodeFormat.UPC_A, zx.BarcodeFormat.UPC_E,
    zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39, zx.BarcodeFormat.ITF,
  ]);
  reader = new zx.MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

export interface CodeResult {
  text: string;
  format: string;
}

export async function decodeCanvas(c: HTMLCanvasElement): Promise<CodeResult | null> {
  const n = await native();
  if (n) {
    try {
      const r = await n.detect(c);
      if (r?.length) return { text: r[0].rawValue, format: r[0].format };
    } catch {}
  }
  const rd = await zxing();
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  try {
    const src = new zx.RGBLuminanceSource(lum, width, height);
    const bmp = new zx.BinaryBitmap(new zx.HybridBinarizer(src));
    const r = rd.decode(bmp);
    return { text: r.getText(), format: zx.BarcodeFormat[r.getBarcodeFormat()] || 'code' };
  } catch {
    return null;
  } finally {
    rd.reset?.();
  }
}

export async function decodeBlob(b: Blob): Promise<CodeResult | null> {
  const bmp = await createImageBitmap(b);
  for (const max of [1400, 900, 2200]) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const r = await decodeCanvas(c);
    if (r) {
      bmp.close();
      return r;
    }
  }
  bmp.close();
  return null;
}

export type QrKind = 'url' | 'wifi' | 'email' | 'phone' | 'sms' | 'contact' | 'geo' | 'text';

export function classifyCode(text: string): { kind: QrKind; title: string; fields: [string, string][]; action?: { label: string; href: string } } {
  const t = text.trim();
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) {
    const href = /^www\./i.test(t) ? 'https://' + t : t;
    return { kind: 'url', title: 'Enlace', fields: [['Dirección', t]], action: { label: 'Abrir enlace', href } };
  }
  if (/^WIFI:/i.test(t)) {
    const get = (k: string) => t.match(new RegExp(`${k}:((?:\\\\.|[^;])*)`, 'i'))?.[1]?.replace(/\\(.)/g, '$1') || '';
    return {
      kind: 'wifi',
      title: 'Red Wi-Fi',
      fields: [['Nombre de la red', get('S')], ['Contraseña', get('P')], ['Seguridad', get('T') || 'Abierta']],
    };
  }
  if (/^mailto:/i.test(t) || /^MATMSG:/i.test(t)) {
    const addr = t.replace(/^mailto:/i, '').split('?')[0].replace(/^MATMSG:TO:/i, '').split(';')[0];
    return { kind: 'email', title: 'Correo', fields: [['Para', addr]], action: { label: 'Escribir correo', href: 'mailto:' + addr } };
  }
  if (/^tel:/i.test(t)) {
    const n = t.slice(4);
    return { kind: 'phone', title: 'Teléfono', fields: [['Número', n]], action: { label: 'Llamar', href: 'tel:' + n } };
  }
  if (/^(sms|smsto):/i.test(t)) {
    const [, num, msg] = t.split(':');
    return { kind: 'sms', title: 'Mensaje SMS', fields: [['Número', num || ''], ['Mensaje', msg || '']], action: { label: 'Enviar SMS', href: `sms:${num}` } };
  }
  if (/^BEGIN:VCARD/i.test(t) || /^MECARD:/i.test(t)) {
    const fields: [string, string][] = [];
    const fn = t.match(/(?:^|\n)FN[^:]*:(.*)/i)?.[1] || t.match(/MECARD:N:([^;]*)/i)?.[1];
    const tel = t.match(/(?:^|\n)TEL[^:]*:(.*)/i)?.[1] || t.match(/TEL:([^;]*)/i)?.[1];
    const em = t.match(/(?:^|\n)EMAIL[^:]*:(.*)/i)?.[1] || t.match(/EMAIL:([^;]*)/i)?.[1];
    const org = t.match(/(?:^|\n)ORG[^:]*:(.*)/i)?.[1];
    if (fn) fields.push(['Nombre', fn.trim()]);
    if (tel) fields.push(['Teléfono', tel.trim()]);
    if (em) fields.push(['Correo', em.trim()]);
    if (org) fields.push(['Empresa', org.trim()]);
    return { kind: 'contact', title: 'Contacto', fields };
  }
  if (/^geo:/i.test(t)) {
    const [lat, lng] = t.slice(4).split(/[,?]/);
    return {
      kind: 'geo',
      title: 'Ubicación',
      fields: [['Coordenadas', `${lat}, ${lng}`]],
      action: { label: 'Ver en el mapa', href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` },
    };
  }
  return { kind: 'text', title: 'Texto', fields: [['Contenido', t]] };
}
