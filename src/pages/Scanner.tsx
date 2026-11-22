import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X, Zap, ZapOff, Image as ImageIcon, Check, Sparkles, CameraOff, Loader2, Copy, MoreHorizontal } from 'lucide-react';
import { useApp, toast, confirmDialog, setBusy } from '../lib/store';
import { loadCV } from '../lib/cv';
import { detectDocument, detectInBlob, quadDistance } from '../lib/detect';
import { SCAN_MODES, DEFAULT_ADJ, ID_CARD_ASPECT, PASSPORT_ASPECT, type ScanMode, type ScanPage, type Quad, type Pt } from '../lib/scanTypes';
import { pageThumb, renderScanPage, newCanvas, blobToCanvas, scaleCanvas } from '../lib/imaging';
import { pendingTranslate } from '../lib/translate';
import { readMRZ, formatMrzDate, type MrzData } from '../lib/ocr';
import { pickFiles, copyText } from '../lib/share';
import { uid, canvasToBlob } from '../lib/util';
import { Button, Modal } from '../components/ui';

type Hint = { text: string; tone: 'info' | 'ok' | 'warn' };

function guideQuad(aspect: number, vw: number, vh: number): Quad {
  // Rectángulo guía centrado (80% del lado corto) con la proporción del documento
  const landscapeFrame = vw >= vh;
  let w = vw * 0.82;
  let h = w / aspect;
  if (!landscapeFrame) {
    w = vw * 0.86;
    h = w / aspect;
  }
  if (h > vh * 0.8) {
    h = vh * 0.8;
    w = h * aspect;
  }
  const x = (vw - w) / 2 / vw, y = (vh - h) / 2 / vh, X = x + w / vw, Y = y + h / vh;
  return [
    { x, y },
    { x: X, y },
    { x: X, y: Y },
    { x, y: Y },
  ];
}

