// Biblioteca de documentos y carpetas (IndexedDB) con cifrado opcional.
import { db, isSealed, type DocKind, type DocMeta, type Folder, type StoredBlob, type StoredScanPage, type Signature } from './db';
import { seal, unseal, LockedError, isUnlocked } from './lock';
import { useApp, requireUnlock } from './store';
import type { ScanPage } from './scanTypes';
import { uid, extOf, canvasToBlob, baseName } from './util';

export const FOLDER_COLORS = ['#3b82f6', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#22c55e', '#64748b'];

const changed = () => useApp.getState().bump();

export function kindOf(name: string, mime = ''): DocKind {
  const e = extOf(name);
  if (mime === 'application/pdf' || e === 'pdf') return 'pdf';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'].includes(e)) return 'image';
  if (mime.startsWith('text/') || ['txt', 'csv', 'md', 'json', 'html', 'htm'].includes(e)) return 'text';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf'].includes(e)) return 'office';
  return 'other';
}

export function mimeOf(name: string): string {
  const e = extOf(name);
  const m: Record<string, string> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html', json: 'application/json', md: 'text/markdown',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  };
  return m[e] || 'application/octet-stream';
}

export async function listAll(): Promise<{ folders: Folder[]; docs: DocMeta[] }> {
  const d = await db();
  const [folders, docs] = await Promise.all([d.getAll('folders'), d.getAll('docs')]);
  return { folders, docs };
}

export async function getDoc(id: string) {
  return (await db()).get('docs', id);
}
export async function getFolder(id: string) {
  return (await db()).get('folders', id);
}

/** ¿La carpeta (o alguna superior) está bloqueada? */
export function folderLocked(folderId: string | null, byId: Map<string, Folder>): boolean {
  let f = folderId ? byId.get(folderId) : undefined;
  let guard = 0;
  while (f && guard++ < 64) {
    if (f.lockedSelf) return true;
    f = f.parentId ? byId.get(f.parentId) : undefined;
  }
  return false;
}

export function docLocked(doc: DocMeta, byId: Map<string, Folder>) {
  return doc.lockedSelf || folderLocked(doc.folderId, byId);
}

async function foldersMap() {
  const all = await (await db()).getAll('folders');
  return new Map(all.map((f) => [f.id, f]));
}

async function store(b: Blob, encrypt: boolean): Promise<StoredBlob> {
  return encrypt ? seal(b) : b;
}
async function load(s: StoredBlob): Promise<Blob> {
  return isSealed(s) ? unseal(s) : s;
}

// ---------- miniaturas ----------

export async function imageThumb(blob: Blob, width = 260): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, width / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await canvasToBlob(c, 'image/jpeg', 0.8);
  } catch {
    return null;
  }
}

async function makeThumb(kind: DocKind, blob: Blob): Promise<{ thumb: Blob | null; pages?: number; pdfPassword?: boolean }> {
  if (kind === 'image') return { thumb: await imageThumb(blob) };
  if (kind === 'pdf') {
    try {
      const { pdfThumbnail } = await import('./pdf');
      const r = await pdfThumbnail(blob);
      return { thumb: r.thumb, pages: r.pages };
    } catch (e: any) {
      if (e?.name === 'NeedPasswordError' || /contraseña/i.test(e?.message)) return { thumb: null, pdfPassword: true };
      return { thumb: null };
    }
  }
  return { thumb: null };
}

