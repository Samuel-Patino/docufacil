import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FolderOpen, Wrench, ScanLine, QrCode, Settings, Lock } from 'lucide-react';
import { useApp } from '../lib/store';
import { lockNow } from '../lib/lock';
import { IconButton } from './ui';

const items = [
  { to: '/', label: 'Archivos', icon: FolderOpen, end: true },
  { to: '/tools', label: 'Herramientas', icon: Wrench },
  { to: '/qr', label: 'Leer QR', icon: QrCode },
  { to: '/settings', label: 'Ajustes', icon: Settings },
];

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="./favicon.svg" alt="" className={small ? 'size-8' : 'size-10'} />
      <div className="leading-tight">
        <div className="text-lg font-black tracking-tight">DocuFácil</div>
        {!small && <div className="text-xs font-semibold text-soft">Escáner y PDF</div>}
      </div>
    </div>
  );
}

export default function Layout() {
  const nav = useNavigate();
  const unlocked = useApp((s) => s.unlocked);
  return (
    <div className="min-h-dvh lg:flex">
      {/* Barra lateral (computador) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        <div className="mb-6 px-2">
          <Logo />
        </div>
        <button
          onClick={() => nav('/scan')}
          className="mb-4 flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-extrabold text-on-primary shadow-card hover:bg-primary-strong active:scale-[0.98]"
        >
          <ScanLine className="size-6" /> Escanear
        </button>
        <nav className="flex flex-col gap-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `flex h-12 items-center gap-3 rounded-2xl px-3 font-bold transition ${isActive ? 'bg-primary-soft text-primary' : 'text-soft hover:bg-surface-2 hover:text-text'}`
              }
            >
              <it.icon className="size-6" /> {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          {unlocked && (
            <button onClick={lockNow} className="flex h-12 w-full items-center gap-3 rounded-2xl px-3 font-bold text-soft hover:bg-surface-2">
              <Lock className="size-5" /> Bloquear ahora
            </button>
          )}
          <p className="px-3 pt-2 text-xs text-faint">Todo se guarda y procesa en tu dispositivo. Gratis.</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-28 lg:pb-8">
        <Outlet />
      </main>

      {/* Barra inferior (celular) */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Navegación principal">
        <div className="mx-auto grid h-[72px] max-w-lg grid-cols-5 items-center px-1">
          {items.slice(0, 2).map((it) => (
            <Tab key={it.to} {...it} />
          ))}
          <div className="flex justify-center">
            <button
              aria-label="Escanear documento"
              onClick={() => nav('/scan')}
              className="-mt-8 flex size-[68px] items-center justify-center rounded-full bg-primary text-on-primary shadow-pop ring-4 ring-bg active:scale-95"
            >
              <ScanLine className="size-8" />
            </button>
          </div>
          {items.slice(2).map((it) => (
            <Tab key={it.to} {...it} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function Tab({ to, label, icon: Icon, end }: (typeof items)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `flex flex-col items-center gap-0.5 py-1 text-[11px] font-bold ${isActive ? 'text-primary' : 'text-faint'}`}
    >
      {({ isActive }) => (
        <>
          <span className={`flex h-8 w-14 items-center justify-center rounded-full transition ${isActive ? 'bg-primary-soft' : ''}`}>
            <Icon className="size-6" />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}
