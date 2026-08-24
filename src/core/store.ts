import { existsSync } from 'node:fs';
import { loadConfig, saveConfig, vaultPaths } from './config.js';
import { appendJsonl, ensureDir, readJsonl, writeJsonl } from './jsonl.js';
import { nowIso, parseDate, slugify, uniqueId } from './ids.js';
import * as notes from './notes.js';
import {
  DEFAULT_CONFIG,
  type ActivityEvent,
  type Company,
  type Deal,
  type Note,
  type Person,
  type Todo,
  type VaultConfig,
} from './types.js';

export class VaultError extends Error {
  code: string;
  constructor(message: string, code = 'VAULT_ERROR') {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

export interface MutationOptions {
  /** Who made the change: "cli", "api", "mcp", "web", or an agent name. */
  actor?: string;
}

type Collection = 'companies' | 'people' | 'deals' | 'todos';

function normaliseTags(tags: unknown): string[] | undefined {
  if (tags === undefined || tags === null) return undefined;
  const list = Array.isArray(tags) ? tags : String(tags).split(',');
  const clean = list.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(clean));
}

/** Drops undefined values so patches never write `"field": undefined`. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

export class Vault {
  readonly root: string;
  readonly paths: ReturnType<typeof vaultPaths>;
  private configCache: VaultConfig | null = null;
  private cache = new Map<Collection, unknown[]>();
  defaultActor: string;

  constructor(root: string, opts: { actor?: string } = {}) {
    this.root = root;
    this.paths = vaultPaths(root);
    this.defaultActor = opts.actor || process.env.PIGEON_ACTOR || 'cli';
  }

  // ---------------------------------------------------------------- lifecycle

  exists(): boolean {
    return existsSync(this.paths.config);
  }

  assertExists(): void {
    if (!this.exists()) {
      throw new VaultError(
        `No SendAPigeon vault at ${this.root}. Run \`pigeon init\` to create one.`,
        'NO_VAULT',
      );
    }
  }

  init(opts: { name?: string; currency?: string; force?: boolean } = {}): VaultConfig {
    if (this.exists() && !opts.force) {
      throw new VaultError(`A vault already exists at ${this.root}.`, 'VAULT_EXISTS');
    }
    ensureDir(this.root);
    ensureDir(this.paths.data);
    ensureDir(this.paths.notes);
    ensureDir(this.paths.attachments);
    const config: VaultConfig = {
      ...DEFAULT_CONFIG,
      name: opts.name || DEFAULT_CONFIG.name,
      currency: opts.currency || DEFAULT_CONFIG.currency,
    };
    saveConfig(this.root, config);
    for (const file of [this.paths.companies, this.paths.people, this.paths.deals, this.paths.todos]) {
      if (!existsSync(file)) writeJsonl(file, []);
    }
    this.configCache = config;
    return config;
  }

  get config(): VaultConfig {
    if (!this.configCache) this.configCache = loadConfig(this.root);
    return this.configCache;
  }

  setConfig(patch: Partial<VaultConfig>): VaultConfig {
    const next = { ...this.config, ...patch };
    saveConfig(this.root, next);
    this.configCache = next;
    return next;
  }

  stage(id: string) {
    return this.config.stages.find((s) => s.id === id);
  }

  /** Accepts a stage id or a stage name, case-insensitively. */
  resolveStage(input?: string): string {
    const stages = this.config.stages;
    if (!input) return stages[0].id;
    const needle = String(input).trim().toLowerCase();
    const hit =
      stages.find((s) => s.id.toLowerCase() === needle) ??
      stages.find((s) => s.name.toLowerCase() === needle) ??
      stages.find((s) => slugify(s.name) === slugify(needle));
    if (!hit) {
      throw new VaultError(
        `Unknown stage "${input}". Known stages: ${stages.map((s) => s.id).join(', ')}.`,
        'BAD_STAGE',
      );
    }
    return hit.id;
  }

  // ------------------------------------------------------------------- io

  private fileFor(collection: Collection): string {
    return this.paths[collection];
  }

  private all<T>(collection: Collection): T[] {
    if (!this.cache.has(collection)) {
      this.cache.set(collection, readJsonl<T>(this.fileFor(collection)));
    }
    return this.cache.get(collection) as T[];
  }

  private persist(collection: Collection, records: unknown[]): void {
    writeJsonl(this.fileFor(collection), records);
    this.cache.set(collection, records);
  }

  /** Forgets in-memory copies; call when another process may have written. */
  reload(): void {
    this.cache.clear();
    this.configCache = null;
  }