export default function Scanner() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const scan = useApp((s) => s.scan);
  const initialMode = (params.get('mode') as ScanMode) || scan?.mode || 'document';
  const [mode, setMode] = useState<ScanMode>(initialMode === 'qr' ? 'document' : initialMode);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cvReady, setCvReady] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [hint, setHint] = useState<Hint>({ text: 'Preparando la cámara…', tone: 'info' });
  const [flash, setFlash] = useState(0);
  const [stableP, setStableP] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [idSide, setIdSide] = useState<'front' | 'back'>('front');
  const [idFront, setIdFront] = useState<ScanPage | null>(null);
  const [mrz, setMrz] = useState<MrzData | null | 'none'>(null);
  const liveQuad = useRef<Quad | null>(null);
  const stableSince = useRef(0);
  const lastShot = useRef(0);
  const shotQuad = useRef<Quad | null>(null);
  const lostSince = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pages = scan?.pages || [];
  const retakeId = params.get('retake');
  const thumbBtnRef = useRef<HTMLButtonElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState<{ src: string; key: number } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (initialMode === 'qr') nav('/qr', { replace: true });
    if (!useApp.getState().scan) useApp.getState().setScan({ pages: [], mode });
  }, []);

  // ----- cámara -----
  const startCamera = useCallback(async () => {
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Este navegador no permite usar la cámara. Abre la app con https:// o usa “Importar fotos”.');
      return;
    }
    const tries: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: true, audio: false },
    ];
    let stream: MediaStream | null = null;
    let lastErr: any;
    for (const c of tries) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (e: any) {
        lastErr = e;
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') break;
      }
    }
    if (!stream) {
      setCamError(
        lastErr?.name === 'NotAllowedError'
          ? 'No diste permiso para usar la cámara. Actívalo en los ajustes del navegador y vuelve a intentar.'
          : 'No se encontró una cámara disponible.',
      );
      return;
    }
    streamRef.current = stream;
    const v = videoRef.current!;
    v.srcObject = stream;
    await v.play().catch(() => {});
    setReady(true);
    const track = stream.getVideoTracks()[0];
    try {
      const caps: any = track.getCapabilities?.();
      if (caps?.torch) setTorch(false);
      if (caps?.focusMode?.includes?.('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
    } catch {}
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  };

  useEffect(() => {
    startCamera();
    loadCV()
      .then(() => setCvReady(true))
      .catch((e) => toast(e.message, 'error'));
    const vis = () => {
      if (document.hidden) stopCamera();
      else startCamera();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      stopCamera();
    };
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as any] });
      setTorch(!torch);
    } catch {
      toast('No se pudo encender la linterna', 'error');
    }
  };

  // ----- detección en tiempo real -----
  const aspectFor = (m: ScanMode) => (m === 'idcard' ? ID_CARD_ASPECT : m === 'passport' ? PASSPORT_ASPECT : undefined);

  useEffect(() => {
    if (!ready || !cvReady) return;
    const cv = (window as any).__cvReady;
    const small = document.createElement('canvas');
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    let alive = true;
    let timer: any;
    const loop = () => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && v.videoWidth && !capturingRef.current) {
        const s = 400 / Math.max(v.videoWidth, v.videoHeight);
        small.width = Math.round(v.videoWidth * s);
        small.height = Math.round(v.videoHeight * s);
        sctx.drawImage(v, 0, 0, small.width, small.height);
        const m = modeRef.current;
        const det = detectDocument(cv, small, { curve: m === 'book', minArea: m === 'idcard' || m === 'passport' ? 0.06 : 0.12 });
        const prev = liveQuad.current;
        let q: Quad | null = det?.quad ?? null;
        if (q && prev && quadDistance(q, prev) < 0.08) {
          // suavizado para que el marco no tiemble
          q = q.map((p, i) => ({ x: prev[i].x * 0.55 + p.x * 0.45, y: prev[i].y * 0.55 + p.y * 0.45 })) as Quad;
        }
        const moved = !q || !prev || quadDistance(q, prev) > 0.018;
        liveQuad.current = q;
        const now = performance.now();
        // Tras una captura automática, esperamos a que cambie la página antes de volver a disparar
        if (shotQuad.current && (!q || quadDistance(q, shotQuad.current) > 0.12)) {
          if (!q) {
            if (!lostSince.current) lostSince.current = now;
            if (now - lostSince.current > 500) shotQuad.current = null;
          } else shotQuad.current = null;
        } else lostSince.current = 0;
        if (!q) {
          stableSince.current = 0;
          setStableP(0);
          setHint({ text: m === 'idcard' || m === 'passport' ? 'Coloca el documento dentro del marco' : 'Buscando el documento…', tone: 'info' });
        } else if (shotQuad.current && prefsRef.current.autoCapture) {
          setStableP(0);
          setHint({ text: '¡Capturada! Pon la siguiente página o toca Listo', tone: 'ok' });
        } else {
          if (moved) stableSince.current = now;
          const area = det!.area;
          if (area < 0.2 && m !== 'idcard' && m !== 'passport') setHint({ text: 'Acércate un poco más', tone: 'warn' });
          else setHint({ text: prefsRef.current.autoCapture ? 'Mantén quieto…' : 'Documento detectado', tone: 'ok' });
          const held = stableSince.current ? now - stableSince.current : 0;
          const need = 1300;
          const p = Math.min(1, held / need);
          setStableP(prefsRef.current.autoCapture ? p : 0);
          if (prefsRef.current.autoCapture && p >= 1 && now - lastShot.current > 1500 && area >= 0.15) {
            lastShot.current = now;
            stableSince.current = 0;
            shotQuad.current = q;
            captureRef.current();
          }
        }
        draw(q, m);
      }
      timer = setTimeout(loop, 110);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ready, cvReady]);

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const capturingRef = useRef(false);

  function draw(q: Quad | null, m: ScanMode) {
    const c = overlayRef.current, v = videoRef.current;
    if (!c || !v) return;
    const dpr = devicePixelRatio || 1;
    const ew = c.clientWidth, eh = c.clientHeight;
    if (c.width !== Math.round(ew * dpr)) {
      c.width = Math.round(ew * dpr);
      c.height = Math.round(eh * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ew, eh);
    const vw = v.videoWidth, vh = v.videoHeight;
    const s = Math.max(ew / vw, eh / vh);
    const ox = (ew - vw * s) / 2, oy = (eh - vh * s) / 2;
    const P = (p: Pt) => ({ x: ox + p.x * vw * s, y: oy + p.y * vh * s });
    const asp = aspectFor(m);
    if (asp && !q) {
      const g = guideQuad(asp, vw, vh).map(P);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      g.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!q) return;
    const pts = q.map(P);
    ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const p of pts) {
      ctx.beginPath();
      ctx.fillStyle = '#fff';
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2563eb';
      ctx.stroke();
    }
  }

  // ----- captura -----
  const filterFor = (m: ScanMode) => {
    const d = prefs.defaultFilter;
    if (d !== 'mode' && m !== 'idcard' && m !== 'passport' && m !== 'receipt' && m !== 'whiteboard') return d;
    return SCAN_MODES.find((x) => x.id === m)!.filter;
  };

  async function makePage(orig: Blob, m: ScanMode, live: Quad | null, frameW: number, frameH: number): Promise<ScanPage> {
    const cv = await loadCV().catch(() => null);
    let quad: Quad | null = null;
    let curve: ScanPage['curve'] = null;
    if (cv) {
      const det = await detectInBlob(cv, orig, m === 'book');
      if (det) {
        quad = det.quad;
        curve = det.curve;
      }
    }
    if (!quad && live) quad = live;
    const asp = aspectFor(m);
    if (!quad && asp) quad = guideQuad(asp, frameW, frameH);
    const page: ScanPage = {
      id: uid(),
      orig,
      quad,
      curve,
      filter: filterFor(m),
      adj: { ...DEFAULT_ADJ },
      rotation: 0,
      erase: [],
      aspect: asp,
    };
    page.thumb = await pageThumb(page).catch(() => undefined);
    return page;
  }

  const addPages = (ps: ScanPage[]) => {
    const st = useApp.getState();
    if (retakeId && st.scan?.pages.some((p) => p.id === retakeId)) {
      // Retomar: reemplaza la página y vuelve a la revisión
      st.updateScan((s) => ({ ...s, pages: s.pages.flatMap((p) => (p.id === retakeId ? ps : [p])) }));
      stopCamera();
      toast('Página reemplazada', 'ok');
      nav('/review', { replace: true });
      return;
    }
    if (!st.scan) st.setScan({ pages: ps, mode });
    else st.updateScan((s) => ({ ...s, pages: [...s.pages, ...ps], mode }));
  };

  function toTranslate(page: ScanPage) {
    pendingTranslate.page = page;
    const st = useApp.getState();
    if (st.scan && !st.scan.pages.length) st.setScan(null);
    stopCamera();
    nav('/translate');
  }

  /** Animación: la foto vuela hasta el botón de páginas (abajo a la derecha). */
  function flyShot(c: HTMLCanvasElement) {
    try {
      setFly({ src: scaleCanvas(c, 520).toDataURL('image/jpeg', 0.7), key: Date.now() });
    } catch {}
  }

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    setFlash((f) => f + 1);
    navigator.vibrate?.(30);
    try {
      const c = newCanvas(v.videoWidth, v.videoHeight);
      c.getContext('2d')!.drawImage(v, 0, 0);
      flyShot(c);
      const orig = await canvasToBlob(c, 'image/jpeg', 0.93);
      const m = modeRef.current;
      const page = await makePage(orig, m, liveQuad.current, v.videoWidth, v.videoHeight);
      await afterCapture(page, m);
    } catch (e: any) {
      toast('No se pudo capturar: ' + (e?.message || e), 'error');
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }
  const captureRef = useRef(capture);
  captureRef.current = capture;

  async function afterCapture(page: ScanPage, m: ScanMode) {
    if (m === 'translate' && !retakeId) return toTranslate(page);
    if (m === 'idcard') {
      if (idSide === 'front' && !idFront) {
        setIdFront(page);
        setIdSide('back');
        toast('¡Listo el frente! Ahora voltea la cédula y escanea el reverso.', 'ok', 4000);
        return;
      }
      const combined = await combineId(idFront!, page);
      addPages([combined]);
      setIdFront(null);
      setIdSide('front');
      toast('Cédula escaneada (frente y reverso en una página)', 'ok');
      return;
    }
    if (m === 'passport') {
      addPages([page]);
      if (retakeId) return;
      setBusy('Leyendo los datos del pasaporte…');
      try {
        const c = await renderScanPage({ ...page, filter: 'original' }, 2000);
        const r = await readMRZ(c);
        setMrz(r || 'none');
      } catch {
        setMrz('none');
      } finally {
        setBusy(null);
      }
      return;
    }
    addPages([page]);
  }

  async function combineId(front: ScanPage, back: ScanPage | null): Promise<ScanPage> {
    // A4 a 200 ppp con ambas caras centradas, tamaño real de la tarjeta (85,6 mm)
    const W = 1654, H = 2339;
    const cardW = Math.round((85.6 / 210) * W * 1.25);
    const c = newCanvas(W, H);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    const sides = [front, back].filter(Boolean) as ScanPage[];
    for (let i = 0; i < sides.length; i++) {
      const img = await renderScanPage(sides[i], 1600);
      const h = Math.round((img.height / img.width) * cardW);
      const y = sides.length === 1 ? (H - h) / 2 : i === 0 ? H * 0.27 - h / 2 : H * 0.7 - h / 2;
      ctx.drawImage(img, (W - cardW) / 2, y, cardW, h);
    }
    const orig = await canvasToBlob(c, 'image/jpeg', 0.92);
    const page: ScanPage = { id: uid(), orig, quad: null, curve: null, filter: 'original', adj: { ...DEFAULT_ADJ }, rotation: 0, erase: [] };
    page.thumb = await pageThumb(page).catch(() => undefined);
    return page;
  }

  async function fromGallery() {
    const files = await pickFiles('image/*', !retakeId && mode !== 'translate');
    if (!files.length) return;
    setBusy('Detectando bordes…');
    if (mode === 'translate' && !retakeId) {
      try {
        const bmp = await createImageBitmap(files[0]);
        const page = await makePage(files[0], 'document', null, bmp.width, bmp.height);
        bmp.close();
        return toTranslate(page);
      } catch (e: any) {
        return toast(e?.message || String(e), 'error');
      } finally {
        setBusy(null);
      }
    }
    try {
      const out: ScanPage[] = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(`Procesando ${i + 1} de ${files.length}…`, i / files.length);
        let orig: Blob = files[i];
        if (!/jpe?g|png|webp/i.test(orig.type)) {
          const c = await blobToCanvas(orig, 4000);
          orig = await canvasToBlob(c, 'image/jpeg', 0.92);
        }
        const bmp = await createImageBitmap(orig);
        const page = await makePage(orig, mode === 'idcard' ? 'document' : mode, null, bmp.width, bmp.height);
        bmp.close();
        out.push(page);
      }
      addPages(out);
      if (!retakeId) toast(`${out.length} imagen(es) agregadas`, 'ok');
    } catch (e: any) {
      toast(e?.message || String(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    if (retakeId) {
      stopCamera();
      return nav('/review', { replace: true });
    }
    if (pages.length && !scan?.docId) {
      if (!(await confirmDialog('¿Descartar el escaneo?', `Tienes ${pages.length} página(s) sin guardar.`, { confirmText: 'Descartar', danger: true }))) return;
      useApp.getState().setScan(null);
    }
    stopCamera();
    if (scan?.docId) nav('/review');
    else nav('/');
  }

  function pickMode(id: ScanMode) {
    if (id === 'qr') return nav('/qr');
    setMode(id);
    setIdFront(null);
    setIdSide('front');
    liveQuad.current = null;
  }

  const last = pages[pages.length - 1];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* barra superior */}
      <div className="safe-top absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-2 px-3 py-2">
          <button aria-label="Cerrar" onClick={close} className="flex size-12 items-center justify-center rounded-full bg-black/40 active:scale-95">
            <X className="size-7" />
          </button>
          <div className="flex-1 text-center text-lg font-extrabold">
            {retakeId ? 'Retomar página' : mode === 'idcard' ? (idSide === 'front' ? 'Cédula · Frente' : 'Cédula · Reverso') : SCAN_MODES.find((m) => m.id === mode)?.label}
            {!retakeId && (mode === 'sign' || mode === 'translate') && (
              <div className="text-xs font-semibold text-white/75">{mode === 'sign' ? 'Escanea el documento y luego fírmalo' : 'Toma una foto del texto a traducir'}</div>
            )}
          </div>
          {torch !== null && (
            <button aria-label="Linterna" onClick={toggleTorch} className={`flex size-12 items-center justify-center rounded-full active:scale-95 ${torch ? 'bg-yellow-400 text-black' : 'bg-black/40'}`}>
              {torch ? <Zap className="size-6" /> : <ZapOff className="size-6" />}
            </button>
          )}
          <button
            aria-label="Captura automática"
            onClick={() => setPrefs({ autoCapture: !prefs.autoCapture })}
            className={`flex h-12 items-center gap-1 rounded-full px-3 text-sm font-bold active:scale-95 ${prefs.autoCapture ? 'bg-primary text-white' : 'bg-black/40'}`}
          >
            <Sparkles className="size-5" /> Auto
          </button>
        </div>
      </div>

      {/* video */}
      <div ref={videoBoxRef} className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {flash > 0 && <div key={flash} className="pointer-events-none absolute inset-0 bg-white animate-shutter" />}
        {camError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <CameraOff className="size-14 opacity-80" />
            <p className="max-w-sm text-lg">{camError}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={startCamera}>Reintentar</Button>
              <Button variant="secondary" icon={<ImageIcon className="size-5" />} onClick={fromGallery}>
                Importar fotos
              </Button>
            </div>
          </div>
        )}
        {!camError && (
          <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center">
            <span
              className={`rounded-full px-4 py-2 text-base font-bold shadow-lg backdrop-blur ${
                hint.tone === 'ok' ? 'bg-emerald-500/90' : hint.tone === 'warn' ? 'bg-amber-500/90 text-black' : 'bg-black/55'
              }`}
            >
              {!cvReady && ready ? 'Cargando detector de bordes…' : hint.text}
            </span>
          </div>
        )}
        {mode === 'idcard' && idSide === 'back' && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const combined = await combineId(idFront!, null);
                addPages([combined]);
                setIdFront(null);
                setIdSide('front');
              }}
            >
              Omitir reverso
            </Button>
          </div>
        )}
      </div>

      {/* modos */}
      {!retakeId && (
        <div className="relative bg-black">
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3 pb-1">
            {SCAN_MODES.filter((m) => !m.more).map((m) => (
              <button
                key={m.id}
                onClick={() => pickMode(m.id)}
                className={`h-10 shrink-0 rounded-full px-4 text-sm font-bold ${mode === m.id ? 'bg-white text-black' : 'bg-white/10 text-white/85'}`}
              >
                {m.label}
              </button>
            ))}
            {(() => {
              const extra = SCAN_MODES.find((m) => m.more && m.id === mode);
              return (
                <button
                  aria-label="Más modos"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((o) => !o)}
                  className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold ${extra ? 'bg-white text-black' : 'bg-white/10 text-white/85'}`}
                >
                  {extra?.label}
                  <MoreHorizontal className="size-5" />
                </button>
              );
            })()}
          </div>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-3 bottom-full z-40 mb-2 w-52 overflow-hidden rounded-2xl bg-neutral-900/95 shadow-2xl ring-1 ring-white/10 backdrop-blur animate-pop">
                {SCAN_MODES.filter((m) => m.more).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setMoreOpen(false);
                      pickMode(m.id);
                    }}
                    className={`flex h-12 w-full items-center justify-between px-4 text-left font-bold ${mode === m.id ? 'text-primary' : 'text-white'} hover:bg-white/10`}
                  >
                    {m.label}
                    {mode === m.id && <Check className="size-5" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* controles */}
      <div className="safe-bottom bg-black">
        <div className="mx-auto flex max-w-md items-center justify-between px-6 py-4">
          <button aria-label="Importar desde la galería" onClick={fromGallery} className="flex size-14 items-center justify-center rounded-2xl bg-white/10 active:scale-95">
            <ImageIcon className="size-7" />
          </button>
          <button aria-label="Tomar foto" onClick={() => capture()} disabled={!ready || capturing} className="relative flex size-[84px] items-center justify-center rounded-full active:scale-95 disabled:opacity-60">
            <svg className="absolute inset-0" viewBox="0 0 84 84">
              <circle cx="42" cy="42" r="38" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="5" />
              <circle
                cx="42"
                cy="42"
                r="38"
                fill="none"
                stroke="#22c55e"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 38}
                strokeDashoffset={2 * Math.PI * 38 * (1 - stableP)}
                transform="rotate(-90 42 42)"
                style={{ transition: 'stroke-dashoffset 0.1s linear' }}
              />
            </svg>
            <span className="flex size-[66px] items-center justify-center rounded-full bg-white">{capturing && <Loader2 className="size-8 animate-spin text-black" />}</span>
          </button>
          <button
            ref={thumbBtnRef}
            aria-label="Terminar y revisar"
            onClick={() => {
              stopCamera();
              nav('/review');
            }}
            disabled={!pages.length || !!retakeId}
            className="relative flex size-14 items-center justify-center rounded-2xl bg-white/10 active:scale-95 disabled:opacity-40"
          >
            {last?.thumb ? <img src={last.thumb} alt="" className="h-full w-full rounded-2xl object-cover" /> : <Check className="size-7" />}
            {pages.length > 0 && (
              <span key={pages.length} className="absolute -top-2 -right-2 flex min-w-7 items-center justify-center rounded-full bg-primary px-1.5 text-sm font-black text-white animate-badge">{pages.length}</span>
            )}
          </button>
        </div>
        {pages.length > 0 && !retakeId && (
          <div className="flex justify-center pb-3">
            <Button
              size="sm"
              icon={<Check className="size-5" />}
              onClick={() => {
                stopCamera();
                nav('/review');
              }}
            >
              Listo · {pages.length} página(s)
            </Button>
          </div>
        )}
      </div>

      {fly && <FlyShot key={fly.key} src={fly.src} from={videoBoxRef.current} to={thumbBtnRef.current} onDone={() => setFly(null)} />}

      <Modal
        open={mrz !== null}
        onClose={() => setMrz(null)}
        title="Datos del pasaporte"
        footer={
          <>
            {mrz && mrz !== 'none' && (
              <Button
                variant="secondary"
                icon={<Copy className="size-5" />}
                onClick={() =>
                  copyText(
                    Object.entries(mrzFields(mrz))
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('\n'),
                  )
                }
              >
                Copiar
              </Button>
            )}
            <Button onClick={() => setMrz(null)}>Continuar</Button>
          </>
        }
      >
        {mrz === 'none' || !mrz ? (
          <p className="text-soft">No se pudo leer la zona de códigos (las 2 líneas con “&lt;&lt;&lt;” al final de la página). La foto quedó guardada; puedes intentar de nuevo con mejor luz y sin reflejos.</p>
        ) : (
          <div className="text-text">
            {!mrz.valid && <p className="mb-3 rounded-2xl bg-warn-soft p-3 text-sm font-semibold text-warn">Algunos datos podrían tener errores. Revísalos.</p>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              {Object.entries(mrzFields(mrz)).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-bold text-soft">{k}</dt>
                  <dd className="font-semibold">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}

function mrzFields(m: MrzData): Record<string, string> {
  const f = m.fields;
  return {
    Apellidos: (f.lastName || '').replace(/</g, ' ').trim(),
    Nombres: (f.firstName || '').replace(/</g, ' ').trim(),
    'Nº de documento': f.documentNumber || '',
    Nacionalidad: f.nationality || '',
    'País emisor': f.issuingState || '',
    Nacimiento: formatMrzDate(f.birthDate),
    Sexo: f.sex === 'male' ? 'Masculino' : f.sex === 'female' ? 'Femenino' : f.sex || '',
    Vencimiento: formatMrzDate(f.expirationDate),
  };
}

/** Miniatura que vuela desde la vista de la cámara hasta el botón de páginas. */
function FlyShot({ src, from, to, onDone }: { src: string; from: HTMLElement | null; to: HTMLElement | null; onDone: () => void }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !from || !to) return onDone();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top;
    const sx = b.width / a.width, sy = b.height / a.height;
    const anim = el.animate(
      [
        { transform: 'translate(0,0) scale(1,1)', borderRadius: '0px', opacity: 1 },
        { transform: `translate(${a.width * 0.06}px, ${a.height * 0.06}px) scale(0.88,0.88)`, borderRadius: '24px', opacity: 1, offset: 0.25 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: '120px', opacity: 0.85 },
      ],
      { duration: 620, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'forwards' },
    );
    anim.onfinish = onDone;
    return () => anim.cancel();
  }, []);
  if (!from) return null;
  const r = from.getBoundingClientRect();
  return (
    <img
      ref={ref}
      src={src}
      alt=""
      className="pointer-events-none fixed z-[60] object-cover shadow-2xl ring-4 ring-white"
      style={{ left: r.left, top: r.top, width: r.width, height: r.height, transformOrigin: '0 0' }}
    />
  );
}
