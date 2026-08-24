/** Thin fetch wrapper over the local REST API. Every call is same-origin. */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-pigeon-actor': 'web', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
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
  config: () => request<Config>('/config'),
  stats: () => request<Stats>('/stats'),
  board: (params?: Record<string, unknown>) => request<Board>(`/board${qs(params)}`),
  search: (q: string) => request<Hit[]>(`/search${qs({ q })}`),
  activity: (limit = 40) => request<ActivityEvent[]>(`/activity${qs({ limit })}`),

  companies: (params?: Record<string, unknown>) => request<Company[]>(`/companies${qs(params)}`),
  company: (id: string) => request<CompanyDetail>(`/companies/${encodeURIComponent(id)}`),

  people: (params?: Record<string, unknown>) => request<Person[]>(`/people${qs(params)}`),
  person: (id: string) => request<PersonDetail>(`/people/${encodeURIComponent(id)}`),

  deals: (params?: Record<string, unknown>) => request<Deal[]>(`/deals${qs(params)}`),
  deal: (id: string) => request<DealDetail>(`/deals/${encodeURIComponent(id)}`),
  moveDeal: (id: string, stage: string, position?: number) =>
    request<Deal>(`/deals/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ stage, position }) }),
  winDeal: (id: string) => request<Deal>(`/deals/${encodeURIComponent(id)}/win`, { method: 'POST', body: '{}' }),
  loseDeal: (id: string, reason?: string) =>
    request<Deal>(`/deals/${encodeURIComponent(id)}/lose`, { method: 'POST', body: JSON.stringify({ reason }) }),

  todos: (params?: Record<string, unknown>) => request<Todo[]>(`/todos${qs(params)}`),
  toggleTodo: (id: string, done: boolean) =>
    request<Todo>(`/todos/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: JSON.stringify({ done }) }),

  notes: (params?: Record<string, unknown>) => request<Note[]>(`/notes${qs(params)}`),
  note: (id: string) => request<Note>(`/notes/${encodeURIComponent(id)}`),
};

// ------------------------------------------------------------------- types

export interface Stage { id: string; name: string; probability?: number }
export interface Config { name: string; currency: string; stages: Stage[] }

export interface Company {
  id: string; name: string; domain?: string; website?: string; industry?: string;
  size?: string; location?: string; phone?: string; owner?: string; description?: string;
  tags?: string[]; createdAt: string; updatedAt: string;
}

export interface Person {
  id: string; name: string; companyId?: string; title?: string; email?: string; phone?: string;
  linkedin?: string; location?: string; owner?: string; description?: string;
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
  companyId?: string; personId?: string; dealId?: string; owner?: string; notes?: string;
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
