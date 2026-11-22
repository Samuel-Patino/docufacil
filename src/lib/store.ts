import { create } from 'zustand';
import type { FilterId, ScanMode, ScanPage } from './scanTypes';

export type Theme = 'auto' | 'light' | 'dark';
export type TextSize = 'normal' | 'large' | 'xlarge';
export type SortMode = 'manual' | 'name' | 'date' | 'size';

export interface Prefs {
  theme: Theme;
  textSize: TextSize;
  view: 'list' | 'grid';
  sort: SortMode;
  autoCapture: boolean;
  defaultFilter: FilterId | 'mode';
  quality: 'high' | 'medium' | 'low';
  ocrLang: string;
  ocrOnSave: boolean;
  pageSize: 'fit' | 'a4' | 'letter';
  readerTheme: 'light' | 'sepia' | 'dark';
  readerSize: number;
  qrHistory: { text: string; at: number }[];
  trLang: string;
  v?: number;
}

const DEFAULT_PREFS: Prefs = {
  theme: 'auto',
  textSize: 'normal',
  view: 'list',
  sort: 'manual',
  autoCapture: false,
  defaultFilter: 'mode',
  quality: 'high',
  ocrLang: 'spa+eng',
  ocrOnSave: false,
  pageSize: 'fit',
  readerTheme: 'light',
  readerSize: 19,
  qrHistory: [],
  trLang: 'es',
};

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem('df-ui') || '{}');
    // v2: la captura automática pasa a estar apagada por defecto
    if (!saved.v) delete saved.autoCapture;
    return { ...DEFAULT_PREFS, ...saved, v: 2 };
  } catch {
    return DEFAULT_PREFS;
  }
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'error';
}

export interface DialogReq {
  id: number;
  title: string;
  message?: string;
  input?: { value: string; placeholder?: string; type?: string; label?: string };
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  resolve: (v: string | boolean | null) => void;
}

export interface ScanSession {
  pages: ScanPage[];
  mode: ScanMode;
  /** Si viene de "Editar escaneo" de un documento existente */
  docId?: string;
  name?: string;
  folderId?: string | null;
}

interface AppState {
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  unlocked: boolean;
  version: number; // cambia cuando la biblioteca cambia
  bump: () => void;
  toasts: Toast[];
  dialogs: DialogReq[];
  unlockReq: { resolve: (ok: boolean) => void; reason?: string } | null;
  busy: { text: string; progress?: number } | null;
  scan: ScanSession | null;
  setScan: (s: ScanSession | null) => void;
  updateScan: (fn: (s: ScanSession) => ScanSession) => void;
  installPrompt: any;
}

export const useApp = create<AppState>((set, get) => ({
  prefs: loadPrefs(),
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    try {
      localStorage.setItem('df-ui', JSON.stringify(prefs));
    } catch {}
    set({ prefs });
    applyTheme(prefs);
  },
  unlocked: false,
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
  toasts: [],
  dialogs: [],
  unlockReq: null,
  busy: null,
  scan: null,
  setScan: (scan) => set({ scan }),
  updateScan: (fn) => {
    const s = get().scan;
    if (s) set({ scan: fn(s) });
  },
  installPrompt: null,
}));

export function applyTheme(p: Prefs = useApp.getState().prefs) {
  const dark = p.theme === 'dark' || (p.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.text = p.textSize;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', dark ? '#0b1220' : '#f4f7fb'));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

let tid = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200) {
  const id = tid++;
  useApp.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

function openDialog(d: Omit<DialogReq, 'id' | 'resolve'>): Promise<any> {
  return new Promise((resolve) => {
    const id = tid++;
    useApp.setState((s) => ({
      dialogs: [
        ...s.dialogs,
        {
          ...d,
          id,
          resolve: (v) => {
            useApp.setState((st) => ({ dialogs: st.dialogs.filter((x) => x.id !== id) }));
            resolve(v);
          },
        },
      ],
    }));
  });
}

export function confirmDialog(title: string, message?: string, opts: { confirmText?: string; danger?: boolean } = {}) {
  return openDialog({ title, message, ...opts }) as Promise<boolean>;
}

export function promptDialog(
  title: string,
  value = '',
  opts: { message?: string; placeholder?: string; confirmText?: string; type?: string; label?: string } = {},
) {
  return openDialog({
    title,
    message: opts.message,
    confirmText: opts.confirmText || 'Aceptar',
    input: { value, placeholder: opts.placeholder, type: opts.type, label: opts.label },
  }) as Promise<string | null>;
}

export function setBusy(text: string | null, progress?: number) {
  useApp.setState({ busy: text ? { text, progress } : null });
}

export async function withBusy<T>(text: string, fn: (progress: (p: number, t?: string) => void) => Promise<T>): Promise<T> {
  setBusy(text, 0);
  try {
    return await fn((p, t) => setBusy(t || text, p));
  } finally {
    setBusy(null);
  }
}

/** Pide desbloquear (PIN / huella). Devuelve true si quedó desbloqueado. */
export function requireUnlock(reason?: string): Promise<boolean> {
  if (useApp.getState().unlocked) return Promise.resolve(true);
  return new Promise((resolve) => {
    useApp.setState({
      unlockReq: {
        reason,
        resolve: (ok) => {
          useApp.setState({ unlockReq: null });
          resolve(ok);
        },
      },
    });
  });
}

export function errMsg(e: any): string {
  const m = e?.message || String(e);
  if (/password|contraseña|encrypted/i.test(m)) return 'El PDF está protegido con contraseña.';
  return m;
}
