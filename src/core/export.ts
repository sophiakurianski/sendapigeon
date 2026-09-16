import type { Vault } from './store.js';

/**
 * Everything here is intentionally boring: flat CSV and plain JSON, so the
 * vault can be lifted into a spreadsheet, Pipedrive, HubSpot or anything else.
 */

const COLUMNS: Record<string, string[]> = {
  companies: ['id', 'name', 'domain', 'website', 'industry', 'size', 'location', 'phone', 'owner', 'tags', 'description', 'createdAt', 'updatedAt'],
  people: ['id', 'name', 'companyId', 'title', 'email', 'phone', 'linkedin', 'location', 'owner', 'tags', 'description', 'boardId', 'stage', 'workflowExcluded', 'createdAt', 'updatedAt'],
  deals: ['id', 'title', 'companyId', 'personIds', 'stage', 'status', 'value', 'currency', 'probability', 'expectedCloseDate', 'closedAt', 'lostReason', 'source', 'owner', 'tags', 'createdAt', 'updatedAt'],
  todos: ['id', 'title', 'done', 'dueDate', 'priority', 'companyId', 'personId', 'dealId', 'owner', 'tags', 'completedAt', 'createdAt', 'updatedAt'],
  notes: ['id', 'title', 'date', 'type', 'companyId', 'dealId', 'attendees', 'tags', 'path'],
};

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const raw = Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function toCsv(records: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Array.from(new Set(records.flatMap((r) => Object.keys(r))));
  const head = cols.join(',');
  const rows = records.map((r) => cols.map((c) => csvCell(r[c])).join(','));
  return [head, ...rows].join('\n') + '\n';
}

export type ExportTable = 'companies' | 'people' | 'deals' | 'todos' | 'notes';

export function tableRecords(vault: Vault, table: ExportTable): Record<string, unknown>[] {
  switch (table) {
    case 'companies': return vault.companies() as unknown as Record<string, unknown>[];
    case 'people': return vault.people() as unknown as Record<string, unknown>[];
    case 'deals': return vault.deals() as unknown as Record<string, unknown>[];
    case 'todos': return vault.todos() as unknown as Record<string, unknown>[];
    case 'notes': return vault.notes(false) as unknown as Record<string, unknown>[];
  }
}

export function exportTable(vault: Vault, table: ExportTable, format: 'csv' | 'json' | 'jsonl'): string {
  const records = tableRecords(vault, table);
  if (format === 'json') return JSON.stringify(records, null, 2) + '\n';
  if (format === 'jsonl') return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  return toCsv(records, COLUMNS[table]);
}

/** One self-contained JSON document with every record and every note body. */
export function exportBundle(vault: Vault) {
  return {
    format: 'sendapigeon/v1',
    exportedAt: new Date().toISOString(),
    config: vault.config,
    companies: vault.companies(),
    people: vault.people(),
    deals: vault.deals(),
    todos: vault.todos(),
    notes: vault.notes(true),
  };
}

// ------------------------------------------------------------------- import

/** Tolerant CSV reader: handles quotes, embedded commas and CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/**
 * Imports rows into a table. Column names are matched loosely, so a Pipedrive
 * or HubSpot CSV usually lands without any remapping.
 */
export function importRows(
  vault: Vault,
  table: 'companies' | 'people' | 'deals' | 'todos',
  rows: Record<string, string>[],
  opts: { actor?: string } = {},
): ImportResult {
  const result: ImportResult = { created: 0, skipped: 0, errors: [] };

  const pick = (row: Record<string, string>, ...names: string[]): string | undefined => {
    const keys = Object.keys(row);
    for (const name of names) {
      const key = keys.find((k) => k.toLowerCase().replace(/[^a-z]/g, '') === name.toLowerCase().replace(/[^a-z]/g, ''));
      if (key && row[key]?.trim()) return row[key].trim();
    }
    return undefined;
  };
  const tags = (row: Record<string, string>) => {
    const raw = pick(row, 'tags', 'labels', 'label');
    return raw ? raw.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : undefined;
  };

  rows.forEach((row, i) => {
    try {
      if (table === 'companies') {
        const name = pick(row, 'name', 'company', 'organization', 'organisation', 'account');
        if (!name) { result.skipped++; return; }
        vault.createCompany({
          name,
          domain: pick(row, 'domain'),
          website: pick(row, 'website', 'url'),
          industry: pick(row, 'industry', 'category'),
          location: pick(row, 'location', 'address', 'city'),
          phone: pick(row, 'phone'),
          owner: pick(row, 'owner', 'ownername'),
          description: pick(row, 'description', 'notes'),
          tags: tags(row),
        }, opts);
      } else if (table === 'people') {
        const name = pick(row, 'name', 'fullname', 'contact', 'person');
        const first = pick(row, 'firstname', 'givenname');
        const last = pick(row, 'lastname', 'surname', 'familyname');
        const resolved = name ?? [first, last].filter(Boolean).join(' ');
        if (!resolved) { result.skipped++; return; }
        vault.createPerson({
          name: resolved,
          company: pick(row, 'company', 'organization', 'organisation', 'account'),
          title: pick(row, 'title', 'jobtitle', 'role', 'position'),
          email: pick(row, 'email', 'emailaddress', 'workemail'),
          phone: pick(row, 'phone', 'mobile', 'phonenumber'),
          linkedin: pick(row, 'linkedin', 'linkedinurl'),
          location: pick(row, 'location', 'city'),
          owner: pick(row, 'owner'),
          description: pick(row, 'description', 'notes'),
          tags: tags(row),
        }, { ...opts, createCompany: true });
      } else if (table === 'deals') {
        const title = pick(row, 'title', 'name', 'deal', 'dealname', 'opportunity');
        if (!title) { result.skipped++; return; }
        const rawValue = pick(row, 'value', 'amount', 'dealvalue', 'weightedvalue');
        vault.createDeal({
          title,
          company: pick(row, 'company', 'organization', 'organisation', 'account'),
          stage: pick(row, 'stage', 'dealstage', 'pipelinestage') ?? undefined,
          status: (pick(row, 'status')?.toLowerCase() as 'open' | 'won' | 'lost') ?? 'open',
          value: rawValue ? Number(rawValue.replace(/[^0-9.\-]/g, '')) : undefined,
          currency: pick(row, 'currency'),
          expectedCloseDate: pick(row, 'expectedclosedate', 'closedate', 'expectedclose'),
          source: pick(row, 'source', 'leadsource'),
          owner: pick(row, 'owner'),
          tags: tags(row),
        }, { ...opts, createCompany: true });
      } else {
        const title = pick(row, 'title', 'task', 'activity', 'subject', 'name');
        if (!title) { result.skipped++; return; }
        vault.createTodo({
          title,
          due: pick(row, 'due', 'duedate', 'date'),
          priority: (pick(row, 'priority')?.toLowerCase() as 'low' | 'normal' | 'high') ?? undefined,
          done: /^(true|yes|done|1)$/i.test(pick(row, 'done', 'completed', 'status') ?? ''),
          tags: tags(row),
        }, opts);
      }
      result.created++;
    } catch (err) {
      result.errors.push({ row: i + 2, message: err instanceof Error ? err.message : String(err) });
    }
  });

  return result;
}
