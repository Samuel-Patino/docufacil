import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Languages, Camera, Copy, Share2, Save, ArrowDown, ExternalLink, RefreshCw } from 'lucide-react';
import { TopBar, Button, Card, Empty, Field, inputCls, Spinner } from '../components/ui';
import { useApp, toast, errMsg } from '../lib/store';
import { renderScanPage } from '../lib/imaging';
import { ocrImage, OCR_LANGS } from '../lib/ocr';
import { pendingTranslate, translateText, paragraphsForTranslation, TR_LANGS, langLabel, googleTranslateUrl } from '../lib/translate';
import { copyText, shareText } from '../lib/share';
import { addDoc } from '../lib/library';
import { defaultScanName } from '../lib/util';

export default function TranslatePage() {
  const nav = useNavigate();
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const [page] = useState(() => pendingTranslate.page);
  const [status, setStatus] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; from: string; online: boolean } | null>(null);
  const [trErr, setTrErr] = useState<string | null>(null);
  const [trBusy, setTrBusy] = useState(false);

  async function read(lang = prefs.ocrLang) {
    if (!page) return;
    setSource(null);
    setResult(null);
    try {
      setStatus('Preparando la imagen…');
      const c = await renderScanPage(page, 2400);
      const r = await ocrImage(c, lang, (p, st) => setStatus(`${st} ${Math.round(p * 100)}%`));
      const text = paragraphsForTranslation(r.paragraphs);
      setSource(text);
      setStatus(null);
      if (text.trim()) translate(text);
    } catch (e) {
      setStatus(null);
      toast(errMsg(e), 'error');
    }
  }

  async function translate(text = source || '', to = prefs.trLang) {
    if (!text.trim()) return;
    setTrBusy(true);
    setTrErr(null);
    try {
      setResult(await translateText(text, to));
    } catch (e) {
      setTrErr(errMsg(e));
    } finally {
      setTrBusy(false);
    }
  }

  useEffect(() => {
    read();
  }, []);

  function again() {
    pendingTranslate.page = null;
    nav('/scan?mode=translate', { replace: true });
  }

  async function saveText() {
    if (!result) return;
    const body = `${result.text}\n\n———\nTexto original (${langLabel(result.from) || 'detectado'}):\n\n${source}`;
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
          text="Toma una foto de un texto y lo traducimos al idioma que elijas."
          action={<Button icon={<Camera className="size-5" />} onClick={again}>Escanear texto</Button>}
        />
      </div>
    );

  return (
    <div className="min-h-dvh pb-10">
      <TopBar title="Traducir" back="/" />
      <div className="mx-auto max-w-3xl px-4 pt-4">
        <div className="mb-4 flex items-center gap-3">
          {page.thumb && <img src={page.thumb} alt="" className="h-20 w-16 rounded-xl border border-line object-cover" />}
          <div className="min-w-0 flex-1">
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
          </div>
        </div>

        {status ? (
          <Card className="flex items-center gap-3 p-5">
            <Spinner className="size-7" />
            <span className="font-semibold">{status}</span>
          </Card>
        ) : (
          source !== null && (
            <>
              <h2 className="mb-1 text-sm font-bold text-soft">Texto leído{result?.from ? ` · ${langLabel(result.from)}` : ''}</h2>
              {source.trim() ? (
                <textarea className={inputCls + ' h-44 py-3 leading-relaxed'} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Texto original" />
              ) : (
                <p className="rounded-2xl bg-warn-soft p-4 font-semibold text-warn">No se encontró texto. Intenta con más luz o acercándote al documento.</p>
              )}

              <div className="my-3 flex items-center gap-2">
                <ArrowDown className="size-5 text-faint" />
                <select
                  className={inputCls + ' flex-1 font-bold'}
                  value={prefs.trLang}
                  aria-label="Traducir a"
                  onChange={(e) => {
                    setPrefs({ trLang: e.target.value });
                    translate(source, e.target.value);
                  }}
                >
                  {TR_LANGS.map((l) => (
                    <option key={l.id} value={l.id}>
                      Traducir a {l.label}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" icon={<RefreshCw className="size-5" />} onClick={() => translate()} disabled={trBusy || !source.trim()}>
                  <span className="hidden sm:inline">Traducir</span>
                </Button>
              </div>

              {trBusy && (
                <Card className="flex items-center gap-3 p-5">
                  <Spinner className="size-7" />
                  <span className="font-semibold">Traduciendo…</span>
                </Card>
              )}
              {trErr && !trBusy && (
                <Card className="p-5">
                  <p className="font-semibold text-danger">{trErr}</p>
                  <p className="mt-1 text-sm text-soft">Puedes copiar el texto y pegarlo en Google Traductor.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" icon={<Copy className="size-5" />} onClick={() => copyText(source)}>
                      Copiar texto
                    </Button>
                    <a href={googleTranslateUrl(prefs.trLang)} target="_blank" rel="noreferrer">
                      <Button variant="secondary" icon={<ExternalLink className="size-5" />}>Abrir Google Traductor</Button>
                    </a>
                  </div>
                </Card>
              )}
              {result && !trBusy && (
                <Card className="p-4">
                  <h2 className="mb-2 text-sm font-bold text-primary">{langLabel(prefs.trLang)}</h2>
                  <p className="text-lg leading-relaxed whitespace-pre-wrap">{result.text}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="soft" icon={<Copy className="size-5" />} onClick={() => copyText(result.text)}>
                      Copiar
                    </Button>
                    <Button variant="secondary" icon={<Share2 className="size-5" />} onClick={() => shareText(result.text)}>
                      Compartir
                    </Button>
                    <Button variant="secondary" icon={<Save className="size-5" />} onClick={saveText}>
                      Guardar
                    </Button>
                  </div>
                  {result.online && <p className="mt-3 text-xs text-faint">Traducido con Google Traductor (se envió sólo el texto).</p>}
                </Card>
              )}
            </>
          )
        )}

        <div className="mt-6 flex justify-center">
          <Button variant="ghost" icon={<Camera className="size-5" />} onClick={again}>
            Escanear otro texto
          </Button>
        </div>
      </div>
    </div>
  );
}
