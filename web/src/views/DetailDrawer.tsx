import { useEffect, useState } from 'react';
import {
  api,
  type CompanyDetail,
  type DealDetail,
  type Note,
  type PersonDetail,
  type Todo,
} from '../api';
import { Drawer, Facts, SectionTitle } from '../components/Drawer';
import { Monogram, Postmark, daysSince } from '../components/Pigeon';
import { dueClass, markdown, money, relativeDay } from '../lib';

export interface Selection {
  kind: 'deal' | 'person' | 'company' | 'note' | 'todo';
  id: string;
}

interface Props {
  selection: Selection;
  onClose: () => void;
  onSelect: (selection: Selection) => void;
  notify: (text: string, error?: boolean) => void;
  refresh: () => void;
}

export function DetailDrawer({ selection, onClose, onSelect, notify, refresh }: Props) {
  const [record, setRecord] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRecord(null);
    const load =
      selection.kind === 'deal' ? api.deal(selection.id)
      : selection.kind === 'person' ? api.person(selection.id)
      : selection.kind === 'company' ? api.company(selection.id)
      : selection.kind === 'note' ? api.note(selection.id)
      : null;
    if (!load) {
      onClose();
      return;
    }
    load.then(setRecord).catch((e) => {
      notify(e.message, true);
      onClose();
    });
  }, [selection.kind, selection.id, tick, notify, onClose]);

  const reload = () => {
    setTick((t) => t + 1);
    refresh();
  };

  if (!record) {
    return (
      <Drawer kicker={selection.kind} title="Loading" onClose={onClose}>
        <div />
      </Drawer>
    );
  }

  if (selection.kind === 'deal') {
    return <DealPanel deal={record as DealDetail} onClose={onClose} onSelect={onSelect} notify={notify} reload={reload} />;
  }
  if (selection.kind === 'person') {
    return <PersonPanel person={record as PersonDetail} onClose={onClose} onSelect={onSelect} />;
  }
  if (selection.kind === 'company') {
    return <CompanyPanel company={record as CompanyDetail} onClose={onClose} onSelect={onSelect} />;
  }
  return <NotePanel note={record as Note} onClose={onClose} onSelect={onSelect} />;
}

// -------------------------------------------------------------------- deal

function DealPanel({
  deal,
  onClose,
  onSelect,
  notify,
  reload,
}: {
  deal: DealDetail;
  onClose: () => void;
  onSelect: (s: Selection) => void;
  notify: (text: string, error?: boolean) => void;
  reload: () => void;
}) {
  const [stages, setStages] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api.config().then((c) => setStages(c.stages)).catch(() => setStages([]));
  }, []);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
    } catch (err) {
      notify((err as Error).message, true);
    }
  };

  return (
    <Drawer kicker="Deal" title={deal.title} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <Facts
            rows={[
              ['Company', deal.company ? <a onClick={() => onSelect({ kind: 'company', id: deal.company!.id })} href="#/companies">{deal.company.name}</a> : null],
              ['Stage', stages.find((s) => s.id === deal.stage)?.name ?? deal.stage],
              ['Status', <span className={`chip ${deal.status}`}>{deal.status}</span>],
              ['Value', money(deal.value, deal.currency)],
              ['Probability', deal.probability !== undefined ? `${deal.probability}%` : null],
              ['Closes', deal.expectedCloseDate ? `${deal.expectedCloseDate} (${relativeDay(deal.expectedCloseDate)})` : null],
              ['Source', deal.source],
              ['Owner', deal.owner],
              ['Lost because', deal.lostReason],
              ['Tags', (deal.tags ?? []).map((t) => <span className="tag" key={t}>{t}</span>)],
            ]}
          />
        </div>
        <div style={{ position: 'relative', width: 62, height: 62, flex: '0 0 auto' }}>
          <Postmark since={deal.updatedAt} days={daysSince(deal.updatedAt)} size={62} />
        </div>
      </div>

      {deal.description && <p style={{ marginTop: 0 }}>{deal.description}</p>}

      {deal.status === 'open' && (
        <>
          <SectionTitle>Move to</SectionTitle>
          <div className="actions">
            {stages
              .filter((s) => s.id !== deal.stage)
              .map((s) => (
                <button key={s.id} className="btn ghost" onClick={() => act(() => api.moveDeal(deal.id, s.id), `Moved to ${s.name}`)}>
                  {s.name}
                </button>
              ))}
          </div>
          <div className="actions">
            <button className="btn" onClick={() => act(() => api.winDeal(deal.id), 'Marked won')}>
              Mark won
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const reason = window.prompt('Why was it lost?') ?? undefined;
                void act(() => api.loseDeal(deal.id, reason), 'Marked lost');
              }}
            >
              Mark lost
            </button>
          </div>
        </>
      )}

      <SectionTitle aside={String(deal.contacts?.length ?? 0)}>Contacts</SectionTitle>
      <div className="stack">
        {(deal.contacts ?? []).map((p) => (
          <button className="line" key={p.id} onClick={() => onSelect({ kind: 'person', id: p.id })}>
            <span className="grow">{p.name}</span>
            <span className="sub">{p.title ?? p.email ?? ''}</span>
          </button>
        ))}
        {!deal.contacts?.length && <div className="column-empty">No contacts on this deal yet.</div>}
      </div>

      <TodoList todos={deal.todos} notify={notify} reload={reload} />
      <NoteList notes={deal.notes} onSelect={onSelect} />
    </Drawer>
  );
}

