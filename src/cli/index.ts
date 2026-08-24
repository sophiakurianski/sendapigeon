#!/usr/bin/env node
import { Command, Option } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expandHome, rememberVault, resolveVault } from '../core/config.js';
import { Vault, VaultError, openVault } from '../core/store.js';
import { today } from '../core/ids.js';
import {
  board as buildBoard,
  expandCompany,
  expandDealFull,
  expandPerson,
  listCompanies,
  listDeals,
  listNotes,
  listPeople,
  listTodos,
  search as runSearch,
  stats as buildStats,
  type ListFilter,
} from '../core/query.js';
import { exportBundle, exportTable, importRows, parseCsv, type ExportTable } from '../core/export.js';
import { c, fail, heading, json, keyValues, money, ok, PIGEON, print, table } from './output.js';

const program = new Command();

program
  .name('pigeon')
  .description('SendAPigeon — agent-first, file-based CRM for people, companies, deals, todos and notes.')
  .version('0.1.0')
  .option('--vault <path>', 'vault directory (default: $PIGEON_VAULT, ./.sendapigeon, or ~/SendAPigeon)')
  .option('--json', 'machine-readable JSON output', false)
  .option('--actor <name>', 'who is making the change, recorded in the activity log')
  .showHelpAfterError();

interface GlobalOpts {
  vault?: string;
  json?: boolean;
  actor?: string;
}

function globals(): GlobalOpts {
  return program.opts<GlobalOpts>();
}

function asJson(): boolean {
  return Boolean(globals().json);
}

function vault(): Vault {
  const g = globals();
  return openVault(resolveVault(g.vault), { actor: g.actor || process.env.PIGEON_ACTOR || 'cli' });
}

/** Every command body runs through here so errors render consistently. */
function run(fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .catch((err: unknown) => {
      if (err instanceof VaultError) fail(err.message, asJson(), err.code);
      fail(err instanceof Error ? err.message : String(err), asJson());
    });
}

function emit(payload: unknown, render: () => void): void {
  if (asJson()) json(payload);
  else render();
}

function filterFrom(opts: Record<string, unknown>): ListFilter {
  return {
    q: opts.q as string | undefined,
    tag: opts.tag as string | undefined,
    company: opts.company as string | undefined,
    person: opts.person as string | undefined,
    deal: opts.deal as string | undefined,
    owner: opts.owner as string | undefined,
    stage: opts.stage as string | undefined,
    status: opts.status as string | undefined,
    archived: opts.archived as boolean | undefined,
    overdue: opts.overdue as boolean | undefined,
    dueBefore: opts.dueBefore as string | undefined,
    limit: opts.limit ? Number(opts.limit) : undefined,
    sort: opts.sort as string | undefined,
  };
}

/** Turns repeated `--field k=v` flags into a patch object. */
function fieldsToPatch(fields: string[] = []): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const raw of fields) {
    const at = raw.indexOf('=');
    if (at < 0) throw new VaultError(`--field expects key=value, got "${raw}".`, 'BAD_INPUT');
    const key = raw.slice(0, at).trim();
    const value = raw.slice(at + 1);
    if (value === '') patch[key] = undefined;
    else if (value === 'true') patch[key] = true;
    else if (value === 'false') patch[key] = false;
    else if (value === 'null') patch[key] = null;
    else if (/^-?\d+(\.\d+)?$/.test(value)) patch[key] = Number(value);
    else patch[key] = value;
  }
  return patch;
}

const listOptions = (cmd: Command) =>
  cmd
    .option('-q, --q <text>', 'free-text filter')
    .option('-t, --tag <tags>', 'comma-separated tags, all must match')
    .option('--owner <name>', 'filter by owner')
    .option('--sort <field>', 'sort field, prefix with - for descending')
    .option('--limit <n>', 'maximum rows');

// ------------------------------------------------------------------- init

program
  .command('init')
  .description('create a new vault')
  .argument('[dir]', 'where to create it', undefined)
  .option('--name <name>', 'display name for this vault')
  .option('--currency <code>', 'default currency', 'AUD')
  .option('--force', 'reinitialise an existing vault', false)
  .option('--no-remember', 'do not record this vault in ~/.sendapigeonrc')
  .action((dir: string | undefined, opts) =>
    run(() => {
      const root = resolve(expandHome(dir ?? globals().vault ?? resolveVault()));
      const v = new Vault(root, { actor: globals().actor });
      const config = v.init({ name: opts.name, currency: opts.currency, force: opts.force });
      if (opts.remember !== false) rememberVault(root);
      writeVaultDocs(v);
      emit({ ok: true, vault: root, config }, () => {
        print(PIGEON);
        ok(`Vault ready at ${c.bold(root)}`);
        print(keyValues([
          ['name', config.name],
          ['currency', config.currency],
          ['stages', config.stages.map((s) => s.id).join(' → ')],
        ]));
        print(`\n${c.dim('Next:')} pigeon person add "Jane Doe" --company "Acme" --email jane@acme.com`);
        print(`${c.dim('     ')} pigeon serve   ${c.dim('# open the board in a browser')}`);
      });
    }),
  );

program
  .command('where')
  .description('print the resolved vault path and config')
  .action(() =>
    run(() => {
      const root = resolveVault(globals().vault);
      const exists = existsSync(resolve(root, 'pigeon.json'));
      const payload = { vault: root, exists, config: exists ? new Vault(root).config : null };
      emit(payload, () => {
        print(keyValues([
          ['vault', root],
          ['exists', String(exists)],
          ['stages', exists ? new Vault(root).config.stages.map((s) => s.id).join(' → ') : ''],
        ]));
      });
    }),
  );

