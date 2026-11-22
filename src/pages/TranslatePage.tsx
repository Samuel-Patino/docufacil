import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Languages, Camera, Copy, Share2, Save, ExternalLink, Download, Eye } from 'lucide-react';
import { TopBar, Button, Card, Empty, Field, inputCls, Spinner, Segmented } from '../components/ui';
import { useApp, toast, errMsg } from '../lib/store';
import { renderScanPage } from '../lib/imaging';
import { ocrImage, OCR_LANGS } from '../lib/ocr';
import { pendingTranslate, translateUnits, TR_LANGS, langLabel, googleTranslateUrl } from '../lib/translate';
import { buildUnits, prepareLens, drawLens, refineLightText, type LensUnit, type LensPrep } from '../lib/lens';
import { copyText, shareText, shareFiles, saveFileAs } from '../lib/share';
import { addDoc } from '../lib/library';
import { defaultScanName, canvasToBlob } from '../lib/util';

type View = 'image' | 'text';

export default function TranslatePage() {
  const nav = useNavigate();
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const [page] = useState(() => pendingTranslate.page);
  const [status, setStatus] = useState<string | null>(null);
  const [view, setView] = useState<View>('image');
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [lensUrl, setLensUrl] = useState<string | null>(null);
  const [units, setUnits] = useState<LensUnit[] | null>(null);
  const [result, setResult] = useState<{ out: string[]; from: string; online: boolean } | null>(null);
  const [trErr, setTrErr] = useState<string | null>(null);
  const [showOrig, setShowOrig] = useState(false);
  const lensCanvas = useRef<HTMLCanvasElement | null>(null);
  const prep = useRef<LensPrep | null>(null);

  useEffect(() => () => {
    origUrl && URL.revokeObjectURL(origUrl);
    lensUrl && URL.revokeObjectURL(lensUrl);
  }, [origUrl, lensUrl]);

  async function read(lang = prefs.ocrLang) {
    if (!page) return;
    setUnits(null);
    setResult(null);
    setLensUrl(null);
    setTrErr(null);
    try {
      setStatus('Preparando la imagen…');
      // La foto se muestra con sus colores reales; el texto se lee sobre una versión mejorada del mismo tamaño
      const c = await renderScanPage({ ...page, filter: 'original' }, 2000);
      const forOcr = await renderScanPage({ ...page, filter: 'auto' }, 2000);
      setOrigUrl(URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.88)));
      const r = await ocrImage(forOcr.width === c.width && forOcr.height === c.height ? forOcr : c, lang, (p, st) => setStatus(`${st} ${Math.round(p * 100)}%`));
      let us = buildUnits(r.paras);
      if (us.length) {
        setStatus("Revisando textos claros sobre fondo oscuro…");
        us = await refineLightText(c, us, lang);
      }
      setUnits(us);
      if (!us.length) return setStatus(null);
      setStatus('Quitando el texto original…');
      prep.current = await prepareLens(c, us);
      await translate(us, prefs.trLang);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setStatus(null);
    }
  }

  async function translate(us = units, to = prefs.trLang) {
    if (!us?.length) return;
    setTrErr(null);
    setStatus('Traduciendo…');
    try {
      const r = await translateUnits(
        us.map((u) => u.text),
        to,
      );
      setResult(r);
      if (prep.current) {
        setStatus('Escribiendo la traducción en la imagen…');
        await document.fonts?.ready;
        const out = drawLens(prep.current, us, r.out);
        lensCanvas.current = out;
        setLensUrl(URL.createObjectURL(await canvasToBlob(out, 'image/jpeg', 0.9)));
      }
    } catch (e) {
      setTrErr(errMsg(e));
    } finally {
      setStatus(null);
    }
  }

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    read();
  }, []);

  function again() {
    pendingTranslate.page = null;
    nav('/scan?mode=translate', { replace: true });
  }

  /** Texto traducido con los párrafos separados por una línea en blanco. */
  const joinUnits = (texts: string[]) => {
    if (!units) return '';
    let s = '';
    units.forEach((u, i) => {
      if (i) s += units[i - 1].para === u.para ? '\n' : '\n\n';
      s += texts[i] || '';
    });
    return s;
  };
  const translatedText = result ? joinUnits(result.out) : '';
  const originalText = units ? joinUnits(units.map((u) => u.text)) : '';

  async function imageFile() {
    const b = await canvasToBlob(lensCanvas.current!, 'image/jpeg', 0.92);
    return new File([b], `${defaultScanName('Traducción')}.jpg`, { type: 'image/jpeg' });
  }

  async function saveImage() {
    if (!lensCanvas.current) return;
    const f = await imageFile();
    const m = await addDoc({ name: f.name, blob: f, folderId: null });
    toast('Imagen traducida guardada en tus documentos', 'ok');
    nav('/doc/' + m.id);
  }

  async function saveText() {
    const body = `${translatedText}\n\n———\nTexto original (${langLabel(result?.from) || 'detectado'}):\n\n${originalText}`;
    const m = await addDoc({ name: defaultScanName('Traducción') + '.txt', blob: new Blob([body], { type: 'text/plain' }), folderId: null });
    toast('Traducción guardada en tus documentos', 'ok');
    nav('/doc/' + m.id);
  }

  if (!page)
    return (
      <div>
        <TopBar title="Traducir" back="/" />
        <Empty
          icon={<Languages className="size-10" />}
          title="Traduce un documento"
          text="Toma una foto de un texto y verás la traducción encima, en el mismo lugar."
          action={<Button icon={<Camera className="size-5" />} onClick={again}>Escanear texto</Button>}
        />
      </div>
    );

  const shown = showOrig || !lensUrl ? origUrl : lensUrl;

  return (
    <div className="min-h-dvh pb-10">
      <TopBar title="Traducir" back="/" />
      <div className="mx-auto max-w-3xl px-4 pt-3">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label="Idioma del documento">
            <select
              className={inputCls}
              value={prefs.ocrLang}
              onChange={(e) => {
                setPrefs({ ocrLang: e.target.value });
                read(e.target.value);
              }}
            >
              {OCR_LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Traducir a">
            <select
              className={inputCls + ' font-bold'}
              value={prefs.trLang}
              onChange={(e) => {
                setPrefs({ trLang: e.target.value });
                translate(units, e.target.value);
              }}
            >
              {TR_LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Segmented
          className="mb-3"
          value={view}
          onChange={setView}
          options={[
            { value: 'image', label: 'En la imagen' },
            { value: 'text', label: 'Sólo texto' },
          ]}
        />

        {status && (
          <Card className="mb-3 flex items-center gap-3 p-4">
            <Spinner className="size-6" />
            <span className="font-semibold">{status}</span>
          </Card>
        )}

        {units && !units.length && !status && (
          <p className="mb-3 rounded-2xl bg-warn-soft p-4 font-semibold text-warn">No se encontró texto. Intenta con más luz o acercándote al documento.</p>
        )}

        {trErr && !status && (
          <Card className="mb-3 p-4">
            <p className="font-semibold text-danger">{trErr}</p>
            <p className="mt-1 text-sm text-soft">Puedes copiar el texto y pegarlo en Google Traductor.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" icon={<Copy className="size-5" />} onClick={() => copyText(originalText)}>
                Copiar texto
              </Button>
              <a href={googleTranslateUrl(prefs.trLang)} target="_blank" rel="noreferrer">
                <Button variant="secondary" icon={<ExternalLink className="size-5" />}>Abrir Google Traductor</Button>
              </a>
            </div>
          </Card>
        )}

        {view === 'image' ? (
          <>
            <div
              className="relative overflow-hidden rounded-2xl border border-line bg-surface-2 select-none"
              onPointerDown={() => setShowOrig(true)}
              onPointerUp={() => setShowOrig(false)}
              onPointerLeave={() => setShowOrig(false)}
              onPointerCancel={() => setShowOrig(false)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {shown ? <img src={shown} alt={showOrig ? 'Foto original' : 'Foto traducida'} className="w-full" draggable={false} /> : <div className="aspect-[3/4]" />}
              {lensUrl && (
                <span className="pointer-events-none absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
                  <Eye className="size-4" /> {showOrig ? 'Original' : `${langLabel(prefs.trLang)} · mantén presionado para ver el original`}
                </span>
              )}
            </div>
            {lensUrl && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="soft" icon={<Save className="size-5" />} onClick={saveImage}>
                  Guardar imagen
                </Button>
                <Button variant="secondary" icon={<Share2 className="size-5" />} onClick={async () => shareFiles([await imageFile()])}>
                  Compartir
                </Button>
                <Button
                  variant="secondary"
                  icon={<Download className="size-5" />}
                  onClick={async () => {
                    await saveFileAs(await imageFile());
                  }}
                >
                  Descargar
                </Button>
              </div>
            )}
          </>
        ) : (
          result && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-bold text-primary">
                {langLabel(result.from) || 'Original'} → {langLabel(prefs.trLang)}
              </h2>
              <p className="text-lg leading-relaxed whitespace-pre-wrap">{translatedText}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="soft" icon={<Copy className="size-5" />} onClick={() => copyText(translatedText)}>
                  Copiar
                </Button>
                <Button variant="secondary" icon={<Share2 className="size-5" />} onClick={() => shareText(translatedText)}>
                  Compartir
                </Button>
                <Button variant="secondary" icon={<Save className="size-5" />} onClick={saveText}>
                  Guardar
                </Button>
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-bold text-soft">Ver texto original</summary>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-soft">{originalText}</p>
              </details>
            </Card>
          )
        )}
        {result?.online && <p className="mt-3 text-xs text-faint">Traducido con Google Traductor (se envió sólo el texto, no la foto).</p>}

        <div className="mt-6 flex justify-center">
          <Button variant="ghost" icon={<Camera className="size-5" />} onClick={again}>
            Escanear otro texto
          </Button>
        </div>
      </div>
    </div>
  );
}
