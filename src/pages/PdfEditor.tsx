import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Check, Pen, Highlighter, Type, StickyNote, Square, ArrowUpRight, Eraser, ImagePlus, PenLine, Undo2, Redo2,
  Save, X, Trash2, Minus, Plus, FormInput, Paintbrush, Loader2, Menu, MoreVertical, Columns2, Presentation, Info, Maximize2,
  MoveHorizontal, TextCursorInput, Trash, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { flushSync } from 'react-dom';
import { PageThumb } from '../components/PageGrid';
import { pdfjs, renderPage } from '../lib/pdf';
import { formatBytes } from '../lib/util';
import { getDoc, getDocBlob, updateDocBlob, addDoc } from '../lib/library';
import type { DocMeta } from '../lib/db';
import { openWithPassword } from '../lib/pdfAccess';
import type { PDFDocumentProxy, PDFPageProxy } from '../lib/pdf';
import { applyAnnotations, fillForm, protectPdf, loadPdf, type Annot, type FormValue } from '../lib/pdfops';
import { pickFont, pageFonts, predictWidth, ensureCssFont, measurePick, fontCss, type FontPick, type PdfFontInfo } from '../lib/fonts';
import { makeCover } from '../lib/textcover';
import { Button, IconButton, Modal, ColorDots, Spinner, Slider } from '../components/ui';
import { SignaturePicker } from '../components/Signature';
import { useApp, toast, promptDialog, confirmDialog, withBusy, errMsg } from '../lib/store';
import { pickFiles } from '../lib/share';
import { uid, blobToDataURL, bytesToBlob, baseName } from '../lib/util';
import { isFromDevice, saveBackToDevice } from '../lib/device';

type Tool = 'edittext' | 'pen' | 'marker' | 'highlight' | 'text' | 'note' | 'rect' | 'arrow' | 'whiteout' | 'eraser';

const COLORS = ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#ffffff'];
const HL = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];

const TOOLS: { id: Tool; label: string; icon: any }[] = [
  { id: 'edittext', label: 'Editar texto', icon: TextCursorInput },
  { id: 'pen', label: 'Lápiz', icon: Pen },
  { id: 'marker', label: 'Marcador', icon: Paintbrush },
  { id: 'highlight', label: 'Resaltar', icon: Highlighter },
  { id: 'text', label: 'Texto', icon: Type },
  { id: 'note', label: 'Comentario', icon: StickyNote },
  { id: 'rect', label: 'Rectángulo', icon: Square },
  { id: 'arrow', label: 'Flecha', icon: ArrowUpRight },
  { id: 'whiteout', label: 'Corrector', icon: Eraser },
  { id: 'eraser', label: 'Borrar anotación', icon: Trash },
];

interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'select';
  page: number;
  rect: [number, number, number, number]; // en coordenadas de vista (escala 1)
  value: FormValue;
  options?: { value: string; label: string }[];
  exportValue?: string;
  multiline?: boolean;
  readOnly?: boolean;
}