  log(event: Omit<ActivityEvent, 'ts'>): void {
    appendJsonl(this.paths.activity, { ts: nowIso(), ...event });
  }

  activity(limit = 50): ActivityEvent[] {
    return readJsonl<ActivityEvent>(this.paths.activity).slice(-limit).reverse();
  }

  // -------------------------------------------------------------- companies

  companies(): Company[] {
    return this.all<Company>('companies');
  }

  company(idOrName: string): Company | undefined {
    const needle = String(idOrName).trim().toLowerCase();
    const list = this.companies();
    return (
      list.find((c) => c.id === idOrName) ??
      list.find((c) => c.id.toLowerCase() === needle) ??
      list.find((c) => c.name.toLowerCase() === needle) ??
      list.find((c) => c.domain?.toLowerCase() === needle) ??
      list.find((c) => slugify(c.name) === slugify(needle))
    );
  }

  requireCompany(idOrName: string): Company {
    const found = this.company(idOrName);
    if (!found) throw new VaultError(`No company matching "${idOrName}".`, 'NOT_FOUND');
    return found;
  }

  /** Finds a company by id/name, optionally creating it on the fly. */
  resolveCompanyId(idOrName?: string, opts: { create?: boolean } & MutationOptions = {}): string | undefined {
    if (!idOrName) return undefined;
    const found = this.company(idOrName);
    if (found) return found.id;
    if (!opts.create) throw new VaultError(`No company matching "${idOrName}".`, 'NOT_FOUND');
    return this.createCompany({ name: idOrName }, opts).id;
  }

  createCompany(input: Partial<Company> & { name: string }, opts: MutationOptions = {}): Company {
    if (!input.name?.trim()) throw new VaultError('A company needs a name.', 'BAD_INPUT');
    const list = this.companies();
    const ts = nowIso();
    const record: Company = compact({
      ...input,
      id: uniqueId(slugify(input.id || input.name), list.map((c) => c.id)),
      name: input.name.trim(),
      tags: normaliseTags(input.tags),
      createdAt: ts,
      updatedAt: ts,
    }) as Company;
    appendJsonl(this.paths.companies, record);
    list.push(record);
    this.log({ action: 'created', kind: 'company', id: record.id, actor: opts.actor ?? this.defaultActor, summary: record.name });
    return record;
  }

  updateCompany(idOrName: string, patch: Partial<Company>, opts: MutationOptions = {}): Company {
    const current = this.requireCompany(idOrName);
    const next: Company = compact({
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      tags: patch.tags !== undefined ? normaliseTags(patch.tags) : current.tags,
      updatedAt: nowIso(),
    }) as Company;
    const list = this.companies().map((c) => (c.id === current.id ? next : c));
    this.persist('companies', list);
    this.log({ action: 'updated', kind: 'company', id: next.id, actor: opts.actor ?? this.defaultActor, changes: patch as Record<string, unknown> });
    return next;
  }

  deleteCompany(idOrName: string, opts: MutationOptions & { cascade?: boolean } = {}): { company: Company; detachedPeople: number; detachedDeals: number } {
    const current = this.requireCompany(idOrName);
    this.persist('companies', this.companies().filter((c) => c.id !== current.id));

    let detachedPeople = 0;
    let detachedDeals = 0;
    if (opts.cascade) {
      const people = this.people().filter((p) => p.companyId !== current.id);
      detachedPeople = this.people().length - people.length;
      this.persist('people', people);
      const deals = this.deals().filter((d) => d.companyId !== current.id);
      detachedDeals = this.deals().length - deals.length;
      this.persist('deals', deals);
    } else {
      const people = this.people().map((p) => {
        if (p.companyId !== current.id) return p;
        detachedPeople++;
        return { ...p, companyId: undefined, updatedAt: nowIso() };
      });
      this.persist('people', people);
      const deals = this.deals().map((d) => {
        if (d.companyId !== current.id) return d;
        detachedDeals++;
        return { ...d, companyId: undefined, updatedAt: nowIso() };
      });
      this.persist('deals', deals);
    }
    this.log({ action: 'deleted', kind: 'company', id: current.id, actor: opts.actor ?? this.defaultActor, summary: current.name });
    return { company: current, detachedPeople, detachedDeals };
  }

  // ----------------------------------------------------------------- people

  people(): Person[] {
    return this.all<Person>('people');
  }

