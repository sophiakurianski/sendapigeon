import { useEffect, useState } from 'react';
import {
  api,
  type Company,
  type CompanyDetail,
  type DealDetail,
  type Note,
  type PeopleBoardTemplate,
  type PersonDetail,
  type Todo,
} from '../api';
import { Drawer, Facts, SectionTitle } from '../components/Drawer';
import { Monogram, Postmark, daysSince } from '../components/Pigeon';
import { dueClass, markdown, money, relativeDay, today } from '../lib';

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
  const selectionKey = `${selection.kind}:${selection.id}`;
  const [loaded, setLoaded] = useState<{ key: string; value: unknown } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
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
    load.then((value) => {
      if (!cancelled) setLoaded({ key: selectionKey, value });
    }).catch((e) => {
      if (cancelled) return;
      notify(e.message, true);
      onClose();
    });
    return () => { cancelled = true; };
  }, [selection.kind, selection.id, selectionKey, tick, notify, onClose]);

  const reload = () => {
    setTick((t) => t + 1);
    refresh();
  };

  const record = loaded?.key === selectionKey ? loaded.value : null;

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
    return <PersonPanel person={record as PersonDetail} onClose={onClose} onSelect={onSelect} notify={notify} reload={reload} />;
  }
  if (selection.kind === 'company') {
    return <CompanyPanel company={record as CompanyDetail} onClose={onClose} onSelect={onSelect} notify={notify} reload={reload} />;
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
  notify,
  reload,
}: {
  person: PersonDetail;
  onClose: () => void;
  onSelect: (s: Selection) => void;
  notify: (text: string, error?: boolean) => void;
  reload: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Drawer
      kicker="Contact"
      title={person.name}
      badge={<Monogram name={person.name} id={person.id} size="lg" />}
      actions={(
        <button className="drawer-edit" onClick={() => setEditing((current) => !current)} aria-pressed={editing}>
          {editing ? 'Cancel edit' : 'Edit'}
        </button>
      )}
      onClose={onClose}
    >
      {editing ? (
        <PersonEditForm
          person={person}
          notify={notify}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); }}
        />
      ) : (
        <>
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
        </>
      )}

      <PersonStageProgress person={person} notify={notify} reload={reload} />
      <ContactTodoComposer person={person} notify={notify} reload={reload} />

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

      <TodoList todos={person.todos} notify={notify} reload={reload} />
      <NoteList
        notes={person.notes}
        onSelect={onSelect}
        composer={<NoteComposer association={{ attendees: [person.id], companyId: person.company?.id }} subject={person.name} notify={notify} reload={reload} />}
      />
    </Drawer>
  );
}