// ------------------------------------------------------------------ person

function PersonPanel({
  person,
  onClose,
  onSelect,
}: {
  person: PersonDetail;
  onClose: () => void;
  onSelect: (s: Selection) => void;
}) {
  return (
    <Drawer
      kicker="Contact"
      title={person.name}
      badge={<Monogram name={person.name} id={person.id} size="lg" />}
      onClose={onClose}
    >
      <Facts
        rows={[
          ['Company', person.company ? <a href="#/companies" onClick={() => onSelect({ kind: 'company', id: person.company!.id })}>{person.company.name}</a> : null],
          ['Role', person.title],
          ['Email', person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : null],
          ['Phone', person.phone ? <a href={`tel:${person.phone.replace(/\s/g, '')}`}>{person.phone}</a> : null],
          ['LinkedIn', person.linkedin ? <a href={person.linkedin} target="_blank" rel="noreferrer">{person.linkedin}</a> : null],
          ['Location', person.location],
          ['Owner', person.owner],
          ['Tags', (person.tags ?? []).map((t) => <span className="tag" key={t}>{t}</span>)],
        ]}
      />
      {person.description && <p>{person.description}</p>}

      <SectionTitle aside={String(person.deals.length)}>Deals</SectionTitle>
      <div className="stack">
        {person.deals.map((d) => (
          <button className="line" key={d.id} onClick={() => onSelect({ kind: 'deal', id: d.id })}>
            <span className="grow">{d.title}</span>
            <span className="sub">{money(d.value, d.currency)}</span>
            <span className={`chip ${d.status}`}>{d.status}</span>
          </button>
        ))}
        {!person.deals.length && <div className="column-empty">Not on any deal.</div>}
      </div>

      <SimpleTodos todos={person.todos} />
      <NoteList notes={person.notes} onSelect={onSelect} />
    </Drawer>
  );
}

// ----------------------------------------------------------------- company

function CompanyPanel({
  company,
  onClose,
  onSelect,
}: {
  company: CompanyDetail;
  onClose: () => void;
  onSelect: (s: Selection) => void;
}) {
  return (
    <Drawer
      kicker="Company"
      title={company.name}
      badge={<Monogram name={company.name} id={company.id} size="lg" />}
      onClose={onClose}
    >
      <Facts
        rows={[
          ['Domain', company.domain],
          ['Website', company.website ? <a href={company.website} target="_blank" rel="noreferrer">{company.website}</a> : null],
          ['Industry', company.industry],
          ['Size', company.size],
          ['Location', company.location],
          ['Phone', company.phone],
          ['Owner', company.owner],
          ['Tags', (company.tags ?? []).map((t) => <span className="tag" key={t}>{t}</span>)],
        ]}
      />
      {company.description && <p>{company.description}</p>}

      <SectionTitle aside={String(company.people.length)}>People</SectionTitle>
      <div className="stack">
        {company.people.map((p) => (
          <button className="line" key={p.id} onClick={() => onSelect({ kind: 'person', id: p.id })}>
            <span className="grow">{p.name}</span>
            <span className="sub">{p.title ?? p.email ?? ''}</span>
          </button>
        ))}
        {!company.people.length && <div className="column-empty">No contacts here yet.</div>}
      </div>

      <SectionTitle aside={String(company.deals.length)}>Deals</SectionTitle>
      <div className="stack">
        {company.deals.map((d) => (
          <button className="line" key={d.id} onClick={() => onSelect({ kind: 'deal', id: d.id })}>
            <span className="grow">{d.title}</span>
            <span className="sub">{money(d.value, d.currency)}</span>
            <span className={`chip ${d.status}`}>{d.status}</span>
          </button>
        ))}
        {!company.deals.length && <div className="column-empty">No deals with this company.</div>}
      </div>

      <SimpleTodos todos={company.todos} />
      <NoteList notes={company.notes} onSelect={onSelect} />
    </Drawer>
  );
}

