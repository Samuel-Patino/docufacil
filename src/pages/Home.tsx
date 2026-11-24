import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  DndContext, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, pointerWithin, closestCenter,
  type DragEndEvent, type CollisionDetection, DragOverlay, type DragStartEvent, useDroppable,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ScanLine, Upload, FolderPlus, Search, MoreVertical, Folder as FolderIcon, Lock, ChevronRight, Home as HomeIcon,
  LayoutGrid, List, ArrowUpDown, CheckSquare, X, Trash2, FolderInput, Share2, Combine, IdCard, Wrench, Unlock, Pencil, Palette, FileStack,
  GripVertical, FilePen, FileType2, PenLine, FileOutput, FileInput,
} from 'lucide-react';
import { useLibrary } from '../lib/hooks';
import type { DocMeta, Folder } from '../lib/db';
import { useApp, toast, promptDialog, confirmDialog, requireUnlock, errMsg, withBusy } from '../lib/store';
import {
  createFolder, importFiles, folderLocked, docLocked, moveItems, reorder, deleteDocs, deleteFolder, updateFolder,
  setFolderLocked, getDocFile, FOLDER_COLORS, listSignatures,
} from '../lib/library';
import { pickFiles } from '../lib/share';
import { lockNow } from '../lib/lock';
import { shareFiles } from '../lib/share';
import { formatBytes, formatDate, pagesLabel } from '../lib/util';
import { Button, IconButton, Modal, MenuItem, Empty, inputCls, Segmented, Card, ColorDots } from '../components/ui';
import { DocThumb } from '../components/DocIcon';
import { DocMenu, MoveDialog } from '../components/DocMenu';
import { SignaturePicker } from '../components/Signature';
import { FeedbackButton } from '../components/Feedback';
import { Logo } from '../components/Layout';

