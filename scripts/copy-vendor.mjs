// Copia a /public los archivos grandes que se cargan bajo demanda
// (OpenCV y recursos de pdf.js) para que funcionen sin conexión.
import { cpSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');
mkdirSync(out, { recursive: true });

function copy(from, to) {
  const src = join(nm, from);
  const dst = join(out, to);
  if (existsSync(dst) && statSync(dst).isFile() && statSync(src).size === statSync(dst).size) return;
  cpSync(src, dst, { recursive: true });
  console.log('copiado', from, '→ public/vendor/' + to);
}

copy('@techstark/opencv-js/dist/opencv.js', 'opencv.js');
copy('pdfjs-dist/cmaps', 'pdfjs/cmaps');
copy('pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts');
copy('pdfjs-dist/wasm', 'pdfjs/wasm');
copy('pdfjs-dist/iccs', 'pdfjs/iccs');
