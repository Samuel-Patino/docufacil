# DocuFácil — Escáner y Editor de Documentos

Aplicación web **gratuita** para PC, Android e iPhone que se instala como una app (PWA).
Todo se procesa **en el propio dispositivo**: los documentos no se suben a ningún servidor.

## Funciones

**Escáner inteligente**
- Cámara con detección del documento **en tiempo real** (marco azul) y captura automática cuando está quieto.
- Modos: Documento, Recibo, Libro (página curva), Pizarra, Cédula (frente y reverso en una página), Pasaporte (lee nombres, número y fechas de la zona MRZ) y lector de QR / códigos de barras.
- Varias páginas por documento, reordenar arrastrando, girar, eliminar.
- Recorte con esquinas y lupa, corrección de perspectiva y de **páginas curvas**.
- Filtros: Mágico (quita sombras y ajusta la luz), Original, Color vivo, Gris, Blanco y negro, Recibo (recupera recibos térmicos desteñidos) y Pizarra.
- Ajustes manuales: brillo, contraste, nitidez y quitar ruido.
- **Borrado inteligente**: pintas lo que no quieres y se rellena el fondo.
- Importar fotos de la galería con detección automática de bordes.

**Reconocimiento de texto (OCR)**: español, inglés, portugués, francés, italiano y alemán. PDF buscable y exportación a PDF, JPG, Word y TXT.

**Conversor**: imágenes → PDF (uno o varios), Word / Excel / PowerPoint / TXT / CSV / HTML → PDF, página web → PDF, PDF → Word / Excel / PowerPoint / JPG / TXT, extraer imágenes del PDF.

**Lector y editor de PDF**: lector con búsqueda y zoom, vista de lectura (claro / sepia / oscuro), resaltar, lápiz, marcador, texto, comentarios, flechas, rectángulos, corrector blanco, imágenes, **firma** (dibujada, escrita o desde una foto; se guarda para reutilizarla) y llenado de formularios. Edición de fotos con recorte, filtros y borrado.

**Organizar**: unir, dividir, extraer, organizar páginas (ordenar, duplicar, eliminar), rotar, recortar (todas o una por una), comprimir, numerar páginas y marcas de agua de texto o imagen.

**Seguridad**: poner y quitar contraseña a PDF (AES-256), y bloquear carpetas y archivos con PIN o con huella / Face ID (contenido cifrado en el dispositivo).

**Archivos**: carpetas con colores, reordenar arrastrando, mover archivos soltándolos sobre una carpeta, búsqueda, copia de seguridad y restauración.

**Compartir**: por WhatsApp, correo o cualquier app, como archivo adjunto. En Android también puedes enviar archivos *a* DocuFácil desde otras apps.

## Usarla en tu computador

Necesitas [Node.js](https://nodejs.org) (gratis).

```powershell
npm install
npm run dev
```

Abre <http://localhost:5173>.

Para probarla en el celular dentro de tu red Wi-Fi (la cámara exige HTTPS):

```powershell
npm run dev:lan
```

Abre en el celular la dirección `https://…` que aparece y acepta el aviso de certificado.

## Publicarla gratis en internet

Primero genera la versión final:

```powershell
npm run build
```

Esto crea la carpeta `dist`. Elige una opción gratuita:

- **Netlify Drop**: entra a <https://app.netlify.com/drop> y arrastra la carpeta `dist`.
- **Cloudflare Pages**: crea un proyecto y sube la carpeta `dist`.
- **GitHub Pages**: sube este proyecto a un repositorio de GitHub y activa *Settings → Pages → Source: GitHub Actions*. El archivo `.github/workflows/deploy.yml` ya publica la app automáticamente.

Todas incluyen HTTPS, que es obligatorio para usar la cámara.

## Instalarla como app

- **iPhone / iPad (Safari)**: botón Compartir → **Agregar a pantalla de inicio**.
- **Android (Chrome)**: menú ⋮ → **Instalar app**.
- **PC (Chrome / Edge)**: ícono de instalar en la barra de direcciones.

Una vez instalada funciona sin internet. El lector de texto descarga cada idioma la primera vez que se usa.

## Notas

- Los documentos se guardan en el navegador del dispositivo. Usa **Ajustes → Exportar copia** de vez en cuando.
- Las conversiones de Office se hacen sin servidor: los documentos sencillos quedan muy bien; los diseños muy complejos pueden cambiar un poco.
- Página web → PDF sólo funciona con sitios que permiten descargarse desde otra página; si no, guarda la página como `.html` y conviértela.
- Si olvidas el PIN de bloqueo, los archivos bloqueados no se pueden recuperar.

## Tecnología

React, TypeScript, Vite, Tailwind CSS, OpenCV.js, Tesseract.js, pdf.js, pdf-lib, pdfmake, mammoth, SheetJS, PptxGenJS, docx, ZXing y Workbox. Todas son librerías gratuitas y de código abierto.