// ---------------------------------------------------------------- companies

const company = program.command('company').alias('co').description('companies');

company
  .command('add')
  .description('add a company')
  .argument('<name>')
  .option('--domain <domain>')
  .option('--website <url>')
  .option('--industry <industry>')
  .option('--size <size>')
  .option('--location <location>')
  .option('--phone <phone>')
  .option('--owner <owner>')
  .option('--description <text>')
  .option('--tags <tags>', 'comma-separated')
  .option('--field <key=value...>', 'set an arbitrary custom field')
  .action((name: string, opts) =>
    run(() => {
      const v = vault();
      const record = v.createCompany({ ...fieldsToPatch(opts.field), ...cleanOpts(opts), name });
      emit(record, () => ok(`Company ${c.bold(record.name)} ${c.dim(`(${record.id})`)}`));
    }),
  );

listOptions(company.command('ls').alias('list').description('list companies'))
  .option('--archived', 'include archived')
  .action((opts) =>
    run(() => {
      const v = vault();
      const rows = listCompanies(v, filterFrom(opts));
      emit(rows, () =>
        print(
          heading(`Companies (${rows.length})`) + '\n' +
            table(rows, [
              { header: 'id', get: (r) => c.beige(r.id), width: 26 },
              { header: 'name', get: (r) => r.name, width: 30 },
              { header: 'domain', get: (r) => r.domain ?? '', width: 24 },
              { header: 'people', get: (r) => String(v.people().filter((p) => p.companyId === r.id).length) },
              { header: 'deals', get: (r) => String(v.deals().filter((d) => d.companyId === r.id && d.status === 'open').length) },
              { header: 'tags', get: (r) => c.dim((r.tags ?? []).join(', ')), width: 24 },
            ]),
        ),
      );
    }),
  );

company
  .command('show')
  .description('show a company with its people, deals, todos and notes')
  .argument('<idOrName>')
  .action((idOrName: string) =>
    run(() => {
      const v = vault();
      const record = expandCompany(v, v.requireCompany(idOrName));
      emit(record, () => {
        print(heading(record.name));
        print(keyValues([
          ['id', record.id],
          ['domain', record.domain],
          ['website', record.website],
          ['industry', record.industry],
          ['location', record.location],
          ['phone', record.phone],
          ['owner', record.owner],
          ['tags', record.tags],
          ['description', record.description],
        ]));
        print(heading(`People (${record.people.length})`) + '\n' +
          table(record.people, [
            { header: 'id', get: (p) => c.beige(p.id), width: 24 },
            { header: 'name', get: (p) => p.name },
            { header: 'title', get: (p) => p.title ?? '' },
            { header: 'email', get: (p) => p.email ?? '' },
            { header: 'phone', get: (p) => p.phone ?? '' },
          ]));
        print(heading(`Deals (${record.deals.length})`) + '\n' +
          table(record.deals, [
            { header: 'id', get: (d) => c.beige(d.id), width: 24 },
            { header: 'title', get: (d) => d.title },
            { header: 'stage', get: (d) => v.stage(d.stage)?.name ?? d.stage },
            { header: 'status', get: (d) => d.status },
            { header: 'value', get: (d) => money(d.value, d.currency ?? v.config.currency) },
          ]));
        print(heading(`Open todos (${record.todos.length})`) + '\n' +
          table(record.todos, [
            { header: 'id', get: (t) => c.beige(t.id), width: 28 },
            { header: 'title', get: (t) => t.title },
            { header: 'due', get: (t) => t.dueDate ?? '' },
          ]));
        print(heading(`Notes (${record.notes.length})`) + '\n' +
          table(record.notes, [
            { header: 'date', get: (n) => n.date },
            { header: 'id', get: (n) => c.beige(n.id), width: 40 },
            { header: 'title', get: (n) => n.title },
          ]));
      });
    }),
  );

company
  .command('set')
  .alias('update')
  .description('update a company')
  .argument('<idOrName>')
  .option('--name <name>')
  .option('--domain <domain>')
  .option('--website <url>')
  .option('--industry <industry>')
  .option('--size <size>')
  .option('--location <location>')
  .option('--phone <phone>')
  .option('--owner <owner>')
  .option('--description <text>')
  .option('--tags <tags>')
  .option('--archived', 'archive it')
  .option('--field <key=value...>')
  .action((idOrName: string, opts) =>
    run(() => {
      const v = vault();
      const record = v.updateCompany(idOrName, { ...fieldsToPatch(opts.field), ...cleanOpts(opts) });
      emit(record, () => ok(`Updated ${c.bold(record.name)}`));
    }),
  );

company
  .command('rm')
  .alias('delete')
  .description('delete a company')
  .argument('<idOrName>')
  .option('--cascade', 'also delete its people and deals', false)
  .action((idOrName: string, opts) =>
    run(() => {
      const v = vault();
      const result = v.deleteCompany(idOrName, { cascade: opts.cascade });
      emit(result, () =>
        ok(`Deleted ${c.bold(result.company.name)} ${c.dim(`(${opts.cascade ? 'removed' : 'detached'} ${result.detachedPeople} people, ${result.detachedDeals} deals)`)}`),
      );
    }),
  );

// ------------------------------------------------------------------- people

const person = program.command('person').alias('p').description('people (contacts live under a company)');