export default function Home() {
  const { folderId = null } = useParams();
  const nav = useNavigate();
  const { folders, docs, loaded } = useLibrary();
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const unlocked = useApp((s) => s.unlocked);
  const [q, setQ] = useState('');
  const [menuDoc, setMenuDoc] = useState<DocMeta | null>(null);
  const [menuFolder, setMenuFolder] = useState<Folder | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState<{ docs: string[]; folders: string[] } | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [hasSignature, setHasSignature] = useState<boolean | null>(null);
  useEffect(() => {
    listSignatures().then((l) => setHasSignature(l.length > 0)).catch(() => setHasSignature(null));
  }, [sigOpen]);

  const fm = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const current = folderId ? fm.get(folderId) : undefined;
  const lockedHere = folderLocked(folderId, fm) && !unlocked;

  useEffect(() => {
    setSel(new Set());
    setSelecting(false);
  }, [folderId]);

  const crumbs = useMemo(() => {
    const out: Folder[] = [];
    let f = current;
    let g = 0;
    while (f && g++ < 50) {
      out.unshift(f);
      f = f.parentId ? fm.get(f.parentId) : undefined;
    }
    return out;
  }, [current, fm]);

  const sorter = (a: { name: string; order: number; updatedAt: number; size?: number }, b: typeof a) => {
    switch (prefs.sort) {
      case 'name':
        return a.name.localeCompare(b.name, 'es', { numeric: true });
      case 'date':
        return b.updatedAt - a.updatedAt;
      case 'size':
        return (b.size || 0) - (a.size || 0);
      default:
        return a.order - b.order || b.updatedAt - a.updatedAt;
    }
  };

  const searching = q.trim().length > 0;
  const subFolders = searching ? [] : folders.filter((f) => f.parentId === folderId).sort(sorter);
  const items = searching
    ? docs.filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase()) && (!docLocked(d, fm) || unlocked)).sort((a, b) => b.updatedAt - a.updatedAt)
    : docs.filter((d) => d.folderId === folderId).sort(sorter);
  const recent = !folderId && !searching ? [...docs].filter((d) => !docLocked(d, fm) || unlocked).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8) : [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const manual = prefs.sort === 'manual' && !searching && !selecting;

  const collision: CollisionDetection = (args) => {
    const p = pointerWithin(args);
    if (p.length) {
      const folderHit = p.find((c) => String(c.id).startsWith('f:') || String(c.id) === 'up');
      if (String(args.active.id).startsWith('d:') && folderHit) return [folderHit];
      return p;
    }
    return closestCenter(args);
  };

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    if (!o || a === o) return;
    try {
      if (a.startsWith('d:') && (o.startsWith('f:') || o === 'up')) {
        const target = o === 'up' ? current?.parentId ?? null : o.slice(2);
        if (await moveItems([a.slice(2)], [], target)) toast('Movido a la carpeta', 'ok');
      } else if (a.startsWith('d:') && o.startsWith('d:')) {
        const ids = items.map((d) => d.id);
        await reorder('doc', arrayMove(ids, ids.indexOf(a.slice(2)), ids.indexOf(o.slice(2))));
      } else if (a.startsWith('f:') && o.startsWith('f:')) {
        const ids = subFolders.map((f) => f.id);
        await reorder('folder', arrayMove(ids, ids.indexOf(a.slice(2)), ids.indexOf(o.slice(2))));
      }
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  }

  async function doImport(files?: File[]) {
    const list = files ?? (await pickFiles('*/*', true));
    if (!list.length) return;
    try {
      const out = await withBusy('Importando…', async (p) => {
        const res: DocMeta[] = [];
        for (let i = 0; i < list.length; i++) {
          p(i / list.length, `Importando ${i + 1} de ${list.length}…`);
          res.push(...(await importFiles([list[i]], folderId)));
        }
        return res;
      });
      toast(out.length === 1 ? 'Archivo importado' : `${out.length} archivos importados`, 'ok');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  async function newFolder() {
    const name = await promptDialog('Nueva carpeta', '', { label: 'Nombre', placeholder: 'Ej. Facturas', confirmText: 'Crear' });
    if (name !== null) await createFolder(name || 'Carpeta nueva', folderId, FOLDER_COLORS[folders.length % FOLDER_COLORS.length]);
  }

  const toggleSel = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const selDocs = [...sel].filter((k) => k.startsWith('d:')).map((k) => k.slice(2));
  const selFolders = [...sel].filter((k) => k.startsWith('f:')).map((k) => k.slice(2));

  // Soltar archivos del sistema sobre la ventana (computador)
  const dropRef = useRef(0);
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) {
        dropRef.current++;
        setDropHover(true);
      }
    },
    onDragLeave: () => {
      if (--dropRef.current <= 0) setDropHover(false);
    },
    onDragOver: (e: React.DragEvent) => e.dataTransfer.types.includes('Files') && e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      dropRef.current = 0;
      setDropHover(false);
      doImport(Array.from(e.dataTransfer.files));
    },
  };

  return (
    <div className="relative mx-auto max-w-6xl px-4 pt-3 sm:px-6" {...dropProps}>
      {dropHover && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/15 backdrop-blur-sm">
          <div className="rounded-3xl border-4 border-dashed border-primary bg-surface px-10 py-8 text-xl font-extrabold text-primary">Suelta los archivos aquí</div>
        </div>
      )}

      {/* Encabezado */}
      <div className="safe-top flex items-center gap-2 py-2">
        <div className="lg:hidden">
          <Logo small />
        </div>
        <h1 className="hidden flex-1 text-2xl font-black lg:block">{current ? current.name : 'Mis documentos'}</h1>
        <div className="flex-1 lg:hidden" />
        <FeedbackButton />
        {unlocked && (
          <IconButton label="Bloquear ahora" className="text-primary lg:hidden" onClick={lockNow}>
            <Lock className="size-6" />
          </IconButton>
        )}
      </div>

      {/* Búsqueda */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" />
        <input className={inputCls + ' h-13 pl-12 text-lg'} placeholder="Buscar documentos" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar documentos" />
        {q && (
          <IconButton label="Borrar búsqueda" className="absolute top-1/2 right-1 -translate-y-1/2" onClick={() => setQ('')}>
            <X className="size-5" />
          </IconButton>
        )}
      </div>

      {/* Acciones rápidas */}
      {!folderId && !searching && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Quick color="#ea580c" icon={<Wrench />} label="Todas las herramientas" sub="Convertir, unir, firmar…" onClick={() => nav('/tools')} />
          <Quick color="#dc2626" icon={<FilePen />} label="Editar PDF" sub="Texto, firmas, dibujos" onClick={() => nav('/tool/annotate')} />
          <Quick color="#2563eb" icon={<Combine />} label="Unir PDF" sub="Varios en uno" onClick={() => nav('/tool/merge')} />
          <Quick color="#9333ea" icon={<FileType2 />} label="Convertir PDF" sub="A PDF o desde PDF" onClick={() => setConvOpen(true)} />
        </div>
      )}

      {/* Sugerencia: crear la firma una vez */}
      {!folderId && !searching && hasSignature === false && (
        <button
          onClick={() => setSigOpen(true)}
          className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-dashed border-primary/50 bg-primary-soft/60 px-4 py-3 text-left transition active:scale-[0.99]"
        >
          <PenLine className="size-6 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block font-extrabold text-primary">Crear o guardar firma</span>
            <span className="block text-sm text-soft">Hazla una vez y úsala para firmar cualquier documento.</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-primary" />
        </button>
      )}

      {/* Ruta de carpetas */}
      {(folderId || searching) && (
        <nav className="no-scrollbar mb-3 flex items-center gap-1 overflow-x-auto text-sm font-bold" aria-label="Ruta">
          <Link to="/" className="flex shrink-0 items-center gap-1 rounded-xl px-2 py-2 text-primary hover:bg-surface-2">
            <HomeIcon className="size-4" /> Inicio
          </Link>
          {searching ? (
            <>
              <ChevronRight className="size-4 shrink-0 text-faint" />
              <span className="px-2 text-soft">Resultados de “{q}”</span>
            </>
          ) : (
            crumbs.map((c, i) => (
              <span key={c.id} className="flex shrink-0 items-center gap-1">
                <ChevronRight className="size-4 text-faint" />
                {i === crumbs.length - 1 ? <span className="px-2">{c.name}</span> : <Link to={'/f/' + c.id} className="rounded-xl px-2 py-2 text-primary hover:bg-surface-2">{c.name}</Link>}
              </span>
            ))
          )}
        </nav>
      )}

      {lockedHere ? (
        <Empty
          icon={<Lock className="size-10" />}
          title="Carpeta bloqueada"
          text="Escribe tu PIN para ver su contenido."
          action={<Button icon={<Unlock className="size-5" />} onClick={() => requireUnlock()}>Desbloquear</Button>}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          {/* Recientes */}
          {recent.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-lg font-extrabold">Recientes</h2>
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
                {recent.map((d) => (
                  <button key={d.id} onClick={() => nav('/doc/' + d.id)} className="w-28 shrink-0 text-left active:scale-[0.98]">
                    <DocThumb doc={d} className="aspect-[3/4] w-28" locked={docLocked(d, fm) && !unlocked} />
                    <div className="mt-1 line-clamp-2 text-sm font-semibold leading-tight">{d.name}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Carpetas */}
          {(subFolders.length > 0 || !searching) && (
            <section className="mb-6">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="flex-1 text-lg font-extrabold">Carpetas</h2>
                {folderId && current && <UpTarget active={!!dragging?.startsWith('d:')} />}
                <Button variant="soft" size="sm" icon={<FolderPlus className="size-5" />} onClick={newFolder}>
                  Nueva
                </Button>
              </div>
              {subFolders.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-soft">Organiza tus documentos en carpetas. Arrastra un archivo sobre una carpeta para moverlo.</p>
              ) : (
                <SortableContext items={subFolders.map((f) => 'f:' + f.id)} strategy={rectSortingStrategy} disabled={!manual}>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
                    {subFolders.map((f) => (
                      <FolderCard
                        key={f.id}
                        f={f}
                        count={docs.filter((d) => d.folderId === f.id).length + folders.filter((x) => x.parentId === f.id).length}
                        locked={folderLocked(f.id, fm)}
                        selecting={selecting}
                        selected={sel.has('f:' + f.id)}
                        onOpen={() => (selecting ? toggleSel('f:' + f.id) : nav('/f/' + f.id))}
                        onMenu={() => setMenuFolder(f)}
                        dropTarget={!!dragging?.startsWith('d:')}
                        manual={manual}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}
            </section>
          )}

          {/* Documentos */}
          <section>
            <div className="mb-2 flex items-center gap-1">
              <h2 className="flex-1 text-lg font-extrabold">{searching ? `${items.length} resultado(s)` : 'Documentos'}</h2>
              {!selecting ? (
                <>
                  <IconButton label="Seleccionar" onClick={() => setSelecting(true)}>
                    <CheckSquare className="size-6" />
                  </IconButton>
                  <IconButton label="Ordenar" onClick={() => setSortOpen(true)}>
                    <ArrowUpDown className="size-6" />
                  </IconButton>
                  <IconButton label={prefs.view === 'list' ? 'Ver en cuadrícula' : 'Ver en lista'} onClick={() => setPrefs({ view: prefs.view === 'list' ? 'grid' : 'list' })}>
                    {prefs.view === 'list' ? <LayoutGrid className="size-6" /> : <List className="size-6" />}
                  </IconButton>
                </>
              ) : (
                <Button variant="secondary" size="sm" icon={<X className="size-5" />} onClick={() => { setSelecting(false); setSel(new Set()); }}>
                  Listo
                </Button>
              )}
            </div>
            {loaded && items.length === 0 ? (
              searching ? (
                <p className="py-8 text-center text-soft">No se encontraron documentos.</p>
              ) : (
                <Empty
                  icon={<FileStack className="size-10" />}
                  title={folderId ? 'Carpeta vacía' : 'Aún no tienes documentos'}
                  text="Escanea con la cámara o importa fotos, PDF y archivos de Office."
                  action={<BigActions onScan={() => nav('/scan')} onImport={() => doImport()} />}
                />
              )
            ) : (
              <SortableContext items={items.map((d) => 'd:' + d.id)} strategy={rectSortingStrategy} disabled={!manual}>
                <div className={prefs.view === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5' : 'flex flex-col gap-2'}>
                  {items.map((d) => (
                    <DocRow
                      key={d.id}
                      d={d}
                      grid={prefs.view === 'grid'}
                      locked={docLocked(d, fm) && !unlocked}
                      path={searching && d.folderId ? fm.get(d.folderId)?.name : undefined}
                      selecting={selecting}
                      selected={sel.has('d:' + d.id)}
                      manual={manual}
                      onOpen={() => (selecting ? toggleSel('d:' + d.id) : nav('/doc/' + d.id))}
                      onMenu={() => setMenuDoc(d)}
                    />
                  ))}
                </div>
              </SortableContext>
            )}
            {!searching && items.length > 0 && (
              <div className="mt-8">
                <BigActions onScan={() => nav('/scan')} onImport={() => doImport()} />
              </div>
            )}
          </section>
          <DragOverlay>{null}</DragOverlay>
        </DndContext>
      )}

      {/* Barra de selección */}
      {selecting && sel.size > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-[76px] z-40 flex justify-center px-3 lg:bottom-4 lg:left-64">
          <Card className="flex flex-wrap items-center justify-center gap-1 p-2 shadow-pop">
            <span className="px-2 font-bold">{sel.size} seleccionado(s)</span>
            {selDocs.length > 0 && (
              <IconButton
                label="Compartir"
                onClick={async () => {
                  try {
                    const files = await Promise.all(selDocs.map((id) => getDocFile(id)));
                    await shareFiles(files);
                  } catch (e) {
                    toast(errMsg(e), 'error');
                  }
                }}
              >
                <Share2 className="size-6" />
              </IconButton>
            )}
            {selDocs.length > 1 && (
              <IconButton label="Unir en un PDF" onClick={() => nav(`/tool/merge?docs=${selDocs.join(',')}`)}>
                <Combine className="size-6" />
              </IconButton>
            )}
            <IconButton label="Mover" onClick={() => setMoveOpen({ docs: selDocs, folders: selFolders })}>
              <FolderInput className="size-6" />
            </IconButton>
            <IconButton
              label="Eliminar"
              className="text-danger"
              onClick={async () => {
                if (!(await confirmDialog(`¿Eliminar ${sel.size} elemento(s)?`, 'Las carpetas se eliminan con todo su contenido. No se puede deshacer.', { confirmText: 'Eliminar', danger: true }))) return;
                await deleteDocs(selDocs);
                for (const f of selFolders) await deleteFolder(f);
                setSel(new Set());
                setSelecting(false);
                toast('Eliminado');
              }}
            >
              <Trash2 className="size-6" />
            </IconButton>
          </Card>
        </div>
      )}

      <Modal open={convOpen} onClose={() => setConvOpen(false)} title="Convertir PDF">
        <div className="grid gap-3">
          {(
            [
              ['topdf', 'Convertir a PDF', 'Fotos, Word, Excel, PowerPoint, texto o páginas web', <FileInput key="a" />, '#16a34a'],
              ['frompdf', 'Convertir desde PDF', 'A Word, Excel, PowerPoint, JPG o texto', <FileOutput key="b" />, '#2563eb'],
            ] as const
          ).map(([id, t, s, ic, colr]) => (
            <button
              key={id}
              onClick={() => {
                setConvOpen(false);
                nav('/tools?s=' + id);
              }}
              className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left transition hover:bg-surface-2 active:scale-[0.99]"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-white [&>svg]:size-6" style={{ background: colr }}>
                {ic}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-extrabold">{t}</span>
                <span className="block text-sm text-soft">{s}</span>
              </span>
              <ChevronRight className="size-5 text-faint" />
            </button>
          ))}
        </div>
      </Modal>
      <SignaturePicker open={sigOpen} onClose={() => setSigOpen(false)} />
      <DocMenu doc={menuDoc} open={!!menuDoc} onClose={() => setMenuDoc(null)} />
      <FolderMenu f={menuFolder} onClose={() => setMenuFolder(null)} onMove={(f) => setMoveOpen({ docs: [], folders: [f.id] })} />
      {moveOpen && (
        <MoveDialog
          open
          onClose={() => setMoveOpen(null)}
          docIds={moveOpen.docs}
          folderIds={moveOpen.folders}
          onDone={() => {
            setSel(new Set());
            setSelecting(false);
          }}
        />
      )}
      <Modal open={sortOpen} onClose={() => setSortOpen(false)} title="Ordenar por">
        <Segmented
          value={prefs.sort}
          onChange={(v) => {
            setPrefs({ sort: v });
            setSortOpen(false);
          }}
          options={[
            { value: 'manual', label: 'Manual' },
            { value: 'date', label: 'Fecha' },
            { value: 'name', label: 'Nombre' },
            { value: 'size', label: 'Tamaño' },
          ]}
        />
        <p className="mt-3 text-sm text-soft">En orden “Manual” puedes arrastrar carpetas y documentos para reordenarlos. En el celular, mantén presionado y arrastra.</p>
      </Modal>
    </div>
  );
}

function Quick({ icon, label, sub, onClick, color }: { icon: React.ReactNode; label: string; sub: string; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick} className="flex flex-col items-start gap-2.5 rounded-3xl border border-line bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 active:scale-[0.98]">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-white [&>svg]:size-6" style={{ background: color }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-extrabold leading-tight">{label}</span>
        <span className="block text-sm leading-snug text-soft">{sub}</span>
      </span>
    </button>
  );
}

function UpTarget({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'up' });
  if (!active) return null;
  return (
    <div ref={setNodeRef} className={`rounded-xl border-2 border-dashed px-3 py-1.5 text-sm font-bold ${isOver ? 'border-primary bg-primary-soft text-primary' : 'border-line text-soft'}`}>
      Soltar aquí para subir un nivel
    </div>
  );
}

function FolderCard({
  f, count, locked, selecting, selected, onOpen, onMenu, dropTarget, manual,
}: {
  f: Folder; count: number; locked: boolean; selecting: boolean; selected: boolean; onOpen: () => void; onMenu: () => void; dropTarget: boolean; manual: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: 'f:' + f.id, disabled: !manual && !dropTarget });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(manual ? listeners : {})}
      className={`relative flex items-center gap-2 rounded-3xl border bg-surface p-2.5 shadow-card transition ${isDragging ? 'z-10 opacity-60' : ''} ${
        isOver && dropTarget ? 'scale-[1.03] border-primary ring-4 ring-primary/25' : selected ? 'border-primary ring-2 ring-primary/30' : 'border-line'
      }`}
    >
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: f.color + '22' }}>
          <FolderIcon className="size-7" style={{ color: f.color }} fill={f.color + '55'} />
          {locked && (
            <span className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full bg-text text-bg">
              <Lock className="size-3.5" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 font-extrabold leading-tight break-words">{f.name}</span>
          <span className="block truncate text-sm text-soft">{locked ? 'Bloqueada' : count === 1 ? '1 elemento' : `${count} elementos`}</span>
        </span>
      </button>
      {selecting ? (
        <span className={`size-6 shrink-0 rounded-lg border-2 ${selected ? 'border-primary bg-primary' : 'border-line'}`} />
      ) : (
        <IconButton label="Opciones de carpeta" onClick={onMenu} className="-mr-1">
          <MoreVertical className="size-5" />
        </IconButton>
      )}
    </div>
  );
}