const thumbCache = new Map<string, string>();
export async function thumbURL(doc: DocMeta): Promise<string | null> {
  const key = doc.id + ':' + doc.updatedAt;
  if (thumbCache.has(key)) return thumbCache.get(key)!;
  const s = await (await db()).get('thumbs', doc.id);
  if (!s) return null;
  if (isSealed(s) && !isUnlocked()) return null;
  try {
    const url = URL.createObjectURL(await load(s));
    thumbCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

// ---------- documentos ----------

async function nextOrder(folderId: string | null) {
  const docs = await (await db()).getAllFromIndex('docs', 'folderId', folderId as any);
  return docs.length ? Math.min(...docs.map((d) => d.order)) - 1 : 0;
}

async function sealScan(pages: ScanPage[], encrypt: boolean): Promise<StoredScanPage[]> {
  const out: StoredScanPage[] = [];
  for (const p of pages) {
    const { thumb, ...rest } = p;
    out.push({
      ...rest,
      orig: await store(p.orig, encrypt),
      processed: p.processed ? await store(p.processed, encrypt) : undefined,
    });
  }
  return out;
}

export interface AddDocOpts {
  name: string;
  blob: Blob;
  folderId?: string | null;
  scanPages?: ScanPage[];
  ocr?: boolean;
  pageCount?: number;
}

export async function addDoc(o: AddDocOpts): Promise<DocMeta> {
  const folderId = o.folderId ?? null;
  const fm = await foldersMap();
  const encrypt = folderLocked(folderId, fm);
  if (encrypt && !(await requireUnlock('Esta carpeta está bloqueada'))) throw new LockedError();
  const kind = kindOf(o.name, o.blob.type);
  const mime = o.blob.type || mimeOf(o.name);
  const blob = o.blob.type ? o.blob : new Blob([o.blob], { type: mime });
  const t = await makeThumb(kind, blob);
  const now = Date.now();
  const meta: DocMeta = {
    id: uid(),
    name: o.name,
    folderId,
    order: await nextOrder(folderId),
    kind,
    mime,
    size: blob.size,
    pageCount: o.pageCount ?? t.pages,
    createdAt: now,
    updatedAt: now,
    lockedSelf: false,
    encrypted: encrypt,
    hasScan: !!o.scanPages?.length,
    ocr: o.ocr,
    pdfPassword: t.pdfPassword,
  };
  const d = await db();
  const fileS = await store(blob, encrypt);
  const thumbS = t.thumb ? await store(t.thumb, encrypt) : null;
  const scanS = o.scanPages?.length ? await sealScan(o.scanPages, encrypt) : null;
  const tx = d.transaction(['docs', 'files', 'thumbs', 'scans'], 'readwrite');
  await tx.objectStore('files').put(fileS, meta.id);
  if (thumbS) await tx.objectStore('thumbs').put(thumbS, meta.id);
  if (scanS) await tx.objectStore('scans').put(scanS, meta.id);
  await tx.objectStore('docs').put(meta);
  await tx.done;
  changed();
  return meta;
}

export async function updateDocBlob(
  id: string,
  blob: Blob,
  extra: { scanPages?: ScanPage[]; name?: string; ocr?: boolean; pageCount?: number } = {},
): Promise<DocMeta> {
  const d = await db();
  const meta = await d.get('docs', id);
  if (!meta) throw new Error('Documento no encontrado');
  if (meta.encrypted && !(await requireUnlock())) throw new LockedError();
  const t = await makeThumb(meta.kind, blob);
  const next: DocMeta = {
    ...meta,
    name: extra.name ?? meta.name,
    size: blob.size,
    mime: blob.type || meta.mime,
    pageCount: extra.pageCount ?? t.pages ?? meta.pageCount,
    updatedAt: Date.now(),
    ocr: extra.ocr ?? meta.ocr,
    pdfPassword: t.pdfPassword,
    hasScan: extra.scanPages ? extra.scanPages.length > 0 : meta.hasScan,
  };
  const fileS = await store(blob, meta.encrypted);
  const thumbS = t.thumb ? await store(t.thumb, meta.encrypted) : null;
  const scanS = extra.scanPages ? await sealScan(extra.scanPages, meta.encrypted) : null;
  const tx = d.transaction(['docs', 'files', 'thumbs', 'scans'], 'readwrite');
  await tx.objectStore('files').put(fileS, id);
  if (thumbS) await tx.objectStore('thumbs').put(thumbS, id);
  else await tx.objectStore('thumbs').delete(id);
  if (scanS) await tx.objectStore('scans').put(scanS, id);
  // Si el PDF cambió por fuera del escáner, las páginas originales ya no corresponden
  else if (meta.hasScan && !extra.scanPages) {
    await tx.objectStore('scans').delete(id);
    next.hasScan = false;
  }
  await tx.objectStore('docs').put(next);
  await tx.done;
  changed();
  return next;
}

/** Obtiene el archivo (pide PIN si está bloqueado). */
export async function getDocBlob(id: string): Promise<Blob> {
  const d = await db();
  const meta = await d.get('docs', id);
  if (!meta) throw new Error('Documento no encontrado');
  if (meta.encrypted && !isUnlocked() && !(await requireUnlock('Este archivo está bloqueado'))) throw new LockedError();
  const s = await d.get('files', id);
  if (!s) throw new Error('Archivo vacío');
  const b = await load(s);
  return b.type ? b : new Blob([b], { type: meta.mime });
}

export async function getDocFile(id: string): Promise<File> {
  const meta = (await getDoc(id))!;
  const b = await getDocBlob(id);
  return new File([b], meta.name, { type: meta.mime });
}

export async function getScanPages(id: string): Promise<ScanPage[] | null> {
  const d = await db();
  const meta = await d.get('docs', id);
  if (meta?.encrypted && !isUnlocked() && !(await requireUnlock())) throw new LockedError();
  const s = await d.get('scans', id);
  if (!s) return null;
  const out: ScanPage[] = [];
  for (const p of s) {
    out.push({ ...p, orig: await load(p.orig), processed: p.processed ? await load(p.processed) : undefined });
  }
  return out;
}

export async function renameDoc(id: string, name: string) {
  const d = await db();
  const m = await d.get('docs', id);
  if (!m) return;
  const ext = extOf(m.name);
  const clean = name.trim();
  if (!clean) return;
  m.name = ext && extOf(clean) !== ext ? `${clean}.${ext}` : clean;
  m.updatedAt = Date.now();
  await d.put('docs', m);
  changed();
}

export async function deleteDocs(ids: string[]) {
  const d = await db();
  const tx = d.transaction(['docs', 'files', 'thumbs', 'scans'], 'readwrite');
  for (const id of ids) {
    await tx.objectStore('docs').delete(id);
    await tx.objectStore('files').delete(id);
    await tx.objectStore('thumbs').delete(id);
    await tx.objectStore('scans').delete(id);
  }
  await tx.done;
  changed();
}

export async function duplicateDoc(id: string): Promise<DocMeta> {
  const m = (await getDoc(id))!;
  const blob = await getDocBlob(id);
  const scan = m.hasScan ? await getScanPages(id) : null;
  return addDoc({
    name: `${baseName(m.name)} (copia)${extOf(m.name) ? '.' + extOf(m.name) : ''}`,
    blob,
    folderId: m.folderId,
    scanPages: scan || undefined,
    ocr: m.ocr,
  });
}

// ---------- cifrado / bloqueo ----------

async function reencryptDoc(meta: DocMeta, encrypt: boolean) {
  if (meta.encrypted === encrypt) return;
  const d = await db();
  const file = await d.get('files', meta.id);
  const thumb = await d.get('thumbs', meta.id);
  const scan = await d.get('scans', meta.id);
  const conv = async (s: StoredBlob) => store(await load(s), encrypt);
  const nf = file ? await conv(file) : null;
  const nt = thumb ? await conv(thumb) : null;
  let ns: StoredScanPage[] | null = null;
  if (scan) {
    ns = [];
    for (const p of scan) ns.push({ ...p, orig: await conv(p.orig), processed: p.processed ? await conv(p.processed) : undefined });
  }
  const tx = d.transaction(['docs', 'files', 'thumbs', 'scans'], 'readwrite');
  if (nf) await tx.objectStore('files').put(nf, meta.id);
  if (nt) await tx.objectStore('thumbs').put(nt, meta.id);
  if (ns) await tx.objectStore('scans').put(ns, meta.id);
  await tx.objectStore('docs').put({ ...meta, encrypted: encrypt });
  await tx.done;
}

/** Asegura que cada documento esté cifrado sólo si debe estarlo. */
export async function syncEncryption() {
  const { folders, docs } = await listAll();
  const fm = new Map(folders.map((f) => [f.id, f]));
  const pending = docs.filter((d) => docLocked(d, fm) !== d.encrypted);
  if (!pending.length) return;
  if (!(await requireUnlock())) throw new LockedError();
  for (const doc of pending) await reencryptDoc(doc, docLocked(doc, fm));
  thumbCache.clear();
  changed();
}

export async function setDocLocked(id: string, locked: boolean) {
  if (!(await requireUnlock(locked ? 'Crea o escribe tu PIN para bloquear' : 'Escribe tu PIN'))) return false;
  const d = await db();
  const m = await d.get('docs', id);
  if (!m) return false;
  await d.put('docs', { ...m, lockedSelf: locked });
  await syncEncryption();
  changed();
  return true;
}

export async function setFolderLocked(id: string, locked: boolean) {
  if (!(await requireUnlock(locked ? 'Crea o escribe tu PIN para bloquear' : 'Escribe tu PIN'))) return false;
  const d = await db();
  const f = await d.get('folders', id);
  if (!f) return false;
  await d.put('folders', { ...f, lockedSelf: locked, updatedAt: Date.now() });
  await syncEncryption();
  changed();
  return true;
}

// ---------- carpetas ----------

export async function createFolder(name: string, parentId: string | null, color = FOLDER_COLORS[0]): Promise<Folder> {
  const d = await db();
  const all = await d.getAll('folders');
  const siblings = all.filter((f) => f.parentId === parentId);
  const now = Date.now();
  const f: Folder = {
    id: uid(),
    name: name.trim() || 'Carpeta nueva',
    parentId,
    order: siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0,
    color,
    lockedSelf: false,
    createdAt: now,
    updatedAt: now,
  };
  await d.put('folders', f);
  changed();
  return f;
}

export async function updateFolder(id: string, patch: Partial<Folder>) {
  const d = await db();
  const f = await d.get('folders', id);
  if (!f) return;
  await d.put('folders', { ...f, ...patch, updatedAt: Date.now() });
  changed();
}

function descendants(id: string, all: Folder[]): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const f of all) if (f.parentId === pid) {
      out.push(f.id);
      walk(f.id);
    }
  };
  walk(id);
  return out;
}

