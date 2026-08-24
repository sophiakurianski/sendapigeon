import { useEffect, useMemo, useState } from 'react';
import { api, type Company, type Deal, type Person, type Todo } from '../api';
import { Empty } from '../components/Drawer';
import { PigeonWaiting } from '../components/Pigeon';
import { dueClass, localDate, relativeDay, today } from '../lib';
import type { ViewProps } from './types';

/** Buckets people actually triage by, in the order they matter. */
const BUCKETS = ['Overdue', 'Today', 'This week', 'Later', 'No date', 'Done'] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketFor(todo: Todo): Bucket {
  if (todo.done) return 'Done';
  if (!todo.dueDate) return 'No date';
  if (todo.dueDate < today()) return 'Overdue';
  if (todo.dueDate === today()) return 'Today';
  const week = new Date();
  week.setDate(week.getDate() + 7);
  return todo.dueDate <= localDate(week) ? 'This week' : 'Later';
}

export function TodosView({ onSelect, notify, refresh, version }: ViewProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [deals, setDeals] = useState<Record<string, Deal>>({});
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [companies, setCompanies] = useState<Record<string, Company>>({});
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    Promise.all([
      api.todos(showDone ? {} : { done: false }),
      api.deals({ status: 'all' }),
      api.people(),
      api.companies(),
    ])
      .then(([ts, ds, ps, cs]) => {
        setTodos(ts);
        setDeals(Object.fromEntries(ds.map((d) => [d.id, d])));
        setPeople(Object.fromEntries(ps.map((p) => [p.id, p])));
        setCompanies(Object.fromEntries(cs.map((c) => [c.id, c])));
      })
      .catch((e) => notify(e.message, true));
  }, [version, showDone, notify]);

  const grouped = useMemo(() => {
    const map = new Map<Bucket, Todo[]>();
    for (const todo of todos) {
      const bucket = bucketFor(todo);
      map.set(bucket, [...(map.get(bucket) ?? []), todo]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    }
    return map;
  }, [todos]);

  const toggle = async (todo: Todo) => {
    try {
      await api.toggleTodo(todo.id, !todo.done);
      refresh();
    } catch (err) {
      notify((err as Error).message, true);
    }
  };

  const linkFor = (todo: Todo) => {
    if (todo.dealId) return { label: deals[todo.dealId]?.title ?? todo.dealId, sel: { kind: 'deal' as const, id: todo.dealId } };
    if (todo.personId) return { label: people[todo.personId]?.name ?? todo.personId, sel: { kind: 'person' as const, id: todo.personId } };
    if (todo.companyId) return { label: companies[todo.companyId]?.name ?? todo.companyId, sel: { kind: 'company' as const, id: todo.companyId } };
    return null;
  };

  if (!todos.length) {
    return (
      <Empty icon={<PigeonWaiting />} title={showDone ? 'Nothing here' : 'Nothing to do'}>
        Add one with <code>pigeon todo add "Send the proposal" --deal acme-renewal --due friday</code>
      </Empty>
    );
  }

  return (
    <>
      <div className="toolbar">
        <span className="spacer" />
        <button className="btn ghost" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Hide done' : 'Show done'}
        </button>
      </div>

      {BUCKETS.filter((b) => grouped.get(b)?.length).map((bucket) => (
        <section key={bucket}>
          <div className="group-label">
            <span>{bucket}</span>
            <span>{grouped.get(bucket)!.length}</span>
          </div>
          <div className="rows">
            {grouped.get(bucket)!.map((todo) => {
              const link = linkFor(todo);
              return (
                <div className="row" key={todo.id} onClick={() => link && onSelect(link.sel)}>
                  <button
                    className="check"
                    role="checkbox"
                    aria-checked={todo.done}
                    aria-label={todo.done ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggle(todo);
                    }}
                  >
                    {todo.done && (
                      <svg width="9" height="7" viewBox="0 0 9 7" aria-hidden="true">
                        <path d="M1 3.6 3.3 6 8 1" fill="none" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <span className="row-main">
                    <span className={todo.done ? 'row-title done-text' : 'row-title'}>{todo.title}</span>
                    {link && <span className="row-sub">{link.label}</span>}
                  </span>
                  {todo.dueDate && (
                    <span className={dueClass(todo.dueDate, todo.done)}>{relativeDay(todo.dueDate)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
