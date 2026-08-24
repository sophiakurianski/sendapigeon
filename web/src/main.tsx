import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, type Config, type Hit, type Stats } from './api';
import { PigeonMark } from './components/Pigeon';
import { BoardView } from './views/BoardView';
import { PeopleView } from './views/PeopleView';
import { CompaniesView } from './views/CompaniesView';
import { TodosView } from './views/TodosView';
import { NotesView } from './views/NotesView';
import { ActivityView } from './views/ActivityView';
import { DetailDrawer, type Selection } from './views/DetailDrawer';

type Route = 'board' | 'people' | 'companies' | 'todos' | 'notes' | 'activity';

const ROUTES: { id: Route; label: string; title: string; sub: (s: Stats | null) => string }[] = [
  { id: 'board', label: 'Board', title: 'Board', sub: (s) => (s ? `${s.people} people · ${s.deals.open} open deals` : '') },
  { id: 'todos', label: 'To do', title: 'To do', sub: (s) => (s ? `${s.todos.open} open · ${s.todos.overdue} overdue` : '') },
  { id: 'people', label: 'People', title: 'People', sub: (s) => (s ? `${s.people} contacts` : '') },
  { id: 'companies', label: 'Companies', title: 'Companies', sub: (s) => (s ? `${s.companies} companies` : '') },
  { id: 'notes', label: 'Notes', title: 'Meeting notes', sub: (s) => (s ? `${s.notes} notes in the vault` : '') },
  { id: 'activity', label: 'Activity', title: 'Activity', sub: () => 'every change, newest first' },
];

function RouteIcon({ route }: { route: Route }) {
  const paths: Record<Route, React.ReactNode> = {
    board: <><rect x="3" y="3" width="7" height="14" rx="2" /><rect x="14" y="3" width="7" height="9" rx="2" /></>,
    todos: <><path d="m4 7 2 2 4-4" /><path d="M13 7h7" /><path d="m4 15 2 2 4-4" /><path d="M13 15h7" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-3.6 2.2-5.5 5.5-5.5s5.1 1.9 5.5 5.5" /><path d="M15 5.5c2.6.1 4 1.4 4 3.5s-1.4 3.3-4 3.5M17 14c2.4.6 3.5 2.2 3.5 5" /></>,
    companies: <><path d="M4 21V5l8-3 8 3v16" /><path d="M9 21v-4h6v4M8 8h1M15 8h1M8 12h1M15 12h1" /></>,
    notes: <><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v5h4M8 12h8M8 16h6" /></>,
    activity: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 7.5V12l3 2" /></>,
  };

  return (
    <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      {paths[route]}
    </svg>
  );
}

/**
 * The hash carries both the view and whatever is open in the drawer, so links
 * are shareable and the back button closes the drawer instead of leaving the app.
 * `#/board` or `#/board/deal/acme-renewal`.
 */
let landed = false;