  person(idOrName: string): Person | undefined {
    const needle = String(idOrName).trim().toLowerCase();
    const list = this.people();
    return (
      list.find((p) => p.id === idOrName) ??
      list.find((p) => p.id.toLowerCase() === needle) ??
      list.find((p) => p.email?.toLowerCase() === needle) ??
      list.find((p) => p.name.toLowerCase() === needle) ??
      list.find((p) => slugify(p.name) === slugify(needle))
    );
  }

  requirePerson(idOrName: string): Person {
    const found = this.person(idOrName);
    if (!found) throw new VaultError(`No person matching "${idOrName}".`, 'NOT_FOUND');
    return found;
  }

  createPerson(
    input: Partial<Person> & { name: string; company?: string },
    opts: MutationOptions & { createCompany?: boolean } = {},
  ): Person {
    if (!input.name?.trim()) throw new VaultError('A person needs a name.', 'BAD_INPUT');
    const { company, ...rest } = input;
    const companyId =
      rest.companyId ?? this.resolveCompanyId(company, { create: opts.createCompany ?? true, actor: opts.actor });
    const list = this.people();
    const ts = nowIso();
    const record: Person = compact({
      ...rest,
      id: uniqueId(slugify(input.id || input.name), list.map((p) => p.id)),
      name: input.name.trim(),
      companyId,
      tags: normaliseTags(input.tags),
      createdAt: ts,
      updatedAt: ts,
    }) as Person;
    appendJsonl(this.paths.people, record);
    list.push(record);
    this.log({ action: 'created', kind: 'person', id: record.id, actor: opts.actor ?? this.defaultActor, summary: record.name });
    return record;
  }

  updatePerson(
    idOrName: string,
    patch: Partial<Person> & { company?: string },
    opts: MutationOptions & { createCompany?: boolean } = {},
  ): Person {
    const current = this.requirePerson(idOrName);
    const { company, ...rest } = patch;
    const companyId =
      rest.companyId ?? (company !== undefined
        ? this.resolveCompanyId(company, { create: opts.createCompany ?? true, actor: opts.actor })
        : current.companyId);
    const next: Person = compact({
      ...current,
      ...rest,
      companyId,
      id: current.id,
      createdAt: current.createdAt,
      tags: patch.tags !== undefined ? normaliseTags(patch.tags) : current.tags,
      updatedAt: nowIso(),
    }) as Person;
    this.persist('people', this.people().map((p) => (p.id === current.id ? next : p)));
    this.log({ action: 'updated', kind: 'person', id: next.id, actor: opts.actor ?? this.defaultActor, changes: patch as Record<string, unknown> });
    return next;
  }

  deletePerson(idOrName: string, opts: MutationOptions = {}): Person {
    const current = this.requirePerson(idOrName);
    this.persist('people', this.people().filter((p) => p.id !== current.id));
    this.persist(
      'deals',
      this.deals().map((d) =>
        d.personIds?.includes(current.id) ? { ...d, personIds: d.personIds.filter((x) => x !== current.id) } : d,
      ),
    );
    this.log({ action: 'deleted', kind: 'person', id: current.id, actor: opts.actor ?? this.defaultActor, summary: current.name });
    return current;
  }

  // ------------------------------------------------------------------ deals

  deals(): Deal[] {
    return this.all<Deal>('deals');
  }

  deal(idOrTitle: string): Deal | undefined {
    const needle = String(idOrTitle).trim().toLowerCase();
    const list = this.deals();
    return (
      list.find((d) => d.id === idOrTitle) ??
      list.find((d) => d.id.toLowerCase() === needle) ??
      list.find((d) => d.title.toLowerCase() === needle) ??
      list.find((d) => slugify(d.title) === slugify(needle))
    );
  }

  requireDeal(idOrTitle: string): Deal {
    const found = this.deal(idOrTitle);
    if (!found) throw new VaultError(`No deal matching "${idOrTitle}".`, 'NOT_FOUND');
    return found;
  }

