import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MoreVertical, Crop, FileType2, ScanText, Share2, ZoomIn, ZoomOut, Lock, FileQuestion, Wrench } from 'lucide-react';
import { getDoc, getDocBlob, getDocFile, addDoc } from '../lib/library';
import type { DocMeta } from '../lib/db';
import type { PDFDocumentProxy } from '../lib/pdf';
import { openWithPassword } from '../lib/pdfAccess';
import { PdfViewer } from '../components/PdfViewer';
import { DocMenu } from '../components/DocMenu';
import { TopBar, IconButton, Button, Spinner, Empty, Chip, BarButton } from '../components/ui';
import { useApp, toast, errMsg, withBusy } from '../lib/store';
import { shareFiles } from '../lib/share';
import { useObjectURL } from '../lib/hooks';
import { extOf, baseName } from '../lib/util';
import { LockedError } from '../lib/lock';

export default function DocOpen() {
  const { id } = useParams();
  const nav = useNavigate();
  const version = useApp((s) => s.version);
  const [doc, setDoc] = useState<DocMeta | null | undefined>(undefined);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  async function load() {
    setError(null);
    setLocked(false);
    const m = await getDoc(id!);
    setDoc(m || null);
    if (!m) return;
    try {
      const b = await getDocBlob(m.id);
      setBlob(b);
      if (m.kind === 'pdf') {
        const r = await openWithPassword(m.id, b, `"${m.name}"`);
        if (!r) return nav(-1);
        setPdf((old) => {
          old?.loadingTask.destroy();
          return r.pdf;
        });
      }
    } catch (e) {
      if (e instanceof LockedError) setLocked(true);
      else setError(errMsg(e));
    }
  }

  useEffect(() => {
    load();
  }, [id, version]);

  useEffect(() => () => { pdf?.loadingTask.destroy(); }, [pdf]);

  if (doc === undefined) return <Center />;
  if (doc === null) return <Missing />;
  if (locked)
    return (
      <div>
        <TopBar title={doc.name} back />
        <Empty icon={<Lock className="size-10" />} title="Archivo bloqueado" text="Necesitas tu PIN para abrirlo." action={<Button onClick={load}>Desbloquear</Button>} />
      </div>
    );
  if (error)
    return (
      <div>
        <TopBar title={doc.name} back />
        <Empty icon={<FileQuestion className="size-10" />} title="No se pudo abrir" text={error} />
      </div>
    );
  if (!blob) return <Center />;
  if (doc.kind === 'pdf') return pdf ? <PdfViewer key={pdf.fingerprints?.[0] + ':' + doc.updatedAt} doc={doc} pdf={pdf} /> : <Center />;
  if (doc.kind === 'image') return <ImageViewer doc={doc} blob={blob} />;
  return <FileViewer doc={doc} blob={blob} />;
}

const Center = () => (
  <div className="flex h-dvh items-center justify-center">
    <Spinner className="size-10" />
  </div>
);

const Missing = () => (
  <div>
    <TopBar title="Documento" back="/" />
    <Empty icon={<FileQuestion className="size-10" />} title="Este documento ya no existe" />
  </div>
);

