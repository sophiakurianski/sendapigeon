import { parseDate, today } from './ids.js';
import type { Vault } from './store.js';
import type { Company, Deal, Note, Person, Todo } from './types.js';

/** Shared list filters. Every field is optional; unset means "no constraint". */
export interface ListFilter {
  q?: string;
  tag?: string | string[];
  company?: string;
  person?: string;
  deal?: string;
  owner?: string;
  stage?: string;
  status?: string;
  done?: boolean;
  overdue?: boolean;
  dueBefore?: string;
  archived?: boolean;
  limit?: number;
  offset?: number;
  sort?: string;
}

function textOf(record: Record<string, unknown>): string {
  return Object.values(record)
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .join(' ')
    .toLowerCase();
}

function matchesTags(record: { tags?: string[] }, tag?: string | string[]): boolean {
  if (!tag) return true;
  const wanted = (Array.isArray(tag) ? tag : String(tag).split(',')).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return true;
  const have = new Set((record.tags ?? []).map((t) => t.toLowerCase()));
  return wanted.every((t) => have.has(t));
}

function sortRecords<T extends Record<string, unknown>>(records: T[], sort?: string): T[] {
  if (!sort) return records;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...records].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return desc ? -cmp : cmp;
  });
}

function paginate<T>(records: T[], filter: ListFilter): T[] {
  const start = filter.offset ?? 0;
  return filter.limit ? records.slice(start, start + filter.limit) : records.slice(start);
}

export function listCompanies(vault: Vault, filter: ListFilter = {}): Company[] {
  let list = vault.companies();
  if (!filter.archived) list = list.filter((c) => !c.archived);
  if (filter.owner) list = list.filter((c) => c.owner === filter.owner);
  if (filter.tag) list = list.filter((c) => matchesTags(c, filter.tag));
  if (filter.q) list = list.filter((c) => textOf(c).includes(filter.q!.toLowerCase()));
  return paginate(sortRecords(list, filter.sort ?? 'name'), filter);
}

export function listPeople(vault: Vault, filter: ListFilter = {}): Person[] {
  let list = vault.people();
  if (!filter.archived) list = list.filter((p) => !p.archived);
  if (filter.company) {
    const companyId = vault.company(filter.company)?.id ?? filter.company;
    list = list.filter((p) => p.companyId === companyId);
  }
  if (filter.owner) list = list.filter((p) => p.owner === filter.owner);
  if (filter.tag) list = list.filter((p) => matchesTags(p, filter.tag));
  if (filter.q) list = list.filter((p) => textOf(p).includes(filter.q!.toLowerCase()));
  return paginate(sortRecords(list, filter.sort ?? 'name'), filter);
}

export function listDeals(vault: Vault, filter: ListFilter = {}): Deal[] {
  let list = vault.deals();
  const status = filter.status ?? 'open';
  if (status !== 'all') list = list.filter((d) => d.status === status);
  if (filter.stage) {
    const stage = vault.resolveStage(filter.stage);
    list = list.filter((d) => d.stage === stage);
  }
  if (filter.company) {
    const companyId = vault.company(filter.company)?.id ?? filter.company;
    list = list.filter((d) => d.companyId === companyId);
  }
  if (filter.person) {
    const personId = vault.person(filter.person)?.id ?? filter.person;
    list = list.filter((d) => d.personIds?.includes(personId));
  }
  if (filter.owner) list = list.filter((d) => d.owner === filter.owner);
  if (filter.tag) list = list.filter((d) => matchesTags(d, filter.tag));
  if (filter.q) list = list.filter((d) => textOf(d).includes(filter.q!.toLowerCase()));
  return paginate(sortRecords(list, filter.sort ?? 'order'), filter);
}

export function listTodos(vault: Vault, filter: ListFilter = {}): Todo[] {
  let list = vault.todos();
  if (filter.done !== undefined) list = list.filter((t) => t.done === filter.done);
  if (filter.company) {
    const companyId = vault.company(filter.company)?.id ?? filter.company;
    list = list.filter((t) => t.companyId === companyId);
  }
  if (filter.person) {
    const personId = vault.person(filter.person)?.id ?? filter.person;
    list = list.filter((t) => t.personId === personId);
  }
  if (filter.deal) {
    const dealId = vault.deal(filter.deal)?.id ?? filter.deal;
    list = list.filter((t) => t.dealId === dealId);
  }
  if (filter.owner) list = list.filter((t) => t.owner === filter.owner);
  if (filter.tag) list = list.filter((t) => matchesTags(t, filter.tag));
  if (filter.overdue) list = list.filter((t) => !t.done && t.dueDate && t.dueDate < today());
  if (filter.dueBefore) {
    const cutoff = parseDate(filter.dueBefore);
    if (cutoff) list = list.filter((t) => t.dueDate && t.dueDate <= cutoff);
  }
  if (filter.q) list = list.filter((t) => textOf(t).includes(filter.q!.toLowerCase()));
  const sorted = sortRecords(list, filter.sort ?? 'dueDate');
  return paginate(sorted, filter);
}

