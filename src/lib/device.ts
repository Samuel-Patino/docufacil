// Edición directa de archivos del dispositivo (Fotos / Archivos).
// En computadores con Chrome/Edge se guarda sobre el archivo original;
// en celulares se ofrece guardar la nueva versión con el menú Compartir.
import { importFiles } from './library';
import { pickFiles, shareFiles } from './share';
import { toast } from './store';

const handles = new Map<string, any>(); // docId → FileSystemFileHandle
const fromDevice = new Set<string>();

export const hasFsAccess = () => typeof (window as any).showOpenFilePicker === 'function';

export async function openFromDevice(kind: 'image' | 'pdf'): Promise<string | null> {
  const accept = kind === 'image' ? { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] } : { 'application/pdf': ['.pdf'] };
  let file: File | null = null;
  let handle: any = null;
  if (hasFsAccess()) {
    try {
      [handle] = await (window as any).showOpenFilePicker({ types: [{ description: kind === 'image' ? 'Imágenes' : 'PDF', accept }], multiple: false });
      file = await handle.getFile();
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
    }
  }
  if (!file) {
    const [f] = await pickFiles(kind === 'image' ? 'image/*' : 'application/pdf,.pdf', false);
    if (!f) return null;
    file = f;
  }
  const [doc] = await importFiles([file]);
  fromDevice.add(doc.id);
  if (handle) handles.set(doc.id, handle);
  return doc.id;
}

export const isFromDevice = (id: string) => fromDevice.has(id);

/** Guarda de vuelta en el dispositivo. Devuelve true si se escribió el archivo original. */
export async function saveBackToDevice(id: string, file: File): Promise<boolean> {
  const h = handles.get(id);
  if (h) {
    try {
      if ((await h.queryPermission?.({ mode: 'readwrite' })) !== 'granted') await h.requestPermission?.({ mode: 'readwrite' });
      const w = await h.createWritable();
      await w.write(file);
      await w.close();
      toast('Guardado en el archivo original', 'ok');
      return true;
    } catch (e: any) {
      toast('No se pudo escribir el archivo original: ' + (e?.message || e), 'error');
    }
  }
  if (fromDevice.has(id)) await shareFiles([file], file.name);
  return false;
}