function ImageViewer({ doc, blob }: { doc: DocMeta; blob: Blob }) {
  const nav = useNavigate();
  const url = useObjectURL(blob);
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        title={doc.name}
        back
        right={
          <IconButton label="Más opciones" onClick={() => setMenu(true)}>
            <MoreVertical className="size-6" />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto bg-surface-3/60 checker">
        <div className="flex min-h-full items-center justify-center p-4">
          {url && <img src={url} alt={doc.name} style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none' }} className="h-auto max-h-none rounded-lg object-contain shadow-pop" />}
        </div>
      </div>
      <div className="safe-bottom border-t border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-2 py-2">
          <span className="hidden items-center sm:flex">
            <IconButton label="Alejar" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
              <ZoomOut className="size-5" />
            </IconButton>
            <IconButton label="Acercar" onClick={() => setZoom((z) => Math.min(6, z * 1.25))}>
              <ZoomIn className="size-5" />
            </IconButton>
          </span>
          <div className="flex-1" />
          <BarButton primary icon={<Crop />} label="Editar" onClick={() => nav('/image/' + doc.id)} />
          <BarButton icon={<FileType2 />} label="A PDF" onClick={() => nav(`/tool/img2pdf?doc=${doc.id}`)} />
          <BarButton icon={<ScanText />} label="Texto" onClick={() => nav(`/tool/ocr?doc=${doc.id}`)} />
          <BarButton icon={<Share2 />} label="Compartir" onClick={async () => shareFiles([await getDocFile(doc.id)])} />
          <BarButton icon={<Wrench />} label="Herramientas" onClick={() => setMenu(true)} />
          <div className="flex-1 sm:hidden" />
        </div>
      </div>
      <DocMenu doc={doc} open={menu} onClose={() => setMenu(false)} inViewer />
    </div>
  );
}

function FileViewer({ doc, blob }: { doc: DocMeta; blob: Blob }) {
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [sheets, setSheets] = useState<{ name: string; html: string }[] | null>(null);
  const [sheet, setSheet] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ext = extOf(doc.name);

  useEffect(() => {
    (async () => {
      try {
        if (ext === 'docx') {
          const { docxToHtml } = await import('../lib/convert');
          setHtml(cleanHtml(await docxToHtml(blob)));
        } else if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) {
          const XLSX: any = await import('xlsx');
          const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
          setSheets(wb.SheetNames.map((n: string) => ({ name: n, html: cleanHtml(XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })) })));
        } else if (doc.kind === 'text') {
          setText(await blob.text());
        } else setErr('Vista previa no disponible para este formato. Puedes convertirlo a PDF.');
      } catch (e) {
        setErr('No se pudo mostrar: ' + errMsg(e));
      }
    })();
  }, [blob]);

  async function toPdf() {
    try {
      const conv = await import('../lib/convert');
      const out = await withBusy('Convirtiendo a PDF…', async (p) => {
        if (ext === 'docx') return conv.docxToPdf(blob);
        if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return conv.sheetToPdf(blob);
        if (ext === 'pptx') return conv.pptxToPdf(blob, p);
        if (ext === 'html' || ext === 'htm') return conv.htmlToPdf(await blob.text(), doc.name);
        if (doc.kind === 'text') return conv.textToPdf(await blob.text(), doc.name);
        throw new Error('Este formato no se puede convertir sin conexión. Usa .docx, .xlsx, .pptx, .csv o .txt');
      });
      const m = await addDoc({ name: baseName(doc.name) + '.pdf', blob: out, folderId: doc.folderId });
      toast('PDF creado', 'ok');
      nav('/doc/' + m.id);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        title={doc.name}
        back
        right={
          <IconButton label="Más opciones" onClick={() => setMenu(true)}>
            <MoreVertical className="size-6" />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto bg-surface-3/50 p-3">
        {sheets && sheets.length > 1 && (
          <div className="no-scrollbar mx-auto mb-3 flex max-w-5xl gap-2 overflow-x-auto">
            {sheets.map((s, i) => (
              <Chip key={i} active={sheet === i} onClick={() => setSheet(i)}>
                {s.name}
              </Chip>
            ))}
          </div>
        )}
        <div className="mx-auto max-w-5xl rounded-2xl bg-white p-5 text-slate-900 shadow-card sm:p-8">
          {err && <p className="text-slate-600">{err}</p>}
          {html !== null && <div className="docx-view" dangerouslySetInnerHTML={{ __html: html }} />}
          {sheets && <div className="sheet-view overflow-auto" dangerouslySetInnerHTML={{ __html: sheets[sheet]?.html || '' }} />}
          {text !== null && <pre className="font-mono text-sm whitespace-pre-wrap">{text}</pre>}
          {!err && html === null && !sheets && text === null && <Spinner className="mx-auto size-8" />}
        </div>
      </div>
      <div className="safe-bottom border-t border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2">
          <Button className="flex-1" icon={<FileType2 className="size-5" />} onClick={toPdf}>
            Convertir a PDF
          </Button>
          <IconButton label="Compartir" onClick={async () => shareFiles([await getDocFile(doc.id)])}>
            <Share2 className="size-6" />
          </IconButton>
        </div>
      </div>
      <DocMenu doc={doc} open={menu} onClose={() => setMenu(false)} inViewer />
    </div>
  );
}

/** Quita scripts y atributos peligrosos del HTML de vista previa. */
function cleanHtml(h: string) {
  const d = new DOMParser().parseFromString(h, 'text/html');
  d.querySelectorAll('script,iframe,object,embed,link,meta,style').forEach((n) => n.remove());
  d.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || (a.name === 'href' && /^javascript:/i.test(a.value)) || (a.name === 'src' && !/^data:image\//i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return d.body.innerHTML;
}
