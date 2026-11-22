import { useMemo, useState } from 'react';
import { Search, Check } from 'lucide-react';
import { Modal, Button, inputCls, Empty } from './ui';
import { useLibrary } from '../lib/hooks';
import type { DocKind, DocMeta } from '../lib/db';
import { DocThumb } from './DocIcon';
import { docLocked } from '../lib/library';
import { useApp } from '../lib/store';
import { formatDate, extOf } from '../lib/util';

export function LibraryPicker({
  open, onClose, onPick, kinds, exts, multiple,
}: { open: boolean; onClose: () => void; onPick: (docs: DocMeta[]) => void; kinds?: DocKind[]; exts?: string[]; multiple?: boolean }) {
  const { docs, folders } = useLibrary();
  const unlocked = useApp((s) => s.unlocked);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const fm = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const list = docs
    .filter((d) => (!kinds || kinds.includes(d.kind)) && (!exts || exts.includes(extOf(d.name))))
    .filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const done = () => {
    onPick(sel.map((id) => docs.find((d) => d.id === id)!).filter(Boolean));
    setSel([]);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Elegir de mis documentos"
      wide
      footer={
        multiple ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={!sel.length} onClick={done}>
              Agregar {sel.length || ''}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" />
        <input className={inputCls + ' pl-12'} placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <Empty icon={<Search className="size-9" />} title="No hay documentos de este tipo" text="Usa “Del dispositivo” para elegir un archivo." />
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((d) => {
            const i = sel.indexOf(d.id);
            const locked = docLocked(d, fm) && !unlocked;
            return (
              <button
                key={d.id}
                onClick={() => {
                  if (!multiple) {
                    onPick([d]);
                    onClose();
                    return;
                  }
                  setSel((s) => (i >= 0 ? s.filter((x) => x !== d.id) : [...s, d.id]));
                }}
                className={`flex items-center gap-3 rounded-2xl border p-2 text-left ${i >= 0 ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2'}`}
              >
                <DocThumb doc={d} locked={locked} className="h-14 w-11 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{d.name}</span>
                  <span className="text-sm text-soft">{formatDate(d.updatedAt)}</span>
                </span>
                {multiple && (
                  <span className={`flex size-7 items-center justify-center rounded-full border-2 text-sm font-black ${i >= 0 ? 'border-primary bg-primary text-white' : 'border-line'}`}>
                    {i >= 0 ? i + 1 : ''}
                  </span>
                )}
                {!multiple && <Check className="size-5 text-faint" />}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
