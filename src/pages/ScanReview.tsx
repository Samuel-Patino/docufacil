import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Pencil, RotateCw, Trash2, Save, ImagePlus, FileText, FileImage, Type, Loader2, Camera, Palette } from 'lucide-react';
import { useApp, toast, confirmDialog, withBusy, errMsg } from '../lib/store';
import { FILTERS, type ScanPage, type FilterId } from '../lib/scanTypes';
import { finalizePage, pageThumb } from '../lib/imaging';
import { imagesToPdf } from '../lib/pdfops';
import { ocrImage, OCR_LANGS, type OcrResult } from '../lib/ocr';
import { addDoc, updateDocBlob, getDoc } from '../lib/library';
import { textToDocx } from '../lib/convert';
import { pickFiles } from '../lib/share';
import { useLibrary } from '../lib/hooks';
import { defaultScanName, uid, bytesToBlob } from '../lib/util';
import { TopBar, Button, IconButton, Modal, Toggle, Segmented, Field, inputCls, Chip, Card } from '../components/ui';
import { PageEditor } from '../components/PageEditor';
import { DEFAULT_ADJ } from '../lib/scanTypes';
import { loadCV } from '../lib/cv';
import { detectInBlob } from '../lib/detect';

export default function ScanReview() {
  const nav = useNavigate();
  const scan = useApp((s) => s.scan);
  const updateScan = useApp((s) => s.updateScan);
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const { folders } = useLibrary();
  const [editing, setEditing] = useState<ScanPage | null>(null);
  const [name, setName] = useState(scan?.name || defaultScanName(scan?.mode === 'idcard' ? 'Cédula' : scan?.mode === 'receipt' ? 'Recibo' : 'Escaneo'));
  const [folderId, setFolderId] = useState<string | null>(scan?.folderId ?? null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [format, setFormat] = useState<'pdf' | 'jpg' | 'docx' | 'txt'>('pdf');

  const leaving = useRef(false);
  useEffect(() => {
    if (!scan && !leaving.current) nav('/', { replace: true });
  }, [scan]);

  // miniaturas faltantes (al editar un escaneo guardado)
  useEffect(() => {
    if (!scan) return;
    const missing = scan.pages.filter((p) => !p.thumb);
    if (!missing.length) return;
    (async () => {
      for (const p of missing) {
        const thumb = await pageThumb(p).catch(() => undefined);
        updateScan((s) => ({ ...s, pages: s.pages.map((x) => (x.id === p.id ? { ...x, thumb } : x)) }));
      }
    })();
  }, [scan?.pages.length]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));
  if (!scan) return null;
  const pages = scan.pages;

  const setPages = (fn: (p: ScanPage[]) => ScanPage[]) => updateScan((s) => ({ ...s, pages: fn(s.pages) }));

  async function refreshThumb(p: ScanPage) {
    const thumb = await pageThumb(p).catch(() => undefined);
    setPages((ps) => ps.map((x) => (x.id === p.id ? { ...p, thumb } : x)));
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = pages.map((p) => p.id);
    setPages((ps) => arrayMove(ps, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over!.id))));
  }

  async function applyAll(f: FilterId) {
    await withBusy('Aplicando filtro…', async (prog) => {
      for (let i = 0; i < pages.length; i++) {
        prog(i / pages.length);
        const np = { ...pages[i], filter: f, processed: undefined };
        const thumb = await pageThumb(np).catch(() => undefined);
        setPages((ps) => ps.map((x) => (x.id === np.id ? { ...np, thumb } : x)));
      }
    });
  }

  async function addFromFiles() {
    const files = await pickFiles('image/*', true);
    if (!files.length) return;
    await withBusy('Agregando imágenes…', async (prog) => {
      const cv = await loadCV().catch(() => null);
      for (let i = 0; i < files.length; i++) {
        prog(i / files.length);
        const det = cv ? await detectInBlob(cv, files[i]) : null;
        const p: ScanPage = { id: uid(), orig: files[i], quad: det?.quad ?? null, curve: null, filter: prefs.defaultFilter === 'mode' ? 'auto' : prefs.defaultFilter, adj: { ...DEFAULT_ADJ }, rotation: 0, erase: [] };
        p.thumb = await pageThumb(p).catch(() => undefined);
        setPages((ps) => [...ps, p]);
      }
    });
  }

  async function save() {
    setSaveOpen(false);
    const docName = name.trim() || defaultScanName();
    try {
      const result = await withBusy('Preparando páginas…', async (prog) => {
        const done: ScanPage[] = [];
        for (let i = 0; i < pages.length; i++) {
          prog((i / pages.length) * 0.5, `Mejorando página ${i + 1} de ${pages.length}…`);
          done.push(await finalizePage(pages[i], prefs.quality));
        }
        const needOcr = format === 'docx' || format === 'txt' || (format === 'pdf' && prefs.ocrOnSave);
        const ocrs: (OcrResult | null)[] = [];
        if (needOcr) {
          for (let i = 0; i < done.length; i++) {
            ocrs.push(
              await ocrImage(done[i].processed!, prefs.ocrLang, (p, st) => prog(0.5 + ((i + p) / done.length) * 0.45, `${st} (página ${i + 1} de ${done.length})`)),
            );
          }
        }
        prog(0.96, 'Guardando…');
        if (format === 'pdf') {
          const bytes = await imagesToPdf(done.map((p, i) => ({ blob: p.processed!, ocr: ocrs[i] })), { pageSize: prefs.pageSize, title: docName });
          const blob = bytesToBlob(bytes, 'application/pdf');
          if (scan!.docId && (await getDoc(scan!.docId))) {
            const m = await updateDocBlob(scan!.docId, blob, { scanPages: done, name: docName + '.pdf', ocr: needOcr });
            return m.id;
          }
          const m = await addDoc({ name: docName + '.pdf', blob, folderId, scanPages: done, ocr: needOcr, pageCount: done.length });
          return m.id;
        }
        if (format === 'jpg') {
          let firstId = '';
          for (let i = 0; i < done.length; i++) {
            const m = await addDoc({ name: `${docName}${done.length > 1 ? ` (${i + 1})` : ''}.jpg`, blob: done[i].processed!, folderId });
            if (!firstId) firstId = m.id;
          }
          return done.length === 1 ? firstId : null;
        }
        if (format === 'docx') {
          const blob = await textToDocx(ocrs.map((o) => o?.paragraphs || []));
          const m = await addDoc({ name: docName + '.docx', blob, folderId });
          return m.id;
        }
        const text = ocrs.map((o) => (o?.paragraphs || []).join('\n\n')).join('\n\n\f\n\n');
        const m = await addDoc({ name: docName + '.txt', blob: new Blob([text], { type: 'text/plain' }), folderId });
        return m.id;
      });
      leaving.current = true;
      toast('Guardado', 'ok');
      if (result) nav('/doc/' + result, { replace: true });
      else nav(folderId ? '/f/' + folderId : '/', { replace: true });
      useApp.getState().setScan(null);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  async function discard() {
    if (!(await confirmDialog('¿Descartar el escaneo?', scan!.docId ? 'Los cambios no se guardarán.' : 'Se perderán todas las páginas.', { confirmText: 'Descartar', danger: true }))) return;
    leaving.current = true;
    const back = scan!.docId ? '/doc/' + scan!.docId : '/';
    nav(back, { replace: true });
    useApp.getState().setScan(null);
  }

  return (
    <div className="min-h-dvh pb-40">
      <TopBar
        title={scan.docId ? 'Editar escaneo' : 'Revisar escaneo'}
        sub={`${pages.length} página(s)`}
        back={false}
        right={
          <>
            <Button variant="ghost" size="sm" onClick={discard}>
              Descartar
            </Button>
          </>
        }
      />
      <div className="mx-auto max-w-5xl px-4 pt-4">
        <Field label="Nombre del documento">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="mt-3 mb-2 flex items-center gap-2 text-sm font-bold text-soft">
          <Palette className="size-4" /> Filtro para todas las páginas
        </div>
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
          {FILTERS.map((f) => (
            <Chip key={f.id} active={pages.every((p) => p.filter === f.id)} onClick={() => applyAll(f.id)}>
              {f.label}
            </Chip>
          ))}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {pages.map((p, i) => (
                <PageCard
                  key={p.id}
                  p={p}
                  n={i + 1}
                  onEdit={() => setEditing(p)}
                  onRotate={() => {
                    const np = { ...p, rotation: ((p.rotation + 90) % 360) as any, processed: undefined };
                    refreshThumb(np);
                  }}
                  onDelete={async () => {
                    if (await confirmDialog('¿Eliminar esta página?', undefined, { confirmText: 'Eliminar', danger: true })) setPages((ps) => ps.filter((x) => x.id !== p.id));
                  }}
                />
              ))}
              <div className="flex aspect-[3/4] flex-col items-stretch justify-center gap-2 rounded-3xl border-2 border-dashed border-line p-3">
                <Button variant="soft" icon={<Camera className="size-5" />} onClick={() => nav('/scan?mode=' + scan.mode)}>
                  Cámara
                </Button>
                <Button variant="secondary" icon={<ImagePlus className="size-5" />} onClick={addFromFiles}>
                  Fotos
                </Button>
              </div>
            </div>
          </SortableContext>
        </DndContext>
        <p className="mt-3 text-center text-sm text-soft">Mantén presionada una página y arrástrala para cambiar el orden.</p>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl gap-2 px-4 py-3">
          <Button className="flex-1" size="lg" icon={<Save className="size-6" />} onClick={() => setSaveOpen(true)} disabled={!pages.length}>
            Guardar
          </Button>
        </div>
      </div>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Guardar documento"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              Cancelar
            </Button>
            <Button icon={<Save className="size-5" />} onClick={save}>
              Guardar
            </Button>
          </>
        }
      >
        <Field label="Formato">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['pdf', 'PDF', <FileText key="a" className="size-6" />],
                ['jpg', 'Imagen JPG', <FileImage key="b" className="size-6" />],
                ['docx', 'Word (texto)', <FileText key="c" className="size-6" />],
                ['txt', 'Texto TXT', <Type key="d" className="size-6" />],
              ] as const
            ).map(([v, l, ic]) => (
              <button key={v} onClick={() => setFormat(v)} className={`flex items-center gap-2 rounded-2xl border-2 p-3 font-bold ${format === v ? 'border-primary bg-primary-soft text-primary' : 'border-line'}`}>
                {ic} {l}
              </button>
            ))}
          </div>
        </Field>
        {format === 'pdf' && (
          <>
            <Toggle checked={prefs.ocrOnSave} onChange={(v) => setPrefs({ ocrOnSave: v })} label="Hacer el texto buscable (OCR)" hint="Podrás buscar y copiar el texto del PDF. Tarda unos segundos por página." />
            <Field label="Tamaño de página">
              <Segmented value={prefs.pageSize} onChange={(v) => setPrefs({ pageSize: v })} options={[{ value: 'fit', label: 'Ajustar' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }]} />
            </Field>
          </>
        )}
        {(format === 'docx' || format === 'txt' || (format === 'pdf' && prefs.ocrOnSave)) && (
          <Field label="Idioma del texto">
            <select className={inputCls} value={prefs.ocrLang} onChange={(e) => setPrefs({ ocrLang: e.target.value })}>
              {OCR_LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Calidad">
          <Segmented value={prefs.quality} onChange={(v) => setPrefs({ quality: v })} options={[{ value: 'high', label: 'Alta' }, { value: 'medium', label: 'Media' }, { value: 'low', label: 'Liviana' }]} />
        </Field>
        {!scan.docId && (
          <Field label="Guardar en">
            <select className={inputCls} value={folderId || ''} onChange={(e) => setFolderId(e.target.value || null)}>
              <option value="">Inicio</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </Modal>

      {editing && (
        <PageEditor
          page={editing}
          title={`Página ${pages.findIndex((p) => p.id === editing.id) + 1}`}
          onCancel={() => setEditing(null)}
          onDone={(np) => {
            setEditing(null);
            refreshThumb(np);
          }}
        />
      )}
    </div>
  );
}

function PageCard({ p, n, onEdit, onRotate, onDelete }: { p: ScanPage; n: number; onEdit: () => void; onRotate: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'relative z-10' : ''}>
    <Card className={`overflow-hidden p-2 ${isDragging ? 'opacity-70 shadow-pop' : ''}`}>
      <div {...attributes} {...listeners} className="relative aspect-[3/4] touch-none overflow-hidden rounded-2xl bg-surface-2" onClick={onEdit}>
        {p.thumb ? <img src={p.thumb} alt={`Página ${n}`} className="h-full w-full object-contain" draggable={false} /> : <Loader2 className="absolute inset-0 m-auto size-8 animate-spin text-primary" />}
        <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2.5 py-0.5 text-sm font-black text-white">{n}</span>
      </div>
      <div className="mt-1 flex justify-around">
        <IconButton label="Editar página" onClick={onEdit}>
          <Pencil className="size-5" />
        </IconButton>
        <IconButton label="Girar" onClick={onRotate}>
          <RotateCw className="size-5" />
        </IconButton>
        <IconButton label="Eliminar página" onClick={onDelete} className="text-danger">
          <Trash2 className="size-5" />
        </IconButton>
      </div>
    </Card>
    </div>
  );
}
