import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { TOOLS, GROUPS, type ToolDef } from '../lib/tools';
import { inputCls, IconButton } from '../components/ui';
import { openFromDevice } from '../lib/device';
import { ConvertIcon } from '../components/FormatIcon';
import { toast, errMsg } from '../lib/store';

export default function Tools() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string>(GROUPS[0].id);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const t = q.trim().toLowerCase();
  const list = TOOLS.filter((x) => !t || (x.title + ' ' + x.desc).toLowerCase().includes(t));
  const groups = GROUPS.filter((g) => list.some((x) => x.group === g.id));

  // marca la sección visible mientras se desplaza
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.group!);
      },
      { rootMargin: '-120px 0px -55% 0px' },
    );
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [t]);

  // mantiene visible el botón de la sección activa
  useEffect(() => {
    const chip = document.getElementById('chip-' + active);
    const row = chip?.parentElement;
    if (chip && row) row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' });
  }, [active]);

  function jump(id: string) {
    setActive(id);
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function open(x: ToolDef) {
    // En iPhone el selector de archivos sólo se abre si se llama directo desde el toque.
    if (x.id === 'editphoto' || x.id === 'editpdf') {
      try {
        const id = await openFromDevice(x.id === 'editphoto' ? 'image' : 'pdf');
        if (id) nav(x.id === 'editphoto' ? '/image/' + id : '/edit/' + id);
      } catch (e) {
        toast(errMsg(e), 'error');
      }
      return;
    }
    nav(x.route || '/tool/' + x.id);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6">
      <h1 className="safe-top py-3 text-2xl font-black">Herramientas</h1>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" />
        <input className={inputCls + ' pl-12 text-lg'} placeholder="¿Qué quieres hacer?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar herramienta" />
        {q && (
          <IconButton label="Borrar búsqueda" className="absolute top-1/2 right-1 -translate-y-1/2" onClick={() => setQ('')}>
            <X className="size-5" />
          </IconButton>
        )}
      </div>

      {/* Ir rápido a una sección */}
      <nav className="safe-top sticky top-0 z-20 -mx-4 mb-4 bg-bg/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6" aria-label="Secciones">
        <div className="no-scrollbar relative flex gap-2 overflow-x-auto">
          {groups.map((g) => (
            <button
              key={g.id}
              id={'chip-' + g.id}
              onClick={() => jump(g.id)}
              className={`h-10 shrink-0 rounded-full border px-4 text-sm font-bold transition ${
                active === g.id ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-soft hover:text-text'
              }`}
            >
              {g.title}
            </button>
          ))}
        </div>
      </nav>

      {list.length === 0 && <p className="py-10 text-center text-soft">No hay herramientas con ese nombre.</p>}

      {groups.map((g) => {
        const items = list.filter((x) => x.group === g.id);
        return (
          <section key={g.id} data-group={g.id} ref={(el) => { refs.current[g.id] = el; }} className="mb-7 scroll-mt-20">
            <h2 className="mb-3 text-lg font-extrabold sm:text-xl">{g.title}</h2>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-4 lg:grid-cols-5">
              {items.map((x) => (
                <button
                  key={x.id}
                  onClick={() => open(x)}
                  className="flex flex-col items-center gap-2 rounded-3xl border border-line bg-surface px-2 py-3.5 text-center shadow-card transition hover:-translate-y-0.5 active:scale-[0.97] sm:items-start sm:gap-3 sm:p-5 sm:text-left"
                >
                  {x.conv ? (
                    <span className="flex h-12 shrink-0 items-center px-1 text-[34px] sm:h-16 sm:text-[46px]">
                      <ConvertIcon from={x.conv[0]} to={x.conv[1]} />
                    </span>
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl sm:size-16" style={{ background: x.color + '1f', color: x.color }}>
                      <x.icon className="size-6 sm:size-8" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold leading-tight sm:text-lg">{x.title}</span>
                    <span className="mt-1 hidden text-sm leading-snug text-soft sm:block">{x.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <div className="h-[40vh]" aria-hidden />
    </div>
  );
}
