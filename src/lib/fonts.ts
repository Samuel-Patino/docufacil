// Fuentes para "Editar texto": reconoce la letra original del PDF y elige la más parecida
// que se pueda usar (las 3 estándar del PDF, Carlito/Caladea incluidas en la app, o una
// letra libre de Google Fonts descargada al momento).
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFNumber, PDFRef, PDFRawStream, StandardFonts, decodePDFRawStream, type PDFFont } from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import carlito400 from '@fontsource/carlito/files/carlito-latin-400-normal.woff?url';
import carlito400i from '@fontsource/carlito/files/carlito-latin-400-italic.woff?url';
import carlito700 from '@fontsource/carlito/files/carlito-latin-700-normal.woff?url';
import carlito700i from '@fontsource/carlito/files/carlito-latin-700-italic.woff?url';
import caladea400 from '@fontsource/caladea/files/caladea-latin-400-normal.woff?url';
import caladea400i from '@fontsource/caladea/files/caladea-latin-400-italic.woff?url';
import caladea700 from '@fontsource/caladea/files/caladea-latin-700-normal.woff?url';
import caladea700i from '@fontsource/caladea/files/caladea-latin-700-italic.woff?url';
import { winAnsi } from './pdfops';

export type StdFamily = 'helvetica' | 'times' | 'courier';

/** Letra elegida para un texto editado. */
export interface FontPick {
  /** 'helvetica' | 'times' | 'courier' (estándar) o el id de una letra descargable (p. ej. 'carlito', 'roboto') */
  font: string;
  /** familia estándar de respaldo por si la otra no tiene algún carácter */
  fallback: StdFamily;
  weight: number;
  italic: boolean;
  /** nombre original en el PDF, para mostrarlo */
  label: string;
}

/** Una letra usada en la página, leída del propio PDF. */
export interface PdfFontInfo {
  base: string;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
  weight: number;
  /** ancho de cada código (fuentes simples), en milésimas del tamaño */
  width?: (code: number) => number | undefined;
  /** código dentro de la letra para cada carácter (según su tabla ToUnicode) */
  code?: (ch: string) => number | undefined;
  /** caracteres que contiene la letra (las letras recortadas sólo traen los que usa el documento) */
  charset?: Set<string>;
}

const STD: StdFamily[] = ['helvetica', 'times', 'courier'];
export const isStd = (f?: string): f is StdFamily => !!f && (STD as string[]).includes(f);

const LOCAL: Record<string, Record<string, string>> = {
  carlito: { '400n': carlito400, '400i': carlito400i, '700n': carlito700, '700i': carlito700i },
  caladea: { '400n': caladea400, '400i': caladea400i, '700n': caladea700, '700i': caladea700i },
};

// Equivalentes conocidos (misma forma y ancho de letra)
const ALIASES: [RegExp, string][] = [
  [/^(arial|helvetica|arimo|liberationsans|nimbussans|nimbussansl|swiss721|helveticaneue|arialunicode|foxitsans|arialmt)$/, 'helvetica'],
  [/^(times|timesnewroman|timesroman|tinos|liberationserif|nimbusroman|nimbusromno9l|timesten|foxitserif|timesnewromanps)$/, 'times'],
  [/^(courier|couriernew|cousine|liberationmono|nimbusmono|nimbusmonops|foxitfixed|couriernewps)$/, 'courier'],
  [/^(calibri|carlito)$/, 'carlito'],
  [/^(cambria|caladea)$/, 'caladea'],
  [/^(segoeui|segoe)$/, 'open-sans'],
  [/^(verdana|tahoma|dejavusans)$/, 'pt-sans'],
  [/^(georgia)$/, 'gelasio'],
  [/^(garamond|adobegaramond|garamondpremrpro)$/, 'eb-garamond'],
  [/^(bookantiqua|palatino|palatinolinotype)$/, 'tex-gyre-pagella'],
  [/^(centurygothic|futura)$/, 'questrial'],
  [/^(trebuchetms|trebuchet)$/, 'fira-sans'],
  [/^(franklingothic|franklingothicbook)$/, 'libre-franklin'],
  [/^(gillsans|gillsansmt)$/, 'lato'],
];
// Letras de sistema/propietarias sin equivalente libre: usar la estándar y ajustar el ancho
const NO_WEB = /^(symbol|zapfdingbats|wingdings|webdings|msgothic|mincho|simsun|arialnarrow|consolas|lucida|candara|corbel|constantia|bookman|impact|comicsans)/;

