import type { Fmt } from '../components/FormatIcon';
import {
  FileImage, FileText, FileSpreadsheet, Presentation, Globe, FileType2, Images, ScanText, FileSearch, Combine, Split, FileOutput,
  LayoutGrid, RotateCw, Crop, Minimize2, Hash, Stamp, KeyRound, LockOpen, PenLine, Highlighter, FormInput, ScanLine, IdCard,
  BookUser, QrCode, ImageUp, FilePen, Type, Languages,
} from 'lucide-react';

export interface ToolDef {
  id: string;
  title: string;
  desc: string;
  icon: any;
  color: string;
  group: 'convert' | 'organize' | 'security' | 'edit' | 'scan';
  accept?: string; // tipos de entrada
  input?: 'pdf' | 'image' | 'office' | 'any' | 'none';
  multiple?: boolean;
  route?: string; // herramientas que abren otra pantalla
  conv?: [Fmt, Fmt]; // ícono origen → destino
}

export const GROUPS: { id: ToolDef['group']; title: string }[] = [
  { id: 'scan', title: 'Escanear' },
  { id: 'edit', title: 'Editar y firmar' },
  { id: 'convert', title: 'Convertir' },
  { id: 'organize', title: 'Organizar y optimizar' },
  { id: 'security', title: 'Seguridad' },
];

const C = { red: '#ef4444', blue: '#2563eb', green: '#16a34a', orange: '#ea580c', purple: '#9333ea', teal: '#0d9488', slate: '#475569', pink: '#db2777', amber: '#d97706' };

