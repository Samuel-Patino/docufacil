import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { applyTheme, useApp } from './lib/store';

applyTheme();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  useApp.setState({ installPrompt: e });
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

// Pedimos almacenamiento persistente para que el navegador no borre los documentos
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
