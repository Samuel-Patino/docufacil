import { ArrowRight, Globe, Image as ImageIcon } from 'lucide-react';

export type Fmt = 'pdf' | 'word' | 'excel' | 'ppt' | 'img' | 'jpg' | 'txt' | 'web';

const FMT: Record<Fmt, { color: string; label?: string; glyph?: 'img' | 'web' }> = {
  pdf: { color: '#e5252a', label: 'PDF' },
  word: { color: '#2b579a', label: 'W' },
  excel: { color: '#217346', label: 'X' },
  ppt: { color: '#d24726', label: 'P' },
  jpg: { color: '#9333ea', label: 'JPG' },
  img: { color: '#9333ea', glyph: 'img' },
  txt: { color: '#475569', label: 'TXT' },
  web: { color: '#0d9488', glyph: 'web' },
};

/** Hoja de papel con la esquina doblada y el sello de color del formato. */
export function FormatDoc({ fmt, className = '' }: { fmt: Fmt; className?: string }) {
  const f = FMT[fmt];
  const long = (f.label?.length || 0) > 1;
  return (
    <span className={`relative inline-block aspect-[4/5] ${className}`} aria-hidden>
      <svg viewBox="0 0 40 50" className="absolute inset-0 h-full w-full">
        <path d="M5 2h21l11 11v33a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke={f.color} strokeWidth="2.2" />
        <path d="M26 2v9a2 2 0 0 0 2 2h9" fill={f.color} fillOpacity="0.25" stroke={f.color} strokeWidth="2.2" strokeLinejoin="round" />
        {[30, 36, 42].map((y) => (
          <line key={y} x1="9" x2={y === 42 ? 24 : 31} y1={y} y2={y} stroke={f.color} strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
        ))}
      </svg>
      <span
        className="absolute left-[-14%] top-[22%] flex items-center justify-center rounded-[22%] font-black leading-none text-white shadow-sm"
        style={{ background: f.color, width: long ? '86%' : '58%', height: '40%', fontSize: long ? '0.32em' : '0.5em' }}
      >
        {f.glyph === 'img' ? <ImageIcon className="size-[62%]" strokeWidth={2.6} /> : f.glyph === 'web' ? <Globe className="size-[62%]" strokeWidth={2.6} /> : f.label}
      </span>
    </span>
  );
}

/** Ícono de conversión: formato de origen → formato de destino. */
export function ConvertIcon({ from, to, className = '' }: { from: Fmt; to: Fmt; className?: string }) {
  return (
    <span className={`flex items-center gap-[0.12em] ${className}`}>
      <FormatDoc fmt={from} className="h-[1.15em]" />
      <ArrowRight className="size-[0.42em] shrink-0 text-soft" strokeWidth={3} />
      <FormatDoc fmt={to} className="h-[1.15em]" />
    </span>
  );
}
