import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../core/config.js';
import { Vault, VaultError } from '../core/store.js';
import {
  board,
  expandCompany,
  expandDealFull,
  expandPerson,
  listCompanies,
  listDeals,
  listNotes,
  listPeople,
  listTodos,
  search,
  stats,
} from '../core/query.js';
import { exportTable, type ExportTable } from '../core/export.js';

/**
 * MCP surface. Tools mirror the CLI one-for-one and always return JSON so an
 * agent can chain calls without parsing prose.
 */

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function result(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof VaultError ? err.code : 'ERROR';
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message, code }, null, 2) }], isError: true };
}

const listShape = {
  q: z.string().optional().describe('free-text filter'),
  tag: z.string().optional().describe('comma-separated tags, all must match'),
  company: z.string().optional().describe('company id or name'),
  owner: z.string().optional(),
  limit: z.number().int().positive().optional(),
  sort: z.string().optional().describe('field name, prefix with - for descending'),
};

export function buildServer(vaultPath: string): McpServer {
  const server = new McpServer(
    { name: 'sendapigeon', version: '0.1.0' },
    {
      instructions:
        'SendAPigeon is a file-based CRM. Companies hold people; deals move through pipeline stages; ' +
        'todos hang off deals, people or companies; meeting notes are markdown files. ' +
        'Ids are readable slugs, and most tools also accept a plain name or title. ' +
        'Call pigeon_stats or pigeon_board first to orient yourself.',
    },
  );

  /** Fresh vault per call so edits made outside this process are visible. */
  const open = (): Vault => {
    const v = new Vault(vaultPath, { actor: process.env.PIGEON_ACTOR || 'mcp' });
    v.assertExists();
    return v;
  };

  const tool = (
    name: string,
    description: string,
    shape: z.ZodRawShape,
    // Args are validated by the SDK against `shape` before we see them.
    handler: (args: any, v: Vault) => unknown,
  ) => {
    server.tool(name, description, shape, async (args: any) => {
      try {
        return result(handler(args, open()));
      } catch (err) {
        return errorResult(err);
      }
    });
  };

  // ------------------------------------------------------------- orientation

  tool('pigeon_stats', 'Pipeline and workload summary: deal counts and value by status, open/overdue todos, record counts.', {}, (_a, v) => stats(v));

  tool('pigeon_config', 'The vault config: pipeline stage ids and names, default currency.', {}, (_a, v) => v.config);

  tool(
    'pigeon_board',
    'The deal pipeline as a kanban board: one column per stage, each deal expanded with its company, contacts and open todo counts.',
    { company: z.string().optional(), owner: z.string().optional(), tag: z.string().optional() },
    (a, v) => board(v, a),
  );

  tool(
    'pigeon_search',
    'Search across companies, people, deals, todos and the full text of every meeting note.',
    { query: z.string().describe('what to look for'), limit: z.number().int().positive().optional() },
    (a, v) => search(v, a.query, a.limit ?? 30),
  );

  tool('pigeon_activity', 'Recent changes to the vault, newest first.', { limit: z.number().int().positive().optional() }, (a, v) => v.activity(a.limit ?? 30));

  // ----------------------------------------------------------------- companies

  tool('pigeon_list_companies', 'List companies.', { ...listShape }, (a, v) => listCompanies(v, a));

  tool('pigeon_get_company', 'One company with its people, deals, open todos and notes.', { id: z.string().describe('company id or name') }, (a, v) =>
    expandCompany(v, v.requireCompany(a.id)),
  );

  tool(
    'pigeon_create_company',
    'Create a company.',
    {
      name: z.string(),
      domain: z.string().optional(),
      website: z.string().optional(),
      industry: z.string().optional(),
      size: z.string().optional(),
      location: z.string().optional(),
      phone: z.string().optional(),
      owner: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    (a, v) => v.createCompany(a),
  );

  tool(
    'pigeon_update_company',
    'Update fields on a company. Only pass the fields you want to change.',
    {
      id: z.string(),
      name: z.string().optional(),
      domain: z.string().optional(),
      website: z.string().optional(),
      industry: z.string().optional(),
      size: z.string().optional(),
      location: z.string().optional(),
      phone: z.string().optional(),
      owner: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      archived: z.boolean().optional(),
    },
    (a, v) => {
      const { id, ...patch } = a;
      return v.updateCompany(id, patch);
    },
  );

  tool('pigeon_delete_company', 'Delete a company. Its people and deals are detached unless cascade is true.', { id: z.string(), cascade: z.boolean().optional() }, (a, v) =>
    v.deleteCompany(a.id, { cascade: a.cascade }),
  );

  // -------------------------------------------------------------------- people

  tool('pigeon_list_people', 'List people. Filter by company to get one company\'s contacts.', { ...listShape }, (a, v) => listPeople(v, a));

  tool('pigeon_get_person', 'One person with their company, deals, open todos and notes.', { id: z.string().describe('person id, name or email') }, (a, v) =>
    expandPerson(v, v.requirePerson(a.id)),
  );

  tool(
    'pigeon_create_person',
    'Create a contact. The company is created automatically if it does not exist yet.',
    {
      name: z.string(),
      company: z.string().optional().describe('company id or name'),
      title: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      linkedin: z.string().optional(),
      location: z.string().optional(),
      owner: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    (a, v) => v.createPerson(a as never, { createCompany: true }),
  );

  tool(
    'pigeon_update_person',
    'Update fields on a person. Only pass the fields you want to change.',
    {
      id: z.string(),
      name: z.string().optional(),
      company: z.string().optional(),
      title: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      linkedin: z.string().optional(),
      location: z.string().optional(),
      owner: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      archived: z.boolean().optional(),
    },
    (a, v) => {
      const { id, ...patch } = a;
      return v.updatePerson(id, patch, { createCompany: true });
    },
  );

  tool('pigeon_delete_person', 'Delete a person.', { id: z.string() }, (a, v) => v.deletePerson(a.id));

  // --------------------------------------------------------------------- deals

  tool(
    'pigeon_list_deals',
    'List deals. Defaults to open deals; pass status "won", "lost" or "all" for the rest.',
    { ...listShape, stage: z.string().optional(), status: z.enum(['open', 'won', 'lost', 'all']).optional(), person: z.string().optional() },
    (a, v) => listDeals(v, a),
  );

  tool('pigeon_get_deal', 'One deal with its company, contacts, todos and notes.', { id: z.string().describe('deal id or title') }, (a, v) =>
    expandDealFull(v, v.requireDeal(a.id)),
  );

  tool(
    'pigeon_create_deal',
    'Create a deal in the pipeline. Company and stage accept names as well as ids.',
    {
      title: z.string(),
      company: z.string().optional(),
      people: z.array(z.string()).optional().describe('contact ids or names on this deal'),
      stage: z.string().optional().describe('stage id or name; defaults to the first stage'),
      value: z.number().optional(),
      currency: z.string().optional(),
      probability: z.number().optional(),
      expectedCloseDate: z.string().optional().describe('YYYY-MM-DD, or "friday", "+2w"'),
      source: z.string().optional(),
      owner: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    (a, v) => v.createDeal(a as never, { createCompany: true }),
  );

  tool(
    'pigeon_update_deal',
    'Update fields on a deal. Only pass the fields you want to change.',
    {
      id: z.string(),
      title: z.string().optional(),
      company: z.string().optional(),
      people: z.array(z.string()).optional(),
      stage: z.string().optional(),
      value: z.number().optional(),
      currency: z.string().optional(),
      probability: z.number().optional(),
      expectedCloseDate: z.string().optional(),
      source: z.string().optional(),
      owner: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    (a, v) => {
      const { id, ...patch } = a;
      return v.updateDeal(id, patch, { createCompany: true });
    },
  );

  tool(
    'pigeon_move_deal',
    'Move a deal to another pipeline stage, optionally to a position within that column.',
    { id: z.string(), stage: z.string().describe('stage id or name'), position: z.number().int().nonnegative().optional() },
    (a, v) => v.moveDeal(a.id, a.stage, a.position),
  );

  tool('pigeon_win_deal', 'Mark a deal won.', { id: z.string(), value: z.number().optional().describe('final value if it changed') }, (a, v) =>
    v.closeDeal(a.id, 'won', { value: a.value }),
  );

  tool('pigeon_lose_deal', 'Mark a deal lost.', { id: z.string(), reason: z.string().optional() }, (a, v) => v.closeDeal(a.id, 'lost', { reason: a.reason }));

  tool('pigeon_delete_deal', 'Delete a deal.', { id: z.string() }, (a, v) => v.deleteDeal(a.id));

  // --------------------------------------------------------------------- todos

  tool(
    'pigeon_list_todos',
    'List todos. Defaults to open ones. Use overdue to triage, or deal/person/company to scope.',
    {
      ...listShape,
      done: z.boolean().optional().describe('true for completed, false for open, omit for all'),
      overdue: z.boolean().optional(),
      dueBefore: z.string().optional(),
      deal: z.string().optional(),
      person: z.string().optional(),
    },
    (a, v) => listTodos(v, { ...a, done: a.done ?? false }),
  );

  tool(
    'pigeon_create_todo',
    'Create a todo, optionally attached to a deal, person or company.',
    {
      title: z.string(),
      due: z.string().optional().describe('YYYY-MM-DD, or "today", "friday", "+3d"'),
      priority: z.enum(['low', 'normal', 'high']).optional(),
      deal: z.string().optional(),
      person: z.string().optional(),
      company: z.string().optional(),
      owner: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    (a, v) => v.createTodo(a),
  );

  tool(
    'pigeon_update_todo',
    'Update fields on a todo.',
    {
      id: z.string(),
      title: z.string().optional(),
      due: z.string().optional(),
      priority: z.enum(['low', 'normal', 'high']).optional(),
      deal: z.string().optional(),
      person: z.string().optional(),
      company: z.string().optional(),
      owner: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    (a, v) => {
      const { id, ...patch } = a;
      return v.updateTodo(id, patch);
    },
  );

  tool('pigeon_complete_todo', 'Mark a todo done, or reopen it with done=false.', { id: z.string(), done: z.boolean().optional() }, (a, v) =>
    v.completeTodo(a.id, a.done ?? true),
  );

  tool('pigeon_delete_todo', 'Delete a todo.', { id: z.string() }, (a, v) => v.deleteTodo(a.id));

  // --------------------------------------------------------------------- notes

  tool(
    'pigeon_list_notes',
    'List meeting notes, newest first. Frontmatter only, without the markdown body.',
    { ...listShape, deal: z.string().optional(), person: z.string().optional() },
    (a, v) => listNotes(v, a),
  );

  tool('pigeon_get_note', 'One note including its full markdown body.', { id: z.string() }, (a, v) => v.requireNote(a.id));

  tool(
    'pigeon_create_note',
    'Write a meeting note as a markdown file in the vault. Link it to a company, a deal and the people who attended.',
    {
      title: z.string(),
      body: z.string().describe('markdown body'),
      date: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      type: z.string().optional().describe('meeting, call, email, research…'),
      company: z.string().optional(),
      deal: z.string().optional(),
      people: z.array(z.string()).optional().describe('attendee ids or names'),
      tags: z.array(z.string()).optional(),
    },
    (a, v) => v.createNote(a as never, { createCompany: true }),
  );

  tool(
    'pigeon_append_note',
    'Append markdown to the end of an existing note. The cheapest way to log something as it happens.',
    { id: z.string(), markdown: z.string() },
    (a, v) => v.appendNote(a.id, a.markdown),
  );

  tool(
    'pigeon_update_note',
    'Replace a note body or change its frontmatter.',
    { id: z.string(), title: z.string().optional(), body: z.string().optional(), tags: z.array(z.string()).optional(), company: z.string().optional(), deal: z.string().optional() },
    (a, v) => {
      const { id, ...patch } = a;
      return v.updateNote(id, patch);
    },
  );

  tool('pigeon_delete_note', 'Delete a note file.', { id: z.string() }, (a, v) => v.deleteNote(a.id));

  // -------------------------------------------------------------------- export

  tool(
    'pigeon_export',
    'Export a table as CSV, JSON or JSONL so the data can be moved into another tool.',
    { table: z.enum(['companies', 'people', 'deals', 'todos', 'notes']), format: z.enum(['csv', 'json', 'jsonl']).optional() },
    (a, v) => ({ table: a.table, format: a.format ?? 'csv', content: exportTable(v, a.table as ExportTable, a.format ?? 'csv') }),
  );

  // ------------------------------------------------------------------ resources

  server.resource('vault-guide', 'pigeon://guide', async () => ({
    contents: [
      {
        uri: 'pigeon://guide',
        mimeType: 'text/markdown',
        text: [
          '# SendAPigeon vault',
          '',
          `Vault: ${vaultPath}`,
          '',
          'Companies hold people. Deals belong to a company, carry contacts, and move through',
          'pipeline stages. Todos hang off a deal, person or company. Meeting notes are markdown',
          'files under notes/ with YAML frontmatter linking them back to records.',
          '',
          '## Stages',
          ...open().config.stages.map((s) => `- ${s.id} — ${s.name}${s.probability ? ` (${s.probability}%)` : ''}`),
          '',
          'Ids are readable slugs. Every tool that takes an id also accepts a name, title or email.',
        ].join('\n'),
      },
    ],
  }));

  return server;
}

export async function startMcpServer(vaultPath: string): Promise<void> {
  const server = buildServer(vaultPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// `node dist/mcp/index.js` runs the server directly; importing it does not.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startMcpServer(resolveVault(process.env.PIGEON_VAULT));
}
