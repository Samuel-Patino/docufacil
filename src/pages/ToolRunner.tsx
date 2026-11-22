import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FolderOpen, Smartphone, X, Play, Save, Share2, Download, CheckCircle2, ArrowUp, ArrowDown, FileType2, Copy, Replace, Eye, Image as ImageIcon } from 'lucide-react';
import { toolById, TOOL_ALIAS } from '../lib/tools';
import { TopBar, Button, Card, Field, inputCls, Segmented, Toggle, Slider, IconButton, Empty, ColorDots } from '../components/ui';
import { LibraryPicker } from '../components/LibraryPicker';
import { PageSelect, PageOrganizer, PageThumb, type OrgPage } from '../components/PageGrid';
import { getDoc, getDocBlob, addDoc, updateDocBlob, kindOf, importFiles } from '../lib/library';
import type { DocMeta } from '../lib/db';
import { pickFiles, ACCEPT, shareFiles, downloadBlob, copyText } from '../lib/share';
import { openWithPassword } from '../lib/pdfAccess';
import { renderPage, pdfPlainText, closePdf, pageLines, type PDFDocumentProxy } from '../lib/pdf';
import * as ops from '../lib/pdfops';
import * as conv from '../lib/convert';
import { ocrImage, OCR_LANGS, type OcrResult } from '../lib/ocr';
import { useApp, toast, withBusy, errMsg } from '../lib/store';
import { baseName, extOf, formatBytes, parseRanges, bytesToBlob, uid } from '../lib/util';
import { openFromDevice } from '../lib/device';

interface Input {
  key: string;
  name: string;
  blob: Blob;
  docId?: string;
  folderId?: string | null;
  password?: string;
}
interface Output {
  name: string;
  blob: Blob;
  savedId?: string;
}

const IN_PLACE = new Set(['rotate', 'crop', 'compress', 'numbers', 'watermark', 'organize', 'protect', 'unlock', 'ocrpdf']);