export const TOOLS: ToolDef[] = [
  // Escanear
  { id: 'scan', title: 'Escanear documento', desc: 'Recibos, contratos, notas, libros, pizarras', icon: ScanLine, color: C.blue, group: 'scan', route: '/scan' },
  { id: 'idcard', title: 'Cédula / ID', desc: 'Frente y reverso en una página', icon: IdCard, color: C.purple, group: 'scan', route: '/scan?mode=idcard' },
  { id: 'passport', title: 'Pasaporte', desc: 'Escanea y lee los datos', icon: BookUser, color: C.teal, group: 'scan', route: '/scan?mode=passport' },
  { id: 'qr', title: 'Leer QR y códigos', desc: 'Enlaces, Wi-Fi, contactos', icon: QrCode, color: C.slate, group: 'scan', route: '/qr' },
  { id: 'translate', title: 'Traducir documento', desc: 'Toma una foto y tradúcela', icon: Languages, color: C.green, group: 'scan', route: '/scan?mode=translate' },

  // Editar
  { id: 'sign', title: 'Firmar PDF', desc: 'Crea tu firma una vez y reutilízala', icon: PenLine, color: C.blue, group: 'edit', input: 'pdf' },
  { id: 'annotate', title: 'Anotar PDF', desc: 'Resaltar, notas, dibujos, texto e imágenes', icon: Highlighter, color: C.amber, group: 'edit', input: 'pdf' },
  { id: 'form', title: 'Llenar formulario', desc: 'Completa campos de un PDF', icon: FormInput, color: C.teal, group: 'edit', input: 'pdf' },
  { id: 'editphoto', title: 'Editar foto del dispositivo', desc: 'Recorta, filtra o borra y guarda en Fotos', icon: ImageUp, color: C.pink, group: 'edit', route: '/image/device' },
  { id: 'editpdf', title: 'Editar PDF del dispositivo', desc: 'Abre de Archivos, edita y guarda', icon: FilePen, color: C.red, group: 'edit', input: 'none' },

  // Convertir
  { id: 'img2pdf', title: 'Imágenes a PDF', desc: 'Una o varias fotos en uno o varios PDF', icon: FileImage, color: C.purple, group: 'convert', input: 'image', multiple: true, conv: ['img', 'pdf'] },
  { id: 'word2pdf', title: 'Word a PDF', desc: 'Documentos .docx', icon: FileText, color: C.blue, group: 'convert', input: 'office', accept: 'word', multiple: true, conv: ['word', 'pdf'] },
  { id: 'excel2pdf', title: 'Excel a PDF', desc: 'Hojas .xlsx y .csv', icon: FileSpreadsheet, color: C.green, group: 'convert', input: 'office', accept: 'excel', multiple: true, conv: ['excel', 'pdf'] },
  { id: 'ppt2pdf', title: 'PowerPoint a PDF', desc: 'Presentaciones .pptx', icon: Presentation, color: C.orange, group: 'convert', input: 'office', accept: 'ppt', multiple: true, conv: ['ppt', 'pdf'] },
  { id: 'txt2pdf', title: 'Texto a PDF', desc: 'Archivos .txt', icon: Type, color: C.slate, group: 'convert', input: 'office', accept: 'text', multiple: true, conv: ['txt', 'pdf'] },
  { id: 'web2pdf', title: 'Página web a PDF', desc: 'Desde un enlace o archivo .html', icon: Globe, color: C.teal, group: 'convert', input: 'none', conv: ['web', 'pdf'] },
  { id: 'pdf2word', title: 'PDF a Word', desc: 'Texto editable (.docx)', icon: FileText, color: C.blue, group: 'convert', input: 'pdf', conv: ['pdf', 'word'] },
  { id: 'pdf2excel', title: 'PDF a Excel', desc: 'Tablas editables (.xlsx)', icon: FileSpreadsheet, color: C.green, group: 'convert', input: 'pdf', conv: ['pdf', 'excel'] },
  { id: 'pdf2ppt', title: 'PDF a PowerPoint', desc: 'Diapositivas (.pptx)', icon: Presentation, color: C.orange, group: 'convert', input: 'pdf', conv: ['pdf', 'ppt'] },
  { id: 'pdf2jpg', title: 'PDF a JPG', desc: 'Cada página como imagen', icon: Images, color: C.purple, group: 'convert', input: 'pdf', conv: ['pdf', 'jpg'] },
  { id: 'extractimg', title: 'Extraer imágenes', desc: 'Imágenes del PDF en calidad original', icon: FileOutput, color: C.pink, group: 'convert', input: 'pdf', conv: ['pdf', 'img'] },
  { id: 'pdf2txt', title: 'PDF a texto', desc: 'Archivo .txt', icon: Type, color: C.slate, group: 'convert', input: 'pdf', conv: ['pdf', 'txt'] },
  { id: 'ocr', title: 'Reconocer texto (OCR)', desc: 'Saca el texto de fotos e imágenes', icon: ScanText, color: C.amber, group: 'convert', input: 'image', multiple: true, conv: ['img', 'txt'] },
  { id: 'ocrpdf', title: 'PDF buscable (OCR)', desc: 'Permite buscar y copiar en escaneos', icon: FileSearch, color: C.teal, group: 'convert', input: 'pdf' },

  // Organizar
  { id: 'merge', title: 'Unir PDF', desc: 'Varios PDF o imágenes en uno', icon: Combine, color: C.red, group: 'organize', input: 'pdf', multiple: true },
  { id: 'split', title: 'Dividir PDF', desc: 'Por páginas o rangos', icon: Split, color: C.orange, group: 'organize', input: 'pdf' },
  { id: 'extract', title: 'Extraer páginas', desc: 'Elige páginas para un nuevo PDF', icon: FileOutput, color: C.purple, group: 'organize', input: 'pdf' },
  { id: 'organize', title: 'Organizar páginas', desc: 'Ordenar, eliminar, duplicar', icon: LayoutGrid, color: C.blue, group: 'organize', input: 'pdf' },
  { id: 'rotate', title: 'Rotar páginas', desc: 'Todas o sólo algunas', icon: RotateCw, color: C.teal, group: 'organize', input: 'pdf' },
  { id: 'crop', title: 'Recortar páginas', desc: 'Una por una o todas a la vez', icon: Crop, color: C.green, group: 'organize', input: 'pdf' },
  { id: 'compress', title: 'Comprimir PDF', desc: 'Que pese menos', icon: Minimize2, color: C.red, group: 'organize', input: 'pdf' },
  { id: 'numbers', title: 'Numerar páginas', desc: 'Posición y formato a tu gusto', icon: Hash, color: C.slate, group: 'organize', input: 'pdf' },
  { id: 'watermark', title: 'Marca de agua', desc: 'Texto o imagen', icon: Stamp, color: C.pink, group: 'organize', input: 'pdf' },

  // Seguridad
  { id: 'protect', title: 'Poner contraseña', desc: 'Protege un PDF', icon: KeyRound, color: C.blue, group: 'security', input: 'pdf' },
  { id: 'unlock', title: 'Quitar contraseña', desc: 'Si conoces la contraseña', icon: LockOpen, color: C.green, group: 'security', input: 'pdf' },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);
// alias desde menús
export const TOOL_ALIAS: Record<string, string> = { office2pdf: 'word2pdf' };
