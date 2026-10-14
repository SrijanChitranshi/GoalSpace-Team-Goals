import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, ArrowRight, BarChart3, CalendarDays, Check, ChevronDown, CircleHelp, Command, Compass, Goal, LayoutDashboard, LogOut, MessageSquare, Plus, Settings, Shield, Users, Wifi, WifiOff, X } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#315895] text-white shadow-sm">
        <Goal size={17} strokeWidth={2.3} />
      </span>
      {!compact && <span className="font-display text-[17px] font-extrabold tracking-[-.05em]">goalspace</span>}
    </div>
  );
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">{eyebrow}</p>}
        <h1 className="font-display text-[27px] font-bold tracking-[-.04em]">{title}</h1>
        {description && <p className="mt-1.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div className="panel flex items-center gap-4 p-4" key={index}>
          <div className="skeleton h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2"><div className="skeleton h-3 w-2/5" /><div className="skeleton h-2.5 w-3/5" /></div>
          <div className="skeleton h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="panel flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-primary"><Compass size={21} /></span>
      <h3 className="font-display text-base font-bold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-muted-foreground">{detail}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="panel flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
      <CircleHelp size={22} className="mb-3 text-destructive" />
      <p className="font-semibold">We couldn’t load this view</p>
      <p className="mt-1 text-sm text-muted-foreground">Your work is safe. Try connecting again.</p>
      <button className="button button-quiet mt-4" onClick={onRetry} data-testid="button-retry"><ArrowRight size={14} /> Try again</button>
    </div>
  );
}

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dimension = size === 'lg' ? 'h-11 w-11 text-sm' : size === 'md' ? 'h-9 w-9 text-xs' : 'h-7 w-7 text-[10px]';
  const initials = name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return <span className={`inline-grid shrink-0 place-items-center rounded-full bg-[#e5ebf5] font-bold text-[#375787] ring-2 ring-white ${dimension}`} data-testid={`avatar-${name.replace(/\W/g, '-').toLowerCase()}`}>{initials}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-50 text-emerald-700',
    'in-progress': 'bg-blue-50 text-blue-700',
    blocked: 'bg-rose-50 text-rose-700',
    'not-started': 'bg-slate-100 text-slate-600',
    high: 'bg-amber-50 text-amber-800',
    medium: 'bg-sky-50 text-sky-700',
    low: 'bg-slate-100 text-slate-600',
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${styles[status] ?? 'bg-slate-100 text-slate-600'}`} data-testid={`status-${status}`}>{status.replace('-', ' ')}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17243a]/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="panel fade-in w-full max-w-lg overflow-hidden shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-center justify-between border-b px-5 py-4"><h2 className="font-display text-base font-bold">{title}</h2><button className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="Close" data-testid="button-close-modal"><X size={16} /></button></header>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}

const navSections = [
  { title: 'Workspace', items: [{ label: 'Overview', path: 'overview', icon: LayoutDashboard }, { label: 'Daily goals', path: 'goals/daily', icon: Check }, { label: 'Weekly goals', path: 'goals/weekly', icon: CalendarDays }, { label: 'Monthly goals', path: 'goals/monthly', icon: BarChart3 }] },
  { title: 'Connect', items: [{ label: 'Team chat', path: 'chat', icon: MessageSquare }, { label: 'Members', path: 'members', icon: Users }, { label: 'Activity', path: 'activity', icon: Activity }] },
];

export function WorkspaceShell({ workspaceId, workspaceName, children, online, userName, role, onLogout }: { workspaceId: string; workspaceName: string; children: ReactNode; online: boolean; userName: string; role: string; onLogout: () => void }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const base = `/w/${workspaceId}`;
  const active = location.replace(`${base}/`, '');
  const sidebar = (
    <aside className="flex h-full flex-col bg-sidebar px-3.5 pb-4 pt-5 text-sidebar-foreground">
      <div className="mb-8 flex items-center justify-between px-2"><Brand /><button onClick={() => setMobileOpen(false)} className="rounded-md p-1 md:hidden" aria-label="Close navigation"><X size={17} /></button></div>
      <Link href="/" className="mb-5 flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.06] p-2.5 text-left hover:bg-white/[.1]" data-testid="link-workspace-switcher">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#567ab3] font-display text-xs font-bold text-white">{workspaceName.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-white">{workspaceName}</span><span className="mt-0.5 block text-[10px] capitalize text-white/50">{role} workspace</span></span>
        <ChevronDown size={14} className="text-white/55" />
      </Link>
      {navSections.map((section) => (
        <div className="mb-6" key={section.title}>
          <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[.15em] text-white/35">{section.title}</p>
          <div className="space-y-1">{section.items.map(({ label, path, icon: Icon }) => {
            const isActive = active === path;
            return <Link href={`${base}/${path}`} className={`nav-link ${isActive ? 'active' : ''}`} data-testid={`link-nav-${path.replace('/', '-')}`} key={path}><Icon size={16} strokeWidth={1.8} /><span>{label}</span></Link>;
          })}</div>
        </div>
      ))}
      <div className="mb-5">
        <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[.15em] text-white/35">Manage</p>
        <Link href={`${base}/permissions`} className={`nav-link ${active === 'permissions' ? 'active' : ''}`} data-testid="link-nav-permissions"><Shield size={16} strokeWidth={1.8} /> Permissions</Link>
        <Link href={`${base}/settings`} className={`nav-link ${active === 'settings' ? 'active' : ''}`} data-testid="link-nav-settings"><Settings size={16} strokeWidth={1.8} /> Settings</Link>
      </div>
      <div className="mt-auto rounded-xl border border-white/10 bg-white/[.045] p-3">
        <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-300'}`} /><span className="text-[11px] font-semibold">{online ? 'Live workspace' : 'Reconnecting'}</span><span className="ml-auto">{online ? <Wifi size={13} /> : <WifiOff size={13} />}</span></div>
        <p className="mt-1.5 pl-4 text-[10px] leading-4 text-white/45">{online ? 'Changes stay in sync across your team.' : 'Updates will resume when connected.'}</p>
      </div>
      <div className="mt-3 flex items-center gap-2.5 rounded-xl px-2 py-2">
        <Avatar name={userName} /><span className="min-w-0 flex-1 truncate text-xs font-medium text-white/90">{userName}</span>
        <button onClick={onLogout} className="rounded-md p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white" aria-label="Sign out" data-testid="button-logout"><LogOut size={15} /></button>
      </div>
    </aside>
  );
  return (
    <div className="app-shell flex bg-background">
      <div className="fixed inset-y-0 left-0 z-40 hidden w-[238px] md:block">{sidebar}</div>
      {mobileOpen && <div className="fixed inset-0 z-40 md:hidden"><div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} /> <div className="relative h-full w-[260px]">{sidebar}</div></div>}
      <main className="min-w-0 flex-1 md:ml-[238px]">
        <header className="sticky top-0 z-30 flex h-[58px] items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md md:px-8">
          <div className="flex items-center gap-3"><button className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Command size={16} /></button><span className="text-xs text-muted-foreground">{workspaceName}</span><ArrowRight size={13} className="text-muted-foreground/50" /><span className="text-xs font-semibold capitalize text-foreground">{active.replaceAll('/', ' / ')}</span></div>
          <div className="flex items-center gap-3"><span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />{online ? 'Synced' : 'Connecting'}</span><span className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground" aria-label="Workspace status"><Activity size={14} /></span></div>
        </header>
        <div className="mx-auto max-w-[1440px] p-4 pb-12 md:px-8 md:py-7">{children}</div>
      </main>
    </div>
  );
}