export async function deleteFolder(id: string) {
  const d = await db();
  const all = await d.getAll('folders');
  const ids = [id, ...descendants(id, all)];
  const docs = (await d.getAll('docs')).filter((x) => x.folderId && ids.includes(x.folderId));
  await deleteDocs(docs.map((x) => x.id));
  const tx = d.transaction('folders', 'readwrite');
  for (const fid of ids) await tx.store.delete(fid);
  await tx.done;
  changed();
}

export async function moveItems(docIds: string[], folderIds: string[], target: string | null) {
  const d = await db();
  const all = await d.getAll('folders');
  const fm = new Map(all.map((f) => [f.id, f]));
  // Mover a una carpeta bloqueada (o sacar de ella) requiere PIN
  const metas = await Promise.all(docIds.map((id) => d.get('docs', id)));
  const needs = folderLocked(target, fm) || metas.some((m) => m && m.encrypted) || folderIds.some((id) => folderLocked(id, fm));
  if (needs && !(await requireUnlock())) return false;
  for (const id of docIds) {
    const m = await d.get('docs', id);
    if (m && m.folderId !== target) await d.put('docs', { ...m, folderId: target, order: await nextOrder(target) });
  }
  for (const id of folderIds) {
    if (id === target) continue;
    if (target && descendants(id, all).includes(target)) continue; // evita ciclos
    const f = fm.get(id);
    if (f) await d.put('folders', { ...f, parentId: target });
  }
  await syncEncryption();
  changed();
  return true;
}

