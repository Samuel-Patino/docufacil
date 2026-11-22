// Traducción gratuita: primero el traductor integrado del navegador (sin enviar
// nada, Chrome de escritorio reciente); si no existe, el servicio público de
// Google Traductor. Como último recurso se abre la web de Google Traductor.
import type { ScanPage } from './scanTypes';

export const TR_LANGS: { id: string; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'Inglés' },
  { id: 'pt', label: 'Portugués' },
  { id: 'fr', label: 'Francés' },
  { id: 'it', label: 'Italiano' },
  { id: 'de', label: 'Alemán' },
  { id: 'nl', label: 'Neerlandés' },
  { id: 'ru', label: 'Ruso' },
  { id: 'zh-CN', label: 'Chino' },
  { id: 'ja', label: 'Japonés' },
  { id: 'ko', label: 'Coreano' },
  { id: 'ar', label: 'Árabe' },
  { id: 'hi', label: 'Hindi' },
];

export const langLabel = (id?: string) => {
  if (!id) return '';
  const base = id.split('-')[0];
  return TR_LANGS.find((l) => l.id === id || l.id.split('-')[0] === base)?.label || id.toUpperCase();
};

/** Página que espera ser traducida (la deja el escáner en modo Traducir). */
export const pendingTranslate: { page: ScanPage | null } = { page: null };

/** Une las líneas de párrafos de texto corrido para que la traducción sea natural. */
export function paragraphsForTranslation(paragraphs: string[]): string {
  // Une una línea con la siguiente si la frase continúa (la siguiente empieza en
  // minúscula y la anterior no termina en puntuación). Títulos, listas y recibos
  // conservan sus saltos de línea.
  return paragraphs
    .map((p) => {
      const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
      let out = lines[0] || '';
      for (let i = 1; i < lines.length; i++) {
        const prev = lines[i - 1], next = lines[i];
        const continues = !/[.:;!?)]$/.test(prev) && /^[a-záéíóúñüàèìòùâêîôûçäöß(“"']/.test(next);
        if (continues && /\w-$/.test(prev)) out = out.slice(0, -1) + next;
        else out += (continues ? ' ' : '\n') + next;
      }
      return out;
    })
    .join('\n\n');
}

function chunks(text: string, max = 1500): string[] {
  const out: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) out.push(cur);
    cur = '';
  };
  for (const para of text.split('\n')) {
    if (para.length > max) {
      push();
      let rest = para;
      while (rest.length > max) {
        let cut = rest.lastIndexOf('. ', max);
        if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
        if (cut <= 0) cut = max;
        out.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
      }
      cur = rest;
      continue;
    }
    if (cur.length + para.length + 1 > max) push();
    cur = cur ? cur + '\n' + para : para;
  }
  push();
  return out;
}

async function builtIn(text: string, to: string): Promise<{ text: string; from: string } | null> {
  const T = (self as any).Translator;
  const D = (self as any).LanguageDetector;
  if (!T || !D) return null;
  try {
    if ((await D.availability?.()) !== 'available') return null;
    const det = await D.create();
    const [best] = await det.detect(text.slice(0, 3000));
    const from: string | undefined = best?.detectedLanguage;
    if (!from || from === 'und') return null;
    const target = to.split('-')[0];
    if (from === target) return { text, from };
    if ((await T.availability({ sourceLanguage: from, targetLanguage: target })) !== 'available') return null;
    const tr = await T.create({ sourceLanguage: from, targetLanguage: target });
    const out: string[] = [];
    for (const c of chunks(text)) out.push(await tr.translate(c));
    tr.destroy?.();
    return { text: out.join('\n'), from };
  } catch {
    return null;
  }
}

async function google(text: string, to: string): Promise<{ text: string; from: string }> {
  const out: string[] = [];
  let from = '';
  for (const c of chunks(text)) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(c)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('El servicio de traducción no respondió (' + r.status + ')');
    const j = await r.json();
    out.push((j?.[0] || []).map((s: any) => s?.[0] || '').join(''));
    from = from || j?.[2] || '';
  }
  return { text: out.join('\n'), from };
}

export async function translateText(text: string, to: string): Promise<{ text: string; from: string; online: boolean }> {
  const t = text.trim();
  if (!t) return { text: '', from: '', online: false };
  const local = await builtIn(t, to);
  if (local) return { ...local, online: false };
  if (!navigator.onLine) throw new Error('Necesitas conexión a internet para traducir.');
  return { ...(await google(t, to)), online: true };
}

export const googleTranslateUrl = (to: string) => `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(to)}&op=translate`;

/** Traduce varios bloques a la vez y devuelve uno por bloque. */
export async function translateUnits(texts: string[], to: string): Promise<{ out: string[]; from: string; online: boolean }> {
  const clean = texts.map((t) => t.replace(/\s*\n\s*/g, ' ').trim());
  const r = await translateText(clean.join('\n'), to);
  let out = r.text.split('\n');
  if (out.length !== clean.length) {
    out = [];
    for (const t of clean) out.push((await translateText(t, to)).text);
  }
  return { out, from: r.from, online: r.online };
}
