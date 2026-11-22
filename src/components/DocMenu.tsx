import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Share2, Pencil, FolderInput, Copy, Lock, Unlock, Download, Trash2, PenLine, Highlighter, FormInput,
  Minimize2, FileText, KeyRound, ScanText, Crop, FileImage, Layers, Eye, Home, Folder as FolderIcon, ChevronRight,
} from 'lucide-react';
import type { DocMeta, Folder } from '../lib/db';
import { Modal, MenuItem, Button } from './ui';
import { renameDoc, duplicateDoc, setDocLocked, deleteDocs, getDocFile, moveItems, getScanPages, folderLocked } from '../lib/library';
import { shareFiles, downloadBlob } from '../lib/share';
import { confirmDialog, promptDialog, toast, useApp, errMsg } from '../lib/store';
import { baseName } from '../lib/util';
import { useLibrary } from '../lib/hooks';

export function DocMenu({ doc, open, onClose, inViewer }: { doc: DocMeta | null; open: boolean; onClose: () => void; inViewer?: boolean }) {
  const nav = useNavigate();
  const [moving, setMoving] = useState(false);
  if (!doc) return null;
  const run = (fn: () => any) => async () => {
    onClose();
    try {
      await fn();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const tool = (id: string) => run(() => nav(`/tool/${id}?doc=${doc.id}`));
  const isPdf = doc.kind === 'pdf';
  return (
    <>
      <Modal open={open} onClose={onClose} title={<span className="line-clamp-1">{doc.name}</span>}>
        <div className="grid gap-0.5 sm:grid-cols-2">
          {!inViewer && <MenuItem icon={<Eye className="size-5" />} label="Abrir" onClick={run(() => nav('/doc/' + doc.id))} />}
          <MenuItem icon={<Share2 className="size-5" />} label="Compartir" hint="WhatsApp, correo…" onClick={run(async () => shareFiles([await getDocFile(doc.id)]))} />
          {isPdf && <MenuItem icon={<PenLine className="size-5" />} label="Firmar" onClick={run(() => nav(`/edit/${doc.id}?tool=sign`))} />}
          {isPdf && <MenuItem icon={<Highlighter className="size-5" />} label="Editar PDF" onClick={run(() => nav(`/edit/${doc.id}`))} />}
          {isPdf && <MenuItem icon={<FormInput className="size-5" />} label="Llenar formulario" onClick={run(() => nav(`/edit/${doc.id}?tool=form`))} />}
          {doc.hasScan && (
            <MenuItem
              icon={<Crop className="size-5" />}
              label="Editar escaneo"
              hint="Recorte, filtros, páginas"
              onClick={run(async () => {
                const pages = await getScanPages(doc.id);
                if (!pages) return;
                useApp.getState().setScan({ pages, mode: 'document', docId: doc.id, name: baseName(doc.name), folderId: doc.folderId });
                nav('/review');
              })}
            />
          )}
          {doc.kind === 'image' && <MenuItem icon={<Crop className="size-5" />} label="Editar imagen" onClick={run(() => nav('/image/' + doc.id))} />}
          {doc.kind === 'image' && <MenuItem icon={<FileImage className="size-5" />} label="Convertir a PDF" onClick={tool('img2pdf')} />}
          {(doc.kind === 'image' || isPdf) && <MenuItem icon={<ScanText className="size-5" />} label="Reconocer texto (OCR)" onClick={tool(isPdf ? 'ocrpdf' : 'ocr')} />}
          {isPdf && <MenuItem icon={<FileText className="size-5" />} label="Convertir a Word" onClick={tool('pdf2word')} />}
          {isPdf && <MenuItem icon={<Layers className="size-5" />} label="Organizar páginas" onClick={tool('organize')} />}
          {isPdf && <MenuItem icon={<Minimize2 className="size-5" />} label="Comprimir" onClick={tool('compress')} />}
          {isPdf && <MenuItem icon={<KeyRound className="size-5" />} label={doc.pdfPassword ? 'Quitar contraseña' : 'Poner contraseña'} onClick={tool(doc.pdfPassword ? 'unlock' : 'protect')} />}
          {(doc.kind === 'office' || doc.kind === 'text') && <MenuItem icon={<FileText className="size-5" />} label="Convertir a PDF" onClick={tool('office2pdf')} />}
          <MenuItem
            icon={<Pencil className="size-5" />}
            label="Cambiar nombre"
            onClick={run(async () => {
              const n = await promptDialog('Cambiar nombre', baseName(doc.name), { label: 'Nombre' });
              if (n) await renameDoc(doc.id, n);
            })}
          />
          <MenuItem icon={<FolderInput className="size-5" />} label="Mover a carpeta" onClick={() => { onClose(); setMoving(true); }} />
          <MenuItem icon={<Copy className="size-5" />} label="Duplicar" onClick={run(async () => { await duplicateDoc(doc.id); toast('Copia creada', 'ok'); })} />
          <MenuItem
            icon={doc.lockedSelf ? <Unlock className="size-5" /> : <Lock className="size-5" />}
            label={doc.lockedSelf ? 'Quitar bloqueo' : 'Bloquear con PIN'}
            onClick={run(async () => {
              if (await setDocLocked(doc.id, !doc.lockedSelf)) toast(doc.lockedSelf ? 'Bloqueo quitado' : 'Archivo bloqueado y cifrado', 'ok');
            })}
          />
          <MenuItem icon={<Download className="size-5" />} label="Descargar" onClick={run(async () => { const f = await getDocFile(doc.id); downloadBlob(f, f.name); })} />
          <MenuItem
            icon={<Trash2 className="size-5" />}
            label="Eliminar"
            danger
            onClick={run(async () => {
              if (await confirmDialog('¿Eliminar este archivo?', `"${doc.name}" se borrará de este dispositivo. No se puede deshacer.`, { confirmText: 'Eliminar', danger: true })) {
                await deleteDocs([doc.id]);
                toast('Archivo eliminado');
                if (inViewer) nav(-1);
              }
            })}
          />
        </div>
      </Modal>
      <MoveDialog open={moving} onClose={() => setMoving(false)} docIds={[doc.id]} folderIds={[]} />
    </>
  );
}

export function MoveDialog({ open, onClose, docIds, folderIds, onDone }: { open: boolean; onClose: () => void; docIds: string[]; folderIds: string[]; onDone?: () => void }) {
  const { folders } = useLibrary();
  const fm = new Map(folders.map((f) => [f.id, f]));
  const tree: { f: Folder; depth: number }[] = [];
  const walk = (pid: string | null, depth: number) => {
    folders
      .filter((f) => f.parentId === pid && !folderIds.includes(f.id))
      .sort((a, b) => a.order - b.order)
      .forEach((f) => {
        tree.push({ f, depth });
        walk(f.id, depth + 1);
      });
  };
  walk(null, 0);
  const go = async (target: string | null) => {
    onClose();
    try {
      if (await moveItems(docIds, folderIds, target)) {
        toast('Movido', 'ok');
        onDone?.();
      }
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Mover a…" footer={<Button variant="secondary" onClick={onClose}>Cancelar</Button>}>
      <button onClick={() => go(null)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 font-bold hover:bg-surface-2">
        <Home className="size-6 text-primary" /> Inicio (sin carpeta)
      </button>
      {tree.map(({ f, depth }) => (
        <button key={f.id} onClick={() => go(f.id)} className="flex w-full items-center gap-3 rounded-2xl py-3 pr-3 font-semibold hover:bg-surface-2" style={{ paddingLeft: 12 + depth * 22 }}>
          {depth > 0 && <ChevronRight className="size-4 text-faint" />}
          <FolderIcon className="size-6" style={{ color: f.color }} fill={f.color + '33'} />
          <span className="flex-1 truncate text-left">{f.name}</span>
          {folderLocked(f.id, fm) && <Lock className="size-4 text-faint" />}
        </button>
      ))}
      {!tree.length && <p className="px-3 py-4 text-soft">Aún no tienes carpetas.</p>}
    </Modal>
  );
}
