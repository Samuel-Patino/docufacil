import { useEffect, useRef, useState } from 'react';
import { Crop, Palette, SlidersHorizontal, Eraser, RotateCcw, RotateCw, Maximize, ScanSearch, Undo2, Check, X, Spline, Loader2 } from 'lucide-react';
import type { ScanPage, Quad, Pt, EraseStroke, FilterId } from '../lib/scanTypes';
import { FILTERS, DEFAULT_ADJ } from '../lib/scanTypes';
import { blobToCanvas, croppedCanvas, applyFilterAdjust, rotateCanvas, filterPreview } from '../lib/imaging';
import { loadCV } from '../lib/cv';
import { detectInBlob, FULL_QUAD, insetQuad } from '../lib/detect';
import { Button, IconButton, Slider, Segmented } from './ui';
import { toast } from '../lib/store';
import { debounce } from '../lib/util';

type Tab = 'crop' | 'filter' | 'adjust' | 'erase';

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const straightMids = (q: Quad): [Pt, Pt, Pt, Pt] => [mid(q[0], q[1]), mid(q[1], q[2]), mid(q[3], q[2]), mid(q[0], q[3])];

export function PageEditor({ page, onDone, onCancel, title = 'Editar página' }: { page: ScanPage; onDone: (p: ScanPage) => void; onCancel: () => void; title?: string }) {
  const [p, setP] = useState<ScanPage>({ ...page });
  const [tab, setTab] = useState<Tab>(page.quad || !page.processed ? 'crop' : 'filter');
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [origSize, setOrigSize] = useState({ w: 1, h: 1 });
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [filterThumbs, setFilterThumbs] = useState<Record<string, string>>({});
  const [curveMode, setCurveMode] = useState(!!page.curve);

  // imagen original (para recortar)
  useEffect(() => {
    let live = true;
    blobToCanvas(page.orig, 1600).then((c) => {
      if (!live) return;
      setOrigSize({ w: c.width, h: c.height });
      setOrigUrl(c.toDataURL('image/jpeg', 0.85));
    });
    return () => {
      live = false;
    };
  }, [page.orig]);

  // vista previa procesada
  const renderRef = useRef(0);
  const doRender = useRef(
    debounce(async (pp: ScanPage) => {
      const n = ++renderRef.current;
      setRendering(true);
      try {
        const base = await croppedCanvas(pp, 1400);
        const f = await applyFilterAdjust(base, pp.filter, pp.adj);
        const r = rotateCanvas(f, pp.rotation);
        if (n === renderRef.current) {
          setPreview(r.toDataURL('image/jpeg', 0.85));
          setDims({ w: r.width, h: r.height, uw: f.width, uh: f.height });
        }
        if (n === renderRef.current && !Object.keys(filterThumbsRef.current).length) {
          const out: Record<string, string> = {};
          for (const fl of FILTERS) out[fl.id] = await filterPreview(base, fl.id);
          filterThumbsRef.current = out;
          setFilterThumbs(out);
        }
      } catch (e: any) {
        toast('Error al procesar: ' + (e?.message || e), 'error');
      } finally {
        if (n === renderRef.current) setRendering(false);
      }
    }, 160),
  ).current;
  const filterThumbsRef = useRef<Record<string, string>>({});
  const [dims, setDims] = useState({ w: 1, h: 1, uw: 1, uh: 1 });

  useEffect(() => {
    if (tab !== 'crop') doRender(p);
  }, [tab, p.filter, p.adj, p.rotation, p.erase, p.quad, p.curve]);

  // si cambia el recorte, las miniaturas de filtros se regeneran
  useEffect(() => {
    filterThumbsRef.current = {};
    setFilterThumbs({});
  }, [p.quad, p.curve, p.erase]);

  const setQuad = (quad: Quad | null, curve: ScanPage['curve'] = null) => {
    setP((x) => ({ ...x, quad, curve, erase: x.quad === quad ? x.erase : [], processed: undefined }));
  };

  async function autoDetect() {
    try {
      const cv = await loadCV();
      const d = await detectInBlob(cv, page.orig, true);
      if (!d) return toast('No se encontraron bordes. Ajusta las esquinas a mano.', 'info');
      setQuad(d.quad, curveMode ? d.curve : null);
      toast('Bordes detectados', 'ok');
    } catch (e: any) {
      toast(e?.message || String(e), 'error');
    }
  }

  const rotate = (d: number) => setP((x) => ({ ...x, rotation: ((((x.rotation + d) % 360) + 360) % 360) as any, processed: undefined }));

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-bg">
      <header className="safe-top border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-2">
          <IconButton label="Cancelar" onClick={onCancel}>
            <X className="size-6" />
          </IconButton>
          <h1 className="flex-1 truncate text-lg font-extrabold">{title}</h1>
          <IconButton label="Girar a la izquierda" onClick={() => rotate(-90)}>
            <RotateCcw className="size-6" />
          </IconButton>
          <IconButton label="Girar a la derecha" onClick={() => rotate(90)}>
            <RotateCw className="size-6" />
          </IconButton>
          <Button size="sm" icon={<Check className="size-5" />} onClick={() => onDone({ ...p, processed: undefined })}>
            Aplicar
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-2">
        {tab === 'crop' ? (
          origUrl ? (
            <CropView
              url={origUrl}
              size={origSize}
              quad={p.quad || FULL_QUAD}
              curve={curveMode ? p.curve || straightMids(p.quad || FULL_QUAD) : null}
              onChange={(q, c) => setQuad(q, curveMode ? c : null)}
            />
          ) : (
            <Center>
              <Loader2 className="size-10 animate-spin text-primary" />
            </Center>
          )
        ) : tab === 'erase' ? (
          preview && <EraseView url={preview} dims={dims} rotation={p.rotation} onStroke={(s) => setP((x) => ({ ...x, erase: [...x.erase, s], processed: undefined }))} busy={rendering} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            {preview && <img src={preview} alt="Vista previa" className="max-h-full max-w-full rounded-lg object-contain shadow-pop" />}
          </div>
        )}
        {rendering && tab !== 'crop' && (
          <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-bold shadow-card">
            <Loader2 className="size-4 animate-spin text-primary" /> Procesando
          </div>
        )}
      </div>

      {/* panel de herramientas */}
      <div className="safe-bottom border-t border-line bg-surface">
        <div className="mx-auto max-w-3xl px-3 pt-3">
          {tab === 'crop' && (
            <div className="flex flex-wrap items-center justify-center gap-2 pb-2">
              <Button variant="soft" size="sm" icon={<ScanSearch className="size-5" />} onClick={autoDetect}>
                Detectar bordes
              </Button>
              <Button variant="secondary" size="sm" icon={<Maximize className="size-5" />} onClick={() => setQuad(null)}>
                Toda la imagen
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setQuad(insetQuad(0.1))}>
                Restablecer
              </Button>
              <Button
                variant={curveMode ? 'primary' : 'secondary'}
                size="sm"
                icon={<Spline className="size-5" />}
                onClick={() => {
                  const on = !curveMode;
                  setCurveMode(on);
                  const q = p.quad || FULL_QUAD;
                  setP((x) => ({ ...x, quad: q, curve: on ? x.curve || straightMids(q) : null, processed: undefined }));
                }}
              >
                Página curva
              </Button>
              <p className="w-full text-center text-sm text-soft">
                {curveMode ? 'Arrastra los puntos del medio para seguir la curva del libro.' : 'Arrastra las esquinas hasta los bordes del documento.'}
              </p>
            </div>
          )}
          {tab === 'filter' && (
            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-3">
              {FILTERS.map((f) => (
                <button key={f.id} onClick={() => setP((x) => ({ ...x, filter: f.id as FilterId, processed: undefined }))} className="w-20 shrink-0 text-center" title={f.hint}>
                  <span className={`block aspect-[3/4] overflow-hidden rounded-xl border-2 bg-surface-2 ${p.filter === f.id ? 'border-primary ring-2 ring-primary/30' : 'border-line'}`}>
                    {filterThumbs[f.id] ? <img src={filterThumbs[f.id]} alt="" className="h-full w-full object-cover" /> : <Loader2 className="m-auto mt-8 size-5 animate-spin text-faint" />}
                  </span>
                  <span className={`mt-1 block text-xs font-bold ${p.filter === f.id ? 'text-primary' : ''}`}>{f.label}</span>
                </button>
              ))}
            </div>
          )}
          {tab === 'adjust' && (
            <div className="grid gap-x-6 pb-2 sm:grid-cols-2">
              <Slider label="Brillo" value={p.adj.brightness} min={-100} max={100} onChange={(v) => setP((x) => ({ ...x, adj: { ...x.adj, brightness: v }, processed: undefined }))} />
              <Slider label="Contraste" value={p.adj.contrast} min={-100} max={100} onChange={(v) => setP((x) => ({ ...x, adj: { ...x.adj, contrast: v }, processed: undefined }))} />
              <Slider label="Nitidez" value={p.adj.sharpen} min={0} max={100} onChange={(v) => setP((x) => ({ ...x, adj: { ...x.adj, sharpen: v }, processed: undefined }))} />
              <Slider label="Quitar ruido" value={p.adj.denoise} min={0} max={100} onChange={(v) => setP((x) => ({ ...x, adj: { ...x.adj, denoise: v }, processed: undefined }))} />
              <div className="sm:col-span-2">
                <Button variant="ghost" size="sm" onClick={() => setP((x) => ({ ...x, adj: { ...DEFAULT_ADJ }, processed: undefined }))}>
                  Restablecer ajustes
                </Button>
              </div>
            </div>
          )}
          {tab === 'erase' && (
            <div className="flex flex-wrap items-center justify-center gap-2 pb-2 text-center">
              <p className="w-full text-sm text-soft">Pinta con el dedo sobre lo que quieres borrar (manchas, sellos, dedos, notas). El fondo se rellena solo.</p>
              <Button variant="secondary" size="sm" icon={<Undo2 className="size-5" />} disabled={!p.erase.length} onClick={() => setP((x) => ({ ...x, erase: x.erase.slice(0, -1), processed: undefined }))}>
                Deshacer
              </Button>
              <Button variant="secondary" size="sm" disabled={!p.erase.length} onClick={() => setP((x) => ({ ...x, erase: [], processed: undefined }))}>
                Quitar todo
              </Button>
            </div>
          )}
          <Segmented<Tab>
            className="mb-3"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'crop', label: <TabLabel icon={<Crop className="size-5" />} text="Recortar" /> },
              { value: 'filter', label: <TabLabel icon={<Palette className="size-5" />} text="Filtros" /> },
              { value: 'adjust', label: <TabLabel icon={<SlidersHorizontal className="size-5" />} text="Ajustes" /> },
              { value: 'erase', label: <TabLabel icon={<Eraser className="size-5" />} text="Borrar" /> },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