export default function ToolRunner() {
  const { toolId = '' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const tool = toolById(TOOL_ALIAS[toolId] || toolId);
  const prefs = useApp((s) => s.prefs);
  const [inputs, setInputs] = useState<Input[]>([]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [outputs, setOutputs] = useState<Output[] | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [opt, setOptState] = useState<any>(() => defaults(tool?.id || ''));
  const setOpt = (p: any) => setOptState((o: any) => ({ ...o, ...p }));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [org, setOrg] = useState<OrgPage[]>([]);

  const isPdfTool = tool?.input === 'pdf';
  const first = inputs[0];

  // documentos preseleccionados (?doc= / ?docs=)
  useEffect(() => {
    const ids = (params.get('docs') || params.get('doc') || '').split(',').filter(Boolean);
    if (!ids.length) return;
    (async () => {
      for (const id of ids) {
        const m = await getDoc(id);
        if (m) await addFromDoc(m);
      }
    })();
  }, []);

  // herramientas que abren otra pantalla directamente
  useEffect(() => {
    if (tool?.id === 'editpdf') {
      openFromDevice('pdf').then((id) => (id ? nav('/edit/' + id, { replace: true }) : nav(-1)));
    }
  }, [tool?.id]);

  // abrir el PDF de la primera entrada (para miniaturas)
  useEffect(() => {
    if (!isPdfTool || !first || tool?.multiple) return;
    let live = true;
    (async () => {
      try {
        const r = await openWithPassword(first.docId || first.key, first.blob, `"${first.name}"`);
        if (!r) return setInputs([]);
        if (!live) return closePdf(r.pdf);
        setInputs((xs) => xs.map((x) => (x.key === first.key ? { ...x, password: r.password } : x)));
        setPdf(r.pdf);
        setSel(new Set());
        setOrg(Array.from({ length: r.pdf.numPages }, (_, i) => ({ key: 'p' + i, src: i, rot: 0 })));
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    })();
    return () => {
      live = false;
    };
  }, [first?.key]);

  useEffect(() => () => { pdf?.loadingTask.destroy(); }, [pdf]);

  if (!tool)
    return (
      <div>
        <TopBar title="Herramienta" back="/tools" />
        <Empty icon={<X className="size-9" />} title="Herramienta no encontrada" />
      </div>
    );

  async function addFromDoc(m: DocMeta) {
    const editRoute = { sign: 'sign', annotate: '', form: 'form' } as Record<string, string>;
    if (tool!.id in editRoute) return nav(`/edit/${m.id}${editRoute[tool!.id] ? '?tool=' + editRoute[tool!.id] : ''}`, { replace: true });
    try {
      const blob = await getDocBlob(m.id);
      addInputs([{ key: uid(), name: m.name, blob, docId: m.id, folderId: m.folderId }]);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  function addInputs(xs: Input[]) {
    setOutputs(null);
    setOcrText(null);
    setInputs((cur) => (tool!.multiple ? [...cur, ...xs] : xs.slice(0, 1)));
  }

  const accept = (() => {
    switch (tool.input) {
      case 'pdf':
        return tool.id === 'merge' ? ACCEPT.pdf + ',image/*' : ACCEPT.pdf;
      case 'image':
        return ACCEPT.images;
      case 'office':
        return (ACCEPT as any)[tool.accept || 'word'];
      default:
        return ACCEPT.any;
    }
  })();

  async function fromDevice() {
    const files = await pickFiles(accept, !!tool!.multiple);
    if (!files.length) return;
    if (['sign', 'annotate', 'form'].includes(tool!.id)) {
      const [d] = await importFiles(files.slice(0, 1));
      return nav(`/edit/${d.id}${tool!.id === 'annotate' ? '' : '?tool=' + tool!.id}`, { replace: true });
    }
    addInputs(files.map((f) => ({ key: uid(), name: f.name, blob: f })));
  }

  const kinds = tool.input === 'pdf' ? (tool.id === 'merge' ? (['pdf', 'image'] as const) : (['pdf'] as const)) : tool.input === 'image' ? (['image'] as const) : tool.input === 'office' ? (['office', 'text'] as const) : undefined;
  const exts = tool.input === 'office' ? { word: ['docx'], excel: ['xlsx', 'xls', 'csv', 'ods'], ppt: ['pptx'], text: ['txt', 'csv', 'md'] }[tool.accept || 'word'] : undefined;

  const pdfBytes = async (i: Input) => new Uint8Array(await i.blob.arrayBuffer());

  // ---------- ejecutar ----------
  async function run() {
    try {
      const outs = await withBusy('Procesando…', async (prog) => {
        const o: Output[] = [];
        const nm = (ext: string, suffix = '') => `${baseName(first?.name || 'documento')}${suffix}.${ext}`;
        switch (tool!.id) {
          case 'img2pdf': {
            if (opt.separate) {
              for (let i = 0; i < inputs.length; i++) {
                prog(i / inputs.length);
                const b = await ops.imagesToPdf([{ blob: inputs[i].blob }], { pageSize: opt.pageSize, margin: opt.margin });
                o.push({ name: baseName(inputs[i].name) + '.pdf', blob: bytesToBlob(b, 'application/pdf') });
              }
            } else {
              const b = await ops.imagesToPdf(inputs.map((x) => ({ blob: x.blob })), { pageSize: opt.pageSize, margin: opt.margin });
              o.push({ name: (inputs.length > 1 ? opt.name || 'Imágenes' : baseName(first.name)) + '.pdf', blob: bytesToBlob(b, 'application/pdf') });
            }
            break;
          }
          case 'word2pdf':
          case 'excel2pdf':
          case 'ppt2pdf':
          case 'txt2pdf': {
            for (let i = 0; i < inputs.length; i++) {
              const it = inputs[i];
              prog(i / inputs.length, `Convirtiendo ${it.name}…`);
              const e = extOf(it.name);
              let b: Blob;
              if (e === 'docx') b = await conv.docxToPdf(it.blob);
              else if (['xlsx', 'xls', 'csv', 'ods'].includes(e)) b = await conv.sheetToPdf(it.blob);
              else if (e === 'pptx') b = await conv.pptxToPdf(it.blob);
              else if (e === 'html' || e === 'htm') b = await conv.htmlToPdf(await it.blob.text(), it.name);
              else if (['doc', 'xls', 'ppt'].includes(e)) throw new Error(`El formato antiguo .${e} no se puede convertir sin conexión. Guárdalo como .${e}x e inténtalo de nuevo.`);
              else b = await conv.textToPdf(await it.blob.text());
              o.push({ name: baseName(it.name) + '.pdf', blob: b });
            }
            break;
          }
          case 'web2pdf': {
            let html = '', title = 'Página web';
            if (inputs[0]) {
              html = await inputs[0].blob.text();
              title = baseName(inputs[0].name);
            } else {
              if (!opt.url) throw new Error('Escribe la dirección de la página.');
              try {
                const r = await conv.fetchWebPage(opt.url);
                html = r.html;
                title = r.title;
              } catch {
                throw new Error('Esta página no permite descargarla desde otra app. Ábrela en tu navegador y usa Compartir → Imprimir → Guardar como PDF, o guárdala como .html y súbela aquí.');
              }
            }
            o.push({ name: title.slice(0, 80) + '.pdf', blob: await conv.htmlToPdf(html, title) });
            break;
          }
          case 'pdf2word':
            o.push({ name: nm('docx'), blob: await conv.pdfToDocx(await pdfBytes(first), { ocr: opt.ocr, lang: prefs.ocrLang, includeImages: opt.images, password: first.password }, prog) });
            break;
          case 'pdf2excel':
            o.push({ name: nm('xlsx'), blob: await conv.pdfToXlsx(await pdfBytes(first), { ocr: opt.ocr, lang: prefs.ocrLang, password: first.password }, prog) });
            break;
          case 'pdf2ppt':
            o.push({ name: nm('pptx'), blob: await conv.pdfToPptx(await pdfBytes(first), { mode: opt.pptMode, ocr: opt.ocr, lang: prefs.ocrLang, password: first.password }, prog) });
            break;
          case 'pdf2jpg': {
            const pages = sel.size ? [...sel].sort((a, b) => a - b) : undefined;
            const imgs = await conv.pdfToImages(await pdfBytes(first), opt.dpi, opt.format, first.password, prog, pages);
            imgs.forEach((b, i) => o.push({ name: `${baseName(first.name)} - ${(pages ? pages[i] : i) + 1}.${opt.format}`, blob: b }));
            break;
          }
          case 'extractimg': {
            const imgs = await conv.extractImages(await pdfBytes(first), first.password, prog);
            if (!imgs.length) throw new Error('Este PDF no tiene imágenes incrustadas. Usa “PDF a JPG” para guardar las páginas como imágenes.');
            imgs.forEach((b, i) => o.push({ name: `${baseName(first.name)} - imagen ${i + 1}.png`, blob: b }));
            break;
          }
          case 'pdf2txt': {
            let parts = await pdfPlainText(pdf!, (i) => prog(i / pdf!.numPages, `Página ${i} de ${pdf!.numPages}`));
            if (opt.ocr && parts.every((t) => !t.trim())) {
              parts = [];
              for (let i = 1; i <= pdf!.numPages; i++) {
                const c = await renderPage(await pdf!.getPage(i), 2.2);
                const r = await ocrImage(c, prefs.ocrLang, (p, st) => prog((i - 1 + p) / pdf!.numPages, `${st} (página ${i})`));
                parts.push(r.paragraphs.join('\n\n'));
              }
            }
            o.push({ name: nm('txt'), blob: new Blob([parts.join('\n\n\f\n\n')], { type: 'text/plain' }) });
            break;
          }
          case 'ocr': {
            const all: string[] = [];
            const res: OcrResult[] = [];
            for (let i = 0; i < inputs.length; i++) {
              const r = await ocrImage(inputs[i].blob, prefs.ocrLang, (p, st) => prog((i + p) / inputs.length, `${st} (${i + 1} de ${inputs.length})`));
              res.push(r);
              all.push(r.paragraphs.join('\n\n'));
            }
            setOcrText(all.join('\n\n———\n\n'));
            break;
          }
          case 'ocrpdf': {
            const layers = new Map<number, OcrResult>();
            for (let i = 1; i <= pdf!.numPages; i++) {
              const page = await pdf!.getPage(i);
              const { lines } = await pageLines(page);
              if (lines.length > 2) continue; // ya tiene texto
              const c = await renderPage(page, 2.4);
              layers.set(i - 1, await ocrImage(c, prefs.ocrLang, (p, st) => prog((i - 1 + p) / pdf!.numPages, `${st} (página ${i} de ${pdf!.numPages})`)));
            }
            if (!layers.size) throw new Error('Este PDF ya tiene texto buscable.');
            const b = await ops.addOcrLayers(await pdfBytes(first), layers, first.password);
            o.push({ name: first.name, blob: bytesToBlob(b, 'application/pdf') });
            break;
          }
          case 'merge': {
            const files: { bytes: Uint8Array; password?: string }[] = [];
            for (const it of inputs) {
              if (kindOf(it.name, it.blob.type) === 'image') files.push({ bytes: await ops.imagesToPdf([{ blob: it.blob }], { pageSize: 'a4' }) });
              else {
                const r = await openWithPassword(it.docId || it.key, it.blob, `"${it.name}"`);
                if (!r) throw new Error('Se canceló la contraseña de ' + it.name);
                closePdf(r.pdf);
                files.push({ bytes: await pdfBytes(it), password: r.password });
              }
            }
            const b = await ops.mergePdfs(files);
            o.push({ name: (opt.name || 'Documentos unidos') + '.pdf', blob: bytesToBlob(b, 'application/pdf') });
            break;
          }
          case 'split': {
            const n = pdf!.numPages;
            let groups: number[][];
            if (opt.splitMode === 'each') groups = Array.from({ length: n }, (_, i) => [i]);
            else if (opt.splitMode === 'every') {
              const k = Math.max(1, opt.every | 0);
              groups = [];
              for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j));
            } else {
              const g = parseRanges(opt.ranges, n);
              if (!g) throw new Error(`Rangos no válidos. Ejemplo: 1-3, 4, 5-${n}`);
              groups = g;
            }
            const parts = await ops.splitPdf(await pdfBytes(first), groups, first.password);
            parts.forEach((b, i) => {
              const g = groups[i];
              const label = g.length === 1 ? `pág ${g[0] + 1}` : `págs ${g[0] + 1}-${g[g.length - 1] + 1}`;
              o.push({ name: `${baseName(first.name)} (${label}).pdf`, blob: bytesToBlob(b, 'application/pdf') });
            });
            break;
          }
          case 'extract': {
            const idx = [...sel].sort((a, b) => a - b);
            if (!idx.length) throw new Error('Elige al menos una página.');
            if (opt.separate) {
              for (const i of idx) o.push({ name: `${baseName(first.name)} (pág ${i + 1}).pdf`, blob: bytesToBlob(await ops.pickPages(await pdfBytes(first), [i], first.password), 'application/pdf') });
            } else o.push({ name: nm('pdf', ' (extracto)'), blob: bytesToBlob(await ops.pickPages(await pdfBytes(first), idx, first.password), 'application/pdf') });
            break;
          }
          case 'organize': {
            if (!org.length) throw new Error('El documento debe tener al menos una página.');
            const rot: Record<number, number> = {};
            org.forEach((p, i) => p.rot && (rot[i] = p.rot));
            o.push({ name: first.name, blob: bytesToBlob(await ops.pickPages(await pdfBytes(first), org.map((p) => p.src), first.password, rot), 'application/pdf') });
            break;
          }
          case 'rotate': {
            const idx = sel.size ? [...sel] : Array.from({ length: pdf!.numPages }, (_, i) => i);
            o.push({ name: first.name, blob: bytesToBlob(await ops.rotatePages(await pdfBytes(first), idx, opt.angle, first.password), 'application/pdf') });
            break;
          }
          case 'crop': {
            const crops = new Map<number, ops.Margins>();
            const m = opt.margins as ops.Margins;
            const targets = opt.cropApply === 'all' ? Array.from({ length: pdf!.numPages }, (_, i) => i) : opt.cropApply === 'selected' ? [...sel] : [];
            if (opt.cropApply === 'selected' && !sel.size) throw new Error('Elige las páginas a recortar.');
            targets.forEach((i: number) => crops.set(i, m));
            // márgenes distintos guardados por página
            Object.entries(opt.perPage || {}).forEach(([k, v]) => crops.set(Number(k), v as ops.Margins));
            o.push({ name: first.name, blob: bytesToBlob(await ops.cropPages(await pdfBytes(first), crops, first.password), 'application/pdf') });
            break;
          }
          case 'compress': {
            const before = first.blob.size;
            const b = await ops.compressPdf(await pdfBytes(first), opt.level, first.password, (p) => prog(p, 'Comprimiendo imágenes…'));
            if (b.length >= before) toast('El PDF ya estaba optimizado; no se pudo reducir más.', 'info', 4500);
            o.push({ name: first.name, blob: bytesToBlob(b.length < before ? b : await pdfBytes(first), 'application/pdf') });
            break;
          }
          case 'numbers': {
            const n = pdf!.numPages;
            let pages = Array.from({ length: n }, (_, i) => i);
            if (opt.skipFirst) pages = pages.slice(1);
            const b = await ops.addPageNumbers(await pdfBytes(first), { position: opt.position, format: opt.format, start: opt.start, fontSize: opt.fontSize, color: opt.color, margin: opt.margin, pages, bold: opt.bold }, first.password);
            o.push({ name: first.name, blob: bytesToBlob(b, 'application/pdf') });
            break;
          }
          case 'watermark': {
            if (opt.wmKind === 'text' && !opt.text.trim()) throw new Error('Escribe el texto de la marca de agua.');
            if (opt.wmKind === 'image' && !opt.image) throw new Error('Elige una imagen.');
            const pages = sel.size ? [...sel] : Array.from({ length: pdf!.numPages }, (_, i) => i);
            const b = await ops.addWatermark(
              await pdfBytes(first),
              { kind: opt.wmKind, text: opt.text, image: opt.image, fontSize: opt.wmSize, color: opt.wmColor, opacity: opt.opacity / 100, angle: opt.wmAngle, layout: opt.layout, scale: opt.wmScale / 100, pages },
              first.password,
            );
            o.push({ name: first.name, blob: bytesToBlob(b, 'application/pdf') });
            break;
          }
          case 'protect': {
            if (opt.pw.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
            if (opt.pw !== opt.pw2) throw new Error('Las contraseñas no coinciden.');
            const b = await ops.protectPdf(await pdfBytes(first), opt.pw, { print: opt.allowPrint, copy: opt.allowCopy, modify: opt.allowModify }, first.password);
            o.push({ name: first.name, blob: bytesToBlob(b, 'application/pdf') });
            break;
          }
          case 'unlock': {
            if (!first.password) throw new Error('Este PDF no tiene contraseña.');
            const b = await ops.unprotectPdf(await pdfBytes(first), first.password);
            o.push({ name: first.name, blob: bytesToBlob(b, 'application/pdf') });
            break;
          }
        }
        return o;
      });
      if (tool!.id !== 'ocr') setOutputs(outs);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  // ---------- guardar resultados ----------
  async function saveAll() {
    if (!outputs) return;
    try {
      const saved = await withBusy('Guardando…', async () => {
        const list: Output[] = [];
        for (const o of outputs) {
          if (o.savedId) {
            list.push(o);
            continue;
          }
          const m = await addDoc({ name: o.name, blob: o.blob, folderId: first?.folderId ?? null });
          list.push({ ...o, savedId: m.id });
        }
        return list;
      });
      setOutputs(saved);
      toast(saved.length === 1 ? 'Guardado en mis documentos' : `${saved.length} archivos guardados`, 'ok');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  async function replaceOriginal() {
    if (!outputs?.[0] || !first?.docId) return;
    try {
      await withBusy('Guardando…', () => updateDocBlob(first.docId!, outputs[0].blob));
      toast('Documento actualizado', 'ok');
      nav('/doc/' + first.docId, { replace: true });
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  async function downloadAll() {
    if (!outputs) return;
    if (outputs.length > 3) {
      const JSZip = (await import('jszip')).default;
      const z = new JSZip();
      outputs.forEach((o) => z.file(o.name, o.blob));
      downloadBlob(await z.generateAsync({ type: 'blob' }), baseName(first?.name || 'archivos') + '.zip');
    } else outputs.forEach((o) => downloadBlob(o.blob, o.name));
  }

  const canRun = (() => {
    if (tool.id === 'web2pdf') return !!opt.url || inputs.length > 0;
    if (!inputs.length) return false;
    if (isPdfTool && !tool.multiple && !pdf) return false;
    if (tool.id === 'merge') return inputs.length >= 2;
    if (tool.id === 'extract') return sel.size > 0;
    return true;
  })();

  const showInputs = tool.input !== 'none' || tool.id === 'web2pdf';

  return (
    <div className="min-h-dvh pb-32">
      <TopBar title={tool.title} sub={tool.desc} back />
      <div className="mx-auto max-w-4xl px-4 pt-4">
        {/* Paso 1: archivos */}
        {showInputs && !outputs && ocrText === null && (
          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-lg font-extrabold">{tool.multiple ? '1. Elige los archivos' : '1. Elige el archivo'}</h2>
            {inputs.length > 0 && (
              <ul className="mb-3 flex flex-col gap-2">
                {inputs.map((it, i) => (
                  <li key={it.key} className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2">
                    <FileType2 className="size-5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{it.name}</span>
                    <span className="text-sm text-soft">{formatBytes(it.blob.size)}</span>
                    {tool.multiple && (
                      <>
                        <IconButton label="Subir" className="size-9" disabled={i === 0} onClick={() => setInputs((xs) => swap(xs, i, i - 1))}>
                          <ArrowUp className="size-4" />
                        </IconButton>
                        <IconButton label="Bajar" className="size-9" disabled={i === inputs.length - 1} onClick={() => setInputs((xs) => swap(xs, i, i + 1))}>
                          <ArrowDown className="size-4" />
                        </IconButton>
                      </>
                    )}
                    <IconButton
                      label="Quitar"
                      className="size-9"
                      onClick={() => {
                        setInputs((xs) => xs.filter((x) => x.key !== it.key));
                        if (!tool.multiple) setPdf(null);
                      }}
                    >
                      <X className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            {(tool.multiple || !inputs.length) && (
              <div className="flex flex-wrap gap-2">
                <Button variant="soft" icon={<FolderOpen className="size-5" />} onClick={() => setPickerOpen(true)}>
                  Mis documentos
                </Button>
                <Button variant="secondary" icon={<Smartphone className="size-5" />} onClick={fromDevice}>
                  Del dispositivo
                </Button>
              </div>
            )}
            {tool.id === 'web2pdf' && !inputs.length && (
              <div className="mt-4">
                <Field label="O escribe la dirección de la página" hint="Funciona con sitios que permiten la descarga. Si no, guarda la página como .html y súbela.">
                  <input className={inputCls} inputMode="url" placeholder="https://ejemplo.com/articulo" value={opt.url} onChange={(e) => setOpt({ url: e.target.value })} />
                </Field>
              </div>
            )}
          </Card>
        )}

        {/* Paso 2: opciones */}
        {!outputs && ocrText === null && (canRun || (isPdfTool && pdf)) && (
          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-lg font-extrabold">2. Opciones</h2>
            <Options tool={tool.id} opt={opt} setOpt={setOpt} pdf={pdf} sel={sel} setSel={setSel} org={org} setOrg={setOrg} inputs={inputs} />
          </Card>
        )}

        {/* Resultado OCR */}
        {ocrText !== null && (
          <Card className="mb-4 p-4">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-extrabold">
              <CheckCircle2 className="size-6 text-ok" /> Texto reconocido
            </h2>
            <p className="mb-2 text-sm text-soft">Puedes corregirlo antes de copiarlo o guardarlo.</p>
            <textarea className={inputCls + ' h-80 py-3 leading-relaxed'} value={ocrText} onChange={(e) => setOcrText(e.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon={<Copy className="size-5" />} onClick={() => copyText(ocrText)}>
                Copiar
              </Button>
              <Button
                variant="secondary"
                icon={<Save className="size-5" />}
                onClick={async () => {
                  await addDoc({ name: baseName(first.name) + ' (texto).txt', blob: new Blob([ocrText], { type: 'text/plain' }), folderId: first.folderId ?? null });
                  toast('Guardado como TXT', 'ok');
                }}
              >
                Guardar TXT
              </Button>
              <Button
                variant="secondary"
                icon={<FileType2 className="size-5" />}
                onClick={async () => {
                  const b = await conv.textToDocx([ocrText.split(/\n{2,}/)]);
                  await addDoc({ name: baseName(first.name) + ' (texto).docx', blob: b, folderId: first.folderId ?? null });
                  toast('Guardado como Word', 'ok');
                }}
              >
                Guardar Word
              </Button>
              <Button variant="ghost" onClick={() => { setOcrText(null); setInputs([]); }}>
                Otra imagen
              </Button>
            </div>
          </Card>
        )}

        {/* Resultados */}
        {outputs && (
          <Card className="mb-4 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold">
              <CheckCircle2 className="size-6 text-ok" /> ¡Listo!
            </h2>
            {tool.id === 'compress' && first && outputs[0] && (
              <p className="mb-3 rounded-2xl bg-ok-soft p-3 font-bold text-ok">
                {formatBytes(first.blob.size)} → {formatBytes(outputs[0].blob.size)} ({Math.max(0, Math.round((1 - outputs[0].blob.size / first.blob.size) * 100))}% menos)
              </p>
            )}
            <ul className="mb-4 flex max-h-80 flex-col gap-2 overflow-auto">
              {outputs.map((o, i) => (
                <li key={i} className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2">
                  {o.blob.type.startsWith('image/') ? <ImageIcon className="size-5 shrink-0 text-purple-500" /> : <FileType2 className="size-5 shrink-0 text-primary" />}
                  <span className="min-w-0 flex-1 truncate font-semibold">{o.name}</span>
                  <span className="text-sm text-soft">{formatBytes(o.blob.size)}</span>
                  {o.savedId && (
                    <IconButton label="Abrir" className="size-9" onClick={() => nav('/doc/' + o.savedId)}>
                      <Eye className="size-4" />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {IN_PLACE.has(tool.id) && first?.docId && outputs.length === 1 && (
                <Button icon={<Replace className="size-5" />} onClick={replaceOriginal}>
                  Reemplazar el original
                </Button>
              )}
              <Button variant={IN_PLACE.has(tool.id) && first?.docId ? 'secondary' : 'primary'} icon={<Save className="size-5" />} onClick={saveAll} disabled={outputs.every((o) => o.savedId)}>
                {outputs.every((o) => o.savedId) ? 'Guardado' : IN_PLACE.has(tool.id) && first?.docId ? 'Guardar como nuevo' : 'Guardar en mis documentos'}
              </Button>
              <Button variant="secondary" icon={<Share2 className="size-5" />} onClick={() => shareFiles(outputs.map((o) => new File([o.blob], o.name, { type: o.blob.type })))}>
                Compartir
              </Button>
              <Button variant="secondary" icon={<Download className="size-5" />} onClick={downloadAll}>
                {outputs.length > 3 ? 'Descargar ZIP' : 'Descargar'}
              </Button>
              {outputs.length === 1 && outputs[0].savedId && (
                <Button variant="ghost" icon={<Eye className="size-5" />} onClick={() => nav('/doc/' + outputs[0].savedId)}>
                  Abrir
                </Button>
              )}
            </div>
            <Button variant="ghost" className="mt-3" onClick={() => { setOutputs(null); }}>
              Volver a las opciones
            </Button>
          </Card>
        )}
      </div>

      {!outputs && ocrText === null && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto max-w-4xl px-4 py-3">
            <Button className="w-full" size="lg" icon={<Play className="size-6" />} disabled={!canRun} onClick={run}>
              {runLabel(tool.id)}
            </Button>
          </div>
        </div>
      )}

      <LibraryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        kinds={kinds as any}
        exts={exts}
        multiple={!!tool.multiple}
        onPick={async (docs) => {
          for (const d of docs) await addFromDoc(d);
        }}
      />
    </div>
  );
}

function swap<T>(a: T[], i: number, j: number) {
  const n = [...a];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

function runLabel(id: string) {
  if (id.includes('2')) return 'Convertir';
  return (
    {
      merge: 'Unir', split: 'Dividir', extract: 'Extraer', organize: 'Aplicar cambios', rotate: 'Rotar', crop: 'Recortar', compress: 'Comprimir',
      numbers: 'Numerar', watermark: 'Agregar marca de agua', protect: 'Proteger', unlock: 'Quitar contraseña', ocr: 'Reconocer texto', ocrpdf: 'Hacer buscable', extractimg: 'Extraer imágenes',
    } as Record<string, string>
  )[id] || 'Aplicar';
}

function defaults(id: string): any {
  return {
    pageSize: 'a4', margin: 18, separate: false, name: '',
    ocr: true, images: true, pptMode: 'text', dpi: 150, format: 'jpg',
    splitMode: 'each', every: 2, ranges: '',
    angle: 90,
    margins: { left: 0.05, top: 0.05, right: 0.05, bottom: 0.05 }, cropApply: 'all', cropPage: 0, perPage: {},
    level: 'medium',
    position: 'bc', format_: 'n', start: 1, fontSize: 11, color: '#334155', bold: false, skipFirst: false,
    wmKind: 'text', text: 'CONFIDENCIAL', image: null, wmSize: 54, wmColor: '#ef4444', opacity: 25, wmAngle: 45, layout: 'center', wmScale: 40,
    pw: '', pw2: '', allowPrint: true, allowCopy: true, allowModify: true,
    url: '',
    ...(id === 'numbers' ? { format: 'Página n de N' } : {}),
  };
}

// ---------- opciones por herramienta ----------

function Options({ tool, opt, setOpt, pdf, sel, setSel, org, setOrg, inputs }: any) {
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const langSelect = (
    <Field label="Idioma del texto (para OCR)">
      <select className={inputCls} value={prefs.ocrLang} onChange={(e) => setPrefs({ ocrLang: e.target.value })}>
        {OCR_LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </Field>
  );
  switch (tool) {
    case 'img2pdf':
      return (
        <>
          <Field label="Tamaño de página">
            <Segmented value={opt.pageSize} onChange={(v) => setOpt({ pageSize: v })} options={[{ value: 'fit', label: 'Igual a la imagen' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }]} />
          </Field>
          {opt.pageSize !== 'fit' && <Slider label="Margen" value={opt.margin} min={0} max={60} onChange={(v) => setOpt({ margin: v })} suffix=" pt" />}
          {inputs.length > 1 && <Toggle checked={opt.separate} onChange={(v) => setOpt({ separate: v })} label="Un PDF por cada imagen" hint="Si está apagado, todas las imágenes van en un solo PDF." />}
          {inputs.length > 1 && !opt.separate && (
            <Field label="Nombre del PDF">
              <input className={inputCls} placeholder="Imágenes" value={opt.name} onChange={(e) => setOpt({ name: e.target.value })} />
            </Field>
          )}
        </>
      );
    case 'merge':
      return (
        <>
          <p className="mb-2 text-soft">Ordena los archivos con las flechas. Las imágenes se agregan como páginas.</p>
          <Field label="Nombre del PDF final">
            <input className={inputCls} placeholder="Documentos unidos" value={opt.name} onChange={(e) => setOpt({ name: e.target.value })} />
          </Field>
        </>
      );
    case 'pdf2word':
      return (
        <>
          <Toggle checked={opt.ocr} onChange={(v) => setOpt({ ocr: v })} label="Reconocer texto en páginas escaneadas" />
          <Toggle checked={opt.images} onChange={(v) => setOpt({ images: v })} label="Incluir la imagen de las páginas escaneadas" />
          {opt.ocr && langSelect}
          <p className="mt-2 text-sm text-soft">El texto queda editable. Diseños complejos pueden cambiar un poco.</p>
        </>
      );
    case 'pdf2excel':
      return (
        <>
          <Toggle checked={opt.ocr} onChange={(v) => setOpt({ ocr: v })} label="Reconocer texto en páginas escaneadas" />
          {opt.ocr && langSelect}
          <p className="mt-2 text-sm text-soft">Cada página se convierte en una hoja. Las columnas se detectan por la posición del texto.</p>
        </>
      );
    case 'pdf2ppt':
      return (
        <>
          <Field label="Tipo de diapositivas">
            <Segmented value={opt.pptMode} onChange={(v) => setOpt({ pptMode: v })} options={[{ value: 'text', label: 'Texto editable' }, { value: 'image', label: 'Imagen exacta' }]} />
          </Field>
          {opt.pptMode === 'text' && <Toggle checked={opt.ocr} onChange={(v) => setOpt({ ocr: v })} label="Reconocer texto en páginas escaneadas" />}
        </>
      );
    case 'pdf2jpg':
      return (
        <>
          <Field label="Calidad">
            <Segmented value={String(opt.dpi)} onChange={(v) => setOpt({ dpi: Number(v) })} options={[{ value: '100', label: 'Baja' }, { value: '150', label: 'Media' }, { value: '220', label: 'Alta' }, { value: '300', label: 'Máxima' }]} />
          </Field>
          <Field label="Formato">
            <Segmented value={opt.format} onChange={(v) => setOpt({ format: v })} options={[{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
          </Field>
          {pdf && (
            <Field label="Páginas (si no eliges ninguna, se convierten todas)">
              <PageSelect pdf={pdf} selected={sel} onChange={setSel} />
            </Field>
          )}
        </>
      );
    case 'pdf2txt':
      return <Toggle checked={opt.ocr} onChange={(v) => setOpt({ ocr: v })} label="Si es un escaneo, reconocer el texto (OCR)" />;
    case 'ocr':
    case 'ocrpdf':
      return (
        <>
          {langSelect}
          <p className="text-sm text-soft">La primera vez se descarga el idioma (unos MB). Después funciona sin internet.</p>
        </>
      );
    case 'split':
      return (
        <>
          <Field label="¿Cómo dividir?">
            <Segmented value={opt.splitMode} onChange={(v) => setOpt({ splitMode: v })} options={[{ value: 'each', label: 'Cada página' }, { value: 'every', label: 'Cada N páginas' }, { value: 'ranges', label: 'Por rangos' }]} />
          </Field>
          {opt.splitMode === 'every' && <Slider label="Páginas por archivo" value={opt.every} min={1} max={Math.max(2, (pdf?.numPages || 2) - 1)} onChange={(v) => setOpt({ every: v })} />}
          {opt.splitMode === 'ranges' && (
            <Field label="Rangos" hint={`Separa con comas. Ejemplo: 1-3, 4, 5-${pdf?.numPages || 10}. Cada rango será un archivo.`}>
              <input className={inputCls} value={opt.ranges} placeholder="1-3, 4-6" onChange={(e) => setOpt({ ranges: e.target.value })} />
            </Field>
          )}
          {pdf && <p className="text-sm text-soft">El documento tiene {pdf.numPages} páginas.</p>}
        </>
      );
    case 'extract':
      return (
        <>
          <Toggle checked={opt.separate} onChange={(v) => setOpt({ separate: v })} label="Cada página en un archivo separado" />
          {pdf && <PageSelect pdf={pdf} selected={sel} onChange={setSel} />}
        </>
      );
    case 'organize':
      return pdf ? (
        <>
          <p className="mb-3 text-soft">Arrastra las páginas para ordenarlas. Usa los botones para girar, duplicar o eliminar.</p>
          <PageOrganizer pdf={pdf} pages={org} onChange={setOrg} />
        </>
      ) : null;
    case 'rotate': {
      const rots: Record<number, number> = {};
      const idx = sel.size ? [...sel] : Array.from({ length: pdf?.numPages || 0 }, (_: any, i: number) => i);
      idx.forEach((i: number) => (rots[i] = opt.angle));
      return (
        <>
          <Field label="Girar">
            <Segmented value={String(opt.angle)} onChange={(v) => setOpt({ angle: Number(v) })} options={[{ value: '90', label: '90° derecha' }, { value: '180', label: '180°' }, { value: '-90', label: '90° izquierda' }]} />
          </Field>
          {pdf && (
            <Field label="Páginas a girar (si no eliges ninguna, se giran todas)">
              <PageSelect pdf={pdf} selected={sel} onChange={setSel} rotations={rots} />
            </Field>
          )}
        </>
      );
    }
    case 'crop':
      return pdf ? <CropOptions pdf={pdf} opt={opt} setOpt={setOpt} sel={sel} setSel={setSel} /> : null;
    case 'compress':
      return (
        <Field label="Nivel de compresión">
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ['low', 'Ligera', 'Casi sin pérdida de calidad'],
              ['medium', 'Recomendada', 'Buen equilibrio'],
              ['high', 'Máxima', 'Archivo más pequeño'],
            ].map(([v, l, h]) => (
              <button key={v} onClick={() => setOpt({ level: v })} className={`rounded-2xl border-2 p-3 text-left ${opt.level === v ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                <span className="block font-extrabold">{l}</span>
                <span className="text-sm text-soft">{h}</span>
              </button>
            ))}
          </div>
        </Field>
      );
    case 'numbers':
      return (
        <>
          <Field label="Posición">
            <PosGrid value={opt.position} onChange={(v) => setOpt({ position: v })} />
          </Field>
          <Field label="Formato">
            <select className={inputCls} value={opt.format} onChange={(e) => setOpt({ format: e.target.value })}>
              {['n', 'n/N', 'Página n', 'Página n de N', '- n -'].map((f) => (
                <option key={f} value={f}>
                  {f.replace('n de N', '1 de 10').replace('n/N', '1/10').replace(/\bn\b/, '1')}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Slider label="Empezar en" value={opt.start} min={1} max={200} onChange={(v) => setOpt({ start: v })} />
            <Slider label="Tamaño de letra" value={opt.fontSize} min={7} max={28} onChange={(v) => setOpt({ fontSize: v })} />
            <Slider label="Margen" value={opt.margin} min={8} max={80} onChange={(v) => setOpt({ margin: v })} suffix=" pt" />
          </div>
          <Field label="Color">
            <ColorDots value={opt.color} onChange={(c) => setOpt({ color: c })} colors={['#334155', '#000000', '#2563eb', '#dc2626', '#16a34a']} />
          </Field>
          <Toggle checked={opt.bold} onChange={(v) => setOpt({ bold: v })} label="Negrita" />
          <Toggle checked={opt.skipFirst} onChange={(v) => setOpt({ skipFirst: v })} label="No numerar la primera página (portada)" />
        </>
      );
    case 'watermark':
      return (
        <>
          <Field label="Tipo">
            <Segmented value={opt.wmKind} onChange={(v) => setOpt({ wmKind: v })} options={[{ value: 'text', label: 'Texto' }, { value: 'image', label: 'Imagen' }]} />
          </Field>
          {opt.wmKind === 'text' ? (
            <>
              <Field label="Texto">
                <input className={inputCls} value={opt.text} onChange={(e) => setOpt({ text: e.target.value })} />
              </Field>
              <Slider label="Tamaño" value={opt.wmSize} min={12} max={140} onChange={(v) => setOpt({ wmSize: v })} />
              <Field label="Color">
                <ColorDots value={opt.wmColor} onChange={(c) => setOpt({ wmColor: c })} colors={['#ef4444', '#64748b', '#000000', '#2563eb', '#16a34a']} />
              </Field>
            </>
          ) : (
            <>
              <Button
                variant="soft"
                icon={<ImageIcon className="size-5" />}
                onClick={async () => {
                  const [f] = await pickFiles('image/*', false);
                  if (f) setOpt({ image: f });
                }}
              >
                {opt.image ? 'Cambiar imagen' : 'Elegir imagen (logo, sello)'}
              </Button>
              {opt.image && <p className="mt-1 text-sm text-soft">{opt.image.name}</p>}
              <Slider label="Tamaño" value={opt.wmScale} min={5} max={100} onChange={(v) => setOpt({ wmScale: v })} suffix="%" />
            </>
          )}
          <Slider label="Transparencia (opacidad)" value={opt.opacity} min={5} max={100} onChange={(v) => setOpt({ opacity: v })} suffix="%" />
          <Field label="Ubicación">
            <Segmented value={['center', 'tile'].includes(opt.layout) ? opt.layout : 'corner'} onChange={(v) => setOpt({ layout: v === 'corner' ? 'br' : v })} options={[{ value: 'center', label: 'Centro' }, { value: 'tile', label: 'Mosaico' }, { value: 'corner', label: 'Esquina' }]} />
          </Field>
          {!['center', 'tile'].includes(opt.layout) && <PosGrid value={opt.layout} onChange={(v) => setOpt({ layout: v })} />}
          {['center', 'tile'].includes(opt.layout) && <Slider label="Ángulo" value={opt.wmAngle} min={-90} max={90} onChange={(v) => setOpt({ wmAngle: v })} suffix="°" />}
          {pdf && pdf.numPages > 1 && (
            <Field label="Páginas (si no eliges ninguna, se aplica a todas)">
              <PageSelect pdf={pdf} selected={sel} onChange={setSel} />
            </Field>
          )}
        </>
      );
    case 'protect':
      return (
        <>
          <Field label="Contraseña para abrir">
            <input className={inputCls} type="password" autoComplete="new-password" value={opt.pw} onChange={(e) => setOpt({ pw: e.target.value })} />
          </Field>
          <Field label="Repite la contraseña">
            <input className={inputCls} type="password" autoComplete="new-password" value={opt.pw2} onChange={(e) => setOpt({ pw2: e.target.value })} />
          </Field>
          <Toggle checked={opt.allowPrint} onChange={(v) => setOpt({ allowPrint: v })} label="Permitir imprimir" />
          <Toggle checked={opt.allowCopy} onChange={(v) => setOpt({ allowCopy: v })} label="Permitir copiar texto" />
          <Toggle checked={opt.allowModify} onChange={(v) => setOpt({ allowModify: v })} label="Permitir modificar" />
          <p className="mt-2 text-sm text-soft">Cifrado AES-256. Guarda bien la contraseña: si la olvidas no se puede recuperar.</p>
        </>
      );
    case 'unlock':
      return <p className="text-soft">{inputs[0]?.password ? 'Contraseña correcta. Se creará una copia sin contraseña.' : 'Este PDF no tiene contraseña.'}</p>;
    default:
      return <p className="text-soft">Listo para procesar.</p>;
  }
}

function PosGrid({ value, onChange }: { value: string; onChange: (v: any) => void }) {
  const cells = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  return (
    <div className="grid aspect-[3/4] w-32 grid-cols-3 gap-1 rounded-2xl border border-line bg-white p-2">
      {cells.map((c) => (
        <button key={c} aria-label={'Posición ' + c} onClick={() => onChange(c)} className={`rounded-lg ${value === c ? 'bg-primary' : 'bg-slate-200 hover:bg-slate-300'}`} />
      ))}
    </div>
  );
}

function CropOptions({ pdf, opt, setOpt, sel, setSel }: any) {
  const [page, setPage] = useState(0);
  const per = opt.perPage || {};
  const m: ops.Margins = per[page] || opt.margins;
  const setM = (nm: ops.Margins) => {
    if (opt.cropApply === 'one') setOpt({ perPage: { ...per, [page]: nm }, cropPage: page });
    else setOpt({ margins: nm });
  };
  return (
    <>
      <Field label="Aplicar a">
        <Segmented value={opt.cropApply} onChange={(v) => setOpt({ cropApply: v, perPage: v === 'one' ? per : {} })} options={[{ value: 'all', label: 'Todas' }, { value: 'one', label: 'Una por una' }, { value: 'selected', label: 'Seleccionadas' }]} />
      </Field>
      <div className="flex flex-col items-center gap-3">
        <CropBox pdf={pdf} index={page} m={m} onChange={setM} />
        {(opt.cropApply === 'one' || opt.cropApply === 'all') && pdf.numPages > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <span className="font-bold tabular-nums">
              Página {page + 1} / {pdf.numPages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= pdf.numPages - 1} onClick={() => setPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        )}
        {opt.cropApply === 'one' && <p className="text-sm text-soft">Ajusta cada página y pasa a la siguiente. Las páginas sin ajustar no se recortan.</p>}
      </div>
      {opt.cropApply === 'selected' && (
        <div className="mt-4">
          <PageSelect pdf={pdf} selected={sel} onChange={setSel} />
        </div>
      )}
    </>
  );
}

function CropBox({ pdf, index, m, onChange }: { pdf: PDFDocumentProxy; index: number; m: ops.Margins; onChange: (m: ops.Margins) => void }) {
  const [size, setSize] = useState({ w: 280, h: 380 });
  useEffect(() => {
    pdf.getPage(index + 1).then((p) => {
      const vp = p.getViewport({ scale: 1 });
      const w = Math.min(320, window.innerWidth - 80);
      setSize({ w, h: (vp.height / vp.width) * w });
    });
  }, [pdf, index]);
  const drag = (edge: keyof ops.Margins) => (e: React.PointerEvent) => {
    const el = (e.currentTarget as HTMLElement).parentElement!;
    const r = el.getBoundingClientRect();
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
      const v = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy }[edge];
      const opp = { left: m.right, right: m.left, top: m.bottom, bottom: m.top }[edge];
      onChange({ ...m, [edge]: Math.max(0, Math.min(1 - opp - 0.1, v)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const h = 'absolute bg-primary rounded-full touch-none shadow-card';
  return (
    <div className="relative select-none" style={{ width: size.w, height: size.h }}>
      <PageThumb pdf={pdf} index={index} className="!aspect-auto h-full w-full !rounded-none" />
      <div className="pointer-events-none absolute border-2 border-primary bg-transparent" style={{ left: `${m.left * 100}%`, right: `${m.right * 100}%`, top: `${m.top * 100}%`, bottom: `${m.bottom * 100}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
      <div className={h + ' h-12 w-3 cursor-ew-resize'} style={{ left: `calc(${m.left * 100}% - 6px)`, top: '50%', transform: 'translateY(-50%)' }} onPointerDown={drag('left')} />
      <div className={h + ' h-12 w-3 cursor-ew-resize'} style={{ right: `calc(${m.right * 100}% - 6px)`, top: '50%', transform: 'translateY(-50%)' }} onPointerDown={drag('right')} />
      <div className={h + ' h-3 w-12 cursor-ns-resize'} style={{ top: `calc(${m.top * 100}% - 6px)`, left: '50%', transform: 'translateX(-50%)' }} onPointerDown={drag('top')} />
      <div className={h + ' h-3 w-12 cursor-ns-resize'} style={{ bottom: `calc(${m.bottom * 100}% - 6px)`, left: '50%', transform: 'translateX(-50%)' }} onPointerDown={drag('bottom')} />
    </div>
  );
}
