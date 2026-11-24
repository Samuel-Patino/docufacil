import { useState } from 'react';
import { MessageSquarePlus, Lightbulb, Bug, Copy, Send } from 'lucide-react';
import { Modal, Button, Segmented, inputCls } from './ui';
import { copyText } from '../lib/share';

const REPO = 'https://github.com/Samuel-Patino/docufacil';

/** Botoncito para sugerir una función o reportar un problema (se envía como "issue" de GitHub). */
export function FeedbackButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'idea' | 'bug'>('idea');
  const [text, setText] = useState('');

  const body = () => {
    const ua = navigator.userAgent;
    const device = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : 'Computador';
    const installed = matchMedia('(display-mode: standalone)').matches ? 'instalada' : 'en el navegador';
    return `${text.trim()}\n\n---\nDispositivo: ${device} (${installed})\nPantalla: ${location.hash || '#/'}`;
  };
  const title = () => (kind === 'idea' ? 'Sugerencia: ' : 'Problema: ') + text.trim().split('\n')[0].slice(0, 70);

  function send() {
    const url = `${REPO}/issues/new?labels=${kind === 'idea' ? 'enhancement' : 'bug'}&title=${encodeURIComponent(title())}&body=${encodeURIComponent(body())}`;
    window.open(url, '_blank', 'noopener');
    setOpen(false);
    setText('');
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Sugerir o reportar"
        title="Sugerir o reportar"
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-bold text-soft shadow-card transition hover:text-text active:scale-95 ${className}`}
      >
        <MessageSquarePlus className="size-4" /> Sugerir
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Sugerir o reportar"
        footer={
          <>
            <Button variant="secondary" icon={<Copy className="size-5" />} disabled={!text.trim()} onClick={() => copyText(`${title()}\n\n${body()}`)}>
              Copiar
            </Button>
            <Button icon={<Send className="size-5" />} disabled={!text.trim()} onClick={send}>
              Enviar
            </Button>
          </>
        }
      >
        <Segmented
          className="mb-3"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'idea', label: <span className="flex items-center justify-center gap-1.5"><Lightbulb className="size-4" />Sugerir función</span> },
            { value: 'bug', label: <span className="flex items-center justify-center gap-1.5"><Bug className="size-4" />Reportar problema</span> },
          ]}
        />
        <textarea
          className={inputCls + ' h-36 py-3 leading-relaxed'}
          placeholder={kind === 'idea' ? '¿Qué te gustaría que hiciera la app?' : '¿Qué pasó? ¿Qué estabas haciendo?'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="mt-2 text-xs text-faint">
          “Enviar” abre GitHub con tu mensaje listo (se necesita una cuenta gratuita). Sólo se envía lo que escribas y el tipo de dispositivo; ningún documento.
        </p>
      </Modal>
    </>
  );
}