export function listNotes(vault: Vault, filter: ListFilter = {}): Note[] {
  let list = vault.notes(Boolean(filter.q));
  if (filter.company) {
    const companyId = vault.company(filter.company)?.id ?? filter.company;
    list = list.filter((n) => n.companyId === companyId);
  }
  if (filter.deal) {
    const dealId = vault.deal(filter.deal)?.id ?? filter.deal;
    list = list.filter((n) => n.dealId === dealId);
  }
  if (filter.person) {
    const personId = vault.person(filter.person)?.id ?? filter.person;
    list = list.filter((n) => n.attendees?.includes(personId));
  }
  if (filter.tag) list = list.filter((n) => matchesTags(n, filter.tag));
  if (filter.q) {
    const q = filter.q.toLowerCase();
    list = list.filter((n) => `${n.title} ${n.body ?? ''} ${(n.tags ?? []).join(' ')}`.toLowerCase().includes(q));
    list = list.map(({ body, ...rest }) => rest as Note);
  }
  return paginate(list, filter);
}

// -------------------------------------------------------------------- board

export interface BoardColumn {
  id: string;
  name: string;
  probability?: number;
  deals: ExpandedDeal[];
  count: number;
  value: number;
}

export interface Board {
  currency: string;
  columns: BoardColumn[];
  won: ExpandedDeal[];
  lost: ExpandedDeal[];
  totals: { open: number; openValue: number; weightedValue: number; won: number; wonValue: number; lost: number };
}

export interface ExpandedDeal extends Deal {
  company?: Pick<Company, 'id' | 'name'> | null;
  contacts?: Pick<Person, 'id' | 'name' | 'email' | 'title'>[];
  openTodos?: number;
  overdueTodos?: number;
  nextTodo?: Pick<Todo, 'id' | 'title' | 'dueDate'> | null;
}

export interface PersonBoardCard extends Person {
  company?: Pick<Company, 'id' | 'name'> | null;
  stageTodo?: Pick<Todo, 'id' | 'title' | 'done' | 'dueDate'> | null;
}

export interface PersonBoardColumn {
  id: string;
  name: string;
  people: PersonBoardCard[];
  count: number;
}

export interface PersonBoard { id: string; name: string; columns: PersonBoardColumn[]; total: number }

