import { FileText, FileImage, FileSpreadsheet, Presentation, File, FileType2, Lock } from 'lucide-react';
import type { DocMeta } from '../lib/db';
import { extOf } from '../lib/util';
import { useThumb } from '../lib/hooks';

export function kindVisual(doc: DocMeta) {
  const e = extOf(doc.name);
  if (doc.kind === 'pdf') return { Icon: FileType2, color: '#ef4444', label: 'PDF' };
  if (doc.kind === 'image') return { Icon: FileImage, color: '#8b5cf6', label: e.toUpperCase() || 'IMG' };
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return { Icon: FileSpreadsheet, color: '#16a34a', label: e.toUpperCase() };
  if (['ppt', 'pptx', 'odp'].includes(e)) return { Icon: Presentation, color: '#ea580c', label: e.toUpperCase() };
  if (['doc', 'docx', 'odt', 'rtf'].includes(e)) return { Icon: FileText, color: '#2563eb', label: e.toUpperCase() };
  if (doc.kind === 'text') return { Icon: FileText, color: '#64748b', label: e.toUpperCase() || 'TXT' };
  return { Icon: File, color: '#64748b', label: e.toUpperCase() || 'ARCHIVO' };
}

export function DocThumb({ doc, className = '', locked }: { doc: DocMeta; className?: string; locked?: boolean }) {
  const url = useThumb(doc);
  const { Icon, color, label } = kindVisual(doc);
  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2 ${className}`}>
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover object-top" draggable={false} />
      ) : (
        <div className="flex flex-col items-center gap-0.5" style={{ color }}>
          <Icon className="size-7" />
          <span className="text-[10px] font-black">{label}</span>
        </div>
      )}
      {locked && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white backdrop-blur-[2px]">
          <Lock className="size-6" />
        </span>
      )}
    </div>
  );
}