  createDeal(
    input: Partial<Deal> & { title: string; company?: string; people?: string[] },
    opts: MutationOptions & { createCompany?: boolean } = {},
  ): Deal {
    if (!input.title?.trim()) throw new VaultError('A deal needs a title.', 'BAD_INPUT');
    const { company, people, ...rest } = input;
    const companyId =
      rest.companyId ?? this.resolveCompanyId(company, { create: opts.createCompany ?? true, actor: opts.actor });
    const personIds = (people ?? [])
      .map((p) => this.person(p)?.id)
      .filter((x): x is string => Boolean(x))
      .concat(rest.personIds ?? []);
    const stage = this.resolveStage(rest.stage);
    const list = this.deals();
    const ts = nowIso();
    const record: Deal = compact({
      ...rest,
      id: uniqueId(slugify(input.id || input.title), list.map((d) => d.id)),
      title: input.title.trim(),
      companyId,
      personIds: personIds.length ? Array.from(new Set(personIds)) : undefined,
      stage,
      status: rest.status ?? 'open',
      value: rest.value !== undefined ? Number(rest.value) : undefined,
      currency: rest.currency ?? this.config.currency,
      probability: rest.probability ?? this.stage(stage)?.probability,
      expectedCloseDate: parseDate(rest.expectedCloseDate) ?? undefined,
      order: rest.order ?? list.filter((d) => d.stage === stage).length,
      tags: normaliseTags(input.tags),
      createdAt: ts,
      updatedAt: ts,
    }) as Deal;
    appendJsonl(this.paths.deals, record);
    list.push(record);
    this.log({ action: 'created', kind: 'deal', id: record.id, actor: opts.actor ?? this.defaultActor, summary: record.title });
    return record;
  }

  updateDeal(
    idOrTitle: string,
    patch: Partial<Deal> & { company?: string; people?: string[] },
    opts: MutationOptions & { createCompany?: boolean } = {},
  ): Deal {
    const current = this.requireDeal(idOrTitle);
    const { company, people, ...rest } = patch;
    const companyId =
      rest.companyId ?? (company !== undefined
        ? this.resolveCompanyId(company, { create: opts.createCompany ?? true, actor: opts.actor })
        : current.companyId);
    const personIds = people
      ? Array.from(new Set(people.map((p) => this.person(p)?.id).filter((x): x is string => Boolean(x))))
      : rest.personIds ?? current.personIds;
    const stage = rest.stage !== undefined ? this.resolveStage(rest.stage) : current.stage;
    const next: Deal = compact({
      ...current,
      ...rest,
      id: current.id,
      createdAt: current.createdAt,
      companyId,
      personIds,
      stage,
      value: rest.value !== undefined ? Number(rest.value) : current.value,
      expectedCloseDate:
        rest.expectedCloseDate !== undefined ? parseDate(rest.expectedCloseDate) ?? undefined : current.expectedCloseDate,
      tags: patch.tags !== undefined ? normaliseTags(patch.tags) : current.tags,
      updatedAt: nowIso(),
    }) as Deal;
    this.persist('deals', this.deals().map((d) => (d.id === current.id ? next : d)));
    const action = stage !== current.stage ? 'stage_changed' : 'updated';
    this.log({
      action,
      kind: 'deal',
      id: next.id,
      actor: opts.actor ?? this.defaultActor,
      summary: action === 'stage_changed' ? `${current.stage} → ${stage}` : next.title,
      changes: patch as Record<string, unknown>,
    });
    return next;
  }

  /** Moves a deal to a stage and optionally to a position within that column. */
  moveDeal(idOrTitle: string, stageInput: string, position?: number, opts: MutationOptions = {}): Deal {
    const current = this.requireDeal(idOrTitle);
    const stage = this.resolveStage(stageInput);
    const column = this.deals()
      .filter((d) => d.stage === stage && d.id !== current.id && d.status === 'open')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const at = position === undefined ? column.length : Math.max(0, Math.min(position, column.length));
    const moved: Deal = {
      ...current,
      stage,
      status: 'open',
      probability: this.stage(stage)?.probability ?? current.probability,
      updatedAt: nowIso(),
    };
    delete moved.closedAt;
    delete moved.lostReason;
    column.splice(at, 0, moved);
    const reordered = new Map(column.map((d, i) => [d.id, i]));
    this.persist(
      'deals',
      this.deals().map((d) => {
        if (d.id === current.id) return { ...moved, order: reordered.get(current.id) ?? at };
        return reordered.has(d.id) ? { ...d, order: reordered.get(d.id)! } : d;
      }),
    );
    this.log({
      action: 'stage_changed',
      kind: 'deal',
      id: current.id,
      actor: opts.actor ?? this.defaultActor,
      summary: `${current.stage} → ${stage}`,
    });
    return this.requireDeal(current.id);
  }

