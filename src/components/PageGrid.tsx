import { useEffect, useRef, useState } from 'react';
import { RotateCw, Trash2, Copy, Check } from 'lucide-react';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PDFDocumentProxy } from '../lib/pdf';
import { renderPageWidth } from '../lib/pdf';
import { IconButton } from './ui';

const thumbCache = new WeakMap<PDFDocumentProxy, Map<number, string>>();

export function PageThumb({ pdf, index, rotation = 0, className = '' }: { pdf: PDFDocumentProxy; index: number; rotation?: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(() => thumbCache.get(pdf)?.get(index) || null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (url) return;
    let live = true;
    const io = new IntersectionObserver(async (es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const page = await pdf.getPage(index + 1);
      const c = await renderPageWidth(page, 240);
      const u = c.toDataURL('image/jpeg', 0.75);
      if (!thumbCache.has(pdf)) thumbCache.set(pdf, new Map());
      thumbCache.get(pdf)!.set(index, u);
      if (live) setUrl(u);
    }, { rootMargin: '300px' });
    io.observe(ref.current!);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [pdf, index]);
  return (
    <div ref={ref} className={`flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl bg-surface-2 ${className}`}>
      {url && <img src={url} alt={`Página ${index + 1}`} className="max-h-full max-w-full object-contain shadow transition-transform" style={{ transform: `rotate(${rotation}deg)` }} draggable={false} />}
    </div>
  );
}

/** Cuadrícula para elegir páginas. */
export function PageSelect({ pdf, selected, onChange, rotations }: { pdf: PDFDocumentProxy; selected: Set<number>; onChange: (s: Set<number>) => void; rotations?: Record<number, number> }) {
  const all = Array.from({ length: pdf.numPages }, (_, i) => i);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button className="h-10 rounded-full bg-surface-2 px-4 text-sm font-bold" onClick={() => onChange(new Set(all))}>
          Todas
        </button>
        <button className="h-10 rounded-full bg-surface-2 px-4 text-sm font-bold" onClick={() => onChange(new Set())}>
          Ninguna
        </button>
        <button className="h-10 rounded-full bg-surface-2 px-4 text-sm font-bold" onClick={() => onChange(new Set(all.filter((i) => i % 2 === 0)))}>
          Impares
        </button>
        <button className="h-10 rounded-full bg-surface-2 px-4 text-sm font-bold" onClick={() => onChange(new Set(all.filter((i) => i % 2 === 1)))}>
          Pares
        </button>
        <span className="ml-auto self-center text-sm font-bold text-soft">{selected.size} seleccionada(s)</span>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {all.map((i) => {
          const on = selected.has(i);
          return (
            <button
              key={i}
              onClick={() => {
                const n = new Set(selected);
                on ? n.delete(i) : n.add(i);
                onChange(n);
              }}
              className={`relative rounded-2xl border-2 p-1.5 transition ${on ? 'border-primary bg-primary-soft' : 'border-transparent'}`}
            >
              <PageThumb pdf={pdf} index={i} rotation={rotations?.[i]} />
              <span className={`absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full border-2 ${on ? 'border-primary bg-primary text-white' : 'border-white bg-black/30'}`}>
                {on && <Check className="size-4" />}
              </span>
              <span className="mt-1 block text-center text-sm font-bold">{i + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface OrgPage {
  key: string;
  src: number;
  rot: number;
}

/** Organizar: arrastrar para ordenar, girar, duplicar y eliminar. */
export function PageOrganizer({ pdf, pages, onChange }: { pdf: PDFDocumentProxy; pages: OrgPage[]; onChange: (p: OrgPage[]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }));
  const end = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = pages.map((p) => p.key);
    onChange(arrayMove(pages, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
      <SortableContext items={pages.map((p) => p.key)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {pages.map((p, i) => (
            <OrgItem
              key={p.key}
              p={p}
              n={i + 1}
              pdf={pdf}
              onRotate={() => onChange(pages.map((x) => (x.key === p.key ? { ...x, rot: (x.rot + 90) % 360 } : x)))}
              onDup={() => {
                const n = [...pages];
                n.splice(i + 1, 0, { ...p, key: p.key + '-' + Math.random().toString(36).slice(2, 6) });
                onChange(n);
              }}
              onDel={() => onChange(pages.filter((x) => x.key !== p.key))}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function OrgItem({ p, n, pdf, onRotate, onDup, onDel }: { p: OrgPage; n: number; pdf: PDFDocumentProxy; onRotate: () => void; onDup: () => void; onDel: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.key });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rounded-2xl border border-line bg-surface p-1.5 shadow-card ${isDragging ? 'z-10 opacity-70' : ''}`}>
      <div {...attributes} {...listeners} className="touch-none">
        <PageThumb pdf={pdf} index={p.src} rotation={p.rot} />
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="pl-1 text-sm font-black">{n}</span>
        <div className="flex">
          <IconButton label="Girar" className="size-9" onClick={onRotate}>
            <RotateCw className="size-4" />
          </IconButton>
          <IconButton label="Duplicar" className="size-9" onClick={onDup}>
            <Copy className="size-4" />
          </IconButton>
          <IconButton label="Eliminar" className="size-9 text-danger" onClick={onDel}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
