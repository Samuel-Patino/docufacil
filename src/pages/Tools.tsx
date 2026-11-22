import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { TOOLS, GROUPS } from '../lib/tools';
import { inputCls } from '../components/ui';

export default function Tools() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const list = TOOLS.filter((x) => !t || (x.title + ' ' + x.desc).toLowerCase().includes(t));
  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6">
      <h1 className="safe-top py-3 text-2xl font-black">Herramientas</h1>
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" />
        <input className={inputCls + ' pl-12 text-lg'} placeholder="¿Qué quieres hacer?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar herramienta" />
      </div>
      {GROUPS.map((g) => {
        const items = list.filter((x) => x.group === g.id);
        if (!items.length) return null;
        return (
          <section key={g.id} className="mb-7">
            <h2 className="mb-3 text-lg font-extrabold">{g.title}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((x) => (
                <button
                  key={x.id}
                  onClick={() => nav(x.route || '/tool/' + x.id)}
                  className="flex flex-col items-start gap-3 rounded-3xl border border-line bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  <span className="flex size-12 items-center justify-center rounded-2xl" style={{ background: x.color + '1f', color: x.color }}>
                    <x.icon className="size-6" />
                  </span>
                  <span>
                    <span className="block font-extrabold leading-tight">{x.title}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-soft">{x.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
