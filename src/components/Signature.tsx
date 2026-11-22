import { useEffect, useRef, useState } from 'react';
import { Trash2, Plus, Eraser, Camera, PenLine, Type } from 'lucide-react';
import { Modal, Button, Segmented, inputCls, ColorDots, Empty, IconButton } from './ui';
import { listSignatures, addSignature, deleteSignature } from '../lib/library';
import type { Signature } from '../lib/db';
import { canvasToBlob } from '../lib/util';
import getStroke from 'perfect-freehand';
import { pickFiles } from '../lib/share';
import { toast, confirmDialog, errMsg } from '../lib/store';

const INK = ['#0f172a', '#1d4ed8', '#7c3aed', '#b91c1c'];

interface InkStroke {
  pts: [number, number, number][];
  /** Lápiz con presión real (Apple Pencil, S Pen); si no, se simula con la velocidad. */
  pen: boolean;
}

/**
 * Dibuja los trazos como tinta de bolígrafo: más gruesa al ir lento y donde se
 * apoya la punta, fina en los trazos rápidos, con la salida afinada y tinta un
 * poco translúcida que se oscurece donde los trazos se cruzan.
 */
function paintInk(ctx: CanvasRenderingContext2D, list: InkStroke[], color: string, live: boolean) {
  list.forEach((s, i) => {
    if (!s.pts.length) return;
    const last = live && i === list.length - 1;
    const outline = getStroke(s.pts, {
      size: 4.6,
      thinning: s.pen ? 0.6 : 0.68,
      smoothing: 0.62,
      streamline: 0.42,
      simulatePressure: !s.pen,
      easing: (t) => Math.sin((t * Math.PI) / 2),
      start: { taper: 6, easing: (t) => t * (2 - t), cap: true },
      end: { taper: last ? 0 : 28, easing: (t) => 1 - Math.pow(1 - t, 3), cap: true },
      last: !last,
    });
    if (outline.length < 2) return;
    const path = new Path2D();
    path.moveTo(outline[0][0], outline[0][1]);
    for (let j = 1; j < outline.length; j++) {
      const [x0, y0] = outline[j];
      const [x1, y1] = outline[(j + 1) % outline.length];
      path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    path.closePath();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.fill(path);
    // borde levemente más oscuro: la tinta se acumula en los bordes del trazo
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = color;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
  });
}

/** Recorta los bordes vacíos de un canvas con transparencia. */
function trimCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 <= x0 || y1 <= y0) return c;
  const pad = 12;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + pad * 2;
  out.height = y1 - y0 + pad * 2;
  out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function SignatureCreator({ onSaved, onCancel }: { onSaved: (s: Signature) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'draw' | 'type' | 'photo'>('draw');
  const [color, setColor] = useState(INK[0]);
  const [name, setName] = useState('');
  const cv = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<InkStroke[]>([]);
  const cur = useRef<InkStroke | null>(null);
  const [empty, setEmpty] = useState(true);

  const redraw = () => {
    const c = cv.current;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintInk(ctx, cur.current ? [...strokes.current, cur.current] : strokes.current, color, !!cur.current);
  };

  useEffect(() => {
    if (mode !== 'draw') return;
    const c = cv.current!;
    const dpr = devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    strokes.current = [];
    setEmpty(true);
  }, [mode]);

  useEffect(redraw, [color]);

  const addPoints = (e: React.PointerEvent) => {
    const s = cur.current;
    if (!s) return;
    const r = cv.current!.getBoundingClientRect();
    const evs: PointerEvent[] = (e.nativeEvent as any).getCoalescedEvents?.() || [e.nativeEvent];
    for (const ev of evs.length ? evs : [e.nativeEvent]) {
      s.pts.push([ev.clientX - r.left, ev.clientY - r.top, ev.pressure || 0.5]);
    }
    redraw();
  };

  const clear = () => {
    strokes.current = [];
    cur.current = null;
    redraw();
    setEmpty(true);
  };

  async function save() {
    try {
      let blob: Blob;
      if (mode === 'draw') {
        if (empty) return toast('Dibuja tu firma primero', 'info');
        // Se vuelve a dibujar a 3× para que la firma quede nítida al imprimir
        const src = cv.current!;
        const k = 3;
        const big = document.createElement('canvas');
        big.width = src.clientWidth * k;
        big.height = src.clientHeight * k;
        const bctx = big.getContext('2d')!;
        bctx.scale(k, k);
        paintInk(bctx, strokes.current, color, false);
        blob = await canvasToBlob(trimCanvas(big), 'image/png');
      } else {
        if (!name.trim()) return toast('Escribe tu nombre', 'info');
        await document.fonts.load('600 80px "Dancing Script"');
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d')!;
        ctx.font = '600 110px "Dancing Script", cursive';
        const w = ctx.measureText(name).width;
        c.width = Math.ceil(w + 60);
        c.height = 180;
        ctx.font = '600 110px "Dancing Script", cursive';
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 30, 95);
        blob = await canvasToBlob(trimCanvas(c), 'image/png');
      }
      const s = await addSignature(blob);
      toast('Firma guardada para reutilizarla', 'ok');
      onSaved(s);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  async function fromPhoto() {
    const [f] = await pickFiles('image/*', false);
    if (!f) return;
    try {
      const { signatureFromPhoto } = await import('../lib/imaging');
      const blob = await signatureFromPhoto(f);
      const s = await addSignature(blob);
      toast('Firma guardada', 'ok');
      onSaved(s);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  return (
    <div>
      <Segmented
        className="mb-3"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'draw', label: <span className="flex items-center justify-center gap-1.5"><PenLine className="size-4" />Dibujar</span> },
          { value: 'type', label: <span className="flex items-center justify-center gap-1.5"><Type className="size-4" />Escribir</span> },
          { value: 'photo', label: <span className="flex items-center justify-center gap-1.5"><Camera className="size-4" />Foto</span> },
        ]}
      />
      {mode === 'draw' && (
        <>
          <div className="relative">
            <canvas
              ref={cv}
              className="h-48 w-full touch-none rounded-2xl border-2 border-dashed border-line bg-white"
              onPointerDown={(e) => {
                try {
                  (e.target as Element).setPointerCapture(e.pointerId);
                } catch {}
                cur.current = { pts: [], pen: e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5 };
                addPoints(e);
                setEmpty(false);
              }}
              onPointerMove={(e) => cur.current && addPoints(e)}
              onPointerUp={() => {
                if (cur.current?.pts.length) strokes.current.push(cur.current);
                cur.current = null;
                redraw();
              }}
              onPointerCancel={() => {
                cur.current = null;
                redraw();
              }}
            />
            <div className="pointer-events-none absolute inset-x-6 bottom-10 border-b-2 border-slate-300" />
            {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-semibold text-slate-400">Firma aquí con el dedo o el mouse</span>}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <ColorDots custom value={color} onChange={setColor} colors={INK} />
            <Button variant="ghost" size="sm" icon={<Eraser className="size-5" />} onClick={clear}>
              Borrar
            </Button>
          </div>
        </>
      )}
      {mode === 'type' && (
        <>
          <input className={inputCls} placeholder="Tu nombre completo" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="mt-3 flex h-28 items-center justify-center overflow-hidden rounded-2xl border border-line bg-white px-4 text-5xl" style={{ fontFamily: '"Dancing Script", cursive', color }}>
            {name || <span className="text-slate-300">Tu firma</span>}
          </div>
          <div className="mt-2">
            <ColorDots custom value={color} onChange={setColor} colors={INK} />
          </div>
        </>
      )}
      {mode === 'photo' && (
        <div className="rounded-2xl bg-surface-2 p-4 text-center">
          <p className="mb-3 text-soft">Firma en una hoja blanca con tinta oscura y tómale una foto. Quitaremos el fondo automáticamente.</p>
          <Button icon={<Camera className="size-5" />} onClick={fromPhoto}>
            Elegir o tomar foto
          </Button>
        </div>
      )}
      {mode !== 'photo' && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={save}>Guardar firma</Button>
        </div>
      )}
    </div>
  );
}

export function SignaturePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick?: (blob: Blob) => void }) {
  const [list, setList] = useState<Signature[]>([]);
  const [creating, setCreating] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const reload = async () => {
    const l = await listSignatures();
    setList(l);
    const u: Record<string, string> = {};
    l.forEach((s) => (u[s.id] = URL.createObjectURL(s.blob)));
    setUrls(u);
    if (!l.length) setCreating(true);
  };
  useEffect(() => {
    if (open) {
      setCreating(false);
      reload();
    }
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={creating ? 'Crear firma' : onPick ? 'Elige tu firma' : 'Mis firmas'}>
      {creating ? (
        <SignatureCreator
          onCancel={() => (list.length ? setCreating(false) : onClose())}
          onSaved={(s) => {
            if (onPick) {
              onPick(s.blob);
              onClose();
            } else {
              setCreating(false);
              reload();
            }
          }}
        />
      ) : (
        <>
          {list.length === 0 ? (
            <Empty icon={<PenLine className="size-9" />} title="Sin firmas" text="Crea tu firma una vez y úsala en todos tus documentos." />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {list.map((s) => (
                <div key={s.id} className="relative">
                  <button
                    onClick={() => {
                      if (onPick) {
                        onPick(s.blob);
                        onClose();
                      }
                    }}
                    className="flex h-28 w-full items-center justify-center rounded-2xl border border-line bg-white p-3 hover:border-primary"
                  >
                    {urls[s.id] && <img src={urls[s.id]} alt="Firma" className="max-h-full max-w-full object-contain" />}
                  </button>
                  <IconButton
                    label="Eliminar firma"
                    className="absolute top-1 right-1 size-9 bg-surface text-danger shadow-card"
                    onClick={async () => {
                      if (await confirmDialog('¿Eliminar esta firma?', undefined, { danger: true, confirmText: 'Eliminar' })) {
                        await deleteSignature(s.id);
                        reload();
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
          <Button className="mt-4 w-full" variant="soft" icon={<Plus className="size-5" />} onClick={() => setCreating(true)}>
            Crear nueva firma
          </Button>
        </>
      )}
    </Modal>
  );
}