export default function PdfEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [doc, setDoc] = useState<DocMeta | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [password, setPassword] = useState<string | undefined>();
  const [annots, setAnnots] = useState<Annot[]>([]);
  const [undo, setUndo] = useState<Annot[][]>([]);
  const [redo, setRedo] = useState<Annot[][]>([]);
  const [tool, setTool] = useState<Tool | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [hl, setHl] = useState(HL[0]);
  const [width, setWidth] = useState(2.5);
  const [fontSize, setFontSize] = useState(14);
  const [selected, setSelected] = useState<string | null>(null);
  const [sigOpen, setSigOpen] = useState(params.get('tool') === 'sign');
  const [formMode, setFormMode] = useState(params.get('tool') === 'form');
  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [flatten, setFlatten] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [containerW, setContainerW] = useState(800);
  const [saveOpen, setSaveOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const gestureRef = useRef(false);
  const [gesturing, setGesturing] = useState(false);
  const visiblePage = useRef(0);
  const [curPage, setCurPage] = useState(0);
  const [twoUp, setTwoUp] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(true); // vista de páginas abierta por defecto
  const [menuOpen, setMenuOpen] = useState(false);
  const [fitOpen, setFitOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const m = await getDoc(id!);
        if (!m) return nav('/');
        setDoc(m);
        const b = await getDocBlob(m.id);
        const u8 = new Uint8Array(await b.arrayBuffer());
        const r = await openWithPassword(m.id, u8, `"${m.name}"`);
        if (!r) return nav(-1);
        setBytes(u8);
        setPassword(r.password);
        setPdf(r.pdf);
        loadFields(r.pdf);
      } catch (e) {
        toast(errMsg(e), 'error');
        nav(-1);
      }
    })();
  }, [id]);

  useEffect(() => () => { pdf?.loadingTask.destroy(); }, [pdf]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(Math.min(1000, el.clientWidth - 24)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf]);

  // Mientras se mueve o pellizca una anotación, la página no se desplaza ni hace zoom (iPhone)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (gestureRef.current) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [pdf]);

  async function loadFields(p: PDFDocumentProxy) {
    const out: FormField[] = [];
    const vals: Record<string, FormValue> = {};
    for (let i = 1; i <= p.numPages; i++) {
      const page = await p.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const anns = await page.getAnnotations();
      for (const a of anns as any[]) {
        if (a.subtype !== 'Widget' || !a.fieldName) continue;
        const r = [...vp.convertToViewportPoint(a.rect[0], a.rect[1]), ...vp.convertToViewportPoint(a.rect[2], a.rect[3])];
        const rect: [number, number, number, number] = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1])];
        let f: FormField | null = null;
        if (a.fieldType === 'Tx') f = { name: a.fieldName, type: 'text', page: i - 1, rect, value: a.fieldValue || '', multiline: a.multiLine, readOnly: a.readOnly };
        else if (a.fieldType === 'Btn' && a.checkBox) f = { name: a.fieldName, type: 'checkbox', page: i - 1, rect, value: !!a.fieldValue && a.fieldValue !== 'Off', readOnly: a.readOnly };
        else if (a.fieldType === 'Btn' && a.radioButton) f = { name: a.fieldName, type: 'radio', page: i - 1, rect, value: a.fieldValue || '', exportValue: a.buttonValue, readOnly: a.readOnly };
        else if (a.fieldType === 'Ch')
          f = {
            name: a.fieldName,
            type: 'select',
            page: i - 1,
            rect,
            value: Array.isArray(a.fieldValue) ? a.fieldValue[0] || '' : a.fieldValue || '',
            options: (a.options || []).map((o: any) => ({ value: o.exportValue, label: o.displayValue })),
            readOnly: a.readOnly,
          };
        if (f) {
          out.push(f);
          if (!(f.name in vals)) vals[f.name] = f.value;
        }
      }
    }
    setFields(out);
    setValues(vals);
    if (params.get('tool') === 'form' && !out.length) {
      toast('Este PDF no tiene campos de formulario. Usa la herramienta Texto para escribir encima.', 'info', 5000);
      setFormMode(false);
      setTool('text');
    }
  }

  const commit = (next: Annot[]) => {
    setUndo((u) => [...u.slice(-50), annots]);
    setRedo([]);
    setAnnots(next);
    setDirty(true);
  };
  const add = (a: Annot) => commit([...annots, a]);
  const update = (idv: string, patch: Partial<Annot>, record = true) => {
    const next = annots.map((a) => (a.id === idv ? ({ ...a, ...patch } as Annot) : a));
    if (record) commit(next);
    else setAnnots(next);
  };
  const patch = (idv: string, ch: Partial<Annot>) => setAnnots((cur) => cur.map((a) => (a.id === idv ? ({ ...a, ...ch } as Annot) : a)));
  // letras del PDF (se leen con pdf-lib una sola vez, sólo si se usa "Editar texto")
  const libDoc = useRef<Promise<any> | null>(null);
  const getFonts = async (i: number) => {
    if (!bytes) return [];
    libDoc.current ??= loadPdf(bytes, password).catch(() => null);
    const d = await libDoc.current;
    return d ? pageFonts(d, i) : [];
  };
  const remove = (idv: string) => {
    commit(annots.filter((a) => a.id !== idv));
    setSelected(null);
  };

  async function placeImage(blob: Blob, signature: boolean) {
    if (!pdf) return;
    const src = await blobToDataURL(blob);
    const bmp = await createImageBitmap(blob);
    // Se coloca en el centro de la zona que se está viendo
    const sc = scroller.current!;
    const sr = sc.getBoundingClientRect();
    const cy = sr.top + sr.height / 2;
    const els = Array.from(sc.querySelectorAll('[data-page]')) as HTMLElement[];
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      return r.top <= cy && r.bottom >= cy;
    }) || els[visiblePage.current];
    const page = Number(el?.dataset.page ?? 0);
    const vp = (await pdf.getPage(page + 1)).getViewport({ scale: 1 });
    const er = el.getBoundingClientRect();
    const k = er.width / vp.width;
    const w = vp.width * (signature ? 0.32 : 0.45);
    const h = (bmp.height / bmp.width) * w;
    bmp.close();
    const centerY = Math.min(vp.height - h, Math.max(0, (cy - er.top) / k - h / 2));
    const a: Annot = { id: uid(), page, type: 'image', x: (vp.width - w) / 2, y: centerY, w, h, src, signature };
    add(a);
    setTool(null);
    setSelected(a.id);
    toast('Arrástrala a su lugar. Para cambiar el tamaño, pellizca con dos dedos o usa la esquina azul.', 'info', 5000);
  }

  async function save(asCopy: boolean) {
    if (!bytes || !doc) return;
    setSaveOpen(false);
    try {
      const id2 = await withBusy('Guardando…', async () => {
        let out = bytes;
        const changedVals = fields.length > 0 && fields.some((f) => values[f.name] !== f.value);
        const doForm = changedVals || (flatten && fields.length > 0);
        if (!doForm && !annots.length && !asCopy) return doc.id;
        if (doForm) out = await fillForm(out, values, flatten, password);
        if (annots.length) out = await applyAnnotations(out, annots, out === bytes ? password : undefined);
        // Si el PDF tenía contraseña, se vuelve a proteger con la misma
        if (password) out = await protectPdf(out, password, { print: true, copy: true, modify: true }, out === bytes ? password : undefined);
        const blob = bytesToBlob(out, 'application/pdf');
        if (asCopy) {
          const m = await addDoc({ name: `${baseName(doc.name)} (editado).pdf`, blob, folderId: doc.folderId });
          return m.id;
        }
        await updateDocBlob(doc.id, blob);
        return doc.id;
      });
      setDirty(false);
      toast('Cambios guardados', 'ok');
      if (!asCopy && isFromDevice(doc.id)) {
        const b = await getDocBlob(doc.id);
        await saveBackToDevice(doc.id, new File([b], doc.name, { type: 'application/pdf' }));
      }
      nav('/doc/' + id2, { replace: true });
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  async function exit() {
    if (dirty && !(await confirmDialog('¿Salir sin guardar?', 'Perderás las anotaciones que agregaste.', { confirmText: 'Salir', danger: true }))) return;
    nav(-1);
  }

  if (!pdf || !doc) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner className="size-10" />
      </div>
    );
  }

  const gap = 16;
  /** Pasa un texto a modo de edición en vivo (con el teclado ya abierto). */
  function startEditText(id: string) {
    flushSync(() => {
      setTool(null);
      setSelected(id);
      setEditingId(id);
    });
    const ta = document.querySelector('textarea[data-edit="' + id + '"]') as HTMLTextAreaElement | null;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  const pageW = twoUp ? Math.max(120, (containerW * zoom - gap) / 2) : containerW * zoom;
  const sel = annots.find((a) => a.id === selected);
  const scrollToPage = (i: number) => {
    const el = scroller.current?.querySelector(`[data-page="${i}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'start' });
    setCurPage(i);
  };
  /** Ajusta el zoom para ver la página completa (alto) o a lo ancho. */
  async function fitView(mode: 'width' | 'page') {
    setFitOpen(false);
    setMenuOpen(false);
    if (mode === 'width') return setZoom(1);
    const vp = (await pdf!.getPage(curPage + 1)).getViewport({ scale: 1 });
    const sh = (scroller.current?.clientHeight || 600) - 32;
    const cols = twoUp ? 2 : 1;
    const wAt1 = twoUp ? (containerW - gap) / 2 : containerW;
    setZoom(Math.max(0.3, Math.min(1, sh / ((vp.height / vp.width) * wAt1)) * (cols === 2 ? 1 : 1)));
    setTimeout(() => scrollToPage(curPage), 60);
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-bg">
      <header className="safe-top border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2">
          <IconButton label="Salir" onClick={exit}>
            <X className="size-6" />
          </IconButton>
          <h1 className="min-w-0 flex-1 truncate px-1 text-lg font-extrabold">{formMode ? 'Llenar formulario' : 'Editar PDF'}</h1>
          <IconButton label="Deshacer" disabled={!undo.length} onClick={() => { setRedo((r) => [...r, annots]); setAnnots(undo[undo.length - 1]); setUndo((u) => u.slice(0, -1)); }}>
            <Undo2 className="size-6" />
          </IconButton>
          <IconButton label="Rehacer" disabled={!redo.length} onClick={() => { setUndo((u) => [...u, annots]); setAnnots(redo[redo.length - 1]); setRedo((r) => r.slice(0, -1)); }}>
            <Redo2 className="size-6" />
          </IconButton>
          <Button size="sm" icon={<Save className="size-5" />} onClick={() => setSaveOpen(true)}>
            Guardar
          </Button>
        </div>
        {/* Vista: páginas, número de página, zoom y más opciones */}
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-1 border-t border-line/60 px-2">
          <IconButton label="Ver todas las páginas" className="size-10" active={pagesOpen} onClick={() => setPagesOpen((v) => !v)}>
            <Menu className="size-5" />
          </IconButton>
          <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-bold tabular-nums">
            {curPage + 1} / {pdf.numPages}
          </span>
          <div className="flex-1" />
          <IconButton label="Alejar" className="size-10" onClick={() => setZoom((z) => Math.max(0.3, z / 1.2))}>
            <Minus className="size-5" />
          </IconButton>
          <button className="h-10 w-14 rounded-xl text-center text-sm font-bold tabular-nums hover:bg-surface-2" onClick={() => setZoom(1)} title="Volver al 100 %">
            {Math.round(zoom * 100)}%
          </button>
          <IconButton label="Acercar" className="size-10" onClick={() => setZoom((z) => Math.min(4, z * 1.2))}>
            <Plus className="size-5" />
          </IconButton>
          <div className="relative">
            <IconButton label="Más opciones de vista" className="size-10" onClick={() => setMenuOpen((v) => !v)}>
              <MoreVertical className="size-5" />
            </IconButton>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setMenuOpen(false); setFitOpen(false); }} />
                <div className="absolute top-full right-0 z-50 mt-1 w-64 overflow-hidden rounded-2xl border border-line bg-surface py-1 shadow-pop animate-pop">
                  <MenuRow icon={<Columns2 />} label="Vista de dos páginas" checked={twoUp} onClick={() => { setTwoUp((v) => !v); setMenuOpen(false); }} />
                  <MenuRow icon={<Presentation />} label="Presentar" onClick={() => { setMenuOpen(false); setPresenting(true); }} />
                  <MenuRow icon={<Info />} label="Propiedades del documento" onClick={() => { setMenuOpen(false); setPropsOpen(true); }} />
                  <MenuRow icon={<Maximize2 />} label="Ajustar vista de página" onClick={() => setFitOpen((v) => !v)} />
                  {fitOpen && (
                    <div className="mx-2 mb-1 grid gap-1 rounded-xl bg-surface-2 p-1">
                      <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-surface" onClick={() => fitView('width')}>
                        <MoveHorizontal className="size-4" /> Ajustar al ancho
                      </button>
                      <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-surface" onClick={() => fitView('page')}>
                        <Maximize2 className="size-4" /> Página completa
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {pagesOpen && <PagesPanel pdf={pdf} current={curPage} onPick={(i) => { scrollToPage(i); if (window.innerWidth < 768) setPagesOpen(false); }} onClose={() => setPagesOpen(false)} />}
        <div
          ref={scroller}
          className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-surface-3/60 px-3 py-4"
          style={{ touchAction: gesturing ? 'none' : undefined }}
          onScroll={(e) => {
            const el = e.currentTarget;
            const kids = Array.from(el.querySelectorAll('[data-page]')) as HTMLElement[];
            const mid = el.scrollTop + el.clientHeight / 3;
            for (const k of kids) if (k.offsetTop <= mid && k.offsetTop + k.offsetHeight > mid) visiblePage.current = Number(k.dataset.page);
            if (visiblePage.current !== curPage) setCurPage(visiblePage.current);
          }}
        >
          <div className={`mx-auto ${twoUp ? 'grid grid-cols-2 items-start justify-items-center' : 'flex flex-col items-center'}`} style={{ width: twoUp ? pageW * 2 + gap : pageW, gap }}>
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <EditablePage
                key={i}
                pdf={pdf}
                index={i}
                width={pageW}
                tool={formMode ? null : tool}
                gestureRef={gestureRef}
                setGesturing={setGesturing}
                onPlaced={(nid) => {
                  setTool(null);
                  setSelected(nid);
                }}
                annots={annots.filter((a) => a.page === i)}
                selected={selected}
                setSelected={setSelected}
                editingId={editingId}
                setEditingId={setEditingId}
                style={{ color, hl, width, fontSize }}
                add={add}
                addMany={(xs) => commit([...annots, ...xs])}
                update={update}
                patch={patch}
                getFonts={getFonts}
                remove={remove}
                commitMove={(prev) => {
                  setUndo((u) => [...u.slice(-50), prev]);
                  setRedo([]);
                  setDirty(true);
                }}
                allAnnots={annots}
                fields={formMode ? fields.filter((f) => f.page === i) : []}
                values={values}
                setValue={(n, v) => {
                  setValues((s) => ({ ...s, [n]: v }));
                  setDirty(true);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Propiedades (sólo cuando hay algo que ajustar) */}
      {!formMode && (tool || sel) && (
        <div className="border-t border-line bg-surface">
          <div className="no-scrollbar mx-auto flex max-w-6xl items-center gap-3 overflow-x-auto px-3 py-2 [&_button]:whitespace-nowrap [&>*]:shrink-0">
            {tool && (
              <Button size="sm" icon={<Check className="size-5" />} onClick={() => setTool(null)}>
                Listo
              </Button>
            )}
            {sel ? (
              <>
                <span className="shrink-0 text-sm font-bold text-soft">Seleccionado</span>
                {sel.type === 'text' && (
                  <>
                    {sel.fontLabel && (
                      <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold text-soft" title="Letra detectada en el PDF">
                        Letra: {sel.fontLabel}
                      </span>
                    )}
                    <IconButton label="Letra más pequeña" onClick={() => update(sel.id, { size: Math.max(6, (sel as any).size - 2) } as any)}>
                      <Minus className="size-5" />
                    </IconButton>
                    <IconButton label="Letra más grande" onClick={() => update(sel.id, { size: Math.min(96, (sel as any).size + 2) } as any)}>
                      <Plus className="size-5" />
                    </IconButton>
                    <Button variant="secondary" size="sm" onClick={() => startEditText(sel.id)}>
                      Editar texto
                    </Button>
                  </>
                )}
                {sel.type === 'note' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const t = await promptDialog('Editar comentario', (sel as any).text);
                      if (t) update(sel.id, { text: t } as any);
                    }}
                  >
                    Editar comentario
                  </Button>
                )}
                {'color' in sel && sel.type !== 'highlight' && sel.type !== 'whiteout' && <ColorDots nowrap small custom value={(sel as any).color} colors={COLORS} onChange={(c) => update(sel.id, { color: c } as any)} />}
                <Button variant="danger" size="sm" icon={<Trash2 className="size-5" />} onClick={() => remove(sel.id)}>
                  Eliminar
                </Button>
              </>
            ) : tool === 'highlight' || tool === 'marker' ? (
              <ColorDots nowrap small custom value={hl} colors={HL} onChange={setHl} />
            ) : tool === 'pen' || tool === 'rect' || tool === 'arrow' || tool === 'text' || tool === 'note' ? (
              <>
                <ColorDots nowrap small custom value={color} colors={COLORS.slice(0, 6)} onChange={setColor} />
                {tool === 'text' ? (
                  <div className="w-40 shrink-0">
                    <Slider label="Tamaño" value={fontSize} min={8} max={48} onChange={setFontSize} />
                  </div>
                ) : tool !== 'note' ? (
                  <div className="w-40 shrink-0">
                    <Slider label="Grosor" value={width} min={1} max={10} step={0.5} onChange={setWidth} />
                  </div>
                ) : null}
              </>
            ) : (
              <span className="min-w-0 shrink! text-sm leading-snug text-soft">
                {tool === 'edittext' ? 'Toca un texto del PDF para cambiarlo.' : tool === 'eraser' ? 'Toca una anotación para borrarla.' : 'Arrastra para tapar contenido.'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Herramientas */}
      <div className="safe-bottom border-t border-line bg-surface">
        <div className="no-scrollbar mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-2 py-2">
          {fields.length > 0 && (
            <ToolBtn active={formMode} label="Formulario" onClick={() => setFormMode((v) => !v)}>
              <FormInput className="size-6" />
            </ToolBtn>
          )}
          <ToolBtn active={false} label="Firma" onClick={() => { setFormMode(false); setSigOpen(true); }} accent>
            <PenLine className="size-6" />
          </ToolBtn>
          <ToolBtn
            active={false}
            label="Imagen"
            onClick={async () => {
              setFormMode(false);
              const [f] = await pickFiles('image/*', false);
              if (f) placeImage(f, false);
            }}
          >
            <ImagePlus className="size-6" />
          </ToolBtn>
          <span className="mx-1 h-8 w-px shrink-0 bg-line" />
          {TOOLS.map((t) => (
            <ToolBtn
              key={t.id}
              active={!formMode && tool === t.id}
              label={t.label}
              onClick={() => {
                setFormMode(false);
                setTool((cur) => (cur === t.id ? null : t.id));
                setSelected(null);
              }}
            >
              <t.icon className="size-6" />
            </ToolBtn>
          ))}
        </div>
      </div>

      <SignaturePicker open={sigOpen} onClose={() => setSigOpen(false)} onPick={(b) => placeImage(b, true)} />
      {presenting && <Presenter pdf={pdf} start={curPage} onClose={(i) => { setPresenting(false); scrollToPage(i); }} />}
      <DocProps open={propsOpen} onClose={() => setPropsOpen(false)} pdf={pdf} doc={doc} size={bytes?.byteLength || 0} />

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Guardar cambios"
        footer={
          <>
            <Button variant="secondary" onClick={() => save(true)}>
              Guardar como copia
            </Button>
            <Button onClick={() => save(false)}>Guardar</Button>
          </>
        }
      >
        <p className="text-soft">Las anotaciones, firmas e imágenes quedarán fijas dentro del PDF y se verán en cualquier programa.</p>
        {fields.length > 0 && (
          <label className="mt-3 flex items-center gap-3 font-semibold">
            <input type="checkbox" className="size-5" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
            Fijar el formulario (ya no se podrá editar)
          </label>
        )}
        {password && <p className="mt-3 text-sm text-soft">El PDF mantendrá su contraseña.</p>}
      </Modal>
    </div>
  );
}

function ToolBtn({ active, label, onClick, children, accent }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-16 shrink-0 flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] font-bold transition ${
        active ? 'bg-primary text-on-primary' : accent ? 'bg-accent-soft text-accent' : 'text-soft hover:bg-surface-2'
      }`}
    >
      {children}
      {label}
    </button>
  );
}