function parseWeight(style: string) {
  const s = style.toLowerCase();
  if (/thin|hairline/.test(s)) return 100;
  if (/extralight|ultralight/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/semibold|demibold|demi/.test(s)) return 600;
  if (/extrabold|ultrabold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  if (/medium/.test(s)) return 500;
  return 400;
}

/** "ABCDEF+Calibri-BoldItalic" → familia "Calibri" y estilo "BoldItalic". */
export function splitFontName(base: string) {
  const name = base.replace(/^[A-Z]{6}\+/, '').replace(/^\//, '');
  let [fam, style = ''] = name.split(/[-,]/);
  // "Arial,Bold" / "TimesNewRomanPS-BoldMT" / "ArialMT"
  fam = fam.replace(/(PSMT|PS|MT|Std|Pro|LT|OT)$/g, '');
  const m = /^(.*?)(Bold|Italic|Oblique|Regular|Light|Medium|Semibold|SemiBold|Black|Heavy|Thin)+$/.exec(fam);
  if (m && m[1].length > 2) {
    style = fam.slice(m[1].length) + style;
    fam = m[1];
  }
  style = style.replace(/MT$/, '');
  return { fam, style };
}

const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');

/** Elige la letra más parecida para una letra del PDF. */
export function pickFont(info: { base: string; bold: boolean; italic: boolean; serif: boolean; mono: boolean; weight?: number }): FontPick {
  const { fam, style } = splitFontName(info.base);
  const key = fam.toLowerCase().replace(/[^a-z0-9]/g, '');
  const weight = info.weight && info.weight !== 400 ? info.weight : info.bold ? Math.max(700, parseWeight(style)) : parseWeight(style);
  const italic = info.italic || /italic|oblique/i.test(style);
  const fallback: StdFamily = info.mono || /mono|courier|code/i.test(fam) ? 'courier' : info.serif || /serif|roman|times|georgia|garamond|book|minion|palatino|century|cambria/i.test(fam) && !/sans/i.test(fam) ? 'times' : 'helvetica';
  let font: string = fallback;
  const alias = ALIASES.find(([re]) => re.test(key));
  if (alias) font = alias[1];
  else if (key && !NO_WEB.test(key) && !/^(f\d+|t\d+|font\d*|tt\d+|c\d+_\d+)$/i.test(fam)) font = kebab(fam);
  return { font, fallback, weight, italic, label: fam || info.base };
}

// ---------- descarga de letras ----------

const bytesCache = new Map<string, Promise<{ bytes: Uint8Array; weight: number; italic: boolean } | null>>();

function variants(weight: number, italic: boolean) {
  const ws = [weight, weight >= 600 ? 700 : 400, weight >= 600 ? 600 : 500, 400].filter((w, i, a) => a.indexOf(w) === i);
  const out: [number, boolean][] = [];
  for (const w of ws) out.push([w, italic]);
  if (italic) for (const w of ws) out.push([w, false]);
  return out;
}

const familyOk = new Map<string, Promise<boolean>>();
const cdn = (id: string, w: number, it: boolean) => `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${w}-${it ? 'italic' : 'normal'}.woff`;
/** ¿Existe la familia en Google Fonts (fontsource)? */
function familyExists(id: string) {
  let pr = familyOk.get(id);
  if (!pr) {
    pr = fetch(cdn(id, 400, false), { method: 'HEAD' }).then((r) => r.ok, () => false);
    familyOk.set(id, pr);
  }
  return pr;
}

/** Archivo de la letra (local o de Google Fonts por fontsource). null si no existe o no hay conexión. */
export function fontBytes(id: string, weight: number, italic: boolean) {
  const k = `${id}|${weight}|${italic}`;
  let pr = bytesCache.get(k);
  if (!pr) {
    pr = (async () => {
      if (!LOCAL[id] && !(await familyExists(id))) return null;
      for (const [w, it] of variants(weight, italic)) {
        const url = LOCAL[id] ? LOCAL[id][`${w >= 600 ? 700 : 400}${it ? 'i' : 'n'}`] : cdn(id, w, it);
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          return { bytes: new Uint8Array(await r.arrayBuffer()), weight: LOCAL[id] ? (w >= 600 ? 700 : 400) : w, italic: it };
        } catch {
          return null; // sin conexión
        }
      }
      return null;
    })();
    bytesCache.set(k, pr);
  }
  return pr;
}

const STD_WEB: Record<StdFamily, string> = { helvetica: 'arimo', times: 'tinos', courier: 'cousine' };
const STD_CSS: Record<StdFamily, string> = {
  helvetica: 'Helvetica, Arial, "df-arimo", sans-serif',
  times: '"Times New Roman", Times, "df-tinos", serif',
  courier: '"Courier New", Courier, "df-cousine", monospace',
};

/** Familia CSS para mostrar el texto igual a como quedará guardado. */
export function fontCss(a: { font?: string; serif?: boolean; fallback?: StdFamily }) {
  const f = a.font || (a.serif ? 'times' : 'helvetica');
  if (isStd(f)) return STD_CSS[f];
  return `"df-${f}", ${STD_CSS[a.fallback || (a.serif ? 'times' : 'helvetica')]}`;
}

const cssLoaded = new Set<string>();
/** Carga la letra en el navegador para la vista previa. Devuelve true si cambió algo. */
export async function ensureCssFont(a: { font?: string; weight?: number; bold?: boolean; italic?: boolean }) {
  const f = a.font;
  if (!f) return false;
  const weight = a.weight ?? (a.bold ? 700 : 400);
  const italic = !!a.italic;
  const id = isStd(f) ? STD_WEB[f] : f;
  // en computadores/iPhone suelen existir Helvetica/Arial/Times: sólo se descarga si hace falta
  if (isStd(f) && hasLocal(f)) return false;
  const k = `${id}|${weight}|${italic}`;
  if (cssLoaded.has(k)) return false;
  cssLoaded.add(k);
  const got = await fontBytes(id, weight, italic);
  if (!got) return false;
  try {
    const ff = new FontFace(`df-${id}`, got.bytes.slice().buffer, { weight: String(weight), style: italic && got.italic ? 'italic' : 'normal' });
    await ff.load();
    document.fonts.add(ff);
    return true;
  } catch {
    return false;
  }
}

// ¿Existe de verdad la letra en el sistema? (document.fonts.check devuelve true aunque no exista)
const localCache = new Map<string, boolean>();
function hasLocal(f: StdFamily) {
  if (localCache.has(f)) return localCache.get(f)!;
  const name = f === 'helvetica' ? 'Arial' : f === 'times' ? 'Times New Roman' : 'Courier New';
  const c = document.createElement('canvas').getContext('2d')!;
  const probe = 'mmmmmmmmmmlli1WQ';
  c.font = `40px monospace`;
  const a = c.measureText(probe).width;
  c.font = `40px "${name}", monospace`;
  const b = c.measureText(probe).width;
  const ok = f === 'courier' ? true : Math.abs(a - b) > 1;
  localCache.set(f, ok);
  return ok;
}

// ---------- medidas y uso dentro del PDF ----------

const STD_NAME: Record<StdFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};
export const stdFontName = (f: StdFamily, bold: boolean, italic: boolean) => STD_NAME[f][(bold ? 1 : 0) + (italic ? 2 : 0)];

