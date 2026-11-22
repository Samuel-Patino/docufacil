import { toast } from './store';
import { safeFileName } from './util';

export function canShareFiles(files?: File[]) {
  try {
    const test = files ?? [new File(['x'], 'a.pdf', { type: 'application/pdf' })];
    return !!navigator.canShare && navigator.canShare({ files: test });
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Comparte archivos con el menú del sistema (WhatsApp, correo, etc.). */
export async function shareFiles(files: File[], title?: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files, title: title || files[0]?.name });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  for (const f of files) downloadBlob(f, f.name);
  toast('Archivo descargado. Adjúntalo en WhatsApp o en tu correo.', 'info', 4500);
  return 'downloaded';
}

export async function shareText(text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }
  await copyText(text);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado', 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copiado', 'ok');
  }
}

/** Abre el selector de archivos del sistema (incluye iCloud / Google Drive en el celular). */
export function pickFiles(accept: string, multiple = true, capture?: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    let done = false;
    input.onchange = () => {
      done = true;
      resolve(Array.from(input.files || []));
      input.remove();
    };
    // Si el usuario cancela, algunos navegadores emiten "cancel"
    input.addEventListener('cancel', () => {
      if (!done) resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export const ACCEPT = {
  pdf: 'application/pdf,.pdf',
  images: 'image/*',
  word: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  excel: '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
  ppt: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
  text: '.txt,.csv,.md,text/plain,text/csv',
  html: '.html,.htm,text/html',
  any: '*/*',
};