// ---------- página editable ----------

interface PageProps {
  pdf: PDFDocumentProxy;
  index: number;
  width: number;
  tool: Tool | null;
  gestureRef: React.MutableRefObject<boolean>;
  setGesturing: (v: boolean) => void;
  onPlaced: (id: string) => void;
  annots: Annot[];
  allAnnots: Annot[];
  selected: string | null;
  setSelected: (id: string | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  addMany: (a: Annot[]) => void;
  style: { color: string; hl: string; width: number; fontSize: number };
  add: (a: Annot) => void;
  update: (id: string, patch: Partial<Annot>, record?: boolean) => void;
  /** cambia una anotación sin crear un paso de deshacer (seguro para tareas en segundo plano) */
  patch: (id: string, patch: Partial<Annot>) => void;
  getFonts: (page: number) => Promise<PdfFontInfo[]>;
  remove: (id: string) => void;
  commitMove: (prev: Annot[]) => void;
  fields: FormField[];
  values: Record<string, FormValue>;
  setValue: (name: string, v: FormValue) => void;
}

function bbox(a: Annot) {
  switch (a.type) {
    case 'ink': {
      const xs = a.pts.map((p) => p.x), ys = a.pts.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'line':
    case 'arrow':
      return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
    case 'text': {
      const lines = a.text.split('\n');
      return { x: a.x, y: a.y, w: Math.max(...lines.map((l) => l.length)) * a.size * 0.55, h: lines.length * a.size * 1.25 };
    }
    case 'note':
      return { x: a.x, y: a.y, w: 20, h: 20 };
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

let lastGestureEnd = 0;
// Último toque sobre una anotación (para detectar el doble toque que abre la edición del texto)
let lastTap = { id: "", t: 0 };

/** Escala la anotación k veces alrededor de (cx, cy) y luego la desplaza (dx, dy). */
function transformAnnot(a: Annot, k: number, cx: number, cy: number, dx: number, dy: number): Partial<Annot> {
  const T = (x: number, y: number) => ({ x: cx + (x - cx) * k + dx, y: cy + (y - cy) * k + dy });
  switch (a.type) {
    case 'ink':
      return { pts: a.pts.map((q) => T(q.x, q.y)) } as any;
    case 'line':
    case 'arrow': {
      const p1 = T(a.x1, a.y1);
      const p2 = T(a.x2, a.y2);
      return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y } as any;
    }
    case 'text': {
      const q = T(a.x, a.y);
      return { x: q.x, y: q.y, size: Math.max(4, a.size * k) } as any;
    }
    case 'note':
      return { x: a.x + dx, y: a.y + dy } as any;
    default: {
      const o = a as any;
      const q = T(o.x, o.y);
      return { x: q.x, y: q.y, w: o.w * k, h: o.h * k } as any;
    }
  }
}

function EditablePage(p: PageProps) {
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(p.index < 2);
  const [draft, setDraft] = useState<Annot | null>(null);
  const action = useRef<{ kind: 'draw'; start: { x: number; y: number } } | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    p.pdf.getPage(p.index + 1).then(setPage);
  }, [p.pdf, p.index]);

  useEffect(() => {
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '800px 0px' });
    io.observe(holder.current!);
    return () => io.disconnect();
  }, []);

  const vp1 = page?.getViewport({ scale: 1 });
  const scale = vp1 ? p.width / vp1.width : 1;
  const H = vp1 ? vp1.height * scale : p.width * 1.414;

  useEffect(() => {
    if (!page || !visible) return;
    let task: any;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const vp = page.getViewport({ scale: scale * dpr });
    const c = canvasRef.current!;
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    setRendering(true);
    task = page.render({ canvas: c, viewport: vp, annotationMode: 1 } as any);
    task.promise.then(() => setRendering(false)).catch(() => {});
    return () => task?.cancel?.();
  }, [page, visible, Math.round(p.width)]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = holder.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const drawing = !!p.tool && ['pen', 'marker', 'highlight', 'rect', 'arrow', 'whiteout'].includes(p.tool);

  // Texto original del PDF (para "Editar texto"): se carga apenas se elige la herramienta
  type PdfLine = { str: string; x: number; base: number; w: number; size: number; font: string; chars: Record<string, number>; pick?: FontPick };
  const pdfLines = useRef<PdfLine[] | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    if (p.tool !== 'edittext' || !page || pdfLines.current) return;
    (async () => {
      const vp = page.getViewport({ scale: 1 });
      const tc: any = await page.getTextContent();
      const items: PdfLine[] = [];
      for (const it of tc.items as any[]) {
        if (!it.str || !it.str.trim()) continue;
        const t = pdfjs.Util.transform(vp.transform, it.transform);
        const size = Math.hypot(t[2], t[3]);
        if (size < 2) continue;
        items.push({ str: it.str, x: t[4], base: t[5], w: it.width * (vp.scale || 1), size, font: it.fontName, chars: { [it.fontName]: it.str.length } });
      }
      // Qué letra del PDF es cada una: se compara negrita/cursiva/tipo y el ancho real del texto
      const infos = await p.getFonts(p.index).catch(() => [] as PdfFontInfo[]);
      const picks: Record<string, FontPick> = {};
      for (const name of new Set(items.map((i) => i.font))) {
        let fo: any = null;
        try {
          if (page.commonObjs.has(name)) fo = page.commonObjs.get(name);
        } catch {}
        const generic = String(tc.styles?.[name]?.fontFamily || '');
        // pdf.js sólo sabe si es negrita/cursiva en algunas letras
        const known = fo && (fo.bold !== undefined || fo.italic !== undefined);
        const bold = !!(fo?.bold || fo?.black);
        const italic = !!fo?.italic;
        const serif = generic === 'serif';
        const mono = generic === 'monospace';
        const mine = items.filter((i) => i.font === name);
        const sample = mine.sort((a, b) => b.str.length - a.str.length)[0];
        const used = [...new Set([...mine.map((i) => i.str).join('')])].filter((ch) => ch.trim());
        let best: PdfFontInfo | null = null;
        let bestScore = Infinity;
        for (const c of infos) {
          let sc = (known && c.bold !== bold ? 2 : 0) + (known && c.italic !== italic ? 2 : 0) + (c.mono !== mono ? 1 : 0);
          // las letras recortadas sólo contienen los caracteres que usa el documento
          if (c.charset && used.length) sc += (used.filter((ch) => !c.charset!.has(ch)).length / used.length) * 6;
          const pred = predictWidth(c, sample.str, sample.size);
          if (pred !== undefined && sample.w > 0) sc += Math.min(4, (Math.abs(pred - sample.w) / sample.w) * 12);
          // sin datos para comprobarla: sólo gana si ninguna otra coincide
          else if (!c.charset) sc += 1.5;
          if (sc < bestScore) [best, bestScore] = [c, sc];
        }
        picks[name] = best ? pickFont({ ...best, bold: known ? bold || best.bold : best.bold, italic: known ? italic || best.italic : best.italic }) : pickFont({ base: '', bold, italic, serif, mono });
      }
      // Une los pedazos de una misma línea (el PDF suele cortar las líneas en varias partes)
      items.sort((a, b) => a.base - b.base || a.x - b.x);
      const lines: PdfLine[] = [];
      for (const it of items) {
        const l = lines.find((q) => Math.abs(q.base - it.base) < q.size * 0.3 && it.x - (q.x + q.w) < q.size * 1.2 && it.x >= q.x - 1);
        if (l) {
          const gap = it.x - (l.x + l.w);
          l.str += (gap > l.size * 0.15 && !/\s$/.test(l.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
          l.w = Math.max(l.w, it.x + it.w - l.x);
          l.chars[it.font] = (l.chars[it.font] || 0) + it.str.length;
        } else lines.push({ ...it, chars: { ...it.chars } });
      }
      // letra de cada línea = la que más caracteres tiene
      for (const l of lines) {
        l.font = Object.entries(l.chars).sort((a, b) => b[1] - a[1])[0][0];
        l.pick = picks[l.font];
      }
      pdfLines.current = lines;
      // deja lista la letra para la vista previa
      for (const pk of new Set(Object.values(picks).map((k) => JSON.stringify({ font: k.font, weight: k.weight, italic: k.italic }))))
        ensureCssFont(JSON.parse(pk)).then((changed) => changed && bump((n) => n + 1));
    })();
  }, [p.tool, page]);

  /** Colores del texto y del fondo leyendo los píxeles de la página dibujada. */
  function sampleColors(x: number, y: number, w: number, h: number) {
    const c = canvasRef.current;
    if (!c) return { ink: '#111111', bg: '#ffffff' };
    const k = c.width / (vp1!.width || 1);
    const sx = Math.max(0, Math.floor(x * k)), sy = Math.max(0, Math.floor(y * k));
    const sw = Math.max(1, Math.min(c.width - sx, Math.ceil(w * k))), sh = Math.max(1, Math.min(c.height - sy, Math.ceil(h * k)));
    const d = c.getContext('2d')!.getImageData(sx, sy, sw, sh).data;
    const px: [number, number, number, number][] = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2], 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]]);
    px.sort((a, b) => a[3] - b[3]);
    const avg = (arr: typeof px) => arr.reduce((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]).map((v) => Math.round(v / Math.max(1, arr.length)));
    const ink = avg(px.slice(0, Math.max(1, Math.floor(px.length * 0.08))));
    const bg = avg(px.slice(Math.floor(px.length * 0.6)));
    const hex = (c3: number[]) => '#' + c3.map((v) => v.toString(16).padStart(2, '0')).join('');
    const same = Math.abs(ink[0] - bg[0]) + Math.abs(ink[1] - bg[1]) + Math.abs(ink[2] - bg[2]) < 60;
    return { ink: same ? '#111111' : hex(ink), bg: hex(bg) };
  }

  // Toques: seleccionar (sin herramienta), borrar, agregar o cambiar texto, comentario
  function click(e: React.MouseEvent) {
    if (Date.now() - lastGestureEnd < 400) return;
    const pt = toPage(e);
    const target = (e.target as Element).closest('[data-id]') as HTMLElement | null;
    if (p.tool === null) {
      const id = target ? target.dataset.id! : null;
      p.setSelected(id);
      if (id) lastTap = { id, t: Date.now() };
      return;
    }
    if (p.tool === 'eraser') {
      if (target) p.remove(target.dataset.id!);
      return;
    }
    if (p.tool === 'text') {
      // Se escribe directamente sobre la página
      const nid = uid();
      flushSync(() => {
        p.add({ id: nid, page: p.index, type: 'text', x: pt.x, y: pt.y - p.style.fontSize * 0.6, w: 0, text: '', size: p.style.fontSize, color: p.style.color });
        p.onPlaced(nid);
      });
      focusEditor(nid);
      return;
    }
    if (p.tool === 'edittext') {
      const lines = pdfLines.current;
      if (!lines) return toast('Leyendo el texto de la página…', 'info');
      const hit = lines.find((l) => pt.x >= l.x - 2 && pt.x <= l.x + l.w + 2 && pt.y >= l.base - l.size * 0.95 && pt.y <= l.base + l.size * 0.3);
      if (!hit) return toast('Aquí no hay texto que se pueda cambiar. Si es una foto o un escaneo, usa “Corrector” y “Texto”.', 'info', 4500);
      const top = hit.base - hit.size * 0.92;
      const colors = sampleColors(hit.x, hit.base - hit.size * 0.8, hit.w, hit.size);
      const pick: FontPick = hit.pick || pickFont({ base: '', bold: false, italic: false, serif: false, mono: false });
      // tapa provisional (al instante); enseguida se cambia por el fondo reconstruido
      const coverId = uid();
      const cover: Annot = { id: coverId, page: p.index, type: 'whiteout', x: hit.x - 1, y: hit.base - hit.size * 0.95, w: hit.w + 2, h: hit.size * 1.25, color: colors.bg, cover: true };
      const nid = uid();
      const txt: Annot = {
        id: nid, page: p.index, type: 'text', x: hit.x, y: top, w: 0, text: hit.str, size: hit.size, color: colors.ink,
        font: pick.font, fallback: pick.fallback, weight: pick.weight, bold: pick.weight >= 600, italic: pick.italic, serif: pick.fallback === 'times', fontLabel: pick.label,
      };
      // la línea ya no se puede volver a tomar (ahora es una anotación)
      pdfLines.current = lines.filter((l) => l !== hit);
      flushSync(() => {
        p.addMany([cover, txt]);
        p.onPlaced(nid);
      });
      focusEditor(nid);
      // Fondo exacto detrás de las letras + ancho igual al original
      (async () => {
        const [cov, width] = await Promise.all([makeCover(page!, hit).catch(() => null), measurePick(pick, hit.str, hit.size).catch(() => 0)]);
        if (cov) p.patch(coverId, cov.src ? ({ type: 'image', src: cov.src, x: cov.x, y: cov.y, w: cov.w, h: cov.h, cover: true } as any) : ({ x: cov.x, y: cov.y, w: cov.w, h: cov.h, color: cov.color } as any));
        let sx = width > 0 ? hit.w / width : 1;
        sx = Math.abs(sx - 1) < 0.03 ? 1 : Math.max(0.75, Math.min(1.3, sx));
        p.patch(nid, { sx, ...(cov ? { color: cov.ink } : {}) } as any);
      })();
      return;
    }
    if (p.tool === 'note') {
      (async () => {
        const t = await promptDialog('Agregar comentario', '', { label: 'Comentario', confirmText: 'Agregar' });
        if (!t) return;
        const nid = uid();
        p.add({ id: nid, page: p.index, type: 'note', x: pt.x - 10, y: pt.y - 10, text: t, color: '#facc15' });
        p.onPlaced(nid);
      })();
    }
  }

  /** Abre la edición en vivo de un texto y enfoca el cuadro (en el mismo toque, para que salga el teclado). */
  function focusEditor(id: string) {
    flushSync(() => p.setEditingId(id));
    const ta = holder.current?.querySelector('textarea[data-edit="' + id + '"]') as HTMLTextAreaElement | null;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  function down(e: React.PointerEvent) {
    if (!drawing) return;
    const pt = toPage(e);
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {}
    action.current = { kind: 'draw', start: pt };
    const base = { id: uid(), page: p.index };
    if (p.tool === 'pen') setDraft({ ...base, type: 'ink', pts: [pt], color: p.style.color, width: p.style.width, opacity: 1 });
    else if (p.tool === 'marker') setDraft({ ...base, type: 'ink', pts: [pt], color: p.style.hl, width: 14, opacity: 0.4 });
    else if (p.tool === 'arrow') setDraft({ ...base, type: 'arrow', x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, color: p.style.color, width: p.style.width });
    else setDraft({ ...base, type: p.tool as 'highlight' | 'rect' | 'whiteout', x: pt.x, y: pt.y, w: 0, h: 0, color: p.tool === 'highlight' ? p.style.hl : p.tool === 'whiteout' ? '#ffffff' : p.style.color, width: p.style.width });
  }

  function moveEv(e: React.PointerEvent) {
    const act = action.current;
    if (!act || !draft) return;
    const pt = toPage(e);
    if (draft.type === 'ink') setDraft({ ...draft, pts: [...draft.pts, pt] });
    else if (draft.type === 'arrow') setDraft({ ...draft, x2: pt.x, y2: pt.y });
    else if ('w' in draft) setDraft({ ...(draft as any), x: Math.min(act.start.x, pt.x), y: Math.min(act.start.y, pt.y), w: Math.abs(pt.x - act.start.x), h: Math.abs(pt.y - act.start.y) });
  }

  function up() {
    const act = action.current;
    action.current = null;
    if (!act || !draft) return;
    const b = bbox(draft);
    if (draft.type === 'ink' ? draft.pts.length > 1 : b.w > 3 || b.h > 3) p.add(draft);
    setDraft(null);
  }

  // ----- mover (un dedo) y cambiar tamaño (dos dedos o la esquina azul) -----
  const gest = useRef<{
    ptrs: Map<number, { x: number; y: number }>;
    base: Annot;
    cur: Annot;
    orig: Annot;
    prev: Annot[];
    baseC: { x: number; y: number };
    baseD: number;
    handle: boolean;
    stop: () => void;
  } | null>(null);
  useEffect(() => () => gest.current?.stop(), []);

  function startGesture(e: React.PointerEvent, handle: boolean, a: Annot) {
    e.stopPropagation();
    if (gest.current) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {}
    const { update, commitMove, gestureRef, setGesturing } = p;
    const sc = scale;
    type Ptrs = Map<number, { x: number; y: number }>;
    const center = (m: Ptrs) => {
      const v = [...m.values()];
      return { x: v.reduce((s, q) => s + q.x, 0) / v.length, y: v.reduce((s, q) => s + q.y, 0) / v.length };
    };
    const spread = (m: Ptrs) => {
      const v = [...m.values()];
      return v.length > 1 ? Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) : 0;
    };
    const rebase = () => {
      const g = gest.current!;
      g.base = g.cur;
      g.baseC = center(g.ptrs);
      g.baseD = spread(g.ptrs);
    };
    const apply = () => {
      const g = gest.current!;
      const c = center(g.ptrs);
      const b = bbox(g.base);
      let k = 1;
      let dx = (c.x - g.baseC.x) / sc;
      let dy = (c.y - g.baseC.y) / sc;
      let cx = b.x + b.w / 2;
      let cy = b.y + b.h / 2;
      if (g.handle) {
        // la esquina azul agranda desde la esquina superior izquierda
        k = Math.hypot(b.w + dx, b.h + dy) / (Math.hypot(b.w, b.h) || 1);
        cx = b.x;
        cy = b.y;
        dx = dy = 0;
      } else if (g.ptrs.size > 1 && g.baseD > 0) k = spread(g.ptrs) / g.baseD;
      const size = Math.max(b.w, b.h) || 1;
      k = Math.min(Math.max(k, 12 / size), 2000 / size);
      const patch = transformAnnot(g.base, k, cx, cy, dx, dy);
      g.cur = { ...g.base, ...patch } as Annot;
      update(g.base.id, patch, false);
    };
    const onDown = (ev: PointerEvent) => {
      const g = gest.current;
      if (!g || g.handle || g.ptrs.has(ev.pointerId)) return;
      g.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      rebase();
    };
    const onMove = (ev: PointerEvent) => {
      const g = gest.current;
      if (!g || !g.ptrs.has(ev.pointerId)) return;
      g.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      apply();
    };
    const onUp = (ev: PointerEvent) => {
      const g = gest.current;
      if (!g || !g.ptrs.has(ev.pointerId)) return;
      g.ptrs.delete(ev.pointerId);
      if (g.ptrs.size) return rebase();
      const changed = JSON.stringify(g.cur) !== JSON.stringify(g.orig);
      const prev = g.prev;
      g.stop();
      if (changed) commitMove(prev);
      else if (!g.handle && g.orig.type === 'text') {
        // Doble toque (o doble clic) sobre un texto: se edita ahí mismo
        const now = Date.now();
        if (lastTap.id === g.orig.id && now - lastTap.t < 450) {
          lastTap = { id: '', t: 0 };
          focusEditor(g.orig.id);
        } else lastTap = { id: g.orig.id, t: now };
      }
    };
    const stop = () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      gestureRef.current = false;
      setGesturing(false);
      lastGestureEnd = Date.now();
      gest.current = null;
    };
    const ptrs: Ptrs = new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]);
    gest.current = { ptrs, base: a, cur: a, orig: a, prev: p.allAnnots, baseC: center(ptrs), baseD: 0, handle, stop };
    gestureRef.current = true;
    setGesturing(true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }

  const list = draft ? [...p.annots, draft] : p.annots;
  const selA = p.annots.find((a) => a.id === p.selected);
  const editA = p.annots.find((a) => a.id === p.editingId) as (Annot & { type: 'text' }) | undefined;
  // Estado antes de editar el texto, para poder deshacer el cambio completo
  const editStart = useRef<{ text: string; all: Annot[] } | null>(null);
  if (editA && !editStart.current) editStart.current = { text: editA.text, all: p.allAnnots };

  return (
    <div data-page={p.index} ref={holder} className="relative shrink-0 bg-white shadow-card" style={{ width: p.width, height: H }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {rendering && <Loader2 className="absolute inset-0 m-auto size-8 animate-spin text-primary" />}
      {vp1 && (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${vp1.width} ${vp1.height}`}
          style={{ touchAction: drawing ? 'none' : 'auto', cursor: drawing ? 'crosshair' : p.tool === 'text' || p.tool === 'note' ? 'text' : 'default' }}
          onClick={click}
          onPointerDown={down}
          onPointerMove={moveEv}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <defs>
            <marker id={`arr-${p.index}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
            </marker>
          </defs>
          {list.map((a) => (
            <AnnotShape key={a.id} a={a} marker={`url(#arr-${p.index})`} hidden={a.id === p.editingId} />
          ))}
        </svg>
      )}
      {/* selección: arrastrar para mover; pellizcar o usar la esquina para cambiar el tamaño */}
      {editA && editA.type === 'text' && (
        <LiveText
          key={editA.id}
          a={editA}
          scale={scale}
          onChange={(text) => p.update(editA.id, { text } as any, false)}
          onDone={(text) => {
            const before = editStart.current;
            editStart.current = null;
            p.setEditingId(null);
            if (!text.trim()) p.remove(editA.id);
            else if (before && before.text !== text) p.commitMove(before.all);
          }}
        />
      )}
      {selA && p.tool === null && !editA && (() => {
        const b = bbox(selA);
        const pad = 6;
        let L = b.x * scale - pad;
        let T = b.y * scale - pad;
        let W = b.w * scale + pad * 2;
        let HH = b.h * scale + pad * 2;
        if (W < 44) {
          L -= (44 - W) / 2;
          W = 44;
        }
        if (HH < 44) {
          T -= (44 - HH) / 2;
          HH = 44;
        }
        return (
          <div
            data-selection
            className="absolute rounded-md border-2 border-dashed border-blue-600 bg-blue-500/5"
            style={{ left: L, top: T, width: W, height: HH, touchAction: 'none', cursor: 'move' }}
            onPointerDown={(e) => startGesture(e, false, selA)}
          >
            {selA.type !== 'note' && (
              <div
                aria-label="Cambiar tamaño"
                className="absolute -right-4 -bottom-4 size-8 rounded-full border-[3px] border-white bg-blue-600 shadow-lg"
                style={{ touchAction: 'none', cursor: 'nwse-resize' }}
                onPointerDown={(e) => startGesture(e, true, selA)}
              />
            )}
          </div>
        );
      })()}
      {/* campos de formulario */}
      {p.fields.map((f, i) => {
        const [x, y, w, h] = f.rect.map((v) => v * scale);
        const st: React.CSSProperties = { left: x, top: y, width: w, height: h, fontSize: Math.max(10, Math.min(h * 0.65, 18)) };
        const cls = 'absolute rounded-sm border border-blue-400 bg-blue-50/80 px-1 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500';
        if (f.type === 'text')
          return f.multiline ? (
            <textarea key={i} aria-label={f.name} disabled={f.readOnly} className={cls + ' resize-none'} style={st} value={String(p.values[f.name] ?? '')} onChange={(e) => p.setValue(f.name, e.target.value)} />
          ) : (
            <input key={i} aria-label={f.name} disabled={f.readOnly} className={cls} style={st} value={String(p.values[f.name] ?? '')} onChange={(e) => p.setValue(f.name, e.target.value)} />
          );
        if (f.type === 'checkbox')
          return <input key={i} type="checkbox" aria-label={f.name} disabled={f.readOnly} className="absolute accent-blue-600" style={{ left: x, top: y, width: w, height: h }} checked={!!p.values[f.name]} onChange={(e) => p.setValue(f.name, e.target.checked)} />;
        if (f.type === 'radio')
          return <input key={i} type="radio" aria-label={`${f.name} ${f.exportValue}`} disabled={f.readOnly} className="absolute accent-blue-600" style={{ left: x, top: y, width: w, height: h }} checked={p.values[f.name] === f.exportValue} onChange={() => p.setValue(f.name, f.exportValue || '')} />;
        return (
          <select key={i} aria-label={f.name} disabled={f.readOnly} className={cls} style={st} value={String(p.values[f.name] ?? '')} onChange={(e) => p.setValue(f.name, e.target.value)}>
            <option value=""></option>
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      })}
    </div>
  );
}


function AnnotShape({ a, marker, hidden }: { a: Annot; marker: string; hidden?: boolean }) {
  switch (a.type) {
    case 'ink': {
      const pts = a.pts.map((q) => `${q.x},${q.y}`).join(' ');
      return (
        <g data-id={a.id} style={{ mixBlendMode: a.opacity < 1 ? 'multiply' : undefined }}>
          <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(14, a.width + 10)} strokeLinecap="round" />
          <polyline points={pts} fill="none" stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    }
    case 'highlight':
      return <rect data-id={a.id} x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color} fillOpacity={0.4} style={{ mixBlendMode: 'multiply' }} />;
    case 'whiteout':
      return a.cover ? (
        <rect data-id={a.id} x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color || '#fff'} />
      ) : (
        <rect data-id={a.id} x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color || '#fff'} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="2 2" />
      );
    case 'rect':
      return <rect data-id={a.id} x={a.x} y={a.y} width={a.w} height={a.h} fill="transparent" stroke={a.color} strokeWidth={a.width || 2} />;
    case 'line':
    case 'arrow':
      return (
        <g data-id={a.id}>
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={14} />
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" markerEnd={a.type === 'arrow' ? marker : undefined} />
        </g>
      );
    case 'text':
      return (
        <text
          data-id={a.id}
          x={a.x}
          y={a.y}
          fill={a.color}
          fontSize={a.size}
          fontFamily={fontCss(a)}
          fontWeight={a.weight ?? (a.bold ? 700 : 400)}
          fontStyle={a.italic ? 'italic' : undefined}
          transform={a.sx && a.sx !== 1 ? `translate(${a.x} 0) scale(${a.sx} 1) translate(${-a.x} 0)` : undefined}
          style={{ userSelect: 'none' }}
          opacity={hidden ? 0 : 1}
        >
          {a.text.split('\n').map((l, i) => (
            <tspan key={i} x={a.x} dy={i === 0 ? a.size * 0.92 : a.size * 1.25}>
              {l || ' '}
            </tspan>
          ))}
        </text>
      );
    case 'note':
      return (
        <g data-id={a.id}>
          <rect x={a.x} y={a.y} width={20} height={20} rx={3} fill={a.color} stroke="#854d0e" strokeWidth={0.8} />
          <path d={`M${a.x + 5},${a.y + 7} h10 M${a.x + 5},${a.y + 11} h10 M${a.x + 5},${a.y + 15} h6`} stroke="#854d0e" strokeWidth={1.2} />
          <title>{a.text}</title>
        </g>
      );
    case 'image':
      return <image data-id={a.id} href={a.src} x={a.x} y={a.y} width={a.w} height={a.h} preserveAspectRatio="none" />;
  }
}