/** Incrusta en el documento la letra elegida (o la estándar si falta algún carácter). */
export async function embedPick(
  d: PDFDocument,
  a: { font?: string; fallback?: StdFamily; weight?: number; bold?: boolean; italic?: boolean; serif?: boolean },
  text: string,
  cache: Map<string, PDFFont>,
): Promise<{ font: PDFFont; std: boolean }> {
  const weight = a.weight ?? (a.bold ? 700 : 400);
  const bold = weight >= 600;
  const italic = !!a.italic;
  const f = a.font || (a.serif ? 'times' : 'helvetica');
  if (!isStd(f)) {
    const k = `${f}|${weight}|${italic}`;
    let font = cache.get(k);
    if (!font) {
      const got = await fontBytes(f, weight, italic);
      if (got) {
        d.registerFontkit(fontkit as any);
        font = await d.embedFont(got.bytes, { subset: true });
        cache.set(k, font);
      }
    }
    if (font) {
      const set = new Set(font.getCharacterSet());
      const ok = [...text.replace(/[\r\n]/g, '')].every((ch) => set.has(ch.codePointAt(0)!));
      if (ok) return { font, std: false };
    }
  }
  const fam: StdFamily = isStd(f) ? f : a.fallback || (a.serif ? 'times' : 'helvetica');
  const name = stdFontName(fam, bold, italic);
  let font = cache.get(name);
  if (!font) {
    font = await d.embedFont(name);
    cache.set(name, font);
  }
  return { font, std: true };
}

