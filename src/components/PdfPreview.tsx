import { useEffect, useRef, useState } from 'react';
import { X, Save } from 'lucide-react';
import type { ScanPage } from '../lib/scanTypes';
import { finalizePage } from '../lib/imaging';
import { imagesToPdf } from '../lib/pdfops';
import { openPdf, renderPageWidth, closePdf } from '../lib/pdf';
import { useApp } from '../lib/store';
import { formatBytes } from '../lib/util';
import { Button, IconButton, Segmented, Spinner } from './ui';

/** Muestra el PDF exactamente como quedará al guardarlo (tamaño de página, calidad y peso). */
export function PdfPreview({ pages, title, onClose, onSave, saveLabel = 'Guardar PDF' }: { pages: ScanPage[]; title: string; onClose: () => void; onSave: () => void; saveLabel?: string }) {
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const [imgs, setImgs] = useState<string[]>([]);
  const [size, setSize] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>('Preparando…');
  const cache = useRef(new Map<string, Blob>());

  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    (async () => {
      setStatus('Preparando…');
      try {
        const blobs: Blob[] = [];
        for (let i = 0; i < pages.length; i++) {
          if (!live) return;
          setStatus(`Preparando página ${i + 1} de ${pages.length}…`);
          const key = pages[i].id + ':' + prefs.quality + ':' + !!pages[i].processed;
          let b = cache.current.get(key);
          if (!b) {
            b = (await finalizePage(pages[i], prefs.quality)).processed!;
            cache.current.set(key, b);
          }
          blobs.push(b);
        }
        const bytes = await imagesToPdf(
          blobs.map((blob) => ({ blob })),
          { pageSize: prefs.pageSize, title },
        );
        if (!live) return;
        setSize(bytes.byteLength);
        const doc = await openPdf(bytes);
        const w = Math.min(1400, Math.round(Math.min(window.innerWidth, 900) * Math.min(2, devicePixelRatio || 1)));
        const out: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          if (!live) break;
          setStatus(`Dibujando página ${i} de ${doc.numPages}…`);
          const c = await renderPageWidth(await doc.getPage(i), w);
          const u = URL.createObjectURL(await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85)));
          urls.push(u);
          out.push(u);
          if (live) setImgs([...out]);
        }
        closePdf(doc);
        if (live) setStatus(null);
      } catch (e: any) {
        if (live) setStatus('No se pudo crear la vista previa: ' + (e?.message || e));
      }
    })();
    return () => {
      live = false;
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
    };
  }, [pages, prefs.pageSize, prefs.quality]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-surface-3 animate-fade" role="dialog" aria-modal="true" aria-label="Vista previa del PDF">
      <header className="safe-top border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-2 px-2 sm:px-4">
          <IconButton label="Cerrar vista previa" onClick={onClose}>
            <X className="size-7" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-extrabold leading-tight">{title}.pdf</h2>
            <div className="text-sm text-soft">
              {pages.length} página(s){size !== null ? ` · ${formatBytes(size)}` : ''}
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-soft">Página</span>
            <Segmented value={prefs.pageSize} onChange={(v) => setPrefs({ pageSize: v })} options={[{ value: 'fit', label: 'Ajustar' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }]} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-soft">Calidad</span>
            <Segmented value={prefs.quality} onChange={(v) => setPrefs({ quality: v })} options={[{ value: 'high', label: 'Alta' }, { value: 'medium', label: 'Media' }, { value: 'low', label: 'Liviana' }]} />
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 px-4 py-6">
          {imgs.map((u, i) => (
            <figure key={u} className="w-full">
              <img src={u} alt={`Página ${i + 1}`} className="w-full bg-white shadow-pop ring-1 ring-black/5" />
              <figcaption className="mt-1.5 text-center text-sm font-bold text-soft">
                {i + 1} / {pages.length}
              </figcaption>
            </figure>
          ))}
          {status && (
            <div className="flex items-center gap-3 py-10 font-semibold text-soft">
              <Spinner className="size-7" /> {status}
            </div>
          )}
        </div>
      </div>
      <div className="safe-bottom border-t border-line bg-surface">
        <div className="mx-auto flex max-w-4xl gap-2 px-4 py-3">
          <Button variant="secondary" size="lg" onClick={onClose}>
            Volver
          </Button>
          <Button className="flex-1" size="lg" icon={<Save className="size-6" />} onClick={onSave}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