function DocRow({
  d, grid, locked, path, selecting, selected, manual, onOpen, onMenu,
}: {
  d: DocMeta; grid: boolean; locked: boolean; path?: string; selecting: boolean; selected: boolean; manual: boolean; onOpen: () => void; onMenu: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: 'd:' + d.id, disabled: !manual });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const meta = [d.pageCount ? pagesLabel(d.pageCount) : null, formatBytes(d.size)].filter(Boolean).join(' · ');
  const check = selecting && <span className={`size-6 shrink-0 rounded-lg border-2 ${selected ? 'border-primary bg-primary' : 'border-line bg-surface'}`} />;
  if (grid)
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...(manual ? listeners : {})} className={`relative ${isDragging ? 'z-10 opacity-60' : ''}`}>
        <button onClick={onOpen} className={`block w-full rounded-3xl border bg-surface p-2 text-left shadow-card active:scale-[0.99] ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-line'}`}>
          <DocThumb doc={d} locked={locked} className="aspect-[3/4] w-full" />
          <div className="mt-2 line-clamp-2 min-h-[2.5em] px-1 text-sm font-bold leading-tight">{d.name}</div>
          <div className="px-1 pb-1 text-xs text-soft">{formatDate(d.updatedAt)}</div>
        </button>
        <div className="absolute top-3 right-3">
          {check || (
            <IconButton label="Opciones" onClick={onMenu} className="size-9 bg-surface/90 shadow-card">
              <MoreVertical className="size-5" />
            </IconButton>
          )}
        </div>
      </div>
    );
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`flex items-center gap-2 rounded-3xl border bg-surface p-2 pr-1 shadow-card ${isDragging ? 'z-10 opacity-60' : ''} ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-line'}`}
    >
      {manual && (
        <span {...listeners} className="flex h-14 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-faint" aria-label="Arrastrar para mover">
          <GripVertical className="size-5" />
        </span>
      )}
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <DocThumb doc={d} locked={locked} className="h-16 w-12 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate font-bold">{d.name}</span>
          <span className="block truncate text-sm text-soft">
            {formatDate(d.updatedAt)} · {meta}
            {path ? ` · ${path}` : ''}
          </span>
        </span>
      </button>
      {check || (
        <IconButton label="Opciones" onClick={onMenu}>
          <MoreVertical className="size-5" />
        </IconButton>
      )}
    </div>
  );
}