let measureDoc: Promise<PDFDocument> | null = null;
const measureCache = new Map<string, PDFFont>();
/** Ancho (en puntos) que tendrá el texto con la letra elegida. */
export async function measurePick(a: FontPick, text: string, size: number) {
  measureDoc ??= PDFDocument.create();
  const d = await measureDoc;
  const { font, std } = await embedPick(d, a, text, measureCache);
  return font.widthOfTextAtSize(std ? winAnsi(text) : text, size);
}

// ---------- letras usadas en una página (leídas con pdf-lib) ----------

/** Lista las letras de una página con sus datos (nombre, negrita, cursiva, anchos). */
export function pageFonts(d: PDFDocument, pageIndex: number): PdfFontInfo[] {
  const out: PdfFontInfo[] = [];
  const seen = new Set<string>();
  const ctx = d.context;
  const look = <T,>(o: any, type?: any): T | undefined => {
    try {
      const v = o instanceof PDFRef ? ctx.lookup(o) : o;
      return (type ? (v instanceof type ? v : undefined) : v) as T;
    } catch {
      return undefined;
    }
  };
  const num = (o: any) => {
    const v = look<any>(o);
    return v instanceof PDFNumber ? v.asNumber() : undefined;
  };
  const visit = (res: PDFDict | undefined, depth: number) => {
    if (!res || depth > 3) return;
    const fonts = look<PDFDict>(res.get(PDFName.of('Font')), PDFDict);
    if (fonts)
      for (const [, ref] of fonts.entries()) {
        const fd = look<PDFDict>(ref, PDFDict);
        if (!fd) continue;
        const baseObj = fd.get(PDFName.of('BaseFont'));
        const base = baseObj instanceof PDFName ? baseObj.decodeText() : '';
        const sub = fd.get(PDFName.of('Subtype'));
        if (sub instanceof PDFName && sub.decodeText() === 'Type3') continue;
        const key = base + '|' + String(ref);
        if (!base || seen.has(key)) continue;
        seen.add(key);
        let desc = look<PDFDict>(fd.get(PDFName.of('FontDescriptor')), PDFDict);
        if (!desc) {
          const df = look<PDFArray>(fd.get(PDFName.of('DescendantFonts')), PDFArray);
          const d0 = df && look<PDFDict>(df.get(0), PDFDict);
          desc = d0 && look<PDFDict>(d0.get(PDFName.of('FontDescriptor')), PDFDict);
        }
        const flags = (desc && num(desc.get(PDFName.of('Flags')))) || 0;
        const fw = desc && num(desc.get(PDFName.of('FontWeight')));
        const { style } = splitFontName(base);
        const weight = fw || parseWeight(style);
        let width: PdfFontInfo['width'];
        const first = num(fd.get(PDFName.of('FirstChar')));
        const ws = look<PDFArray>(fd.get(PDFName.of('Widths')), PDFArray);
        if (first !== undefined && ws) {
          const arr = ws.asArray().map((o) => num(o) ?? 0);
          width = (c) => (c >= first && c - first < arr.length ? arr[c - first] : undefined);
        } else {
          // letras compuestas (Type0): anchos en /W de la letra descendiente
          const df = look<PDFArray>(fd.get(PDFName.of('DescendantFonts')), PDFArray);
          const d0 = df && look<PDFDict>(df.get(0), PDFDict);
          const W = d0 && look<PDFArray>(d0.get(PDFName.of('W')), PDFArray);
          const dw = (d0 && num(d0.get(PDFName.of('DW')))) ?? 1000;
          if (d0) {
            const map = new Map<number, number>();
            const arr = W ? W.asArray().map((o) => look<any>(o)) : [];
            for (let i = 0; i < arr.length; ) {
              const c0 = arr[i] instanceof PDFNumber ? arr[i].asNumber() : NaN;
              const nx = arr[i + 1];
              if (nx instanceof PDFArray) {
                nx.asArray().forEach((o, k) => map.set(c0 + k, num(o) ?? dw));
                i += 2;
              } else {
                const c1 = num(nx) ?? c0, w = num(arr[i + 2]) ?? dw;
                for (let c = c0; c <= c1 && c - c0 < 65536; c++) map.set(c, w);
                i += 3;
              }
            }
            width = (c) => map.get(c) ?? dw;
          }
        }
        const tu = toUnicode(look<any>(fd.get(PDFName.of('ToUnicode'))));
        out.push({
          base,
          bold: /bold|black|heavy/i.test(style) || !!(flags & 262144) || weight >= 600,
          italic: /italic|oblique/i.test(style) || !!(flags & 64),
          serif: !!(flags & 2),
          mono: !!(flags & 1),
          weight,
          width,
          code: tu ? (ch) => tu.get(ch) : undefined,
          charset: tu ? new Set(tu.keys()) : undefined,
        });
      }
    // letras dentro de formularios/plantillas (XObject)
    const xo = look<PDFDict>(res.get(PDFName.of('XObject')), PDFDict);
    if (xo)
      for (const [, ref] of xo.entries()) {
        const s: any = look<any>(ref);
        const dict: PDFDict | undefined = s?.dict;
        if (!dict) continue;
        const st = dict.get(PDFName.of('Subtype'));
        if (!(st instanceof PDFName) || st.decodeText() !== 'Form') continue;
        visit(look<PDFDict>(dict.get(PDFName.of('Resources')), PDFDict), depth + 1);
      }
  };
  try {
    const page = d.getPage(pageIndex);
    visit(page.node.Resources(), 0);
  } catch {
    /* página rara: sin datos de letras */
  }
  return out;
}