// -------------------------------------------------------------------- note

function NotePanel({ note, onClose, onSelect }: { note: Note; onClose: () => void; onSelect: (s: Selection) => void }) {
  return (
    <Drawer kicker={note.type ?? 'Note'} title={note.title} onClose={onClose}>
      <Facts
        rows={[
          ['Date', note.date],
          ['Company', note.companyId ? <a href="#/companies" onClick={() => onSelect({ kind: 'company', id: note.companyId! })}>{note.companyId}</a> : null],
          ['Deal', note.dealId ? <a href="#/board" onClick={() => onSelect({ kind: 'deal', id: note.dealId! })}>{note.dealId}</a> : null],
          ['Present', (note.attendees ?? []).map((a) => (
            <button key={a} className="tag" style={{ cursor: 'pointer' }} onClick={() => onSelect({ kind: 'person', id: a })}>
              {a}
            </button>
          ))],
          ['File', <span className="mono">{note.path}</span>],
        ]}
      />
      <div className="note-body" dangerouslySetInnerHTML={{ __html: markdown(note.body ?? '') }} />
    </Drawer>
  );
}

// ------------------------------------------------------------------ shared

function TodoList({ todos, notify, reload }: { todos: Todo[]; notify: (t: string, e?: boolean) => void; reload: () => void }) {
  const toggle = async (todo: Todo) => {
    try {
      await api.toggleTodo(todo.id, !todo.done);
      reload();
    } catch (err) {
      notify((err as Error).message, true);
    }
  };

  return (
    <>
      <SectionTitle aside={`${todos.filter((t) => !t.done).length} open`}>To do</SectionTitle>
      <div className="stack">
        {todos.map((todo) => (
          <div className="line" key={todo.id}>
            <button
              className="check"
              role="checkbox"
              aria-checked={todo.done}
              aria-label={todo.done ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
              onClick={() => void toggle(todo)}
            >
              {todo.done && (
                <svg width="9" height="7" viewBox="0 0 9 7" aria-hidden="true">
                  <path d="M1 3.6 3.3 6 8 1" fill="none" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span className={todo.done ? 'grow done-text' : 'grow'}>{todo.title}</span>
            {todo.dueDate && <span className={dueClass(todo.dueDate, todo.done)}>{relativeDay(todo.dueDate)}</span>}
          </div>
        ))}
        {!todos.length && <div className="column-empty">Nothing to do here.</div>}
      </div>
    </>
  );
}

function SimpleTodos({ todos }: { todos: Todo[] }) {
  if (!todos.length) return null;
  return (
    <>
      <SectionTitle aside={String(todos.length)}>Open to do</SectionTitle>
      <div className="stack">
        {todos.map((todo) => (
          <div className="line" key={todo.id}>
            <span className="grow">{todo.title}</span>
            {todo.dueDate && <span className={dueClass(todo.dueDate, todo.done)}>{relativeDay(todo.dueDate)}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

function NoteList({ notes, onSelect }: { notes: Note[]; onSelect: (s: Selection) => void }) {
  return (
    <>
      <SectionTitle aside={String(notes.length)}>Notes</SectionTitle>
      <div className="stack">
        {notes.map((note) => (
          <button className="line" key={note.id} onClick={() => onSelect({ kind: 'note', id: note.id })}>
            <span className="due">{note.date}</span>
            <span className="grow">{note.title}</span>
          </button>
        ))}
        {!notes.length && <div className="column-empty">No notes written yet.</div>}
      </div>
    </>
  );
}