  closeDeal(idOrTitle: string, status: 'won' | 'lost', extra: { reason?: string; value?: number } = {}, opts: MutationOptions = {}): Deal {
    const current = this.requireDeal(idOrTitle);
    const next: Deal = compact({
      ...current,
      status,
      value: extra.value !== undefined ? Number(extra.value) : current.value,
      probability: status === 'won' ? 100 : 0,
      lostReason: status === 'lost' ? extra.reason : undefined,
      closedAt: nowIso(),
      updatedAt: nowIso(),
    }) as Deal;
    this.persist('deals', this.deals().map((d) => (d.id === current.id ? next : d)));
    this.log({ action: status, kind: 'deal', id: next.id, actor: opts.actor ?? this.defaultActor, summary: next.title });
    return next;
  }

  reopenDeal(idOrTitle: string, stageInput?: string, opts: MutationOptions = {}): Deal {
    const current = this.requireDeal(idOrTitle);
    return this.moveDeal(current.id, stageInput ?? current.stage, undefined, opts);
  }

  deleteDeal(idOrTitle: string, opts: MutationOptions = {}): Deal {
    const current = this.requireDeal(idOrTitle);
    this.persist('deals', this.deals().filter((d) => d.id !== current.id));
    this.log({ action: 'deleted', kind: 'deal', id: current.id, actor: opts.actor ?? this.defaultActor, summary: current.title });
    return current;
  }

  // ------------------------------------------------------------------ todos

  todos(): Todo[] {
    return this.all<Todo>('todos');
  }

  todo(idOrTitle: string): Todo | undefined {
    const needle = String(idOrTitle).trim().toLowerCase();
    const list = this.todos();
    return (
      list.find((t) => t.id === idOrTitle) ??
      list.find((t) => t.id.toLowerCase() === needle) ??
      list.find((t) => t.title.toLowerCase() === needle) ??
      list.find((t) => slugify(t.title) === slugify(needle))
    );
  }

  requireTodo(idOrTitle: string): Todo {
    const found = this.todo(idOrTitle);
    if (!found) throw new VaultError(`No todo matching "${idOrTitle}".`, 'NOT_FOUND');
    return found;
  }

  createTodo(
    input: Partial<Todo> & { title: string; company?: string; person?: string; deal?: string; due?: string },
    opts: MutationOptions = {},
  ): Todo {
    if (!input.title?.trim()) throw new VaultError('A todo needs a title.', 'BAD_INPUT');
    const { company, person, deal, due, ...rest } = input;
    const dealId = rest.dealId ?? (deal ? this.requireDeal(deal).id : undefined);
    const personId = rest.personId ?? (person ? this.requirePerson(person).id : undefined);
    const companyId =
      rest.companyId ??
      (company ? this.requireCompany(company).id : undefined) ??
      (dealId ? this.deal(dealId)?.companyId : undefined) ??
      (personId ? this.person(personId)?.companyId : undefined);
    const list = this.todos();
    const ts = nowIso();
    const record: Todo = compact({
      ...rest,
      id: uniqueId(slugify(input.id || input.title), list.map((t) => t.id)),
      title: input.title.trim(),
      done: rest.done ?? false,
      dueDate: parseDate(due ?? rest.dueDate) ?? undefined,
      priority: rest.priority ?? 'normal',
      companyId,
      personId,
      dealId,
      tags: normaliseTags(input.tags),
      createdAt: ts,
      updatedAt: ts,
    }) as Todo;
    appendJsonl(this.paths.todos, record);
    list.push(record);
    this.log({ action: 'created', kind: 'todo', id: record.id, actor: opts.actor ?? this.defaultActor, summary: record.title });
    return record;
  }

  updateTodo(
    idOrTitle: string,
    patch: Partial<Todo> & { company?: string; person?: string; deal?: string; due?: string },
    opts: MutationOptions = {},
  ): Todo {
    const current = this.requireTodo(idOrTitle);
    const { company, person, deal, due, ...rest } = patch;
    const next: Todo = compact({
      ...current,
      ...rest,
      id: current.id,
      createdAt: current.createdAt,
      companyId: rest.companyId ?? (company !== undefined ? this.requireCompany(company).id : current.companyId),
      personId: rest.personId ?? (person !== undefined ? this.requirePerson(person).id : current.personId),
      dealId: rest.dealId ?? (deal !== undefined ? this.requireDeal(deal).id : current.dealId),
      dueDate: due !== undefined || rest.dueDate !== undefined
        ? parseDate(due ?? rest.dueDate) ?? undefined
        : current.dueDate,
      tags: patch.tags !== undefined ? normaliseTags(patch.tags) : current.tags,
      updatedAt: nowIso(),
    }) as Todo;
    this.persist('todos', this.todos().map((t) => (t.id === current.id ? next : t)));
    this.log({ action: 'updated', kind: 'todo', id: next.id, actor: opts.actor ?? this.defaultActor, changes: patch as Record<string, unknown> });
    return next;
  }

