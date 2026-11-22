import { openPdf, NeedPasswordError, sessionPasswords, type PDFDocumentProxy } from './pdf';
import { promptDialog } from './store';

/** Abre un PDF pidiendo la contraseña si hace falta. Devuelve null si el usuario cancela. */
export async function openWithPassword(
  key: string,
  data: Blob | Uint8Array,
  name = 'el PDF',
): Promise<{ pdf: PDFDocumentProxy; password?: string } | null> {
  let password = sessionPasswords.get(key);
  let wrong = false;
  for (let i = 0; i < 6; i++) {
    try {
      const pdf = await openPdf(data, password);
      if (password) sessionPasswords.set(key, password);
      return { pdf, password };
    } catch (e) {
      if (!(e instanceof NeedPasswordError)) throw e;
      wrong = !!password;
      const p = await promptDialog(wrong ? 'Contraseña incorrecta' : 'Este PDF tiene contraseña', '', {
        message: `Escribe la contraseña para abrir ${name}.`,
        type: 'password',
        label: 'Contraseña',
        confirmText: 'Abrir',
      });
      if (p === null) return null;
      password = p;
    }
  }
  return null;
}

/** Sólo obtiene la contraseña (para operaciones con pdf-lib). */
export async function passwordFor(key: string, data: Blob | Uint8Array, name?: string): Promise<{ ok: boolean; password?: string }> {
  const r = await openWithPassword(key, data, name);
  if (!r) return { ok: false };
  r.pdf.loadingTask.destroy();
  return { ok: true, password: r.password };
}
