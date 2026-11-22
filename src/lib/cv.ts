// Carga perezosa de OpenCV.js (≈13 MB, se guarda para uso sin conexión).
let loading: Promise<any> | null = null;

export function loadCV(): Promise<any> {
  if ((window as any).__cvReady) return Promise.resolve((window as any).__cvReady);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('vendor/opencv.js', document.baseURI).href;
    s.async = true;
    s.onload = async () => {
      try {
        let cv = (window as any).cv;
        if (cv && typeof cv.then === 'function' && !cv.Mat) cv = await cv;
        if (!cv.Mat) {
          await new Promise<void>((res) => {
            const prev = cv.onRuntimeInitialized;
            cv.onRuntimeInitialized = () => {
              prev?.();
              res();
            };
            const t = setInterval(() => {
              if (cv.Mat) {
                clearInterval(t);
                res();
              }
            }, 100);
          });
        }
        (window as any).__cvReady = cv;
        resolve(cv);
      } catch (e) {
        reject(e);
      }
    };
    s.onerror = () => {
      loading = null;
      reject(new Error('No se pudo cargar el motor de imagen. Revisa tu conexión la primera vez.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export const cvReady = () => (window as any).__cvReady || null;
