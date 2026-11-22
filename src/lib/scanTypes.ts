export interface Pt {
  x: number;
  y: number;
}

/** 4 esquinas normalizadas (0..1): sup-izq, sup-der, inf-der, inf-izq */
export type Quad = [Pt, Pt, Pt, Pt];

export type FilterId = 'original' | 'auto' | 'enhanced' | 'gray' | 'bw' | 'receipt' | 'whiteboard';

export interface Adjust {
  brightness: number; // -100..100
  contrast: number; // -100..100
  sharpen: number; // 0..100
  denoise: number; // 0..100
}

export interface EraseStroke {
  pts: Pt[]; // normalizados sobre la imagen recortada (antes de girar)
  size: number; // grosor relativo al ancho
}

export interface ScanPage {
  id: string;
  orig: Blob;
  /** null = imagen completa */
  quad: Quad | null;
  /** Puntos medios de los bordes (arriba, derecha, abajo, izquierda) para páginas curvas */
  curve: [Pt, Pt, Pt, Pt] | null;
  filter: FilterId;
  adj: Adjust;
  rotation: 0 | 90 | 180 | 270;
  erase: EraseStroke[];
  /** Resultado final a resolución completa (caché) */
  processed?: Blob;
  thumb?: string; // object URL de vista previa
  /** Aspecto forzado (ancho/alto) para cédula, pasaporte */
  aspect?: number;
}

export const DEFAULT_ADJ: Adjust = { brightness: 0, contrast: 0, sharpen: 0, denoise: 0 };

export const FILTERS: { id: FilterId; label: string; hint: string }[] = [
  { id: 'auto', label: 'Mágico', hint: 'Ajuste automático de luz, sombras y contraste' },
  { id: 'original', label: 'Original', hint: 'Sin cambios de color' },
  { id: 'enhanced', label: 'Color vivo', hint: 'Realza colores (fotos, folletos)' },
  { id: 'gray', label: 'Gris', hint: 'Escala de grises limpia' },
  { id: 'bw', label: 'Blanco y negro', hint: 'Texto nítido, ideal para fax y contratos' },
  { id: 'receipt', label: 'Recibo', hint: 'Recupera recibos térmicos desteñidos' },
  { id: 'whiteboard', label: 'Pizarra', hint: 'Fondo blanco y trazos con color' },
];

export type ScanMode = 'document' | 'receipt' | 'book' | 'whiteboard' | 'idcard' | 'passport' | 'qr' | 'sign' | 'translate';

export const SCAN_MODES: { id: ScanMode; label: string; filter: FilterId; more?: boolean }[] = [
  { id: 'document', label: 'Documento', filter: 'auto' },
  { id: 'idcard', label: 'Cédula', filter: 'enhanced' },
  { id: 'qr', label: 'QR', filter: 'original' },
  { id: 'receipt', label: 'Recibo', filter: 'receipt' },
  { id: 'sign', label: 'Firmar', filter: 'auto' },
  { id: 'translate', label: 'Traducir', filter: 'auto' },
  { id: 'book', label: 'Libro', filter: 'auto', more: true },
  { id: 'whiteboard', label: 'Pizarra', filter: 'whiteboard', more: true },
  { id: 'passport', label: 'Pasaporte', filter: 'enhanced', more: true },
];

/** Cédula / tarjeta ID-1: 85.6 × 54 mm. Pasaporte (página de datos ID-3): 125 × 88 mm */
export const ID_CARD_ASPECT = 85.6 / 54;
export const PASSPORT_ASPECT = 125 / 88;
