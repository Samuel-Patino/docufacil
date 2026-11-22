import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import { BusyOverlay, Dialogs, Spinner, Toaster } from './components/ui';
import { UnlockModal } from './components/UnlockModal';
import Home from './pages/Home';
import { db } from './lib/db';
import { importFiles } from './lib/library';
import { toast } from './lib/store';

const Scanner = lazy(() => import('./pages/Scanner'));
const ScanReview = lazy(() => import('./pages/ScanReview'));
const DocOpen = lazy(() => import('./pages/DocOpen'));
const PdfEditor = lazy(() => import('./pages/PdfEditor'));
const ImageEditorPage = lazy(() => import('./pages/ImageEditorPage'));
const Tools = lazy(() => import('./pages/Tools'));
const ToolRunner = lazy(() => import('./pages/ToolRunner'));
const QrPage = lazy(() => import('./pages/QrPage'));
const Settings = lazy(() => import('./pages/Settings'));

function Loading() {
  return (
    <div className="flex h-[60dvh] items-center justify-center">
      <Spinner className="size-10" />
    </div>
  );
}

/** Archivos recibidos desde "Compartir" (Android) o "Abrir con" (computador). */
function Incoming() {
  const nav = useNavigate();
  useEffect(() => {
    (async () => {
      try {
        const d = await db();
        const items: any[] = await (d as any).getAll('inbox');
        if (items.length) {
          await (d as any).clear('inbox');
          const docs = await importFiles(items.map((i) => i.file));
          toast(`${docs.length} archivo(s) recibidos`, 'ok');
          if (docs.length === 1) nav('/doc/' + docs[0].id);
        }
      } catch (e) {
        console.warn(e);
      }
    })();
    const lq = (window as any).launchQueue;
    if (lq?.setConsumer) {
      lq.setConsumer(async (params: any) => {
        if (!params.files?.length) return;
        const files: File[] = [];
        for (const h of params.files) files.push(await h.getFile());
        const docs = await importFiles(files);
        if (docs.length === 1) nav('/doc/' + docs[0].id);
      });
    }
  }, []);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <Incoming />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/f/:folderId" element={<Home />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/qr" element={<QrPage />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="/scan" element={<Scanner />} />
          <Route path="/review" element={<ScanReview />} />
          <Route path="/doc/:id" element={<DocOpen />} />
          <Route path="/edit/:id" element={<PdfEditor />} />
          <Route path="/image/:id" element={<ImageEditorPage />} />
          <Route path="/tool/:toolId" element={<ToolRunner />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
      <Toaster />
      <Dialogs />
      <UnlockModal />
      <BusyOverlay />
    </HashRouter>
  );
}
