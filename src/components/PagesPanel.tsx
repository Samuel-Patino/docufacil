import { useEffect, useRef } from 'react';
import type { PDFDocumentProxy } from '../lib/pdf';
import { PageThumb } from './PageGrid';

/** Vista general de las páginas (miniaturas) para saltar a cualquiera. */
export function PagesPanel({ pdf, current, onPick, onClose }: { pdf: PDFDocumentProxy; current: number; onPick: (i: number) => void; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-thumb="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <>
      <div className="absolute inset-0 z-20 bg-black/30 md:hidden" onClick={onClose} />
      <aside className="absolute inset-y-0 left-0 z-30 flex w-40 flex-col border-r border-line bg-neutral-800 shadow-pop animate-fade md:relative md:z-0 md:shadow-none">
        <div ref={list} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <button key={i} data-thumb={i} onClick={() => onPick(i)} className="mb-4 block w-full text-center">
              <div className={`rounded-md p-1 transition ${i === current ? 'bg-primary/60' : 'hover:bg-white/10'}`}>
                <PageThumb pdf={pdf} index={i} className="rounded-sm bg-white" />
              </div>
              <span className={`mt-1 block text-sm font-bold ${i === current ? 'text-white' : 'text-white/70'}`}>{i + 1}</span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

