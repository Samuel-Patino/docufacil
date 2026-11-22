import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ScanPage } from './scanTypes';

export type DocKind = 'pdf' | 'image' | 'text' | 'office' | 'other';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  color: string;
  lockedSelf: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DocMeta {
  id: string;
  name: string; // con extensión
  folderId: string | null;
  order: number;
  kind: DocKind;
  mime: string;
  size: number;
  pageCount?: number;
  createdAt: number;
  updatedAt: number;
  lockedSelf: boolean;
  encrypted: boolean;
  hasScan: boolean;
  ocr?: boolean;
  pdfPassword?: boolean; // PDF protegido con contraseña
}

export interface Sealed {
  sealed: true;
  iv: Uint8Array;
  data: ArrayBuffer;
  type: string;
}
export type StoredBlob = Blob | Sealed;

export interface StoredScanPage extends Omit<ScanPage, 'orig' | 'processed' | 'thumb'> {
  orig: StoredBlob;
  processed?: StoredBlob;
}

export interface Signature {
  id: string;
  blob: Blob;
  createdAt: number;
}

interface Schema extends DBSchema {
  folders: { key: string; value: Folder };
  docs: { key: string; value: DocMeta; indexes: { folderId: string } };
  files: { key: string; value: StoredBlob };
  thumbs: { key: string; value: StoredBlob };
  scans: { key: string; value: StoredScanPage[] };
  signatures: { key: string; value: Signature };
  kv: { key: string; value: any };
  inbox: { key: number; value: { file: File; at: number }; autoIncrement: true } & any;
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<Schema>('docufacil', 1, {
      upgrade(d) {
        d.createObjectStore('folders', { keyPath: 'id' });
        const docs = d.createObjectStore('docs', { keyPath: 'id' });
        docs.createIndex('folderId', 'folderId');
        d.createObjectStore('files');
        d.createObjectStore('thumbs');
        d.createObjectStore('scans');
        d.createObjectStore('signatures', { keyPath: 'id' });
        d.createObjectStore('kv');
        (d as any).createObjectStore('inbox', { autoIncrement: true });
      },
    });
  }
  return dbp;
}

export const isSealed = (b: any): b is Sealed => !!b && b.sealed === true;

export async function kvGet<T = any>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key);
}
export async function kvSet(key: string, value: any) {
  return (await db()).put('kv', value, key);
}
export async function kvDel(key: string) {
  return (await db()).delete('kv', key);
}