function MenuRow({ icon, label, onClick, checked }: { icon: React.ReactNode; label: string; onClick: () => void; checked?: boolean }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left font-semibold hover:bg-surface-2">
      <span className="text-soft [&>svg]:size-5">{icon}</span>
      <span className="flex-1">{label}</span>
      {checked && <Check className="size-5 text-primary" />}
    </button>
  );
}

/** Vista general de las páginas (miniaturas) para saltar a cualquiera. */
function PagesPanel({ pdf, current, onPick, onClose }: { pdf: PDFDocumentProxy; current: number; onPick: (i: number) => void; onClose: () => void }) {
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

/** Modo presentación: una página a pantalla completa, se pasa con flechas, toques o deslizando. */
function Presenter({ pdf, start, onClose }: { pdf: PDFDocumentProxy; start: number; onClose: (page: number) => void }) {
  const [i, setI] = useState(start);
  const cv = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const go = (d: number) => setI((v) => Math.max(0, Math.min(pdf.numPages - 1, v + d)));
  useEffect(() => {
    box.current?.requestFullscreen?.().catch(() => {});
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') go(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      if (e.key === 'Escape') close();
    };
    const fs = () => {
      if (!document.fullscreenElement) onCloseRef.current();
    };
    window.addEventListener('keydown', k);
    document.addEventListener('fullscreenchange', fs);
    return () => {
      window.removeEventListener('keydown', k);
      document.removeEventListener('fullscreenchange', fs);
    };
  }, []);
  const iRef = useRef(i);
  iRef.current = i;
  const onCloseRef = useRef(() => onClose(iRef.current));
  onCloseRef.current = () => onClose(iRef.current);
  function close() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    onCloseRef.current();
  }
  useEffect(() => {
    let live = true;
    (async () => {
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const W = window.innerWidth, H = window.innerHeight;
      const s = Math.min(W / vp.width, H / vp.height) * Math.min(2, devicePixelRatio || 1);
      if (!live || !cv.current) return;
      await renderPage(page, s, cv.current);
    })();
    return () => {
      live = false;
    };
  }, [i]);
  return (
    <div
      ref={box}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black"
      onClick={(e) => go(e.clientX > window.innerWidth / 2 ? 1 : -1)}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const s = touchX.current;
        touchX.current = null;
        if (s === null) return;
        const dx = e.changedTouches[0].clientX - s;
        if (Math.abs(dx) > 50) {
          e.preventDefault();
          go(dx < 0 ? 1 : -1);
        }
      }}
    >
      <canvas ref={cv} className="max-h-full max-w-full object-contain" style={{ width: 'auto', height: 'auto', maxHeight: '100dvh' }} />
      <div className="safe-top absolute inset-x-0 top-0 flex items-center justify-between p-3 opacity-80">
        <button
          aria-label="Salir de la presentación"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          className="flex size-11 items-center justify-center rounded-full bg-white/15 text-white"
        >
          <X className="size-6" />
        </button>
        <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-bold text-white tabular-nums">
          {i + 1} / {pdf.numPages}
        </span>
      </div>
      <div className="safe-bottom absolute inset-x-0 bottom-0 flex justify-center gap-3 p-3 opacity-70">
        <button aria-label="Página anterior" onClick={(e) => { e.stopPropagation(); go(-1); }} className="flex size-11 items-center justify-center rounded-full bg-white/15 text-white">
          <ChevronLeft className="size-6" />
        </button>
        <button aria-label="Página siguiente" onClick={(e) => { e.stopPropagation(); go(1); }} className="flex size-11 items-center justify-center rounded-full bg-white/15 text-white">
          <ChevronRight className="size-6" />
        </button>
      </div>
    </div>
  );
}