person
  .command('add')
  .description('add a person')
  .argument('<name>')
  .option('--company <idOrName>', 'company; created if it does not exist')
  .option('--title <title>')
  .option('--email <email>')
  .option('--phone <phone>')
  .option('--linkedin <url>')
  .option('--location <location>')
  .option('--owner <owner>')
  .option('--description <text>')
  .option('--tags <tags>')
  .option('--no-create-company', 'fail instead of creating an unknown company')
  .option('--field <key=value...>')
  .action((name: string, opts) =>
    run(() => {
      const v = vault();
      const record = v.createPerson(
        { ...fieldsToPatch(opts.field), ...cleanOpts(opts, ['createCompany']), name },
        { createCompany: opts.createCompany !== false },
      );
      emit(record, () =>
        ok(`Person ${c.bold(record.name)} ${c.dim(`(${record.id})`)}${record.companyId ? ` at ${c.beige(record.companyId)}` : ''}`),
      );
    }),
  );

listOptions(person.command('ls').alias('list').description('list people'))
  .option('--company <idOrName>')
  .option('--archived')
  .action((opts) =>
    run(() => {
      const v = vault();
      const rows = listPeople(v, filterFrom(opts));
      emit(rows, () =>
        print(
          heading(`People (${rows.length})`) + '\n' +
            table(rows, [
              { header: 'id', get: (r) => c.beige(r.id), width: 24 },
              { header: 'name', get: (r) => r.name, width: 26 },
              { header: 'company', get: (r) => (r.companyId ? v.company(r.companyId)?.name ?? r.companyId : ''), width: 24 },
              { header: 'title', get: (r) => r.title ?? '', width: 24 },
              { header: 'email', get: (r) => r.email ?? '', width: 30 },
              { header: 'phone', get: (r) => r.phone ?? '', width: 18 },
            ]),
        ),
      );
    }),
  );

person
  .command('show')
  .description('show a person with their deals, todos and notes')
  .argument('<idOrName>')
  .action((idOrName: string) =>
    run(() => {
      const v = vault();
      const record = expandPerson(v, v.requirePerson(idOrName));
      emit(record, () => {
        print(heading(record.name));
        print(keyValues([
          ['id', record.id],
          ['company', record.company?.name],
          ['title', record.title],
          ['email', record.email],
          ['phone', record.phone],
          ['linkedin', record.linkedin],
          ['location', record.location],
          ['owner', record.owner],
          ['tags', record.tags],
          ['description', record.description],
        ]));
        print(heading(`Deals (${record.deals.length})`) + '\n' +
          table(record.deals, [
            { header: 'id', get: (d) => c.beige(d.id), width: 24 },
            { header: 'title', get: (d) => d.title },
            { header: 'stage', get: (d) => v.stage(d.stage)?.name ?? d.stage },
            { header: 'value', get: (d) => money(d.value, d.currency) },
          ]));
        print(heading(`Open todos (${record.todos.length})`) + '\n' +
          table(record.todos, [
            { header: 'id', get: (t) => c.beige(t.id), width: 28 },
            { header: 'title', get: (t) => t.title },
            { header: 'due', get: (t) => t.dueDate ?? '' },
          ]));
        print(heading(`Notes (${record.notes.length})`) + '\n' +
          table(record.notes, [
            { header: 'date', get: (n) => n.date },
            { header: 'title', get: (n) => n.title },
            { header: 'id', get: (n) => c.dim(n.id), width: 40 },
          ]));
      });
    }),
  );

person
  .command('set')
  .alias('update')
  .description('update a person')
  .argument('<idOrName>')
  .option('--name <name>')
  .option('--company <idOrName>')
  .option('--title <title>')
  .option('--email <email>')
  .option('--phone <phone>')
  .option('--linkedin <url>')
  .option('--location <location>')
  .option('--owner <owner>')
  .option('--description <text>')
  .option('--tags <tags>')
  .option('--archived')
  .option('--field <key=value...>')
  .action((idOrName: string, opts) =>
    run(() => {
      const v = vault();
      const record = v.updatePerson(idOrName, { ...fieldsToPatch(opts.field), ...cleanOpts(opts) });
      emit(record, () => ok(`Updated ${c.bold(record.name)}`));
    }),
  );

person
  .command('rm')
  .alias('delete')
  .description('delete a person')
  .argument('<idOrName>')
  .action((idOrName: string) =>
    run(() => {
      const record = vault().deletePerson(idOrName);
      emit(record, () => ok(`Deleted ${c.bold(record.name)}`));
    }),
  );

// -------------------------------------------------------------------- deals

const deal = program.command('deal').alias('d').description('deals and the kanban pipeline');

deal
  .command('add')
  .description('add a deal')
  .argument('<title>')
  .option('--company <idOrName>', 'company; created if it does not exist')
  .option('--person <idOrName...>', 'contacts on the deal')
  .option('--stage <stage>', 'stage id or name (default: first stage)')
  .option('--value <amount>')
  .option('--currency <code>')
  .option('--probability <percent>')
  .option('--close <date>', 'expected close date; accepts 2026-09-01, friday, +2w')
  .option('--source <source>')
  .option('--owner <owner>')
  .option('--description <text>')
  .option('--tags <tags>')
  .option('--field <key=value...>')
  .action((title: string, opts) =>
    run(() => {
      const v = vault();
      const record = v.createDeal({
        ...fieldsToPatch(opts.field),
        ...cleanOpts(opts, ['person', 'close', 'probability', 'value']),
        title,
        people: opts.person,
        expectedCloseDate: opts.close,
        value: opts.value !== undefined ? Number(opts.value) : undefined,
        probability: opts.probability !== undefined ? Number(opts.probability) : undefined,
      });
      emit(record, () =>
        ok(`Deal ${c.bold(record.title)} ${c.dim(`(${record.id})`)} in ${c.beige(v.stage(record.stage)?.name ?? record.stage)}`),
      );
    }),
  );