const TabLabel = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <span className="flex flex-col items-center gap-0.5 py-1 sm:flex-row sm:gap-1.5">
    {icon}
    <span className="text-xs sm:text-sm">{text}</span>
  </span>
);

const Center = ({ children }: { children: React.ReactNode }) => <div className="absolute inset-0 flex items-center justify-center">{children}</div>;

// ---------- recorte con esquinas y lupa ----------

function CropView({ url, size, quad, curve, onChange }: { url: string; size: { w: number; h: number }; quad: Quad; curve: [Pt, Pt, Pt, Pt] | null; onChange: (q: Quad, c: [Pt, Pt, Pt, Pt] | null) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, x: 0, y: 0 });
  const [drag, setDrag] = useState<{ kind: 'c' | 'm'; i: number } | null>(null);
  const [loupe, setLoupe] = useState<Pt | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = wrap.current!;
    const fit = () => {
      const pad = 28;
      const W = el.clientWidth - pad * 2, H = el.clientHeight - pad * 2;
      const s = Math.min(W / size.w, H / size.h);
      const w = size.w * s, h = size.h * s;
      setBox({ w, h, x: (el.clientWidth - w) / 2, y: (el.clientHeight - h) / 2 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  useEffect(() => {
    const im = new Image();
    im.src = url;
    imgRef.current = im;
  }, [url]);

  useEffect(() => {
    const c = loupeRef.current, im = imgRef.current;
    if (!c || !loupe || !im) return;
    const ctx = c.getContext('2d')!;
    const S = 120, zoom = 3;
    const sx = loupe.x * im.naturalWidth, sy = loupe.y * im.naturalHeight;
    const src = (S / zoom) * (im.naturalWidth / box.w);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(im, sx - src / 2, sy - src / 2, src, src, 0, 0, S, S);
    ctx.restore();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 - 10, S / 2);
    ctx.lineTo(S / 2 + 10, S / 2);
    ctx.moveTo(S / 2, S / 2 - 10);
    ctx.lineTo(S / 2, S / 2 + 10);
    ctx.stroke();
  }, [loupe, box.w]);

  const toNorm = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left - box.x) / box.w)), y: Math.min(1, Math.max(0, (e.clientY - r.top - box.y) / box.h)) };
  };
  const P = (p: Pt) => ({ x: box.x + p.x * box.w, y: box.y + p.y * box.h });

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const n = toNorm(e);
    setLoupe(n);
    if (drag.kind === 'c') {
      const q = [...quad] as Quad;
      const old = q[drag.i];
      q[drag.i] = n;
      let c = curve;
      if (c) {
        // los puntos medios de los dos bordes vecinos se desplazan con la esquina
        const dx = (n.x - old.x) / 2, dy = (n.y - old.y) / 2;
        const edges = [[0, 3], [0, 1], [1, 2], [2, 3]][drag.i];
        c = c.map((m, k) => (edges.includes(k) ? { x: m.x + dx, y: m.y + dy } : m)) as [Pt, Pt, Pt, Pt];
      }
      onChange(q, c);
    } else if (curve) {
      const c = [...curve] as [Pt, Pt, Pt, Pt];
      c[drag.i] = n;
      onChange(quad, c);
    }
  };

  // camino del borde (curvo si hay puntos medios)
  const path = () => {
    const q = quad.map(P);
    if (!curve) return `M${q[0].x},${q[0].y} L${q[1].x},${q[1].y} L${q[2].x},${q[2].y} L${q[3].x},${q[3].y} Z`;
    const m = curve.map(P);
    const ctrl = (a: Pt, b: Pt, mm: Pt) => ({ x: 2 * mm.x - (a.x + b.x) / 2, y: 2 * mm.y - (a.y + b.y) / 2 });
    const t = ctrl(q[0], q[1], m[0]), r = ctrl(q[1], q[2], m[1]), b = ctrl(q[3], q[2], m[2]), l = ctrl(q[0], q[3], m[3]);
    return `M${q[0].x},${q[0].y} Q${t.x},${t.y} ${q[1].x},${q[1].y} Q${r.x},${r.y} ${q[2].x},${q[2].y} Q${b.x},${b.y} ${q[3].x},${q[3].y} Q${l.x},${l.y} ${q[0].x},${q[0].y} Z`;
  };

  return (
    <div
      ref={wrap}
      className="absolute inset-0 touch-none select-none"
      onPointerMove={move}
      onPointerUp={() => {
        setDrag(null);
        setLoupe(null);
      }}
      onPointerCancel={() => {
        setDrag(null);
        setLoupe(null);
      }}
    >
      <img src={url} alt="" draggable={false} className="absolute shadow-pop" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <mask id="cropmask">
            <rect width="100%" height="100%" fill="white" />
            <path d={path()} fill="black" />
          </mask>
        </defs>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="rgba(0,0,0,0.45)" mask="url(#cropmask)" />
        <path d={path()} fill="none" stroke="#3b82f6" strokeWidth={3} />
        {quad.map((p, i) => {
          const q = P(p);
          return (
            <g key={'c' + i}>
              <circle cx={q.x} cy={q.y} r={26} fill="transparent" style={{ cursor: 'grab' }} onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ kind: 'c', i }); setLoupe(p); }} />
              <circle cx={q.x} cy={q.y} r={12} fill="white" stroke="#2563eb" strokeWidth={4} pointerEvents="none" />
            </g>
          );
        })}
        {curve &&
          curve.map((p, i) => {
            const q = P(p);
            return (
              <g key={'m' + i}>
                <circle cx={q.x} cy={q.y} r={24} fill="transparent" style={{ cursor: 'grab' }} onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ kind: 'm', i }); setLoupe(p); }} />
                <rect x={q.x - 9} y={q.y - 9} width={18} height={18} rx={5} fill="#2563eb" stroke="white" strokeWidth={3} pointerEvents="none" />
              </g>
            );
          })}
      </svg>
      {loupe && (
        <canvas
          ref={loupeRef}
          width={120}
          height={120}
          className="pointer-events-none absolute rounded-full border-4 border-white shadow-pop"
          style={{ left: loupe.x < 0.5 ? 'auto' : 12, right: loupe.x < 0.5 ? 12 : 'auto', top: 12 }}
        />
      )}
    </div>
  );
}