function PersonEditForm({ person, notify, onCancel, onSaved }: {
  person: PersonDetail;
  notify: (text: string, error?: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [company, setCompany] = useState(person.company?.name ?? '');
  const [title, setTitle] = useState(person.title ?? '');
  const [email, setEmail] = useState(person.email ?? '');
  const [phone, setPhone] = useState(person.phone ?? '');
  const [linkedin, setLinkedin] = useState(person.linkedin ?? '');
  const [location, setLocation] = useState(person.location ?? '');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFocused, setCompanyFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.companies().then(setCompanies).catch(() => setCompanies([]));
  }, []);

  const companyNeedle = company.trim().toLowerCase();
  const exactCompany = companies.find((item) => item.name.toLowerCase() === companyNeedle);
  const suggestions = companyNeedle
    ? companies.filter((item) => item.name.toLowerCase().includes(companyNeedle)).slice(0, 6)
    : companies.slice(0, 6);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) {
      if (!name.trim()) setError('Name is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await api.updatePerson(person.id, {
        name: name.trim(),
        company: exactCompany?.name ?? company.trim(),
        title: title.trim(),
        email: email.trim(),
        phone: phone.trim(),
        linkedin: linkedin.trim(),
        location: location.trim(),
      });
      notify(`${updated.name} updated`);
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="person-edit-form" onSubmit={(event) => void save(event)}>
      <div className="person-edit-intro">
        <div className="drawer-kicker">Edit contact</div>
        <p>Update the person here. Choosing an existing company keeps the records linked; a new name creates a company.</p>
      </div>
      <label>
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
      </label>
      <label>
        <span>Role</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Industrial Designer" />
      </label>
      <label className="person-edit-company">
        <span>Company</span>
        <input
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          onFocus={() => setCompanyFocused(true)}
          onBlur={() => window.setTimeout(() => setCompanyFocused(false), 120)}
          placeholder="Search or create a company"
          role="combobox"
          aria-expanded={companyFocused && suggestions.length > 0}
          aria-autocomplete="list"
        />
        {companyFocused && suggestions.length > 0 && (
          <span className="company-suggestions" role="listbox">
            {suggestions.map((item) => (
              <button type="button" key={item.id} role="option" onMouseDown={() => setCompany(item.name)}>
                <span>{item.name}</span>
                <small>{[item.industry, item.location].filter(Boolean).join(' · ') || 'Existing company'}</small>
              </button>
            ))}
          </span>
        )}
        {company.trim() && (
          <small className={exactCompany ? 'company-match existing' : 'company-match new'}>
            {exactCompany ? `Linked to ${exactCompany.name}` : `Creates a new company named “${company.trim()}”`}
          </small>
        )}
      </label>
      <label>
        <span>Email</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
      </label>
      <label>
        <span>Phone</span>
        <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+61 400 000 000" />
      </label>
      <label className="person-edit-wide">
        <span>LinkedIn</span>
        <input type="url" value={linkedin} onChange={(event) => setLinkedin(event.target.value)} placeholder="https://linkedin.com/in/name" />
      </label>
      <label className="person-edit-wide">
        <span>Location</span>
        <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Sydney, Australia" />
      </label>
      {error && <div className="form-error person-edit-wide" role="alert">{error}</div>}
      <div className="person-edit-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------- company

