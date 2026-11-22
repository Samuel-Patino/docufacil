import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Lock, Fingerprint, PenLine, HardDrive, Download, Upload, Smartphone, Info, KeyRound, ScanLine, Share, PlusSquare, MoreVertical } from 'lucide-react';
import { useApp, toast, requireUnlock, withBusy, errMsg, confirmDialog } from '../lib/store';
import { Card, Segmented, Toggle, Button, Field, inputCls, Modal } from '../components/ui';
import { SignaturePicker } from '../components/Signature';
import { PinPad } from '../components/UnlockModal';
import { getLockConfig, setPin, bioSupported, enableBio, disableBio, lockNow } from '../lib/lock';
import { exportBackup, importBackup, storageEstimate } from '../lib/library';
import { downloadBlob, pickFiles } from '../lib/share';
import { FILTERS } from '../lib/scanTypes';
import { OCR_LANGS } from '../lib/ocr';
import { formatBytes, isIOS, isAndroid, isStandalone } from '../lib/util';

export default function Settings() {
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const unlocked = useApp((s) => s.unlocked);
  const installPrompt = useApp((s) => s.installPrompt);
  const [hasPin, setHasPin] = useState(false);
  const [hasBio, setHasBio] = useState(false);
  const [canBio, setCanBio] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [storage, setStorage] = useState({ usage: 0, quota: 0, persisted: false });

  const refresh = async () => {
    const c = await getLockConfig();
    setHasPin(!!c);
    setHasBio(!!c?.bio);
    setCanBio(await bioSupported());
    setStorage(await storageEstimate());
  };
  useEffect(() => {
    refresh();
  }, [unlocked]);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-3 pb-10">
      <h1 className="safe-top py-3 text-2xl font-black">Ajustes</h1>

      <Section icon={<Sun className="size-5" />} title="Apariencia">
        <Field label="Tema">
          <Segmented
            value={prefs.theme}
            onChange={(v) => setPrefs({ theme: v })}
            options={[
              { value: 'auto', label: <span className="flex items-center justify-center gap-1.5"><Monitor className="size-4" />Automático</span> },
              { value: 'light', label: <span className="flex items-center justify-center gap-1.5"><Sun className="size-4" />Claro</span> },
              { value: 'dark', label: <span className="flex items-center justify-center gap-1.5"><Moon className="size-4" />Oscuro</span> },
            ]}
          />
        </Field>
        <Field label="Tamaño del texto">
          <Segmented value={prefs.textSize} onChange={(v) => setPrefs({ textSize: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Grande' }, { value: 'xlarge', label: 'Muy grande' }]} />
        </Field>
      </Section>

      <Section icon={<ScanLine className="size-5" />} title="Escáner">
        <Toggle checked={prefs.autoCapture} onChange={(v) => setPrefs({ autoCapture: v })} label="Captura automática" hint="Toma la foto sola cuando el documento está quieto." />
        <Field label="Filtro por defecto">
          <select className={inputCls} value={prefs.defaultFilter} onChange={(e) => setPrefs({ defaultFilter: e.target.value as any })}>
            <option value="mode">Según el modo (recomendado)</option>
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Calidad de los escaneos">
          <Segmented value={prefs.quality} onChange={(v) => setPrefs({ quality: v })} options={[{ value: 'high', label: 'Alta' }, { value: 'medium', label: 'Media' }, { value: 'low', label: 'Liviana' }]} />
        </Field>
        <Toggle checked={prefs.ocrOnSave} onChange={(v) => setPrefs({ ocrOnSave: v })} label="Hacer buscables los PDF escaneados (OCR)" />
        <Field label="Idioma del texto (OCR)">
          <select className={inputCls} value={prefs.ocrLang} onChange={(e) => setPrefs({ ocrLang: e.target.value })}>
            {OCR_LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section icon={<Lock className="size-5" />} title="Seguridad">
        <p className="mb-3 text-soft">Bloquea carpetas o archivos desde su menú (⋮ → Bloquear con PIN). Su contenido queda cifrado en este dispositivo.</p>
        <div className="flex flex-wrap gap-2">
          {!hasPin ? (
            <Button icon={<KeyRound className="size-5" />} onClick={async () => { if (await requireUnlock()) refresh(); }}>
              Crear PIN
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                icon={<KeyRound className="size-5" />}
                onClick={async () => {
                  if (await requireUnlock('Escribe tu PIN actual')) setPinOpen(true);
                }}
              >
                Cambiar PIN
              </Button>
              {unlocked && (
                <Button variant="secondary" icon={<Lock className="size-5" />} onClick={lockNow}>
                  Bloquear ahora
                </Button>
              )}
            </>
          )}
        </div>
        {hasPin && canBio && (
          <div className="mt-2">
            <Toggle
              checked={hasBio}
              onChange={async (v) => {
                if (v) {
                  if (!(await requireUnlock())) return;
                  const r = await enableBio();
                  toast(r.message, r.ok ? 'ok' : 'error', 5000);
                } else await disableBio();
                refresh();
              }}
              label={<span className="flex items-center gap-2"><Fingerprint className="size-5" />Desbloquear con huella / Face ID</span>}
              hint="Funciona en celulares y computadores compatibles."
            />
          </div>
        )}
        <p className="mt-2 text-sm text-faint">La app se bloquea sola si la dejas en segundo plano más de 1 minuto.</p>
      </Section>

      <Section icon={<PenLine className="size-5" />} title="Firmas">
        <p className="mb-3 text-soft">Crea tu firma una vez y úsala en cualquier PDF.</p>
        <Button variant="secondary" icon={<PenLine className="size-5" />} onClick={() => setSigOpen(true)}>
          Mis firmas
        </Button>
      </Section>

      <Section icon={<HardDrive className="size-5" />} title="Almacenamiento y copia de seguridad">
        <p className="text-soft">
          Usado: <b>{formatBytes(storage.usage)}</b>
          {storage.quota ? ` de ${formatBytes(storage.quota)} disponibles` : ''}.
          {storage.persisted ? ' El navegador no borrará tus documentos.' : ''}
        </p>
        <p className="mt-2 text-sm text-faint">Tus documentos se guardan sólo en este dispositivo. Haz una copia de seguridad de vez en cuando o antes de cambiar de celular.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!storage.persisted && (
            <Button
              variant="soft"
              onClick={async () => {
                const ok = await navigator.storage?.persist?.();
                toast(ok ? 'Almacenamiento protegido' : 'El navegador no lo permitió. Instala la app para protegerlo.', ok ? 'ok' : 'info', 4500);
                refresh();
              }}
            >
              Proteger almacenamiento
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<Download className="size-5" />}
            onClick={async () => {
              try {
                const b = await withBusy('Creando copia de seguridad…', () => exportBackup());
                downloadBlob(b, `DocuFacil-copia-${new Date().toISOString().slice(0, 10)}.zip`);
              } catch (e) {
                toast(errMsg(e), 'error');
              }
            }}
          >
            Exportar copia
          </Button>
          <Button
            variant="secondary"
            icon={<Upload className="size-5" />}
            onClick={async () => {
              const [f] = await pickFiles('.zip,application/zip', false);
              if (!f) return;
              if (!(await confirmDialog('¿Restaurar copia de seguridad?', 'Se agregarán los documentos de la copia. Los que ya tienes no se borran.'))) return;
              try {
                const n = await withBusy('Restaurando…', () => importBackup(f));
                toast(`${n} documento(s) restaurados`, 'ok');
                refresh();
              } catch (e) {
                toast('No es una copia válida: ' + errMsg(e), 'error');
              }
            }}
          >
            Restaurar copia
          </Button>
        </div>
      </Section>

      {!isStandalone() && (
        <Section icon={<Smartphone className="size-5" />} title="Instalar como app">
          {installPrompt ? (
            <>
              <p className="mb-3 text-soft">Instálala para abrirla desde tu pantalla de inicio, a pantalla completa y sin internet.</p>
              <Button
                icon={<PlusSquare className="size-5" />}
                onClick={async () => {
                  installPrompt.prompt();
                  await installPrompt.userChoice;
                  useApp.setState({ installPrompt: null });
                }}
              >
                Instalar DocuFácil
              </Button>
            </>
          ) : isIOS() ? (
            <ol className="list-decimal space-y-2 pl-5 text-soft">
              <li>Abre esta página en <b>Safari</b>.</li>
              <li>
                Toca el botón <b>Compartir</b> <Share className="inline size-4" /> (abajo o arriba).
              </li>
              <li>
                Elige <b>“Agregar a pantalla de inicio”</b> <PlusSquare className="inline size-4" /> y luego <b>Agregar</b>.
              </li>
            </ol>
          ) : isAndroid() ? (
            <ol className="list-decimal space-y-2 pl-5 text-soft">
              <li>Abre esta página en <b>Chrome</b>.</li>
              <li>
                Toca el menú <MoreVertical className="inline size-4" /> arriba a la derecha.
              </li>
              <li>
                Elige <b>“Instalar app”</b> o <b>“Agregar a pantalla principal”</b>.
              </li>
            </ol>
          ) : (
            <p className="text-soft">En Chrome o Edge, haz clic en el ícono de instalar (⊕) en la barra de direcciones, o en el menú → “Instalar DocuFácil”.</p>
          )}
        </Section>
      )}

      <Section icon={<Info className="size-5" />} title="Acerca de">
        <p className="text-soft">
          DocuFácil es gratis. Todo se procesa en tu dispositivo: tus documentos no se suben a ningún servidor. Algunas funciones (lector de texto) descargan sus datos la primera vez y luego funcionan sin internet.
        </p>
      </Section>

      <SignaturePicker open={sigOpen} onClose={() => setSigOpen(false)} />
      <ChangePin open={pinOpen} onClose={() => setPinOpen(false)} />
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function ChangePin({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState('');
  const [first, setFirst] = useState('');
  useEffect(() => {
    setV('');
    setFirst('');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={first ? 'Repite el nuevo PIN' : 'Nuevo PIN de 4 dígitos'}>
      <PinPad
        value={v}
        onChange={setV}
        length={4}
        onDone={async (p) => {
          if (!first) {
            setFirst(p);
            setV('');
            return;
          }
          if (p !== first) {
            toast('Los PIN no coinciden', 'error');
            setFirst('');
            setV('');
            return;
          }
          await setPin(p);
          toast('PIN cambiado', 'ok');
          onClose();
        }}
      />
    </Modal>
  );
}
