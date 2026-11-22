import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => ({
  // Rutas relativas: la app funciona en cualquier hosting estático gratuito
  // (GitHub Pages, Cloudflare Pages, Netlify) aunque esté en una subcarpeta.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    mode === 'lan' ? basicSsl() : null,
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2,wasm}'],
      },
      manifest: {
        id: './',
        name: 'DocuFácil — Escáner y PDF',
        short_name: 'DocuFácil',
        description: 'Escanea, edita, firma y convierte documentos y PDF desde tu celular o computador.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f7fb',
        theme_color: '#2563eb',
        categories: ['productivity', 'utilities', 'business'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            files: [
              {
                name: 'files',
                accept: [
                  'application/pdf', 'image/*', 'text/plain', 'text/csv',
                  '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
                ],
              },
            ],
          },
        },
        file_handlers: [
          {
            action: './',
            accept: {
              'application/pdf': ['.pdf'],
              'image/*': ['.jpg', '.jpeg', '.png', '.webp'],
            },
          },
        ],
      } as any,
      devOptions: { enabled: false },
    }),
  ].filter(Boolean),
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  worker: { format: 'es' },
}));
