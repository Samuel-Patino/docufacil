import { useEffect, useState } from 'react';
import { useApp } from './store';
import { listAll, thumbURL } from './library';
import type { DocMeta, Folder } from './db';

export function useLibrary() {
  const version = useApp((s) => s.version);
  const unlocked = useApp((s) => s.unlocked);
  const [data, setData] = useState<{ folders: Folder[]; docs: DocMeta[]; loaded: boolean }>({ folders: [], docs: [], loaded: false });
  useEffect(() => {
    let live = true;
    listAll().then((d) => live && setData({ ...d, loaded: true }));
    return () => {
      live = false;
    };
  }, [version, unlocked]);
  return data;
}

export function useThumb(doc: DocMeta | undefined) {
  const unlocked = useApp((s) => s.unlocked);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (doc) thumbURL(doc).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [doc?.id, doc?.updatedAt, unlocked]);
  return url;
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

export function useObjectURL(blob: Blob | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