listOptions(deal.command('ls').alias('list').description('list deals'))
  .option('--company <idOrName>')
  .option('--person <idOrName>')
  .option('--stage <stage>')
  .addOption(new Option('--status <status>', 'deal status').choices(['open', 'won', 'lost', 'all']).default('open'))
  .action((opts) =>
    run(() => {
      const v = vault();
      const rows = listDeals(v, filterFrom(opts));
      emit(rows, () =>
        print(
          heading(`Deals (${rows.length})`) + '\n' +
            table(rows, [
              { header: 'id', get: (r) => c.beige(r.id), width: 26 },
              { header: 'title', get: (r) => r.title, width: 32 },
              { header: 'company', get: (r) => (r.companyId ? v.company(r.companyId)?.name ?? r.companyId : ''), width: 22 },
              { header: 'stage', get: (r) => v.stage(r.stage)?.name ?? r.stage, width: 14 },
              { header: 'status', get: (r) => statusColour(r.status) },
              { header: 'value', get: (r) => money(r.value, r.currency ?? v.config.currency) },
              { header: 'close', get: (r) => r.expectedCloseDate ?? '' },
            ]),
        ),
      );
    }),
  );

deal
  .command('show')
  .description('show a deal with contacts, todos and notes')
  .argument('<idOrTitle>')
  .action((idOrTitle: string) =>
    run(() => {
      const v = vault();
      const record = expandDealFull(v, v.requireDeal(idOrTitle));
      emit(record, () => {
        print(heading(record.title));
        print(keyValues([
          ['id', record.id],
          ['company', record.company?.name],
          ['stage', v.stage(record.stage)?.name ?? record.stage],
          ['status', record.status],
          ['value', money(record.value, record.currency ?? v.config.currency)],
          ['probability', record.probability !== undefined ? `${record.probability}%` : undefined],
          ['expected close', record.expectedCloseDate],
          ['source', record.source],
          ['owner', record.owner],
          ['tags', record.tags],
          ['description', record.description],
          ['lost reason', record.lostReason],
        ]));
        print(heading(`Contacts (${record.contacts?.length ?? 0})`) + '\n' +
          table(record.contacts ?? [], [
            { header: 'id', get: (p) => c.beige(p.id), width: 24 },
            { header: 'name', get: (p) => p.name },
            { header: 'title', get: (p) => p.title ?? '' },
            { header: 'email', get: (p) => p.email ?? '' },
          ]));
        print(heading(`Todos (${record.todos.length})`) + '\n' +
          table(record.todos, [
            { header: '', get: (t) => (t.done ? c.green('[x]') : c.dim('[ ]')) },
            { header: 'id', get: (t) => c.beige(t.id), width: 28 },
            { header: 'title', get: (t) => t.title },
            { header: 'due', get: (t) => dueColour(t.dueDate, t.done) },
          ]));
        print(heading(`Notes (${record.notes.length})`) + '\n' +
          table(record.notes, [
            { header: 'date', get: (n) => n.date },
            { header: 'title', get: (n) => n.title },
            { header: 'id', get: (n) => c.dim(n.id), width: 40 },
          ]));
      });
    }),
  );

deal
  .command('mv')
  .alias('move')
  .description('move a deal to another stage')
  .argument('<idOrTitle>')
  .argument('<stage>', 'stage id or name')
  .option('--position <n>', 'index within the column')
  .action((idOrTitle: string, stage: string, opts) =>
    run(() => {
      const v = vault();
      const record = v.moveDeal(idOrTitle, stage, opts.position !== undefined ? Number(opts.position) : undefined);
      emit(record, () => ok(`${c.bold(record.title)} → ${c.beige(v.stage(record.stage)?.name ?? record.stage)}`));
    }),
  );

deal
  .command('win')
  .description('mark a deal won')
  .argument('<idOrTitle>')
  .option('--value <amount>', 'final value')
  .action((idOrTitle: string, opts) =>
    run(() => {
      const record = vault().closeDeal(idOrTitle, 'won', { value: opts.value ? Number(opts.value) : undefined });
      emit(record, () => ok(`${c.green('Won')} ${c.bold(record.title)} ${money(record.value, record.currency)}`));
    }),
  );

deal
  .command('lose')
  .description('mark a deal lost')
  .argument('<idOrTitle>')
  .option('--reason <text>')
  .action((idOrTitle: string, opts) =>
    run(() => {
      const record = vault().closeDeal(idOrTitle, 'lost', { reason: opts.reason });
      emit(record, () => ok(`${c.red('Lost')} ${c.bold(record.title)}${opts.reason ? ` — ${opts.reason}` : ''}`));
    }),
  );

deal
  .command('reopen')
  .description('reopen a closed deal')
  .argument('<idOrTitle>')
  .option('--stage <stage>')
  .action((idOrTitle: string, opts) =>
    run(() => {
      const v = vault();
      const record = v.reopenDeal(idOrTitle, opts.stage);
      emit(record, () => ok(`Reopened ${c.bold(record.title)} in ${c.beige(v.stage(record.stage)?.name ?? record.stage)}`));
    }),
  );