function parseHash(): { route: Route; selection: Selection | null } {
  const [routePart, kind, ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  const route = (ROUTES.some((r) => r.id === routePart) ? routePart : 'board') as Route;
  const id = rest.join('/');
  const selection =
    kind && id && ['deal', 'person', 'company', 'note', 'todo'].includes(kind)
      ? ({ kind, id: decodeURIComponent(id) } as Selection)
      : null;
  return { route, selection };
}

function useHashState() {
  const [state, setState] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setState(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goRoute = useCallback((route: Route) => {
    window.location.hash = `#/${route}`;
  }, []);

  const select = useCallback((selection: Selection | null) => {
    const { route } = parseHash();
    window.location.hash = selection
      ? `#/${route}/${selection.kind}/${encodeURIComponent(selection.id)}`
      : `#/${route}`;
  }, []);

  return { ...state, goRoute, select };
}

function Search({ onPick }: { onPick: (s: Selection) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api.search(q).then(setHits).catch(() => setHits([]));
    }, 140);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        box.current?.querySelector('input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="search" ref={box}>
      <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input
        value={q}
        placeholder="Search the loft"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Search companies, people, deals, todos and notes"
      />
      {!q && <kbd className="search-key">⌘ K</kbd>}
      {open && hits.length > 0 && (
        <div className="results">
          {hits.map((hit) => (
            <button
              key={`${hit.kind}-${hit.id}`}
              className="result"
              onClick={() => {
                onPick({ kind: hit.kind as Selection['kind'], id: hit.id });
                setOpen(false);
                setQ('');
              }}
            >
              <div className="result-kind">{hit.kind}</div>
              <div className="result-title">{hit.title}</div>
              {(hit.snippet || hit.subtitle) && <div className="result-sub">{hit.snippet ?? hit.subtitle}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const { route, selection, goRoute, select } = useHashState();
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [version, setVersion] = useState(0);

  /** Bumping the version re-runs every view's loader. */
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    api.config().then(setConfig).catch((e) => notify(e.message, true));
  }, [notify]);

  useEffect(() => {
    api.stats().then((s) => {
      setStats(s);
      // First load only, and only when the URL did not ask for a view: an empty
      // board is a poor first impression when the vault is full of contacts.
      if (!landed) {
        landed = true;
        if (!window.location.hash && !s.deals.open && s.people) window.location.hash = '#/people';
      }
    }).catch(() => setStats(null));
  }, [version, route, notify]);

  const current = useMemo(() => ROUTES.find((r) => r.id === route)!, [route]);

  const shared = { onSelect: select, notify, refresh, version, config };

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand">
          <span className="brand-mark"><PigeonMark size={30} /></span>
          <span>
            <span className="brand-name">SendAPigeon</span>
            <span className="brand-tagline">Your quiet CRM</span>
          </span>
        </div>
        <div className="nav-eyebrow">Workspace</div>
        <div className="nav">
          {ROUTES.map((r) => (
            <button key={r.id} className="nav-item" aria-current={route === r.id} onClick={() => goRoute(r.id)}>
              <RouteIcon route={r.id} />
              <span className="nav-label">{r.label}</span>
              <span className="nav-count">{countFor(r.id, stats)}</span>
            </button>
          ))}
        </div>
        <div className="rail-foot">
          <span className="vault-icon" aria-hidden="true"><PigeonMark size={23} /></span>
          <span>
            <span className="vault-label">Current loft</span>
            <b>{config?.name ?? 'Vault'}</b>
            <small>{stats ? `${stats.people} people · ${stats.companies} companies` : 'Loading…'}</small>
          </span>
        </div>
      </nav>

      <main className="main">
        <header className="topbar">
          <div className="view-heading">
            <div className="view-kicker">Pigeon post</div>
            <h1 className="view-title">{current.title}</h1>
            <div className="view-sub">{current.sub(stats)}</div>
          </div>
          <Search onPick={select} />
        </header>

        <div className="content">
          {route === 'board' && <BoardView {...shared} />}
          {route === 'todos' && <TodosView {...shared} />}
          {route === 'people' && <PeopleView {...shared} />}
          {route === 'companies' && <CompaniesView {...shared} />}
          {route === 'notes' && <NotesView {...shared} />}
          {route === 'activity' && <ActivityView {...shared} />}
        </div>
      </main>

      {selection && (
        <DetailDrawer
          selection={selection}
          onClose={() => select(null)}
          onSelect={select}
          notify={notify}
          refresh={refresh}
        />
      )}

      {toast && <div className={toast.error ? 'toast error' : 'toast'} role="status" aria-live="polite">{toast.text}</div>}
    </div>
  );
}

function countFor(route: Route, stats: Stats | null): string {
  if (!stats) return '';
  switch (route) {
    case 'board': return String(stats.deals.open);
    case 'todos': return String(stats.todos.open);
    case 'people': return String(stats.people);
    case 'companies': return String(stats.companies);
    case 'notes': return String(stats.notes);
    default: return '';
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