/** Ancho previsto de un texto con una letra del PDF (sólo letras simples con tabla de anchos). */
export function predictWidth(f: PdfFontInfo, text: string, size: number) {
  if (!f.width) return undefined;
  let sum = 0;
  for (const ch of text) {
    const code = f.code ? f.code(ch) : ch.charCodeAt(0);
    if (code === undefined) return undefined;
    const w = f.width(code);
    if (w === undefined) return undefined;
    sum += w;
  }
  return (sum / 1000) * size;
}

/** Lee la tabla ToUnicode de una letra: carácter → código. */
function toUnicode(stream: any): Map<string, number> | undefined {
  if (!stream || !stream.dict) return undefined;
  let txt = '';
  try {
    const bytes: Uint8Array = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents?.();
    if (!bytes) return undefined;
    for (let i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]);
  } catch {
    return undefined;
  }
  const map = new Map<string, number>();
  const uni = (h: string) => {
    let out = '';
    for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return out;
  };
  for (const block of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const ch = uni(m[2]);
      if (ch && !map.has(ch)) map.set(ch, parseInt(m[1], 16));
    }
  for (const block of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (hi - lo > 4096) continue;
      if (m[3].startsWith('[')) {
        const list = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => uni(x[1]));
        list.forEach((ch, k) => ch && !map.has(ch) && map.set(ch, lo + k));
      } else {
        const h = m[3].slice(1, -1);
        const start = parseInt(h.slice(-4), 16), prefix = uni(h.slice(0, -4));
        for (let c = lo; c <= hi; c++) {
          const ch = prefix + String.fromCharCode(start + (c - lo));
          if (!map.has(ch)) map.set(ch, c);
        }
      }
    }
  return map.size ? map : undefined;
}

