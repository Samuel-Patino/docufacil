import { useEffect, useState } from 'react';
import { Minus, Plus, Bold, Italic, Underline } from 'lucide-react';
import { isStd, type StdFamily } from '../lib/fonts';

/** Letras que se pueden elegir para un texto. Las de Google se descargan la primera vez. */
export const FONT_CHOICES: { v: string; l: string; serif?: boolean }[] = [
  { v: 'helvetica', l: 'Arial / Helvetica' },
  { v: 'times', l: 'Times New Roman', serif: true },
  { v: 'courier', l: 'Courier New' },
  { v: 'carlito', l: 'Calibri' },
  { v: 'caladea', l: 'Cambria', serif: true },
  { v: 'roboto', l: 'Roboto' },
  { v: 'open-sans', l: 'Open Sans' },
  { v: 'lato', l: 'Lato' },
  { v: 'montserrat', l: 'Montserrat' },
  { v: 'merriweather', l: 'Merriweather', serif: true },
  { v: 'playfair-display', l: 'Playfair Display', serif: true },
  { v: 'dancing-script', l: 'Dancing Script (a mano)' },
];

export interface TextFmt {
  font?: string;
  fontLabel?: string;
  size: number;
  weight?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  serif?: boolean;
}

export type FmtPatch = Partial<{ font: string; fallback: StdFamily; fontLabel: string; size: number; weight: number; bold: boolean; italic: boolean; underline: boolean; serif: boolean; sx: number }>;

// Los botones no quitan el foco del texto que se está escribiendo
const keep = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

function Tog({ on, label, onClick, children }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={!!on}
      title={label}
      {...keep}
      onClick={onClick}
      className={`flex size-10 items-center justify-center rounded-xl transition ${on ? 'bg-primary text-white' : 'text-soft hover:bg-surface-2 hover:text-text'}`}
    >
      {children}
    </button>
  );
}

/** Tamaño: − [número escribible] + */
function SizeStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const show = (v: number) => String(Math.round(v * 10) / 10);
  const [txt, setTxt] = useState(show(value));
  useEffect(() => setTxt(show(value)), [value]);
  const commit = () => {
    const v = parseFloat(txt.replace(',', '.'));
    if (isFinite(v) && v >= 4 && v <= 300) {
      if (Math.abs(v - value) > 0.01) onChange(v);
    } else setTxt(show(value));
  };
  const step = (d: number) => onChange(Math.max(4, Math.min(300, Math.round(value) + d)));
  return (
    <div className="flex items-center rounded-xl bg-surface-2">
      <button type="button" aria-label="Letra más pequeña" {...keep} onClick={() => step(-1)} className="flex size-10 items-center justify-center rounded-xl text-soft hover:text-text">
        <Minus className="size-5" />
      </button>
      <input
        aria-label="Tamaño de letra"
        inputMode="decimal"
        className="h-9 w-12 rounded-lg border border-line bg-surface text-center text-sm font-bold tabular-nums outline-none focus:border-primary"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label="Letra más grande" {...keep} onClick={() => step(1)} className="flex size-10 items-center justify-center rounded-xl text-soft hover:text-text">
        <Plus className="size-5" />
      </button>
    </div>
  );
}

/** Barra de formato de un texto: letra, tamaño, negrita, cursiva y subrayado. */
export function TextFormat({ value, onChange }: { value: TextFmt; onChange: (p: FmtPatch) => void }) {
  const font = value.font || (value.serif ? 'times' : 'helvetica');
  const known = FONT_CHOICES.some((c) => c.v === font);
  const bold = (value.weight ?? (value.bold ? 700 : 400)) >= 600;
  return (
    <>
      <select
        aria-label="Letra"
        title="Letra"
        className="h-10 max-w-44 rounded-xl border border-line bg-surface px-2 text-sm font-semibold"
        value={font}
        onChange={(e) => {
          const c = FONT_CHOICES.find((x) => x.v === e.target.value);
          if (!c) return;
          onChange({ font: c.v, fontLabel: c.l, fallback: c.serif ? 'times' : isStd(c.v) ? (c.v as StdFamily) : 'helvetica', serif: !!c.serif, sx: 1 });
        }}
      >
        {!known && <option value={font}>{value.fontLabel || font} (del PDF)</option>}
        {FONT_CHOICES.map((c) => (
          <option key={c.v} value={c.v}>
            {c.l}
          </option>
        ))}
      </select>
      <SizeStepper value={value.size} onChange={(size) => onChange({ size })} />
      <div className="flex items-center gap-0.5">
        <Tog label="Negrita" on={bold} onClick={() => onChange({ weight: bold ? 400 : 700, bold: !bold })}>
          <Bold className="size-5" />
        </Tog>
        <Tog label="Cursiva" on={value.italic} onClick={() => onChange({ italic: !value.italic })}>
          <Italic className="size-5" />
        </Tog>
        <Tog label="Subrayado" on={value.underline} onClick={() => onChange({ underline: !value.underline })}>
          <Underline className="size-5" />
        </Tog>
      </div>
    </>
  );
}