  completeTodo(idOrTitle: string, done = true, opts: MutationOptions = {}): Todo {
    const current = this.requireTodo(idOrTitle);
    const next: Todo = compact({
      ...current,
      done,
      completedAt: done ? nowIso() : undefined,
      updatedAt: nowIso(),
    }) as Todo;
    this.persist('todos', this.todos().map((t) => (t.id === current.id ? next : t)));
    this.log({ action: done ? 'completed' : 'reopened', kind: 'todo', id: next.id, actor: opts.actor ?? this.defaultActor, summary: next.title });
    return next;
  }

  deleteTodo(idOrTitle: string, opts: MutationOptions = {}): Todo {
    const current = this.requireTodo(idOrTitle);
    this.persist('todos', this.todos().filter((t) => t.id !== current.id));
    this.log({ action: 'deleted', kind: 'todo', id: current.id, actor: opts.actor ?? this.defaultActor, summary: current.title });
    return current;
  }

  // ------------------------------------------------------------------ notes

  notes(includeBody = false): Note[] {
    return notes.listNotes(this.paths.notes, includeBody);
  }

  note(id: string): Note | undefined {
    const direct = notes.readNote(this.paths.notes, id, true);
    if (direct) return direct;
    const needle = slugify(id);
    const match = this.notes(false).find((n) => n.id.includes(needle) || slugify(n.title) === needle);
    return match ? notes.readNote(this.paths.notes, match.id, true) ?? undefined : undefined;
  }

  requireNote(id: string): Note {
    const found = this.note(id);
    if (!found) throw new VaultError(`No note matching "${id}".`, 'NOT_FOUND');
    return found;
  }

  createNote(
    input: notes.NoteInput & { company?: string; deal?: string; people?: string[] },
    opts: MutationOptions & { createCompany?: boolean } = {},
  ): Note {
    const { company, deal, people, ...rest } = input;
    const dealId = rest.dealId ?? (deal ? this.requireDeal(deal).id : undefined);
    const companyId =
      rest.companyId ??
      (company ? this.resolveCompanyId(company, { create: opts.createCompany ?? true, actor: opts.actor }) : undefined) ??
      (dealId ? this.deal(dealId)?.companyId : undefined);
    const attendees = Array.from(
      new Set([...(rest.attendees ?? []), ...(people ?? [])].map((p) => this.person(p)?.id ?? slugify(p))),
    );
    const note = notes.createNote(this.paths.notes, compact({
      ...rest,
      companyId,
      dealId,
      attendees: attendees.length ? attendees : undefined,
      tags: normaliseTags(rest.tags),
    }) as notes.NoteInput);
    this.log({ action: 'created', kind: 'note', id: note.id, actor: opts.actor ?? this.defaultActor, summary: note.title });
    return note;
  }

  updateNote(id: string, patch: Partial<notes.NoteInput>, opts: MutationOptions = {}): Note {
    const current = this.requireNote(id);
    const next = notes.updateNote(this.paths.notes, current.id, patch);
    if (!next) throw new VaultError(`No note matching "${id}".`, 'NOT_FOUND');
    this.log({ action: 'updated', kind: 'note', id: next.id, actor: opts.actor ?? this.defaultActor });
    return next;
  }

  appendNote(id: string, markdown: string, opts: MutationOptions = {}): Note {
    const current = this.requireNote(id);
    const next = notes.appendNote(this.paths.notes, current.id, markdown);
    if (!next) throw new VaultError(`No note matching "${id}".`, 'NOT_FOUND');
    this.log({ action: 'appended', kind: 'note', id: next.id, actor: opts.actor ?? this.defaultActor });
    return next;
  }

  deleteNote(id: string, opts: MutationOptions = {}): Note {
    const current = this.requireNote(id);
    notes.deleteNote(this.paths.notes, current.id);
    this.log({ action: 'deleted', kind: 'note', id: current.id, actor: opts.actor ?? this.defaultActor, summary: current.title });
    return current;
  }

  notePath(id: string): string {
    return notes.notePath(this.paths.notes, this.requireNote(id).id);
  }

  searchNotes(query: string): Note[] {
    return notes.searchNotes(this.paths.notes, query);
  }
}

export function openVault(root: string, opts: { actor?: string } = {}): Vault {
  const vault = new Vault(root, opts);
  vault.assertExists();
  return vault;
}
