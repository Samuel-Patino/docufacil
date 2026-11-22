import { useEffect, useState } from 'react';
import { Delete, Fingerprint, Lock } from 'lucide-react';
import { useApp, toast } from '../lib/store';
import { getLockConfig, setPin, unlockWithPin, unlockWithBio } from '../lib/lock';
import { Modal, Button } from './ui';

export function PinPad({ value, onChange, length, onDone }: { value: string; onChange: (v: string) => void; length: number; onDone?: (v: string) => void }) {
  const press = (d: string) => {
    if (value.length >= 8) return;
    const v = value + d;
    onChange(v);
    if (v.length === length) setTimeout(() => onDone?.(v), 60);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter' && value.length >= 4) onDone?.(value);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <div>
      <div className="mb-5 flex justify-center gap-3" aria-label={`${value.length} dígitos`}>
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={`size-4 rounded-full transition ${i < value.length ? 'scale-110 bg-primary' : 'bg-surface-3'}`} />
        ))}
      </div>
      <div className="mx-auto grid max-w-[300px] grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} className="h-16 rounded-2xl bg-surface-2 text-2xl font-extrabold active:scale-95 active:bg-surface-3">
            {d}
          </button>
        ))}
        <span />
        <button onClick={() => press('0')} className="h-16 rounded-2xl bg-surface-2 text-2xl font-extrabold active:scale-95 active:bg-surface-3">
          0
        </button>
        <button aria-label="Borrar" onClick={() => onChange(value.slice(0, -1))} className="flex h-16 items-center justify-center rounded-2xl text-soft active:scale-95">
          <Delete className="size-7" />
        </button>
      </div>
    </div>
  );
}

export function UnlockModal() {
  const req = useApp((s) => s.unlockReq);
  const [mode, setMode] = useState<'loading' | 'enter' | 'create' | 'confirm'>('loading');
  const [pin, setPinV] = useState('');
  const [first, setFirst] = useState('');
  const [len, setLen] = useState(4);
  const [hasBio, setHasBio] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!req) return;
    setPinV('');
    setFirst('');
    setErr('');
    getLockConfig().then((cfg) => {
      if (cfg) {
        setLen(cfg.pinLength || 4);
        setHasBio(!!cfg.bio);
        setMode('enter');
        if (cfg.bio) bio();
      } else {
        setLen(4);
        setMode('create');
      }
    });
  }, [req]);

  if (!req) return null;

  async function bio() {
    const ok = await unlockWithBio();
    if (ok) req!.resolve(true);
  }

  async function submit(v: string) {
    if (mode === 'enter') {
      const ok = await unlockWithPin(v);
      if (ok) req!.resolve(true);
      else {
        setErr('PIN incorrecto. Intenta de nuevo.');
        setPinV('');
      }
    } else if (mode === 'create') {
      setFirst(v);
      setPinV('');
      setMode('confirm');
    } else if (mode === 'confirm') {
      if (v !== first) {
        setErr('Los PIN no coinciden. Empieza de nuevo.');
        setPinV('');
        setFirst('');
        setMode('create');
        return;
      }
      await setPin(v);
      toast('PIN creado. Tus archivos bloqueados quedan cifrados en este dispositivo.', 'ok', 4500);
      req!.resolve(true);
    }
  }

  const title = mode === 'create' ? 'Crea un PIN de 4 dígitos' : mode === 'confirm' ? 'Repite tu PIN' : 'Escribe tu PIN';

  return (
    <Modal open onClose={() => req.resolve(false)} title={<span className="flex items-center gap-2"><Lock className="size-6 text-primary" />{title}</span>}>
      {req.reason && mode === 'enter' && <p className="mb-3 text-center text-soft">{req.reason}</p>}
      {mode === 'create' && <p className="mb-3 text-center text-soft">Servirá para abrir las carpetas y archivos que bloquees. Si lo olvidas, no podrás recuperarlos.</p>}
      {err && <p className="mb-3 text-center font-bold text-danger">{err}</p>}
      {mode !== 'loading' && <PinPad value={pin} onChange={(v) => { setErr(''); setPinV(v); }} length={len} onDone={submit} />}
      {mode === 'enter' && hasBio && (
        <div className="mt-5 flex justify-center">
          <Button variant="soft" icon={<Fingerprint className="size-6" />} onClick={bio}>
            Usar huella / Face ID
          </Button>
        </div>
      )}
    </Modal>
  );
}
