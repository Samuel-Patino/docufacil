/// <reference lib="webworker" />
// Service worker: funciona sin conexión y recibe archivos compartidos (Android).
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { db } from './lib/db';

declare const self: any;

self.skipWaiting();
self.addEventListener('activate', (e: any) => e.waitUntil(self.clients.claim()));

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Recursos de pdf.js (fuentes, cmaps) y OCR (Tesseract desde jsDelivr)
registerRoute(
  ({ url }: any) => url.pathname.includes('/vendor/'),
  new CacheFirst({ cacheName: 'vendor', plugins: [new ExpirationPlugin({ maxEntries: 400 })] }),
);
registerRoute(
  ({ url }: any) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com',
  new CacheFirst({ cacheName: 'ocr', plugins: [new ExpirationPlugin({ maxEntries: 60 })] }),
);

// Destino para "Compartir" desde otras apps (Web Share Target)
self.addEventListener('fetch', (event: any) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(
      (async () => {
        try {
          const form = await event.request.formData();
          const files = form.getAll('files').filter((f: any) => f && typeof f !== 'string');
          // Misma base de datos (y esquema) que la app
          const d: any = await db();
          const tx = d.transaction('inbox', 'readwrite');
          for (const f of files) await tx.store.add({ file: f, at: Date.now() });
          await tx.done;
        } catch (e) {
          console.warn('share-target', e);
        }
        return Response.redirect(new URL('./#/', self.registration.scope).href, 303);
      })(),
    );
  }
});