deal
  .command('set')
  .alias('update')
  .description('update a deal')
  .argument('<idOrTitle>')
  .option('--title <title>')
  .option('--company <idOrName>')
  .option('--person <idOrName...>', 'replace the contact list')
  .option('--stage <stage>')
  .option('--value <amount>')
  .option('--currency <code>')
  .option('--probability <percent>')
  .option('--close <date>')
  .option('--source <source>')
  .option('--owner <owner>')
  .option('--description <text>')
  .option('--tags <tags>')
  .option('--field <key=value...>')
  .action((idOrTitle: string, opts) =>
    run(() => {
      const record = vault().updateDeal(idOrTitle, {
        ...fieldsToPatch(opts.field),
        ...cleanOpts(opts, ['person', 'close', 'value', 'probability']),
        people: opts.person,
        expectedCloseDate: opts.close,
        value: opts.value !== undefined ? Number(opts.value) : undefined,
        probability: opts.probability !== undefined ? Number(opts.probability) : undefined,
      });
      emit(record, () => ok(`Updated ${c.bold(record.title)}`));
    }),
  );

deal
  .command('rm')
  .alias('delete')
  .description('delete a deal')
  .argument('<idOrTitle>')
  .action((idOrTitle: string) =>
    run(() => {
      const record = vault().deleteDeal(idOrTitle);
      emit(record, () => ok(`Deleted ${c.bold(record.title)}`));
    }),
  );

// -------------------------------------------------------------------- todos

const todo = program.command('todo').alias('t').description('things to do');

todo
  .command('add')
  .description('add a todo')
  .argument('<title>')
  .option('--due <date>', 'accepts 2026-09-01, today, tomorrow, friday, +3d')
  .addOption(new Option('--priority <level>').choices(['low', 'normal', 'high']))
  .option('--deal <idOrTitle>')
  .option('--person <idOrName>')
  .option('--company <idOrName>')
  .option('--owner <owner>')
  .option('--notes <text>')
  .option('--tags <tags>')
  .option('--field <key=value...>')
  .action((title: string, opts) =>
    run(() => {
      const record = vault().createTodo({ ...fieldsToPatch(opts.field), ...cleanOpts(opts), title });
      emit(record, () =>
        ok(`Todo ${c.bold(record.title)} ${c.dim(`(${record.id})`)}${record.dueDate ? ` due ${c.amber(record.dueDate)}` : ''}`),
      );
    }),
  );

listOptions(todo.command('ls').alias('list').description('list todos'))
  .option('--all', 'include completed', false)
  .option('--done', 'only completed', false)
  .option('--overdue', 'only overdue', false)
  .option('--due-before <date>')
  .option('--deal <idOrTitle>')
  .option('--person <idOrName>')
  .option('--company <idOrName>')
  .action((opts) =>
    run(() => {
      const v = vault();
      const filter = filterFrom(opts);
      filter.done = opts.done ? true : opts.all ? undefined : false;
      const rows = listTodos(v, filter);
      emit(rows, () =>
        print(
          heading(`Todos (${rows.length})`) + '\n' +
            table(rows, [
              { header: '', get: (r) => (r.done ? c.green('[x]') : c.dim('[ ]')) },
              { header: 'id', get: (r) => c.beige(r.id), width: 30 },
              { header: 'title', get: (r) => r.title, width: 40 },
              { header: 'due', get: (r) => dueColour(r.dueDate, r.done) },
              { header: 'pri', get: (r) => (r.priority === 'high' ? c.red('high') : r.priority ?? '') },
              { header: 'linked to', get: (r) => linkLabel(v, r), width: 28 },
            ]),
        ),
      );
    }),
  );

todo
  .command('done')
  .description('complete a todo')
  .argument('<idOrTitle...>')
  .action((ids: string[]) =>
    run(() => {
      const v = vault();
      const records = ids.map((id) => v.completeTodo(id, true));
      emit(records.length === 1 ? records[0] : records, () => records.forEach((r) => ok(`Done: ${c.bold(r.title)}`)));
    }),
  );

todo
  .command('undone')
  .alias('reopen')
  .description('reopen a completed todo')
  .argument('<idOrTitle...>')
  .action((ids: string[]) =>
    run(() => {
      const v = vault();
      const records = ids.map((id) => v.completeTodo(id, false));
      emit(records.length === 1 ? records[0] : records, () => records.forEach((r) => ok(`Reopened: ${c.bold(r.title)}`)));
    }),
  );

todo
  .command('set')
  .alias('update')
  .description('update a todo')
  .argument('<idOrTitle>')
  .option('--title <title>')
  .option('--due <date>')
  .addOption(new Option('--priority <level>').choices(['low', 'normal', 'high']))
  .option('--deal <idOrTitle>')
  .option('--person <idOrName>')
  .option('--company <idOrName>')
  .option('--owner <owner>')
  .option('--notes <text>')
  .option('--tags <tags>')
  .option('--field <key=value...>')
  .action((idOrTitle: string, opts) =>
    run(() => {
      const record = vault().updateTodo(idOrTitle, { ...fieldsToPatch(opts.field), ...cleanOpts(opts) });
      emit(record, () => ok(`Updated ${c.bold(record.title)}`));
    }),
  );

todo
  .command('rm')
  .alias('delete')
  .description('delete a todo')
  .argument('<idOrTitle>')
  .action((idOrTitle: string) =>
    run(() => {
      const record = vault().deleteTodo(idOrTitle);
      emit(record, () => ok(`Deleted ${c.bold(record.title)}`));
    }),
  );

// -------------------------------------------------------------------- notes

const note = program.command('note').alias('n').description('markdown meeting notes');

