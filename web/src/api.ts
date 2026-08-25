/** Thin fetch wrapper over the local REST API. Every call is same-origin. */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-pigeon-actor': 'web', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body means we did not reach the API route -- usually a server
    // running older code than the page, which 404s as an HTML error document.
    throw new Error(
      res.ok || res.status === 404
        ? `The server has no ${path} endpoint. Restart it so it picks up the current build.`
        : `Request failed (${res.status}).`,
    );
  }
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const qs = (params: Record<string, unknown> = {}): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
};

export const api = {
  vaults: () => request<VaultSummary[]>('/vaults'),
  createVault: (input: { name: string; path: string; currency?: string }) =>
    request<VaultSummary>('/vaults', { method: 'POST', body: JSON.stringify(input) }),
  openVault: (path: string) =>
    request<VaultSummary>('/vaults/open', { method: 'POST', body: JSON.stringify({ path }) }),
  switchVault: (path: string) =>
    request<VaultSummary>('/vaults/switch', { method: 'POST', body: JSON.stringify({ path }) }),
  forgetVault: (path: string) =>
    request<{ path: string; forgotten: boolean; deleted: false }>('/vaults', { method: 'DELETE', body: JSON.stringify({ path }) }),
  config: () => request<Config>('/config'),
  revision: () => request<{ vault: string; revision: string }>('/revision'),
  stats: () => request<Stats>('/stats'),
  board: (params?: Record<string, unknown>) => request<Board>(`/board${qs(params)}`),
  peopleBoard: (board?: string) => request<PersonBoard>(`/people-board${qs({ board })}`),
  createPeopleBoard: (input: { name: string; stages: Pick<Stage, 'name'>[] }) =>
    request<PeopleBoardTemplate>('/people-boards', { method: 'POST', body: JSON.stringify(input) }),
  updatePeopleBoard: (id: string, patch: { name?: string; stages?: Stage[] }) =>
    request<PeopleBoardTemplate>(`/people-boards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deletePeopleBoard: (id: string) =>
    request<PeopleBoardTemplate>(`/people-boards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  search: (q: string) => request<Hit[]>(`/search${qs({ q })}`),
  activity: (limit = 40) => request<ActivityEvent[]>(`/activity${qs({ limit })}`),

  companies: (params?: Record<string, unknown>) => request<Company[]>(`/companies${qs(params)}`),
  company: (id: string) => request<CompanyDetail>(`/companies/${encodeURIComponent(id)}`),

  people: (params?: Record<string, unknown>) => request<Person[]>(`/people${qs(params)}`),
  person: (id: string) => request<PersonDetail>(`/people/${encodeURIComponent(id)}`),
  createPerson: (input: { name: string; company?: string; companyId?: string; linkedin?: string; boardId?: string }) =>
    request<Person>('/people', { method: 'POST', body: JSON.stringify(input) }),
  updatePerson: (id: string, patch: Partial<Person> & { company?: string }) =>
    request<Person>(`/people/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  movePersonBoard: (id: string, boardId: string) =>
    request<{ person: Person; todo: Todo | null }>(`/people/${encodeURIComponent(id)}/board`, { method: 'POST', body: JSON.stringify({ boardId }) }),
  advancePersonStage: (id: string) =>
    request<{ person: Person; completed: Todo; next: Todo | null }>(`/people/${encodeURIComponent(id)}/stage/advance`, { method: 'POST', body: '{}' }),
  movePersonStage: (id: string, stage: string) =>
    request<{ person: Person; todo: Todo | null }>(`/people/${encodeURIComponent(id)}/stage/move`, { method: 'POST', body: JSON.stringify({ stage }) }),
  ensurePersonStage: (id: string) =>
    request<Todo | null>(`/people/${encodeURIComponent(id)}/stage/ensure`, { method: 'POST', body: '{}' }),

  deals: (params?: Record<string, unknown>) => request<Deal[]>(`/deals${qs(params)}`),
  deal: (id: string) => request<DealDetail>(`/deals/${encodeURIComponent(id)}`),
  moveDeal: (id: string, stage: string, position?: number) =>
    request<Deal>(`/deals/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ stage, position }) }),
  winDeal: (id: string) => request<Deal>(`/deals/${encodeURIComponent(id)}/win`, { method: 'POST', body: '{}' }),
  loseDeal: (id: string, reason?: string) =>
    request<Deal>(`/deals/${encodeURIComponent(id)}/lose`, { method: 'POST', body: JSON.stringify({ reason }) }),

  todos: (params?: Record<string, unknown>) => request<Todo[]>(`/todos${qs(params)}`),
  createTodo: (input: { title: string; dueDate?: string; priority?: Todo['priority']; personId?: string; companyId?: string; dealId?: string }) =>
    request<Todo>('/todos', { method: 'POST', body: JSON.stringify(input) }),
  toggleTodo: (id: string, done: boolean) =>
    request<Todo>(`/todos/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: JSON.stringify({ done }) }),

  notes: (params?: Record<string, unknown>) => request<Note[]>(`/notes${qs(params)}`),
  note: (id: string) => request<Note>(`/notes/${encodeURIComponent(id)}`),
  createNote: (input: { title: string; body?: string; type?: string; companyId?: string; dealId?: string; attendees?: string[] }) =>
    request<Note>('/notes', { method: 'POST', body: JSON.stringify(input) }),
};

// ------------------------------------------------------------------- types

export interface Stage { id: string; name: string; probability?: number }
export interface VaultSummary { path: string; name: string; current: boolean; exists: boolean; people: number; companies: number }
export interface PeopleBoardTemplate { id: string; name: string; stages: Stage[] }
export interface Config { name: string; currency: string; stages: Stage[]; peopleBoards: PeopleBoardTemplate[] }

export interface Company {
  id: string; name: string; domain?: string; website?: string; industry?: string;
  size?: string; location?: string; phone?: string; owner?: string; description?: string;
  tags?: string[]; createdAt: string; updatedAt: string;
}

export interface Person {
  id: string; name: string; companyId?: string; title?: string; email?: string; phone?: string;
  linkedin?: string; boardId?: string; stage?: string; stageCompletedAt?: string; location?: string; owner?: string; description?: string;
  tags?: string[]; createdAt: string; updatedAt: string;
}

export interface Deal {
  id: string; title: string; companyId?: string; personIds?: string[]; stage: string;
  status: 'open' | 'won' | 'lost'; value?: number; currency?: string; probability?: number;
  expectedCloseDate?: string; closedAt?: string; lostReason?: string; source?: string;
  owner?: string; description?: string; tags?: string[]; order?: number;
  createdAt: string; updatedAt: string;
}

export interface Todo {
  id: string; title: string; done: boolean; dueDate?: string; priority?: 'low' | 'normal' | 'high';
  companyId?: string; personId?: string; dealId?: string; stageId?: string; boardId?: string; owner?: string; notes?: string;
  tags?: string[]; completedAt?: string; createdAt: string; updatedAt: string;
}

export interface Note {
  id: string; title: string; date: string; type?: string; companyId?: string; dealId?: string;
  attendees?: string[]; tags?: string[]; path: string; body?: string; createdAt: string; updatedAt: string;
}

export interface ExpandedDeal extends Deal {
  company?: { id: string; name: string } | null;
  contacts?: { id: string; name: string; email?: string; title?: string }[];
  openTodos?: number;
  overdueTodos?: number;
  nextTodo?: { id: string; title: string; dueDate?: string } | null;
}

export interface BoardColumn { id: string; name: string; probability?: number; deals: ExpandedDeal[]; count: number; value: number }

export interface Board {
  currency: string;
  columns: BoardColumn[];
  won: ExpandedDeal[];
  lost: ExpandedDeal[];
  totals: { open: number; openValue: number; weightedValue: number; won: number; wonValue: number; lost: number };
}

export interface PersonBoardCard extends Person {
  company?: { id: string; name: string } | null;
  stageTodo?: Pick<Todo, 'id' | 'title' | 'done' | 'dueDate'> | null;
}
export interface PersonBoardColumn { id: string; name: string; people: PersonBoardCard[]; count: number }
export interface PersonBoard { id: string; name: string; columns: PersonBoardColumn[]; total: number }

export interface Stats {
  companies: number; people: number; notes: number; currency: string;
  deals: Board['totals'];
  todos: { open: number; overdue: number; dueToday: number; done: number };
}

export interface Hit { kind: string; id: string; title: string; subtitle?: string; snippet?: string }

export interface ActivityEvent { ts: string; action: string; kind: string; id: string; actor?: string; summary?: string }

export interface CompanyDetail extends Company { people: Person[]; deals: Deal[]; todos: Todo[]; notes: Note[] }
export interface PersonDetail extends Person { company: { id: string; name: string } | null; deals: Deal[]; todos: Todo[]; notes: Note[] }
export interface DealDetail extends ExpandedDeal { todos: Todo[]; notes: Note[] }