export async function reorder(kind: 'doc' | 'folder', idsInOrder: string[]) {
  const d = await db();
  const tx = d.transaction(kind === 'doc' ? 'docs' : 'folders', 'readwrite');
  for (let i = 0; i < idsInOrder.length; i++) {
    const it: any = await tx.store.get(idsInOrder[i]);
    if (it && it.order !== i) await tx.store.put({ ...it, order: i });
  }
  await tx.done;
  changed();
}

// ---------- importar ----------

export async function importFiles(files: File[] | FileList, folderId: string | null = null): Promise<DocMeta[]> {
  const out: DocMeta[] = [];
  for (const f of Array.from(files)) {
    let blob: Blob = f;
    let name = f.name || 'archivo';
    // HEIC (iPhone): convertir a JPG si el navegador puede decodificarlo
    if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(name)) {
      try {
        const bmp = await createImageBitmap(f);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        blob = await canvasToBlob(c, 'image/jpeg', 0.92);
        name = baseName(name) + '.jpg';
      } catch {}
    }
    if (!blob.type) blob = new Blob([blob], { type: mimeOf(name) });
    out.push(await addDoc({ name, blob, folderId }));
  }
  return out;
}

// ---------- firmas ----------

export async function listSignatures(): Promise<Signature[]> {
  const all = await (await db()).getAll('signatures');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function addSignature(blob: Blob) {
  const s: Signature = { id: uid(), blob, createdAt: Date.now() };
  await (await db()).put('signatures', s);
  return s;
}
export async function deleteSignature(id: string) {
  await (await db()).delete('signatures', id);
}

// ---------- copia de seguridad ----------

export async function exportBackup(): Promise<Blob> {
  const { folders, docs } = await listAll();
  if (docs.some((d) => d.encrypted) && !(await requireUnlock('Desbloquea para incluir los archivos protegidos')))
    throw new LockedError();
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const d = await db();
  const sigs = await d.getAll('signatures');
  zip.file('docufacil.json', JSON.stringify({ v: 1, folders, docs: docs.map((x) => ({ ...x, encrypted: false })), signatures: sigs.map((s) => ({ id: s.id, createdAt: s.createdAt })) }));
  for (const doc of docs) {
    const s = await d.get('files', doc.id);
    if (s) zip.file(`files/${doc.id}`, await load(s));
    const t = await d.get('thumbs', doc.id);
    if (t) zip.file(`thumbs/${doc.id}`, await load(t));
  }
  for (const s of sigs) zip.file(`signatures/${s.id}.png`, s.blob);
  return zip.generateAsync({ type: 'blob' });
}

export async function importBackup(file: Blob): Promise<number> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const manifest = JSON.parse(await zip.file('docufacil.json')!.async('string'));
  const d = await db();
  const existing = new Set((await d.getAllKeys('docs')) as string[]);
  let n = 0;
  for (const f of manifest.folders as Folder[]) {
    if (!(await d.get('folders', f.id))) await d.put('folders', { ...f, lockedSelf: false });
  }
  for (const m of manifest.docs as DocMeta[]) {
    if (existing.has(m.id)) continue;
    const fb = await zip.file(`files/${m.id}`)?.async('blob');
    if (!fb) continue;
    const tb = await zip.file(`thumbs/${m.id}`)?.async('blob');
    await d.put('files', new Blob([fb], { type: m.mime }), m.id);
    if (tb) await d.put('thumbs', new Blob([tb], { type: 'image/jpeg' }), m.id);
    await d.put('docs', { ...m, encrypted: false, lockedSelf: false, hasScan: false });
    n++;
  }
  for (const s of manifest.signatures || []) {
    const b = await zip.file(`signatures/${s.id}.png`)?.async('blob');
    if (b && !(await d.get('signatures', s.id))) await d.put('signatures', { id: s.id, createdAt: s.createdAt, blob: new Blob([b], { type: 'image/png' }) });
  }
  changed();
  return n;
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usage: e.usage || 0, quota: e.quota || 0, persisted };
  } catch {
    return { usage: 0, quota: 0, persisted: false };
  }
}