note
  .command('new')
  .alias('add')
  .description('create a note; body comes from --body, --file, or stdin')
  .argument('<title>')
  .option('--body <markdown>')
  .option('--file <path>', 'read the body from a file, or - for stdin')
  .option('--date <date>', 'defaults to today')
  .option('--type <type>', 'meeting, call, email, research…', 'meeting')
  .option('--company <idOrName>')
  .option('--deal <idOrTitle>')
  .option('--person <idOrName...>', 'attendees')
  .option('--tags <tags>')
  .option('--field <key=value...>')
  .action(async (title: string, opts) =>
    run(async () => {
      const v = vault();
      let body = opts.body as string | undefined;
      if (opts.file === '-') body = await readStdin();
      else if (opts.file) body = readFileSync(expandHome(opts.file), 'utf8');
      if (body === undefined && !process.stdin.isTTY) body = await readStdin();
      const record = v.createNote({
        ...fieldsToPatch(opts.field),
        title,
        body: body ?? '',
        date: opts.date,
        type: opts.type,
        company: opts.company,
        deal: opts.deal,
        people: opts.person,
        tags: opts.tags ? String(opts.tags).split(',') : undefined,
      });
      emit(record, () => ok(`Note ${c.bold(record.title)} ${c.dim(`→ ${record.path}`)}`));
    }),
  );

listOptions(note.command('ls').alias('list').description('list notes'))
  .option('--company <idOrName>')
  .option('--deal <idOrTitle>')
  .option('--person <idOrName>')
  .action((opts) =>
    run(() => {
      const v = vault();
      const rows = listNotes(v, filterFrom(opts));
      emit(rows, () =>
        print(
          heading(`Notes (${rows.length})`) + '\n' +
            table(rows, [
              { header: 'date', get: (r) => r.date },
              { header: 'title', get: (r) => r.title, width: 40 },
              { header: 'type', get: (r) => r.type ?? '' },
              { header: 'company', get: (r) => (r.companyId ? v.company(r.companyId)?.name ?? r.companyId : ''), width: 22 },
              { header: 'id', get: (r) => c.dim(r.id), width: 44 },
            ]),
        ),
      );
    }),
  );

note
  .command('show')
  .alias('cat')
  .description('print a note as markdown')
  .argument('<id>')
  .action((id: string) =>
    run(() => {
      const record = vault().requireNote(id);
      emit(record, () => {
        print(heading(record.title));
        print(keyValues([
          ['id', record.id],
          ['date', record.date],
          ['type', record.type],
          ['company', record.companyId],
          ['deal', record.dealId],
          ['attendees', record.attendees],
          ['tags', record.tags],
          ['path', record.path],
        ]));
        print('\n' + (record.body ?? ''));
      });
    }),
  );

note
  .command('append')
  .description('append markdown to a note')
  .argument('<id>')
  .argument('[markdown]', 'omit to read from stdin')
  .action(async (id: string, markdown: string | undefined) =>
    run(async () => {
      const body = markdown ?? (await readStdin());
      const record = vault().appendNote(id, body);
      emit(record, () => ok(`Appended to ${c.bold(record.title)}`));
    }),
  );

note
  .command('path')
  .description('print the absolute file path of a note')
  .argument('<id>')
  .action((id: string) =>
    run(() => {
      const path = vault().notePath(id);
      emit({ path }, () => print(path));
    }),
  );

note
  .command('rm')
  .alias('delete')
  .description('delete a note file')
  .argument('<id>')
  .action((id: string) =>
    run(() => {
      const record = vault().deleteNote(id);
      emit(record, () => ok(`Deleted ${c.bold(record.title)}`));
    }),
  );

// -------------------------------------------------------------- board/views

program
  .command('board')
  .alias('kanban')
  .description('the deal pipeline as a kanban board')
  .option('--company <idOrName>')
  .option('--owner <owner>')
  .option('--tag <tags>')
  .option('--width <n>', 'column width', '26')
  .action((opts) =>
    run(() => {
      const v = vault();
      const b = buildBoard(v, filterFrom(opts));
      emit(b, () => print(renderBoard(b, Number(opts.width))));
    }),
  );

program
  .command('search')
  .description('search everything, notes included')
  .argument('<query...>')
  .option('--limit <n>', 'maximum hits', '30')
  .action((query: string[], opts) =>
    run(() => {
      const hits = runSearch(vault(), query.join(' '), Number(opts.limit));
      emit(hits, () =>
        print(
          heading(`Results (${hits.length})`) + '\n' +
            table(hits, [
              { header: 'kind', get: (h) => c.slate(h.kind) },
              { header: 'id', get: (h) => c.beige(h.id), width: 40 },
              { header: 'title', get: (h) => h.title, width: 36 },
              { header: 'context', get: (h) => c.dim(h.snippet ?? h.subtitle ?? ''), width: 50 },
            ]),
        ),
      );
    }),
  );

program
  .command('stats')
  .alias('status')
  .description('pipeline and workload summary')
  .action(() =>
    run(() => {
      const v = vault();
      const s = buildStats(v);
      emit(s, () => {
        print(PIGEON);
        print(heading('Pipeline'));
        print(keyValues([
          ['open deals', `${s.deals.open}  ${c.dim(money(s.deals.openValue, s.currency))}`],
          ['weighted', money(s.deals.weightedValue, s.currency)],
          ['won', `${s.deals.won}  ${c.dim(money(s.deals.wonValue, s.currency))}`],
          ['lost', String(s.deals.lost)],
        ]));
        print(heading('Workload'));
        print(keyValues([
          ['open todos', String(s.todos.open)],
          ['due today', String(s.todos.dueToday)],
          ['overdue', s.todos.overdue ? c.red(String(s.todos.overdue)) : '0'],
        ]));
        print(heading('Records'));
        print(keyValues([
          ['companies', String(s.companies)],
          ['people', String(s.people)],
          ['notes', String(s.notes)],
        ]));
      });
    }),
  );