/** Propiedades del documento (metadatos del PDF). */
function DocProps({ open, onClose, pdf, doc, size }: { open: boolean; onClose: () => void; pdf: PDFDocumentProxy; doc: DocMeta; size: number }) {
  const [rows, setRows] = useState<[string, string][]>([]);
  useEffect(() => {
    if (!open) return;
    (async () => {
      const md: any = await pdf.getMetadata().catch(() => ({}));
      const info = md?.info || {};
      const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
      const mm = (pt: number) => Math.round((pt / 72) * 25.4);
      const named = (w: number, h: number) => {
        const [a, b] = [Math.min(w, h), Math.max(w, h)];
        if (Math.abs(a - 210) < 3 && Math.abs(b - 297) < 3) return ' (A4)';
        if (Math.abs(a - 216) < 3 && Math.abs(b - 279) < 3) return ' (Carta)';
        if (Math.abs(a - 216) < 3 && Math.abs(b - 356) < 3) return ' (Oficio)';
        return '';
      };
      const date = (s?: string) => {
        const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(s || '');
        if (!m) return '';
        const parts = [+m[1], +(m[2] || 1) - 1, +(m[3] || 1), +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)] as const;
        let d: Date;
        if (m[7]) {
          // Fecha con zona horaria (Z = UTC, o +HH'mm / -HH'mm)
          const off = m[7] === 'Z' ? 0 : (m[7] === '-' ? -1 : 1) * ((+(m[8] || 0)) * 60 + +(m[9] || 0));
          d = new Date(Date.UTC(...parts) - off * 60000);
        } else d = new Date(...parts);
        return d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
      };
      const w = mm(vp.width), h = mm(vp.height);
      const out: [string, string][] = [
        ['Nombre', doc.name],
        ['Título', info.Title || ''],
        ['Autor', info.Author || ''],
        ['Asunto', info.Subject || ''],
        ['Palabras clave', info.Keywords || ''],
        ['Creado con', info.Creator || ''],
        ['Generado por', info.Producer || ''],
        ['Fecha de creación', date(info.CreationDate)],
        ['Última modificación', date(info.ModDate)],
        ['Páginas', String(pdf.numPages)],
        ['Tamaño de página', `${w} × ${h} mm${named(w, h)}`],
        ['Peso del archivo', formatBytes(size)],
        ['Versión de PDF', info.PDFFormatVersion || ''],
        ['Con contraseña', md?.info?.IsEncrypted || (pdf as any)._transport?.encrypted ? 'Sí' : 'No'],
      ];
      setRows(out.filter(([, v]) => v));
    })();
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Propiedades del documento">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-bold text-soft">{k}</dt>
            <dd className="font-semibold break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

/** Cuadro para escribir sobre la página: el texto cambia en el PDF mientras se escribe. */
function LiveText({ a, scale, onChange, onDone }: { a: Annot & { type: 'text' }; scale: number; onChange: (t: string) => void; onDone: (t: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [val, setVal] = useState(a.text);
  const font = `${a.italic ? 'italic ' : ''}${a.weight ?? (a.bold ? 700 : 400)} ${a.size * scale}px ${fontCss(a)}`;
  const sx = a.sx && a.sx !== 1 ? a.sx : 1;
  // ancho según el texto escrito (se mide con la misma letra)
  const measure = (t: string) => {
    const c = (LiveText as any)._c || ((LiveText as any)._c = document.createElement('canvas').getContext('2d'));
    c.font = font;
    return Math.max(...t.split('\n').map((l) => c.measureText(l || ' ').width));
  };
  const lines = val.split('\n').length;
  const w = Math.max(a.size * scale * 3, measure(val) + a.size * scale * 1.2);
  const h = lines * a.size * scale * 1.25 + 6;
  useEffect(() => {
    // Por si no se enfocó en el mismo toque (computador)
    const t = setTimeout(() => {
      if (document.activeElement !== ref.current) ref.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <textarea
      ref={ref}
      data-edit={a.id}
      value={val}
      spellCheck={false}
      autoCapitalize="sentences"
      placeholder="Escribe aquí"
      onChange={(e) => {
        setVal(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => onDone(val)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
      }}
      className="absolute z-10 resize-none overflow-hidden rounded-sm bg-white/40 p-0 outline-2 outline-offset-2 outline-blue-500 outline-dashed placeholder:text-slate-400"
      style={{
        left: a.x * scale,
        top: a.y * scale - 1,
        width: w,
        height: h,
        font,
        lineHeight: 1.25,
        transform: sx !== 1 ? `scaleX(${sx})` : undefined,
        transformOrigin: 'left top',
        color: a.color,
        border: 'none',
      }}
    />
  );
}
