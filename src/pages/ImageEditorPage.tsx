import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageEditor } from '../components/PageEditor';
import { getDoc, getDocBlob, updateDocBlob, addDoc } from '../lib/library';
import type { DocMeta } from '../lib/db';
import { DEFAULT_ADJ, type ScanPage } from '../lib/scanTypes';
import { finalizePage } from '../lib/imaging';
import { toast, withBusy, errMsg } from '../lib/store';
import { uid, baseName } from '../lib/util';
import { Modal, Button, Spinner } from '../components/ui';
import { saveBackToDevice, isFromDevice, hasFsAccess } from '../lib/device';
import { DevicePick } from '../components/DevicePick';

export default function ImageEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [doc, setDoc] = useState<DocMeta | null>(null);
  const [page, setPage] = useState<ScanPage | null>(null);
  const [result, setResult] = useState<ScanPage | null>(null);

  useEffect(() => {
    if (id === 'device') return;
    (async () => {
      try {
        const m = await getDoc(id!);
        if (!m) return nav('/');
        setDoc(m);
        const blob = await getDocBlob(m.id);
        setPage({ id: uid(), orig: blob, quad: null, curve: null, filter: 'original', adj: { ...DEFAULT_ADJ }, rotation: 0, erase: [] });
      } catch (e) {
        toast(errMsg(e), 'error');
        nav(-1);
      }
    })();
  }, [id]);

  async function save(copy: boolean) {
    if (!result || !doc) return;
    setResult(null);
    try {
      const out = await withBusy('Guardando imagen…', async () => {
        const fin = await finalizePage(result, 'high');
        const name = copy ? `${baseName(doc.name)} (editada).jpg` : baseName(doc.name) + '.jpg';
        if (copy) return addDoc({ name, blob: fin.processed!, folderId: doc.folderId });
        return updateDocBlob(doc.id, fin.processed!, { name });
      });
      toast('Imagen guardada', 'ok');
      if (!copy && isFromDevice(doc.id)) {
        const b = await getDocBlob(out.id);
        await saveBackToDevice(doc.id, new File([b], out.name, { type: 'image/jpeg' }));
      }
      nav('/doc/' + out.id, { replace: true });
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  if (id === 'device') return <DevicePick kind="image" />;
  if (!page || !doc)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner className="size-10" />
      </div>
    );

  return (
    <>
      <PageEditor page={page} title={doc.name} onCancel={() => nav(-1)} onDone={(p) => setResult(p)} />
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title="Guardar imagen"
        footer={
          <>
            <Button variant="secondary" onClick={() => save(true)}>
              Guardar como copia
            </Button>
            <Button onClick={() => save(false)}>Reemplazar</Button>
          </>
        }
      >
        <p className="text-soft">
          {isFromDevice(doc.id)
            ? hasFsAccess()
              ? '“Reemplazar” también actualizará el archivo original en tu computador.'
              : 'Después de guardar podrás enviarla a Fotos o Archivos con el menú Compartir (“Guardar imagen”).'
            : '¿Quieres reemplazar la imagen original o guardar una copia?'}
        </p>
      </Modal>
    </>
  );
}