program
  .command('config')
  .description('the vault config: pipeline stages and currency')
  .action(() =>
    run(() => {
      const v = vault();
      emit(v.config, () => {
        print(heading(v.config.name));
        print(keyValues([['currency', v.config.currency], ['owner', v.config.owner]]));
        print(heading(`Stages (${v.config.stages.length})`) + '\n' +
          table(v.config.stages, [
            { header: 'id', get: (s) => c.beige(s.id), width: 20 },
            { header: 'name', get: (s) => s.name, width: 24 },
            { header: 'probability', get: (s) => (s.probability !== undefined ? `${s.probability}%` : '') },
          ]));
      });
    }),
  );

program
  .command('activity')
  .alias('log')
  .description('recent changes, newest first')
  .option('--limit <n>', 'how many events', '30')
  .action((opts) =>
    run(() => {
      const events = vault().activity(Number(opts.limit));
      emit(events, () =>
        print(
          heading(`Activity (${events.length})`) + '\n' +
            table(events, [
              { header: 'when', get: (e) => e.ts.replace('T', ' ').slice(0, 16) },
              { header: 'actor', get: (e) => c.slate(e.actor ?? '') },
              { header: 'action', get: (e) => e.action },
              { header: 'kind', get: (e) => e.kind },
              { header: 'id', get: (e) => c.beige(e.id), width: 34 },
              { header: 'summary', get: (e) => c.dim(e.summary ?? ''), width: 36 },
            ]),
        ),
      );
    }),
  );

// ----------------------------------------------------------- export/import

program
  .command('export')
  .description('export a table, or the whole vault')
  .argument('[table]', 'companies | people | deals | todos | notes | all', 'all')
  .addOption(new Option('-f, --format <format>').choices(['csv', 'json', 'jsonl']).default('csv'))
  .option('-o, --out <file>', 'write to a file instead of stdout')
  .action((tableName: string, opts) =>
    run(() => {
      const v = vault();
      let payload: string;
      if (tableName === 'all') {
        if (opts.format === 'csv') throw new VaultError('`export all` needs --format json or jsonl.', 'BAD_INPUT');
        payload = JSON.stringify(exportBundle(v), null, opts.format === 'json' ? 2 : 0) + '\n';
      } else {
        payload = exportTable(v, tableName as ExportTable, opts.format);
      }
      if (opts.out) {
        writeFileSync(expandHome(opts.out), payload, 'utf8');
        ok(`Wrote ${expandHome(opts.out)}`);
      } else {
        process.stdout.write(payload);
      }
    }),
  );

program
  .command('import')
  .description('import a CSV or JSON file into a table')
  .argument('<table>', 'companies | people | deals | todos')
  .argument('<file>', 'path to a .csv, .json or .jsonl file, or - for stdin')
  .action(async (tableName: string, file: string) =>
    run(async () => {
      const v = vault();
      const raw = file === '-' ? await readStdin() : readFileSync(expandHome(file), 'utf8');
      const rows: Record<string, string>[] = file.endsWith('.json')
        ? JSON.parse(raw)
        : file.endsWith('.jsonl')
          ? raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
          : parseCsv(raw);
      const result = importRows(v, tableName as 'companies' | 'people' | 'deals' | 'todos', rows, { actor: globals().actor ?? 'import' });
      emit(result, () => {
        ok(`Imported ${result.created} ${tableName}${result.skipped ? `, skipped ${result.skipped}` : ''}`);
        for (const e of result.errors) print(`  ${c.red('row ' + e.row)} ${e.message}`);
      });
    }),
  );

// ------------------------------------------------------------------ servers

program
  .command('serve')
  .description('start the local web UI and REST API')
  .option('-p, --port <port>', 'port', '4477')
  .option('--host <host>', 'bind address', '127.0.0.1')
  .option('--open', 'open a browser window', false)
  .action(async (opts) =>
    run(async () => {
      const { startServer } = await import('../server/index.js');
      const root = resolveVault(globals().vault);
      const url = await startServer({ vault: root, port: Number(opts.port), host: opts.host });
      print(PIGEON);
      ok(`Serving ${c.bold(root)}`);
      print(`  ${c.dim('web')}  ${c.beige(url)}`);
      print(`  ${c.dim('api')}  ${c.beige(url + '/api')}`);
      if (opts.open) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }),
  );

program
  .command('mcp')
  .description('run the MCP server on stdio for agents')
  .action(async () =>
    run(async () => {
      const { startMcpServer } = await import('../mcp/index.js');
      await startMcpServer(resolveVault(globals().vault));
    }),
  );

program
  .command('agents')
  .description('print the agent instructions for this vault (also written to AGENTS.md)')
  .action(() =>
    run(() => {
      const v = vault();
      print(agentDocs(v));
    }),
  );

// ------------------------------------------------------------------ helpers

/** Strips commander bookkeeping and the flags a command handles itself. */
function cleanOpts(opts: Record<string, unknown>, drop: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const skip = new Set(['field', 'json', 'vault', 'actor', 'all', 'q', 'limit', 'sort', ...drop]);
  for (const [k, v] of Object.entries(opts)) {
    if (skip.has(k) || v === undefined) continue;
    if (k === 'tags') out.tags = String(v).split(',');
    else out[k] = v;
  }
  return out;
}

function statusColour(status: string): string {
  if (status === 'won') return c.green(status);
  if (status === 'lost') return c.red(status);
  return status;
}