function CompanyPanel({
  company,
  onClose,
  onSelect,
  notify,
  reload,
}: {
  company: CompanyDetail;
  onClose: () => void;
  onSelect: (s: Selection) => void;
  notify: (text: string, error?: boolean) => void;
  reload: () => void;
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

      <TodoList todos={company.todos} notify={notify} reload={reload} />
      <NoteList
        notes={company.notes}
        onSelect={onSelect}
        composer={<NoteComposer association={{ companyId: company.id }} subject={company.name} notify={notify} reload={reload} />}
      />
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

function PersonStageProgress({ person, notify, reload }: {
  person: PersonDetail;
  notify: (text: string, error?: boolean) => void;
  reload: () => void;
}) {
  const [boards, setBoards] = useState<PeopleBoardTemplate[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.config().then((config) => setBoards(config.peopleBoards)).catch(() => setBoards([]));
  }, []);

  if (!boards.length) return null;
  const board = boards.find((item) => item.id === person.boardId) ?? boards[0];
  const stages = board.stages;
  const currentId = person.stage ?? stages[0].id;
  const currentIndex = Math.max(0, stages.findIndex((stage) => stage.id === currentId));

  const complete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.advancePersonStage(person.id);
      const current = stages[currentIndex].name;
      notify(result.next ? `${current} completed · ${result.next.title} added to To do` : `${current} completed and noted`);
      reload();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const changeBoard = async (boardId: string) => {
    if (busy || boardId === board.id) return;
    setBusy(true);
    try {
      const result = await api.movePersonBoard(person.id, boardId);
      const destination = boards.find((item) => item.id === boardId);
      notify(`${person.name} moved to ${destination?.name ?? boardId} · ${result.todo.title} added to To do`);
      reload();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle aside={`${currentIndex + 1} of ${stages.length}`}>Board stages</SectionTitle>
      <label className="person-board-picker">
        <span>Workflow</span>
        <select value={board.id} onChange={(event) => void changeBoard(event.target.value)} disabled={busy}>
          {boards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="stage-progress">
        {stages.map((stage, index) => {
          const done = index < currentIndex || (index === currentIndex && Boolean(person.stageCompletedAt));
          const active = index === currentIndex && !done;
          return (
            <button
              key={stage.id}
              className={done ? 'stage-step done' : active ? 'stage-step active' : 'stage-step'}
              disabled={!active || busy}
              onClick={() => void complete()}
              aria-label={active ? `Complete ${stage.name}` : stage.name}
            >
              <span className="stage-step-check" aria-hidden="true">{done ? '✓' : active ? '' : index + 1}</span>
              <span>{stage.name}</span>
              {active && <small>{busy ? 'Noting…' : 'Tick to complete'}</small>}
            </button>
          );
        })}
      </div>
    </>
  );
}

function TodoList({ todos, notify, reload }: { todos: Todo[]; notify: (t: string, e?: boolean) => void; reload: () => void }) {
  const [visibleTodos, setVisibleTodos] = useState(todos);
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  useEffect(() => setVisibleTodos(todos), [todos]);

  const toggle = async (todo: Todo) => {
    if (pending.has(todo.id)) return;
    const done = !todo.done;
    setVisibleTodos((current) => current.map((item) => item.id === todo.id ? { ...item, done } : item));
    setPending((current) => new Set(current).add(todo.id));
    try {
      await api.toggleTodo(todo.id, done);
      reload();
    } catch (err) {
      setVisibleTodos((current) => current.map((item) => item.id === todo.id ? { ...item, done: todo.done } : item));
      notify((err as Error).message, true);
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(todo.id);
        return next;
      });
    }
  };

  return (
    <>
      <SectionTitle aside={`${visibleTodos.filter((todo) => !todo.done).length} open`}>To do</SectionTitle>
      <div className="stack">
        {visibleTodos.map((todo) => (
          <div className="line" key={todo.id}>
            <button
              className="check"
              role="checkbox"
              aria-checked={todo.done}
              aria-busy={pending.has(todo.id)}
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
        {!visibleTodos.length && <div className="column-empty">Nothing to do here.</div>}
      </div>
    </>
  );
}

function NoteList({ notes, onSelect, composer }: { notes: Note[]; onSelect: (s: Selection) => void; composer?: React.ReactNode }) {
  return (
    <>
      <SectionTitle aside={String(notes.length)}>Notes</SectionTitle>
      {composer}
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

function ContactTodoComposer({ person, notify, reload }: { person: PersonDetail; notify: (text: string, error?: boolean) => void; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const create = async (todoTitle: string, date?: string) => {
    if (!todoTitle.trim() || busy) return;
    setBusy(true);
    try {
      await api.createTodo({ title: todoTitle.trim(), personId: person.id, companyId: person.company?.id, dueDate: date });
      notify('Follow-up added');
      setTitle('');
      setOpen(false);
      reload();
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Quick follow-up</SectionTitle>
      <div className="quick-actions">
        <button className="quick-action" disabled={busy} onClick={() => void create(`Call ${person.name}`, today())}>
          <span aria-hidden="true">☎</span> Call today
        </button>
        <button className="quick-action" disabled={busy} onClick={() => void create(`Add ${person.name} on LinkedIn`)}>
          <span aria-hidden="true">in</span> Add on LinkedIn
        </button>
        <button className="quick-action" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <span aria-hidden="true">＋</span> Custom
        </button>
      </div>
      {open && (
        <form className="composer compact" onSubmit={(event) => { event.preventDefault(); void create(title, dueDate || undefined); }}>
          <label className="composer-wide">
            <span>What needs doing?</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Follow up with ${person.name}`} autoFocus required />
          </label>
          <label>
            <span>Due</span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <div className="composer-actions">
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn" disabled={busy}>{busy ? 'Adding\u2026' : 'Add follow-up'}</button>
          </div>
        </form>
      )}
    </>
  );
}

function NoteComposer({
  association,
  subject,
  notify,
  reload,
}: {
  association: { companyId?: string; attendees?: string[] };
  subject: string;
  notify: (text: string, error?: boolean) => void;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await api.createNote({
        title: title.trim(),
        body: body.trim(),
        type: association.attendees?.length ? 'contact' : 'company',
        ...association,
      });
      notify('Note added');
      setTitle('');
      setBody('');
      setOpen(false);
      reload();
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <button className="add-note" onClick={() => setOpen(true)}>＋ Add a note about {subject}</button>;
  }

  return (
    <form className="composer note-composer" onSubmit={(event) => void submit(event)}>
      <label>
        <span>Note title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Conversation with ${subject}`} autoFocus required />
      </label>
      <label>
        <span>Details</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="What happened, and what should happen next?" rows={5} />
      </label>
      <div className="composer-actions">
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn" disabled={busy}>{busy ? 'Saving\u2026' : 'Save note'}</button>
      </div>
    </form>
  );
}