// ---------- borrado con pincel ----------

function EraseView({ url, dims, rotation, onStroke, busy }: { url: string; dims: { w: number; h: number; uw: number; uh: number }; rotation: number; onStroke: (s: EraseStroke) => void; busy: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, x: 0, y: 0 });
  const [brush, setBrush] = useState(4); // % del ancho
  const pts = useRef<Pt[]>([]);
  const drawing = useRef(false);

  useEffect(() => {
    const el = wrap.current!;
    const fit = () => {
      const pad = 16;
      const W = el.clientWidth - pad * 2, H = el.clientHeight - pad * 2 - 56;
      const s = Math.min(W / dims.w, H / dims.h);
      const w = dims.w * s, h = dims.h * s;
      setBox({ w, h, x: (el.clientWidth - w) / 2, y: 8 + (H - h) / 2 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims.w, dims.h]);

  useEffect(() => {
    const c = cvs.current;
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  }, [url]);

  const local = (e: React.PointerEvent) => {
    const r = cvs.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const unrot = (p: Pt): Pt => {
    switch (rotation) {
      case 90:
        return { x: p.y, y: 1 - p.x };
      case 180:
        return { x: 1 - p.x, y: 1 - p.y };
      case 270:
        return { x: 1 - p.y, y: p.x };
      default:
        return p;
    }
  };
  const paint = (p: Pt) => {
    const c = cvs.current!;
    const ctx = c.getContext('2d')!;
    const lw = (brush / 100) * c.width;
    ctx.strokeStyle = 'rgba(239,68,68,0.55)';
    ctx.fillStyle = 'rgba(239,68,68,0.55)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    const prev = pts.current[pts.current.length - 1];
    if (prev) {
      ctx.beginPath();
      ctx.moveTo(prev.x * c.width, prev.y * c.height);
      ctx.lineTo(p.x * c.width, p.y * c.height);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x * c.width, p.y * c.height, lw / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    pts.current.push(p);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (!pts.current.length) return;
    // tamaño relativo al ancho de la imagen sin girar
    const dispW = dims.w;
    const unW = dims.uw;
    const size = ((brush / 100) * dispW) / unW;
    onStroke({ pts: pts.current.map(unrot), size });
    pts.current = [];
  };

  return (
    <div ref={wrap} className="absolute inset-0 select-none">
      <img src={url} alt="" draggable={false} className="absolute shadow-pop" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      <canvas
        ref={cvs}
        width={Math.max(1, Math.round(box.w))}
        height={Math.max(1, Math.round(box.h))}
        className="absolute touch-none"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, cursor: 'crosshair', opacity: busy ? 0.5 : 1 }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drawing.current = true;
          pts.current = [];
          paint(local(e));
        }}
        onPointerMove={(e) => drawing.current && paint(local(e))}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="absolute inset-x-0 bottom-2 mx-auto flex max-w-xs items-center gap-3 rounded-2xl bg-surface px-4 py-1 shadow-card">
        <span className="text-sm font-bold">Pincel</span>
        <input type="range" min={1} max={12} step={0.5} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="flex-1" aria-label="Tamaño del pincel" />
        <span className="rounded-full bg-red-500/60" style={{ width: 8 + brush * 2.5, height: 8 + brush * 2.5 }} />
      </div>
    </div>
  );
}