function dueColour(due: string | undefined, done?: boolean): string {
  if (!due) return '';
  if (done) return c.dim(due);
  if (due < today()) return c.red(due);
  if (due === today()) return c.amber(due);
  return due;
}

function linkLabel(v: Vault, t: { dealId?: string; personId?: string; companyId?: string }): string {
  if (t.dealId) return c.dim('deal ') + (v.deal(t.dealId)?.title ?? t.dealId);
  if (t.personId) return c.dim('person ') + (v.person(t.personId)?.name ?? t.personId);
  if (t.companyId) return c.dim('co ') + (v.company(t.companyId)?.name ?? t.companyId);
  return '';
}

function renderBoard(b: ReturnType<typeof buildBoard>, width = 26): string {
  const lines: string[] = [];
  lines.push(heading('Pipeline'));
  for (const col of b.columns) {
    lines.push('');
    lines.push(`  ${c.bold(c.brown(col.name))} ${c.dim(`(${col.count})`)}  ${c.beige(money(col.value, b.currency))}`);
    lines.push('  ' + c.dim('─'.repeat(Math.max(width, col.name.length + 12))));
    if (!col.deals.length) lines.push('  ' + c.dim('·'));
    for (const d of col.deals) {
      const flags = [
        d.overdueTodos ? c.red(`!${d.overdueTodos}`) : '',
        d.openTodos ? c.dim(`☐${d.openTodos}`) : '',
      ].filter(Boolean).join(' ');
      lines.push(`  ${c.cream('•')} ${d.title}  ${c.dim(d.company?.name ?? '')} ${c.beige(money(d.value, d.currency ?? b.currency))} ${flags}`);
      lines.push(`    ${c.dim(d.id)}${d.nextTodo ? c.dim(`  next: ${d.nextTodo.title}${d.nextTodo.dueDate ? ` (${d.nextTodo.dueDate})` : ''}`) : ''}`);
    }
  }
  lines.push('');
  lines.push(
    `  ${c.dim('open')} ${b.totals.open} · ${money(b.totals.openValue, b.currency)}   ` +
      `${c.dim('weighted')} ${money(b.totals.weightedValue, b.currency)}   ` +
      `${c.green('won')} ${b.totals.won} · ${money(b.totals.wonValue, b.currency)}   ` +
      `${c.red('lost')} ${b.totals.lost}`,
  );
  return lines.join('\n');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function agentDocs(v: Vault): string {
  const stages = v.config.stages.map((s) => `${s.id} (${s.name})`).join(', ');
  return `# SendAPigeon vault

This folder is a CRM. Everything is plain files: JSONL records under \`data/\` and
markdown notes under \`notes/\`. You may read the files directly, but prefer the
\`pigeon\` CLI or the MCP server so the activity log stays accurate.

## Layout

    pigeon.json          vault config: pipeline stages, currency
    data/companies.jsonl  one company per line
    data/people.jsonl     one person per line, linked by companyId
    data/deals.jsonl      one deal per line, linked by companyId and personIds
    data/todos.jsonl      one todo per line, linked by dealId/personId/companyId
    data/activity.jsonl   append-only change log
    notes/YYYY-MM-DD-slug.md   markdown notes with YAML frontmatter

## Stages

${stages}

## CLI

Add \`--json\` to any command for machine-readable output, and
\`--actor <name>\` so the activity log records who did it.

    pigeon company add "Acme Corp" --domain acme.com
    pigeon person add "Jane Doe" --company "Acme Corp" --email jane@acme.com --title "Head of Ops"
    pigeon deal add "Acme renewal" --company "Acme Corp" --value 24000 --stage proposal --person jane-doe
    pigeon deal mv acme-renewal negotiation
    pigeon deal win acme-renewal
    pigeon todo add "Send proposal" --deal acme-renewal --due friday
    pigeon todo done send-proposal
    pigeon note new "Acme kickoff" --deal acme-renewal --person jane-doe --file notes.md
    pigeon note append 2026-08-24-acme-kickoff "- Follow up on pricing"
    pigeon board --json
    pigeon search "pricing"
    pigeon stats --json
    pigeon export deals --format csv

Ids are readable slugs derived from the name or title. Most commands also accept
the plain name, so \`pigeon deal show "Acme renewal"\` works.

## Loading data in

See POPULATING.md next to this file before bulk-loading a vault: it covers
duplicate checking, what not to invent, and when to use \`pigeon import\`
instead of creating records one at a time.

## MCP

    pigeon mcp     # stdio MCP server exposing the same operations as tools

## REST

    pigeon serve   # http://127.0.0.1:4477 — web UI at /, JSON API at /api
`;
}

function vaultReadme(v: Vault): string {
  return `# ${v.config.name}

This folder is your CRM. It is plain files, so it works with git, Dropbox,
Obsidian, ripgrep and anything else that reads text.

    pigeon board        the deal pipeline
    pigeon stats        where things stand
    pigeon serve        the same thing in a browser

\`notes/\` is an Obsidian-style vault of markdown meeting notes — point Obsidian
at this folder and they open as-is. \`data/\` holds one JSON record per line;
\`pigeon export\` turns any of it into CSV.

See AGENTS.md for what to tell a coding agent pointed at this folder.
`;
}

function writeVaultDocs(v: Vault): void {
  writeFileSync(resolve(v.root, 'AGENTS.md'), agentDocs(v), 'utf8');
  writeFileSync(resolve(v.root, 'README.md'), vaultReadme(v), 'utf8');
}

program.parseAsync(process.argv).catch((err) => {
  fail(err instanceof Error ? err.message : String(err), Boolean(program.opts().json));
});
