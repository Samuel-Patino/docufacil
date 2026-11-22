import { Download } from 'lucide-react';
import type { DocMeta } from '../lib/db';
import { getDocFile } from '../lib/library';
import { saveFileAs } from '../lib/share';
import { toast, errMsg } from '../lib/store';

/** Botón flotante "Descargar", encima de la barra inferior del visor (lado derecho). */
export function DownloadFab({ doc }: { doc: DocMeta }) {
  async function go() {
    try {
      const f = await getDocFile(doc.id);
      await saveFileAs(f);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }
  return (
    <button
      onClick={go}
      className="fixed right-3 z-20 flex h-12 items-center gap-2 rounded-full bg-primary px-5 font-bold text-on-primary shadow-pop transition active:scale-95 sm:right-6"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.25rem)' }}
    >
      <Download className="size-5" />
      Descargar
    </button>
  );
}
