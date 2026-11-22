import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, BookOpen, MoreVertical, ZoomIn, ZoomOut, PenLine, Highlighter, Share2, ChevronUp, ChevronDown, X, ScanText, Loader2, StickyNote, Files } from 'lucide-react';
import { pdfjs, renderPage, pageLines, linesToParagraphs, type PDFDocumentProxy, type PDFPageProxy, type Para } from '../lib/pdf';
import type { DocMeta } from '../lib/db';
import { TopBar, IconButton, Button, inputCls, Segmented, Spinner, BarButton } from './ui';
import { DocMenu } from './DocMenu';
import { getDocFile } from '../lib/library';
import { shareFiles } from '../lib/share';
import { useApp, toast, errMsg } from '../lib/store';
import { ocrImage } from '../lib/ocr';

export function PdfViewer({ doc, pdf }: { doc: DocMeta; pdf: PDFDocumentProxy }) {
  const nav = useNavigate();
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [mode, setMode] = useState<'pages' | 'read'>('pages');
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number[]>([]);
  const [hitIdx, setHitIdx] = useState(0);
  const [current, setCurrent] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const texts = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(1100, el.clientWidth - 24)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // Zoom con Ctrl + rueda
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(4, Math.max(0.5, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [mode]);

  async function runSearch(q: string) {
    setQuery(q);
    const t = q.trim().toLowerCase();
    if (t.length < 2) return setHits([]);
    const found: number[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      if (!texts.current.has(i)) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        texts.current.set(i, (tc.items as any[]).map((x) => x.str || '').join(' ').toLowerCase());
      }
      if (texts.current.get(i)!.includes(t)) found.push(i);
    }
    setHits(found);
    setHitIdx(0);
    if (found.length) goTo(found[0]);
  }

  const goTo = (n: number) => {
    const el = document.getElementById(`pg-${n}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const share = async () => {
    try {
      await shareFiles([await getDocFile(doc.id)]);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const pageW = width * zoom;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        title={doc.name}
        sub={`${pdf.numPages} página(s)`}
        back
        right={
          <>
            <IconButton label="Buscar texto" active={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
              <Search className="size-6" />
            </IconButton>
            <IconButton label="Vista de lectura" active={mode === 'read'} onClick={() => setMode((m) => (m === 'read' ? 'pages' : 'read'))}>
              <BookOpen className="size-6" />
            </IconButton>
            <IconButton label="Más opciones" onClick={() => setMenu(true)}>
              <MoreVertical className="size-6" />
            </IconButton>
          </>
        }
      />
      {searchOpen && (
        <div className="border-b border-line bg-surface px-3 py-2">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <input autoFocus className={inputCls + ' h-11'} placeholder="Buscar en el documento" value={query} onChange={(e) => runSearch(e.target.value)} />
            <span className="shrink-0 text-sm font-bold text-soft tabular-nums">{hits.length ? `${hitIdx + 1}/${hits.length} pág.` : query.length > 1 ? '0' : ''}</span>
            <IconButton label="Anterior" disabled={!hits.length} onClick={() => { const i = (hitIdx - 1 + hits.length) % hits.length; setHitIdx(i); goTo(hits[i]); }}>
              <ChevronUp className="size-5" />
            </IconButton>
            <IconButton label="Siguiente" disabled={!hits.length} onClick={() => { const i = (hitIdx + 1) % hits.length; setHitIdx(i); goTo(hits[i]); }}>
              <ChevronDown className="size-5" />
            </IconButton>
            <IconButton label="Cerrar búsqueda" onClick={() => { setSearchOpen(false); setQuery(''); setHits([]); }}>
              <X className="size-5" />
            </IconButton>
          </div>
          {query.length > 1 && !hits.length && <p className="mx-auto mt-1 max-w-3xl text-sm text-soft">Sin resultados. Si es un escaneo, usa “Reconocer texto (OCR)” en el menú para poder buscar.</p>}
        </div>
      )}

      {mode === 'read' ? (
        <ReadingView pdf={pdf} />
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-surface-3/60 px-3 py-4">
          <div className="mx-auto flex flex-col items-center gap-4" style={{ width: pageW }}>
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <PageView key={i} pdf={pdf} n={i + 1} width={pageW} query={searchOpen ? query : ''} onVisible={setCurrent} />
            ))}
          </div>
        </div>
      )}

      <div className="safe-bottom border-t border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-2 py-2">
          {mode === 'pages' && (
            <>
              <span className="min-w-16 px-2 text-center text-sm font-bold tabular-nums">
                {current} / {pdf.numPages}
              </span>
              <span className="hidden items-center sm:flex">
                <IconButton label="Alejar" onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))}>
                  <ZoomOut className="size-5" />
                </IconButton>
                <button className="h-10 rounded-xl px-2 text-sm font-bold text-soft" onClick={() => setZoom(1)}>
                  {Math.round(zoom * 100)}%
                </button>
                <IconButton label="Acercar" onClick={() => setZoom((z) => Math.min(4, z * 1.2))}>
                  <ZoomIn className="size-5" />
                </IconButton>
              </span>
            </>
          )}
          <div className="flex-1" />
          <BarButton primary icon={<PenLine />} label="Firmar" onClick={() => nav(`/edit/${doc.id}?tool=sign`)} />
          <BarButton icon={<Highlighter />} label="Anotar" onClick={() => nav(`/edit/${doc.id}`)} />
          <BarButton icon={<Files />} label="Páginas" onClick={() => nav(`/tool/organize?doc=${doc.id}`)} />
          <BarButton icon={<Share2 />} label="Compartir" onClick={share} />
        </div>
      </div>
      <DocMenu doc={doc} open={menu} onClose={() => setMenu(false)} inViewer />
    </div>
  );
}

function PageView({ pdf, n, width, query, onVisible }: { pdf: PDFDocumentProxy; n: number; width: number; query: string; onVisible: (n: number) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [visible, setVisible] = useState(n <= 2);
  const [notes, setNotes] = useState<{ x: number; y: number; text: string }[]>([]);
  const [openNote, setOpenNote] = useState<number | null>(null);

  useEffect(() => {
    pdf.getPage(n).then(setPage);
  }, [pdf, n]);

  useEffect(() => {
    const el = holder.current!;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (e.isIntersecting) setVisible(true);
          if (e.intersectionRatio > 0.5) onVisible(n);
        }
      },
      { rootMargin: '600px 0px', threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const vp1 = page?.getViewport({ scale: 1 });
  const scale = vp1 ? width / vp1.width : 1;
  const height = vp1 ? vp1.height * scale : width * 1.414;

  useEffect(() => {
    if (!page || !visible) return;
    let cancelled = false;
    let task: any;
    (async () => {
      const dpr = Math.min(2.5, devicePixelRatio || 1);
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvasRef.current!;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = page.render({ canvas: c, viewport: vp } as any);
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      // capa de texto
      const tl = textRef.current!;
      tl.innerHTML = '';
      const tvp = page.getViewport({ scale });
      tl.style.setProperty('--scale-factor', String(scale));
      tl.style.setProperty('--total-scale-factor', String(scale));
      const layer = new (pdfjs as any).TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: tvp });
      await layer.render().catch(() => {});
      highlight(tl, query);
      // notas (comentarios)
      const anns = await page.getAnnotations();
      setNotes(
        anns
          .filter((a: any) => a.subtype === 'Text' && (a.contentsObj?.str || a.contents))
          .map((a: any) => {
            const [x, y] = tvp.convertToViewportPoint(a.rect[0], a.rect[3]);
            return { x, y, text: a.contentsObj?.str || a.contents };
          }),
      );
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [page, visible, Math.round(width)]);

  useEffect(() => {
    if (textRef.current) highlight(textRef.current, query);
  }, [query]);

  return (
    <div id={`pg-${n}`} ref={holder} className="relative shrink-0 bg-white shadow-card" style={{ width, height }}>
      {!visible || !page ? <Spinner className="absolute inset-0 m-auto size-8" /> : null}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={textRef} className="textLayer" />
      {notes.map((nt, i) => (
        <div key={i} className="absolute z-10" style={{ left: nt.x, top: nt.y }}>
          <button aria-label="Ver comentario" onClick={() => setOpenNote(openNote === i ? null : i)} className="flex size-8 items-center justify-center rounded-lg bg-yellow-300 text-yellow-900 shadow-card">
            <StickyNote className="size-5" />
          </button>
          {openNote === i && <div className="absolute top-9 left-0 w-56 rounded-2xl bg-yellow-50 p-3 text-sm text-yellow-950 shadow-pop">{nt.text}</div>}
        </div>
      ))}
      <span className="absolute -bottom-0 left-1/2 -translate-x-1/2 translate-y-full pt-0.5 text-xs font-bold text-faint">{n}</span>
    </div>
  );
}

function highlight(container: HTMLElement, q: string) {
  const t = q.trim().toLowerCase();
  container.querySelectorAll('span').forEach((s) => {
    const on = t.length > 1 && (s.textContent || '').toLowerCase().includes(t);
    s.classList.toggle('hl-match', on);
  });
}

// ---------- Vista de lectura ----------

function ReadingView({ pdf }: { pdf: PDFDocumentProxy }) {
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const [pages, setPages] = useState<(Para[] | null)[]>([]);
  const [ocring, setOcring] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const out: (Para[] | null)[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const { lines } = await pageLines(await pdf.getPage(i));
        out.push(lines.length ? linesToParagraphs(lines) : null);
        if (live) setPages([...out]);
      }
    })();
    return () => {
      live = false;
    };
  }, [pdf]);

  async function ocrPage(i: number) {
    setOcring(i);
    try {
      const c = await renderPage(await pdf.getPage(i + 1), 2.2);
      const r = await ocrImage(c, prefs.ocrLang);
      setPages((ps) => ps.map((p, k) => (k === i ? r.paragraphs.map((t) => ({ text: t, size: 12, heading: false })) : p)));
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setOcring(null);
    }
  }

  const theme = {
    light: 'bg-white text-slate-900',
    sepia: 'bg-[#f6efe0] text-[#3b2f20]',
    dark: 'bg-[#111827] text-[#e5e7eb]',
  }[prefs.readerTheme];

  const empty = useMemo(() => pages.length === pdf.numPages && pages.every((p) => !p), [pages]);

  return (
    <div className={`min-h-0 flex-1 overflow-auto ${theme}`}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-3 border-b border-line bg-surface px-3 py-2 text-text">
        <Segmented
          value={prefs.readerTheme}
          onChange={(v) => setPrefs({ readerTheme: v })}
          options={[
            { value: 'light', label: 'Claro' },
            { value: 'sepia', label: 'Sepia' },
            { value: 'dark', label: 'Oscuro' },
          ]}
        />
        <div className="flex items-center gap-2">
          <button className="h-10 w-10 rounded-xl text-sm font-black hover:bg-black/10" onClick={() => setPrefs({ readerSize: Math.max(14, prefs.readerSize - 1) })} aria-label="Letra más pequeña">
            A-
          </button>
          <span className="w-8 text-center text-sm tabular-nums">{prefs.readerSize}</span>
          <button className="h-10 w-10 rounded-xl text-lg font-black hover:bg-black/10" onClick={() => setPrefs({ readerSize: Math.min(32, prefs.readerSize + 1) })} aria-label="Letra más grande">
            A+
          </button>
        </div>
      </div>
      <article className="mx-auto max-w-2xl px-5 py-8" style={{ fontSize: prefs.readerSize, lineHeight: 1.65 }}>
        {empty && <p className="mb-6 rounded-2xl bg-black/5 p-4 text-base">Este PDF no tiene texto (es una imagen escaneada). Toca “Reconocer texto” en cada página para leerlo.</p>}
        {pages.map((p, i) => (
          <section key={i} className="mb-8">
            <div className="mb-3 text-xs font-bold tracking-wider uppercase opacity-50">Página {i + 1}</div>
            {p ? (
              p.map((para, k) =>
                para.heading ? (
                  <h2 key={k} className="mt-6 mb-3 font-extrabold" style={{ fontSize: '1.3em', lineHeight: 1.3 }}>
                    {para.text}
                  </h2>
                ) : (
                  <p key={k} className="mb-4 whitespace-pre-line">
                    {para.text}
                  </p>
                ),
              )
            ) : (
              <Button variant="soft" size="sm" icon={ocring === i ? <Loader2 className="size-5 animate-spin" /> : <ScanText className="size-5" />} disabled={ocring !== null} onClick={() => ocrPage(i)}>
                Reconocer texto
              </Button>
            )}
          </section>
        ))}
        {pages.length < pdf.numPages && <Spinner className="mx-auto size-8" />}
      </article>
    </div>
  );
}