/** One named contact workflow and the people assigned to it. */
export function personBoard(vault: Vault, boardId?: string): PersonBoard {
  const template = vault.requirePeopleBoard(boardId);
  const people = vault.people().filter((person) => !person.archived && vault.personBoardId(person) === template.id);
  const todos = vault.todos();
  const firstStage = template.stages[0]?.id;
  const defaultId = vault.peopleBoards[0]?.id;
  const columns = template.stages.map((stage) => {
    const members = people
      .filter((person) => (person.stage ?? firstStage) === stage.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((person): PersonBoardCard => {
        const company = person.companyId ? vault.company(person.companyId) : undefined;
        const stageTodo = todos.find((todo) => todo.personId === person.id
          && todo.stageId === stage.id
          && (todo.boardId === template.id || (!todo.boardId && template.id === defaultId)));
        return {
          ...person,
          company: company ? { id: company.id, name: company.name } : null,
          stageTodo: stageTodo
            ? { id: stageTodo.id, title: stageTodo.title, done: stageTodo.done, dueDate: stageTodo.dueDate }
            : null,
        };
      });
    return { id: stage.id, name: stage.name, people: members, count: members.length };
  });
  return { id: template.id, name: template.name, columns, total: people.length };
}

export function expandDeal(vault: Vault, deal: Deal): ExpandedDeal {
  const company = deal.companyId ? vault.company(deal.companyId) : undefined;
  const contacts = (deal.personIds ?? [])
    .map((id) => vault.person(id))
    .filter((p): p is Person => Boolean(p))
    .map((p) => ({ id: p.id, name: p.name, email: p.email, title: p.title }));
  const todos = vault.todos().filter((t) => t.dealId === deal.id && !t.done);
  const dated = todos.filter((t) => t.dueDate).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const next = dated[0] ?? todos[0];
  return {
    ...deal,
    company: company ? { id: company.id, name: company.name } : null,
    contacts,
    openTodos: todos.length,
    overdueTodos: todos.filter((t) => t.dueDate && t.dueDate < today()).length,
    nextTodo: next ? { id: next.id, title: next.title, dueDate: next.dueDate } : null,
  };
}

export function board(vault: Vault, filter: ListFilter = {}): Board {
  const all = listDeals(vault, { ...filter, status: 'all', limit: undefined, offset: undefined });
  const open = all.filter((d) => d.status === 'open');
  const columns: BoardColumn[] = vault.config.stages.map((stage) => {
    const deals = open
      .filter((d) => d.stage === stage.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((d) => expandDeal(vault, d));
    return {
      id: stage.id,
      name: stage.name,
      probability: stage.probability,
      deals,
      count: deals.length,
      value: deals.reduce((sum, d) => sum + (d.value ?? 0), 0),
    };
  });
  const won = all.filter((d) => d.status === 'won').map((d) => expandDeal(vault, d));
  const lost = all.filter((d) => d.status === 'lost').map((d) => expandDeal(vault, d));
  return {
    currency: vault.config.currency,
    columns,
    won,
    lost,
    totals: {
      open: open.length,
      openValue: open.reduce((s, d) => s + (d.value ?? 0), 0),
      weightedValue: Math.round(open.reduce((s, d) => s + (d.value ?? 0) * ((d.probability ?? 0) / 100), 0)),
      won: won.length,
      wonValue: won.reduce((s, d) => s + (d.value ?? 0), 0),
      lost: lost.length,
    },
  };
}

// ------------------------------------------------------------------ expands

export function expandCompany(vault: Vault, company: Company) {
  return {
    ...company,
    people: vault.people().filter((p) => p.companyId === company.id),
    deals: vault.deals().filter((d) => d.companyId === company.id),
    todos: vault.todos().filter((t) => t.companyId === company.id && !t.done),
    notes: vault.notes().filter((n) => n.companyId === company.id),
  };
}

export function expandPerson(vault: Vault, person: Person) {
  const company = person.companyId ? vault.company(person.companyId) : undefined;
  return {
    ...person,
    company: company ? { id: company.id, name: company.name } : null,
    deals: vault.deals().filter((d) => d.personIds?.includes(person.id)),
    todos: vault.todos().filter((t) => t.personId === person.id && !t.done),
    notes: vault.notes().filter((n) => n.attendees?.includes(person.id)),
  };
}

export function expandDealFull(vault: Vault, deal: Deal) {
  return {
    ...expandDeal(vault, deal),
    todos: vault.todos().filter((t) => t.dealId === deal.id),
    notes: vault.notes().filter((n) => n.dealId === deal.id),
  };
}

// ------------------------------------------------------------------- search

export interface SearchHit {
  kind: 'company' | 'person' | 'deal' | 'todo' | 'note';
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
}

export function search(vault: Vault, query: string, limit = 30): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const c of vault.companies()) {
    if (textOf(c).includes(q)) hits.push({ kind: 'company', id: c.id, title: c.name, subtitle: c.domain ?? c.industry });
  }
  for (const p of vault.people()) {
    if (textOf(p).includes(q)) {
      const company = p.companyId ? vault.company(p.companyId)?.name : undefined;
      hits.push({ kind: 'person', id: p.id, title: p.name, subtitle: [p.title, company].filter(Boolean).join(' · ') });
    }
  }
  for (const d of vault.deals()) {
    if (textOf(d).includes(q)) {
      hits.push({ kind: 'deal', id: d.id, title: d.title, subtitle: `${vault.stage(d.stage)?.name ?? d.stage} · ${d.status}` });
    }
  }
  for (const t of vault.todos()) {
    if (textOf(t).includes(q)) hits.push({ kind: 'todo', id: t.id, title: t.title, subtitle: t.dueDate ? `due ${t.dueDate}` : undefined });
  }
  for (const n of vault.searchNotes(q)) {
    const body = n.body ?? '';
    const at = body.toLowerCase().indexOf(q);
    hits.push({
      kind: 'note',
      id: n.id,
      title: n.title,
      subtitle: n.date,
      snippet: at >= 0 ? body.slice(Math.max(0, at - 60), at + 90).replace(/\s+/g, ' ').trim() : undefined,
    });
  }
  return hits.slice(0, limit);
}

// -------------------------------------------------------------------- stats

export function stats(vault: Vault) {
  const b = board(vault);
  const todos = vault.todos();
  return {
    companies: vault.companies().length,
    people: vault.people().length,
    notes: vault.notes().length,
    deals: b.totals,
    todos: {
      open: todos.filter((t) => !t.done).length,
      overdue: todos.filter((t) => !t.done && t.dueDate && t.dueDate < today()).length,
      dueToday: todos.filter((t) => !t.done && t.dueDate === today()).length,
      done: todos.filter((t) => t.done).length,
    },
    currency: vault.config.currency,
  };
}
