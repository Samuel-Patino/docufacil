import { useNavigate } from 'react-router-dom';
import { ImageUp, FilePen } from 'lucide-react';
import { TopBar, Empty, Button } from './ui';
import { openFromDevice } from '../lib/device';
import { toast, errMsg } from '../lib/store';

/** Pantalla con un botón para elegir el archivo (iPhone exige un toque para abrir el selector). */
export function DevicePick({ kind }: { kind: 'image' | 'pdf' }) {
  const nav = useNavigate();
  async function pick() {
    try {
      const id = await openFromDevice(kind);
      if (id) nav(kind === 'image' ? '/image/' + id : '/edit/' + id, { replace: true });
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }
  return (
    <div>
      <TopBar title={kind === 'image' ? 'Editar foto' : 'Editar PDF'} back="/tools" />
      <Empty
        icon={kind === 'image' ? <ImageUp className="size-10" /> : <FilePen className="size-10" />}
        title={kind === 'image' ? 'Elige una foto' : 'Elige un PDF'}
        text={kind === 'image' ? 'De tu galería, Fotos o Archivos.' : 'De Archivos, iCloud, Google Drive o tu computador.'}
        action={<Button onClick={pick}>{kind === 'image' ? 'Elegir foto' : 'Elegir PDF'}</Button>}
      />
    </div>
  );
}
