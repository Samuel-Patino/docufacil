import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Info, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/store';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  children,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  const v: Record<Variant, string> = {
    primary: 'bg-primary text-on-primary hover:bg-primary-strong shadow-card',
    secondary: 'bg-surface text-text border border-line hover:bg-surface-2',
    ghost: 'text-text hover:bg-surface-2',
    danger: 'bg-danger text-white hover:opacity-90',
    soft: 'bg-primary-soft text-primary hover:brightness-95',
  };
  const s = { sm: 'h-10 px-3 text-sm gap-1.5', md: 'h-12 px-4 text-base gap-2', lg: 'h-14 px-6 text-lg gap-2.5' }[size];
  return (
    <button
      className={`inline-flex items-center justify-center rounded-2xl font-bold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 select-none ${v[variant]} ${s} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-2xl transition active:scale-95 disabled:opacity-40 ${
        active ? 'bg-primary text-on-primary' : 'text-text hover:bg-surface-2'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Botón con ícono y texto debajo, para barras inferiores. */
export function BarButton({ icon, label, onClick, primary }: { icon: ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-w-[4.25rem] shrink-0 flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] font-bold transition active:scale-95 ${
        primary ? 'bg-primary-soft text-primary' : 'text-soft hover:bg-surface-2 hover:text-text'
      }`}
    >
      <span className="[&>svg]:size-6">{icon}</span>
      {label}
    </button>
  );
}

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-3xl border border-line bg-surface shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function TopBar({ title, back, right, sub }: { title: ReactNode; back?: string | boolean; right?: ReactNode; sub?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-2 sm:px-4">
        {back !== undefined && back !== false && (
          <IconButton label="Volver" onClick={() => (typeof back === 'string' ? nav(back) : history.length > 1 ? nav(-1) : nav('/'))}>
            <ChevronLeft className="size-7" />
          </IconButton>
        )}
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-lg font-extrabold leading-tight sm:text-xl">{title}</h1>
          {sub && <div className="truncate text-sm text-soft">{sub}</div>}
        </div>
        <div className="flex items-center gap-1">{right}</div>
      </div>
    </header>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 animate-fade sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        className={`safe-bottom flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-pop animate-sheet sm:rounded-3xl sm:animate-pop ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-surface-3 sm:hidden" />
        {title && (
          <div className="flex items-center gap-2 px-5 pt-3 pb-2">
            <h2 className="flex-1 text-xl font-extrabold">{title}</h2>
            <IconButton label="Cerrar" onClick={onClose}>
              <X className="size-6" />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {children}
    </Modal>
  );
}

export function MenuItem({ icon, label, onClick, danger, hint }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean; hint?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left text-base font-semibold hover:bg-surface-2 active:scale-[0.99] ${danger ? 'text-danger' : ''}`}
    >
      <span className={`flex size-10 items-center justify-center rounded-xl ${danger ? 'bg-danger-soft' : 'bg-surface-2'}`}>{icon}</span>
      <span className="flex-1">
        {label}
        {hint && <span className="block text-sm font-normal text-soft">{hint}</span>}
      </span>
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex-1">
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-soft">{hint}</span>}
      </span>
      <span className={`relative h-8 w-14 shrink-0 rounded-full transition ${checked ? 'bg-primary' : 'bg-surface-3'}`}>
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${checked ? 'left-7' : 'left-1'}`} />
      </span>
    </label>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, suffix = '' }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="block py-1">
      <span className="flex justify-between text-sm font-semibold">
        <span>{label}</span>
        <span className="text-soft tabular-nums">
          {value}
          {suffix}
        </span>
      </span>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className = '' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-1 rounded-2xl bg-surface-2 p-1 ${className}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-xl px-3 text-sm font-bold transition ${value === o.value ? 'bg-surface text-primary shadow-card' : 'text-soft hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block py-1.5">
      <span className="mb-1 block text-sm font-bold text-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base text-text outline-none placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-primary/30';

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return <Loader2 className={`animate-spin text-primary ${className}`} />;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-20 items-center justify-center rounded-3xl bg-primary-soft text-primary">{icon}</div>
      <h3 className="text-xl font-extrabold">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-soft">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Toaster() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="safe-top pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl px-4 py-3 font-semibold shadow-pop animate-pop ${
            t.kind === 'error' ? 'bg-danger text-white' : t.kind === 'ok' ? 'bg-ok text-white dark:text-black' : 'bg-text text-bg'
          }`}
        >
          {t.kind === 'error' ? <AlertCircle className="size-5 shrink-0" /> : t.kind === 'ok' ? <CheckCircle2 className="size-5 shrink-0" /> : <Info className="size-5 shrink-0" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Dialogs() {
  const dialogs = useApp((s) => s.dialogs);
  const d = dialogs[dialogs.length - 1];
  const [val, setVal] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (d?.input) {
      setVal(d.input.value);
      setTimeout(() => {
        ref.current?.focus();
        ref.current?.select();
      }, 50);
    }
  }, [d?.id]);
  if (!d) return null;
  const ok = () => d.resolve(d.input ? val : true);
  const cancel = () => d.resolve(d.input ? null : false);
  return (
    <Modal
      open
      onClose={cancel}
      title={d.title}
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            {d.cancelText || 'Cancelar'}
          </Button>
          <Button variant={d.danger ? 'danger' : 'primary'} onClick={ok}>
            {d.confirmText || 'Aceptar'}
          </Button>
        </>
      }
    >
      {d.message && <p className="mb-3 text-soft">{d.message}</p>}
      {d.input && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ok();
          }}
        >
          <Field label={d.input.label || ''}>
            <input ref={ref} className={inputCls} type={d.input.type || 'text'} value={val} placeholder={d.input.placeholder} onChange={(e) => setVal(e.target.value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}

export function BusyOverlay() {
  const busy = useApp((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-6 animate-fade">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-pop">
        <Spinner className="mx-auto size-10" />
        <p className="mt-4 text-lg font-bold">{busy.text}</p>
        {busy.progress !== undefined && busy.progress > 0 && (
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
          </div>
        )}
        <p className="mt-3 text-sm text-soft">Todo se procesa en tu dispositivo.</p>
      </div>
    </div>
  );
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-10 shrink-0 rounded-full px-4 text-sm font-bold transition ${active ? 'bg-primary text-on-primary' : 'bg-surface-2 text-soft hover:text-text'}`}
    >
      {children}
    </button>
  );
}

export function ColorDots({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          aria-label={'Color ' + c}
          onClick={() => onChange(c)}
          className={`size-9 rounded-full border-2 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.35)] transition ${value === c ? 'scale-110 border-primary ring-2 ring-primary/40' : 'border-faint/50'}`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
