import { useEffect, useRef, useState } from 'react';
import { QrCode, Image as ImageIcon, Copy, ExternalLink, Share2, Trash2, CameraOff, History, Wifi, User, Link2, Mail, Phone, MapPin, Type } from 'lucide-react';
import { decodeCanvas, decodeBlob, classifyCode, type CodeResult } from '../lib/barcode';
import { pickFiles, copyText, shareText } from '../lib/share';
import { useApp, toast } from '../lib/store';
import { Button, Card, Modal, IconButton } from '../components/ui';
import { formatDate } from '../lib/util';

const KIND_ICON: Record<string, any> = { url: Link2, wifi: Wifi, contact: User, email: Mail, phone: Phone, sms: Phone, geo: MapPin, text: Type };

export default function QrPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CodeResult | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const pausedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: any;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        videoRef.current!.srcObject = s;
        await videoRef.current!.play().catch(() => {});
      } catch (e: any) {
        setErr(e?.name === 'NotAllowedError' ? 'Necesitas permitir el uso de la cámara.' : 'No se pudo abrir la cámara. Puedes leer un código desde una imagen.');
        return;
      }
      const c = document.createElement('canvas');
      const tick = async () => {
        if (!alive) return;
        const v = videoRef.current;
        if (v && v.videoWidth && !pausedRef.current) {
          const s = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
          c.width = Math.round(v.videoWidth * s);
          c.height = Math.round(v.videoHeight * s);
          c.getContext('2d', { willReadFrequently: true })!.drawImage(v, 0, 0, c.width, c.height);
          const r = await decodeCanvas(c);
          if (r && alive) found(r);
        }
        timer = setTimeout(tick, 220);
      };
      tick();
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function found(r: CodeResult) {
    pausedRef.current = true;
    navigator.vibrate?.(60);
    setResult(r);
    const h = [{ text: r.text, at: Date.now() }, ...useApp.getState().prefs.qrHistory.filter((x) => x.text !== r.text)].slice(0, 30);
    setPrefs({ qrHistory: h });
  }

  async function fromImage() {
    const [f] = await pickFiles('image/*', false);
    if (!f) return;
    const r = await decodeBlob(f);
    if (r) found(r);
    else toast('No se encontró ningún código en la imagen', 'error');
  }

  const info = result ? classifyCode(result.text) : null;
  const Icon = info ? KIND_ICON[info.kind] || Type : QrCode;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-3">
      <div className="safe-top flex items-center py-2">
        <h1 className="flex-1 text-2xl font-black">Leer QR y códigos</h1>
        <IconButton label="Historial" onClick={() => setHistOpen(true)}>
          <History className="size-6" />
        </IconButton>
      </div>
      <div className="relative mx-auto aspect-square max-h-[60dvh] w-full overflow-hidden rounded-3xl bg-black shadow-pop">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        {!err && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative size-[62%] rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              <div className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse bg-emerald-400" />
            </div>
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            <CameraOff className="size-12" />
            <p>{err}</p>
          </div>
        )}
      </div>
      <p className="mt-3 text-center text-soft">Apunta la cámara al código QR o de barras.</p>
      <div className="mt-3 flex justify-center">
        <Button variant="secondary" icon={<ImageIcon className="size-5" />} onClick={fromImage}>
          Leer desde una imagen
        </Button>
      </div>

      <Modal
        open={!!result}
        onClose={() => {
          setResult(null);
          pausedRef.current = false;
        }}
        title={
          <span className="flex items-center gap-2">
            <Icon className="size-6 text-primary" /> {info?.title}
          </span>
        }
        footer={
          <>
            <Button variant="secondary" icon={<Copy className="size-5" />} onClick={() => copyText(result!.text)}>
              Copiar
            </Button>
            <Button variant="secondary" icon={<Share2 className="size-5" />} onClick={() => shareText(result!.text)}>
              Compartir
            </Button>
            {info?.action && (
              <Button icon={<ExternalLink className="size-5" />} onClick={() => window.open(info.action!.href, '_blank', 'noopener')}>
                {info.action.label}
              </Button>
            )}
          </>
        }
      >
        {info && (
          <dl className="space-y-3">
            {info.fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm font-bold text-soft">{k}</dt>
                <dd className="flex items-center gap-2 text-lg font-semibold break-all">
                  <span className="flex-1">{v || '—'}</span>
                  {v && (
                    <IconButton label={'Copiar ' + k} className="size-9" onClick={() => copyText(v)}>
                      <Copy className="size-4" />
                    </IconButton>
                  )}
                </dd>
              </div>
            ))}
            {info.kind === 'url' && <p className="rounded-2xl bg-warn-soft p-3 text-sm text-warn">Revisa que el enlace sea de confianza antes de abrirlo.</p>}
            <p className="text-xs text-faint">Formato: {result?.format}</p>
          </dl>
        )}
      </Modal>

      <Modal open={histOpen} onClose={() => setHistOpen(false)} title="Historial de códigos">
        {prefs.qrHistory.length === 0 ? (
          <p className="text-soft">Todavía no has leído códigos.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {prefs.qrHistory.map((h, i) => (
                <li key={i}>
                  <Card className="flex items-center gap-2 p-3">
                    <button className="min-w-0 flex-1 text-left" onClick={() => { setHistOpen(false); setResult({ text: h.text, format: 'historial' }); pausedRef.current = true; }}>
                      <span className="block truncate font-semibold">{h.text}</span>
                      <span className="text-sm text-soft">{formatDate(h.at)}</span>
                    </button>
                    <IconButton label="Copiar" onClick={() => copyText(h.text)}>
                      <Copy className="size-5" />
                    </IconButton>
                  </Card>
                </li>
              ))}
            </ul>
            <Button variant="ghost" className="mt-3 text-danger" icon={<Trash2 className="size-5" />} onClick={() => setPrefs({ qrHistory: [] })}>
              Borrar historial
            </Button>
          </>
        )}
      </Modal>
    </div>
  );
}
