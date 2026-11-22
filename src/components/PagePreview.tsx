import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Pencil, RotateCw, RefreshCcw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ScanPage } from '../lib/scanTypes';
import { renderScanPage } from '../lib/imaging';
import { canvasToBlob } from '../lib/util';
import { IconButton, Spinner } from './ui';

const hiRes = new WeakMap<ScanPage, string>();

/** Una página a pantalla completa: muestra la miniatura y luego la versión nítida. */
function Slide({ page, n, active }: { page: ScanPage; n: number; active: boolean }) {
  const [url, setUrl] = useState<string | null>(() => hiRes.get(page) || null);
  useEffect(() => {
    if (url || !active) return;
    let live = true;
    (async () => {
      try {
        const c = await renderScanPage(page, 1800);
        const u = URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.88));
        hiRes.set(page, u);
        if (live) setUrl(u);
      } catch {}
    })();
    return () => {
      live = false;
    };
  }, [page, active]);
  const src = url || page.thumb;
  return (
    <div className="flex h-full w-full shrink-0 snap-center items-center justify-center p-4">
      {src ? <img src={src} alt={`Página ${n}`} className="max-h-full max-w-full rounded-md bg-white object-contain shadow-2xl" draggable={false} /> : <Spinner className="size-10" />}
    </div>
  );
}

/** Vista previa sencilla de las páginas escaneadas, deslizando de una a otra. */
export function PagePreview({
  pages,
  start,
  onClose,
  onEdit,
  onRotate,
  onRetake,
  onDelete,
}: {
  pages: ScanPage[];
  start: number;
  onClose: () => void;
  onEdit: (p: ScanPage) => void;
  onRotate: (p: ScanPage) => void;
  onRetake: (p: ScanPage) => void;
  onDelete: (p: ScanPage) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(Math.min(start, pages.length - 1));

  useLayoutEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = idx * el.clientWidth;
  }, []);

  useEffect(() => {
    if (!pages.length) onClose();
    else if (idx > pages.length - 1) go(pages.length - 1);
  }, [pages.length]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(idx + 1);
      if (e.key === 'ArrowLeft') go(idx - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [idx]);

  function go(i: number) {
    const el = strip.current;
    if (!el) return;
    const j = Math.max(0, Math.min(pages.length - 1, i));
    el.scrollTo({ left: j * el.clientWidth, behavior: 'smooth' });
    setIdx(j);
  }

  const cur = pages[idx];
  if (!cur) return null;

  const Act = ({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={onClick} className={`flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-xs font-bold transition active:scale-95 ${danger ? 'text-red-400' : 'text-white/85 hover:bg-white/10'}`}>
      <span className="[&>svg]:size-6">{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-neutral-950 text-white animate-fade" role="dialog" aria-modal="true" aria-label="Vista previa de la página">
      <header className="safe-top">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-2 px-2">
          <IconButton label="Cerrar" className="text-white hover:bg-white/10" onClick={onClose}>
            <X className="size-7" />
          </IconButton>
          <div className="flex-1 text-center text-lg font-extrabold">
            Página {idx + 1} de {pages.length}
          </div>
          <span className="size-11" />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div
          ref={strip}
          className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overscroll-contain"
          onScroll={(e) => {
            const el = e.currentTarget;
            const i = Math.round(el.scrollLeft / el.clientWidth);
            if (i !== idx) setIdx(i);
          }}
        >
          {pages.map((p, i) => (
            <Slide key={p.id + (p.thumb || '')} page={p} n={i + 1} active={Math.abs(i - idx) <= 1} />
          ))}
        </div>
        {idx > 0 && (
          <button aria-label="Página anterior" onClick={() => go(idx - 1)} className="absolute top-1/2 left-2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 sm:flex">
            <ChevronLeft className="size-7" />
          </button>
        )}
        {idx < pages.length - 1 && (
          <button aria-label="Página siguiente" onClick={() => go(idx + 1)} className="absolute top-1/2 right-2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 sm:flex">
            <ChevronRight className="size-7" />
          </button>
        )}
      </div>
      <div className="safe-bottom">
        <div className="mx-auto flex max-w-md gap-1 px-3 py-2">
          <Act icon={<Pencil />} label="Editar" onClick={() => onEdit(cur)} />
          <Act icon={<RotateCw />} label="Rotar" onClick={() => onRotate(cur)} />
          <Act icon={<RefreshCcw />} label="Retomar" onClick={() => onRetake(cur)} />
          <Act icon={<Trash2 />} label="Eliminar" onClick={() => onDelete(cur)} danger />
        </div>
      </div>
    </div>
  );
}