function FolderMenu({ f, onClose, onMove }: { f: Folder | null; onClose: () => void; onMove: (f: Folder) => void }) {
  const [colorOpen, setColorOpen] = useState(false);
  if (!f) return null;
  const run = (fn: () => any) => async () => {
    onClose();
    try {
      await fn();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  return (
    <>
      <Modal open onClose={onClose} title={f.name}>
        <MenuItem icon={<Pencil className="size-5" />} label="Cambiar nombre" onClick={run(async () => {
          const n = await promptDialog('Cambiar nombre', f.name, { label: 'Nombre' });
          if (n) await updateFolder(f.id, { name: n });
        })} />
        <MenuItem icon={<Palette className="size-5" />} label="Color" onClick={() => setColorOpen(true)} />
        <MenuItem icon={<FolderInput className="size-5" />} label="Mover a otra carpeta" onClick={run(() => onMove(f))} />
        <MenuItem
          icon={f.lockedSelf ? <Unlock className="size-5" /> : <Lock className="size-5" />}
          label={f.lockedSelf ? 'Quitar bloqueo' : 'Bloquear con PIN'}
          hint={f.lockedSelf ? undefined : 'Cifra todo su contenido'}
          onClick={run(async () => {
            if (await withBusy(f.lockedSelf ? 'Descifrando…' : 'Cifrando…', () => setFolderLocked(f.id, !f.lockedSelf))) toast(f.lockedSelf ? 'Bloqueo quitado' : 'Carpeta bloqueada', 'ok');
          })}
        />
        <MenuItem icon={<Trash2 className="size-5" />} label="Eliminar carpeta" danger onClick={run(async () => {
          if (await confirmDialog('¿Eliminar la carpeta?', `Se borrarán "${f.name}" y todo lo que contiene. No se puede deshacer.`, { confirmText: 'Eliminar', danger: true })) await deleteFolder(f.id);
        })} />
      </Modal>
      <Modal open={colorOpen} onClose={() => setColorOpen(false)} title="Color de la carpeta">
        <ColorDots value={f.color} colors={FOLDER_COLORS} onChange={async (c) => { await updateFolder(f.id, { color: c }); setColorOpen(false); onClose(); }} />
      </Modal>
    </>
  );
}

/** Botones grandes y cuadrados para escanear o importar. */
function BigActions({ onScan, onImport }: { onScan: () => void; onImport: () => void }) {
  const Item = ({ icon, label, sub, color, onClick }: { icon: React.ReactNode; label: string; sub: string; color: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      className="flex aspect-square flex-col items-center justify-center gap-3 rounded-3xl border border-line bg-surface p-4 text-center shadow-card transition hover:-translate-y-0.5 active:scale-[0.98]"
    >
      <span className="flex size-16 items-center justify-center rounded-3xl text-white shadow-card [&>svg]:size-8 sm:size-20 sm:[&>svg]:size-10" style={{ background: color }}>
        {icon}
      </span>
      <span>
        <span className="block text-lg font-extrabold leading-tight sm:text-xl">{label}</span>
        <span className="block text-sm text-soft">{sub}</span>
      </span>
    </button>
  );
  return (
    <div className="mx-auto grid w-[min(calc(100vw-2rem),26rem)] grid-cols-2 gap-3 sm:gap-4">
      <Item icon={<ScanLine />} label="Escanear" sub="Con la cámara" color="#2563eb" onClick={onScan} />
      <Item icon={<Upload />} label="Importar" sub="Fotos y archivos" color="#0d9488" onClick={onImport} />
    </div>
  );
}