/**
 * Nombre real de una letra leyendo la tabla "name" del archivo de fuente que genera pdf.js
 * (conserva el nombre original de la letra incrustada o el del PDF).
 */
export function fontNamesFromData(data?: Uint8Array | null): { family: string; style: string; ps: string } | null {
  if (!data || data.length < 12) return null;
  try {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const n = dv.getUint16(4);
    let off = -1;
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16;
      const tag = String.fromCharCode(data[r], data[r + 1], data[r + 2], data[r + 3]);
      if (tag === 'name') off = dv.getUint32(r + 8);
    }
    if (off < 0) return null;
    const count = dv.getUint16(off + 2), strOff = off + dv.getUint16(off + 4);
    const best: Record<number, { s: string; rank: number }> = {};
    for (let k = 0; k < count; k++) {
      const r = off + 6 + k * 12;
      const plat = dv.getUint16(r), lang = dv.getUint16(r + 4), id = dv.getUint16(r + 6), len = dv.getUint16(r + 8), o = strOff + dv.getUint16(r + 10);
      if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
      let s = '';
      if (plat === 3 || plat === 0) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(dv.getUint16(o + j));
      else for (let j = 0; j < len; j++) s += String.fromCharCode(data[o + j]);
      s = s.replace(/\0/g, '').trim();
      if (!s) continue;
      const rank = plat === 3 && lang === 0x409 ? 3 : plat === 3 ? 2 : 1;
      if (!best[id] || rank > best[id].rank) best[id] = { s, rank };
    }
    const g = (id: number) => best[id]?.s || '';
    const family = g(16) || g(1);
    const style = g(17) || g(2);
    const ps = g(6);
    if (!family && !ps) return null;
    return { family, style, ps };
  } catch {
    return null;
  }
}

/** Datos de la letra a partir de su nombre real (familia + estilo). */
export function infoFromNames(nm: { family: string; style: string; ps: string }, flags: { bold?: boolean; italic?: boolean; serif?: boolean; mono?: boolean }) {
  // familias limpias ("Times New Roman") se prefieren; si parece un nombre PostScript se usa tal cual
  const clean = !!nm.family && !/^[A-Z]{6}\+/.test(nm.family) && !/^(Unknown|Original licence)$/i.test(nm.family) && (/\s/.test(nm.family) || !/-/.test(nm.family));
  const fam = clean ? nm.family.replace(/\s+/g, '') : splitFontName(nm.ps || nm.family).fam;
  const style = ((clean ? nm.style : splitFontName(nm.ps || nm.family).style) || '').replace(/^unknown$/i, '');
  const st = style.toLowerCase();
  const base = fam + (style && !/^regular|normal|roman|book$/i.test(style) ? '-' + style.replace(/\s+/g, '') : '');
  return {
    base,
    bold: /bold|black|heavy|semibold|demi/.test(st) || !!flags.bold,
    italic: /italic|oblique/.test(st) || !!flags.italic,
    serif: !!flags.serif,
    mono: !!flags.mono,
    weight: parseWeight(st) === 400 && flags.bold ? 700 : parseWeight(st),
  };
}
