import { useEffect, type ReactNode } from 'react';

export function Drawer({
  kicker,
  title,
  badge,
  onClose,
  children,
}: {
  kicker: string;
  title: string;
  badge?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          {badge}
          <div>
            <div className="drawer-kicker">{kicker}</div>
            <h2 className="drawer-title">{title}</h2>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(
    ([, v]) => v !== undefined && v !== null && v !== '' && v !== '—' && !(Array.isArray(v) && v.length === 0),
  );
  if (!shown.length) return null;
  return (
    <dl className="facts">
      {shown.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {aside ? <span>{aside}</span> : null}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
