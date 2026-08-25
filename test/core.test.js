import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Vault, VaultError } from '../dist/core/store.js';
import { slugify, uniqueId, parseDate, toLocalDate } from '../dist/core/ids.js';
import { board, listTodos, personBoard, search, stats } from '../dist/core/query.js';
import { exportTable, parseCsv, importRows, exportBundle } from '../dist/core/export.js';

function freshVault() {
  const root = mkdtempSync(join(tmpdir(), 'pigeon-test-'));
  const vault = new Vault(root, { actor: 'test' });
  vault.init({ name: 'Test', currency: 'AUD' });
  return vault;
}

describe('ids', () => {
  test('slugify produces readable, url-safe ids', () => {
    assert.equal(slugify('Acme Corp'), 'acme-corp');
    assert.equal(slugify("O'Brien & Sons, Pty Ltd"), 'obrien-sons-pty-ltd');
    assert.equal(slugify('Café Zoë'), 'cafe-zoe');
    assert.equal(slugify('   '), 'untitled');
    assert.equal(slugify('a'.repeat(80)).length, 48);
  });

  test('uniqueId suffixes only on collision', () => {
    assert.equal(uniqueId('acme', []), 'acme');
    assert.equal(uniqueId('acme', ['acme']), 'acme-2');
    assert.equal(uniqueId('acme', ['acme', 'acme-2']), 'acme-3');
  });

  test('parseDate understands the shorthands agents actually type', () => {
    const today = toLocalDate(new Date());
    assert.equal(parseDate('2026-09-01'), '2026-09-01');
    assert.equal(parseDate('today'), today);
    assert.equal(parseDate(undefined), null);
    assert.equal(parseDate('nonsense words here'), null);

    // Dates are the machine's calendar date, not the UTC one: east of UTC those
    // differ for most of the working day.
    assert.equal(parseDate('today'), toLocalDate(new Date()));

    // A weekday name always lands in the future, never today.
    const friday = parseDate('friday');
    assert.match(friday, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(friday > today, `${friday} should be after ${today}`);
    assert.equal(new Date(`${friday}T12:00:00`).getDay(), 5);

    const inThree = parseDate('+3d');
    const expected = new Date();
    expected.setDate(expected.getDate() + 3);
    assert.equal(inThree, toLocalDate(expected));
  });
});

describe('vault lifecycle', () => {
  test('init creates the documented layout and refuses to clobber', () => {
    const vault = freshVault();
    assert.ok(vault.exists());
    assert.deepEqual(vault.config.stages.map((s) => s.id), ['lead', 'contacted', 'demo', 'proposal', 'negotiation']);
    assert.throws(() => vault.init(), (err) => err.code === 'VAULT_EXISTS');
    rmSync(vault.root, { recursive: true, force: true });
  });

  test('an unopened vault fails loudly rather than silently writing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pigeon-empty-'));
    const vault = new Vault(root);
    assert.throws(() => vault.assertExists(), (err) => err.code === 'NO_VAULT');
    rmSync(root, { recursive: true, force: true });
  });
});

describe('records', () => {
  let vault;
  before(() => { vault = freshVault(); });
  after(() => rmSync(vault.root, { recursive: true, force: true }));

  test('a person creates their company on the way in', () => {
    const person = vault.createPerson({ name: 'Jane Doe', company: 'Acme Corp', email: 'jane@acme.com' });
    assert.equal(person.id, 'jane-doe');
    assert.equal(person.companyId, 'acme-corp');
    assert.equal(vault.company('acme-corp').name, 'Acme Corp');
    assert.equal(person.stage, 'lead');
    assert.equal(vault.todos().some((todo) => todo.personId === person.id && todo.stageId === 'lead' && !todo.done), false);
    assert.equal(vault.todos().find((todo) => todo.personId === person.id && todo.stageId === 'contacted').done, false);
  });

  test('reaching the next person stage closes its todo and opens the stage after it', () => {
    const result = vault.advancePersonStage('jane-doe', { actor: 'web' });
    assert.equal(result.completed.stageId, 'contacted');
    assert.equal(result.completed.done, true);
    assert.equal(result.person.stage, 'contacted');
    assert.equal(result.next.stageId, 'demo');
    assert.equal(result.next.done, false);
    assert.equal(vault.activity(10).some((event) => event.action === 'completed' && event.id === result.completed.id), true);
  });

  test('moving backward reopens a previously completed stage', () => {
    vault.advancePersonStage('jane-doe');
    const moved = vault.movePersonStage('jane-doe', 'contacted');
    assert.equal(moved.person.stage, 'contacted');
    assert.equal(moved.todo.stageId, 'demo');
    assert.equal(moved.todo.done, false);
  });

  test('custom people boards can be created, edited and assigned safely', () => {
    const custom = vault.createPeopleBoard({
      name: 'Partner outreach',
      stages: [{ name: 'Introduce' }, { name: 'Check in' }],
    });
    assert.deepEqual(custom.stages.map((stage) => stage.id), ['introduce', 'check-in']);

    const moved = vault.movePersonBoard('jane-doe', custom.id);
    assert.equal(moved.person.boardId, custom.id);
    assert.equal(moved.person.stage, 'introduce');
    assert.equal(moved.todo.boardId, custom.id);
    assert.equal(moved.todo.stageId, 'check-in');
    assert.equal(personBoard(vault, custom.id).total, 1);

    assert.throws(
      () => vault.updatePeopleBoard(custom.id, { stages: [{ id: 'check-in', name: 'Check in' }] }),
      (error) => error.code === 'BAD_INPUT',
    );

    vault.movePersonStage('jane-doe', 'check-in');
    const edited = vault.updatePeopleBoard(custom.id, { stages: [{ id: 'check-in', name: 'Follow up' }, { name: 'Close loop' }] });
    assert.deepEqual(edited.stages.map((stage) => stage.name), ['Follow up', 'Close loop']);
    assert.equal(vault.todos().find((todo) => todo.personId === 'jane-doe' && todo.boardId === custom.id && todo.stageId === 'check-in').title, 'Follow up');
  });

  test('lookups accept id, name or email', () => {
    assert.equal(vault.person('jane-doe').id, 'jane-doe');
    assert.equal(vault.person('Jane Doe').id, 'jane-doe');
    assert.equal(vault.person('jane@acme.com').id, 'jane-doe');
    assert.equal(vault.company('Acme Corp').id, 'acme-corp');
  });

  test('duplicate names get distinct ids, not overwritten records', () => {
    const second = vault.createPerson({ name: 'Jane Doe', company: 'Acme Corp' });
    assert.equal(second.id, 'jane-doe-2');
    assert.equal(vault.people().filter((p) => p.name === 'Jane Doe').length, 2);
    vault.deletePerson('jane-doe-2');
  });

  test('tags are normalised so filters can rely on them', () => {
    const co = vault.updateCompany('acme-corp', { tags: ['Target', ' ENTERPRISE ', 'target'] });
    assert.deepEqual(co.tags, ['target', 'enterprise']);
  });

  test('unknown records raise NOT_FOUND', () => {
    assert.throws(() => vault.requireDeal('nope'), (err) => err instanceof VaultError && err.code === 'NOT_FOUND');
  });
});

describe('deals', () => {
  let vault;
  before(() => {
    vault = freshVault();
    vault.createPerson({ name: 'Jane Doe', company: 'Acme Corp' });
  });
  after(() => rmSync(vault.root, { recursive: true, force: true }));

  test('a new deal lands in the first stage and inherits its probability', () => {
    const deal = vault.createDeal({ title: 'Acme renewal', company: 'Acme Corp', value: 24000, people: ['Jane Doe'] });
    assert.equal(deal.stage, 'lead');
    assert.equal(deal.status, 'open');
    assert.equal(deal.probability, 10);
    assert.equal(deal.currency, 'AUD');
    assert.deepEqual(deal.personIds, ['jane-doe']);
  });

  test('stages resolve by id or by display name', () => {
    assert.equal(vault.resolveStage('proposal'), 'proposal');
    assert.equal(vault.resolveStage('Lead In'), 'lead');
    assert.throws(() => vault.resolveStage('nowhere'), (err) => err.code === 'BAD_STAGE');
  });

  test('moving a deal restacks the target column', () => {
    vault.createDeal({ title: 'Deal B', stage: 'proposal' });
    vault.createDeal({ title: 'Deal C', stage: 'proposal' });
    const moved = vault.moveDeal('acme-renewal', 'proposal', 0);
    assert.equal(moved.stage, 'proposal');
    assert.equal(moved.probability, 60);

    const column = vault.deals().filter((d) => d.stage === 'proposal').sort((a, b) => a.order - b.order);
    assert.deepEqual(column.map((d) => d.id), ['acme-renewal', 'deal-b', 'deal-c']);
    assert.deepEqual(column.map((d) => d.order), [0, 1, 2]);
  });

  test('winning stamps the close, losing keeps the reason', () => {
    const won = vault.closeDeal('acme-renewal', 'won', { value: 26000 });
    assert.equal(won.status, 'won');
    assert.equal(won.value, 26000);
    assert.equal(won.probability, 100);
    assert.ok(won.closedAt);

    const lost = vault.closeDeal('deal-b', 'lost', { reason: 'Budget cut' });
    assert.equal(lost.status, 'lost');
    assert.equal(lost.lostReason, 'Budget cut');
  });

  test('reopening clears the close and the lost reason', () => {
    const reopened = vault.reopenDeal('deal-b', 'demo');
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.stage, 'demo');
    assert.equal(reopened.closedAt, undefined);
    assert.equal(reopened.lostReason, undefined);
  });

  test('the board totals only count open deals', () => {
    const view = board(vault);
    assert.equal(view.columns.length, 5);
    assert.equal(view.totals.won, 1);
    assert.equal(view.totals.wonValue, 26000);
    assert.equal(view.totals.open, view.columns.reduce((n, col) => n + col.count, 0));
    assert.ok(!view.columns.some((col) => col.deals.some((d) => d.status !== 'open')));
  });
});

describe('todos', () => {
  let vault;
  before(() => {
    vault = freshVault();
    vault.createDeal({ title: 'Acme renewal', company: 'Acme Corp' });
  });
  after(() => rmSync(vault.root, { recursive: true, force: true }));

  test('a todo on a deal inherits that deal company', () => {
    const todo = vault.createTodo({ title: 'Send proposal', deal: 'acme-renewal', due: 'today' });
    assert.equal(todo.dealId, 'acme-renewal');
    assert.equal(todo.companyId, 'acme-corp');
    assert.equal(todo.done, false);
  });

  test('completing records when, reopening clears it', () => {
    const done = vault.completeTodo('send-proposal');
    assert.equal(done.done, true);
    assert.ok(done.completedAt);
    const reopened = vault.completeTodo('send-proposal', false);
    assert.equal(reopened.done, false);
    assert.equal(reopened.completedAt, undefined);
  });

  test('overdue filters exclude completed work', () => {
    vault.createTodo({ title: 'Old thing', due: '2020-01-01' });
    vault.createTodo({ title: 'Future thing', due: '2099-01-01' });
    const overdue = listTodos(vault, { overdue: true });
    assert.deepEqual(overdue.map((t) => t.id), ['old-thing']);

    vault.completeTodo('old-thing');
    assert.equal(listTodos(vault, { overdue: true }).length, 0);
  });
});

describe('notes', () => {
  let vault;
  before(() => { vault = freshVault(); });
  after(() => rmSync(vault.root, { recursive: true, force: true }));

  test('a note is a markdown file with frontmatter that survives a round trip', () => {
    vault.createDeal({ title: 'Acme renewal', company: 'Acme Corp' });
    vault.createPerson({ name: 'Jane Doe', company: 'Acme Corp' });

    const note = vault.createNote({
      title: 'Acme kickoff',
      body: '## Agenda\n- Pricing\n- Timing',
      deal: 'acme-renewal',
      people: ['Jane Doe'],
      tags: ['Discovery'],
    });

    assert.match(note.id, /^\d{4}-\d{2}-\d{2}-acme-kickoff$/);
    assert.equal(note.dealId, 'acme-renewal');
    assert.equal(note.companyId, 'acme-corp');
    assert.deepEqual(note.attendees, ['jane-doe']);
    assert.deepEqual(note.tags, ['discovery']);

    const raw = readFileSync(join(vault.root, note.path), 'utf8');
    assert.ok(raw.startsWith('---\n'), 'note should open with YAML frontmatter');
    assert.match(raw, /dealId: acme-renewal/);
    assert.match(raw, /## Agenda/);

    const reread = vault.requireNote(note.id);
    assert.equal(reread.title, 'Acme kickoff');
    assert.match(reread.body, /- Pricing/);
  });

  test('appending adds to the body without disturbing the frontmatter', () => {
    const id = vault.notes()[0].id;
    const appended = vault.appendNote(id, '- Follow up on pricing');
    assert.match(appended.body, /## Agenda/);
    assert.match(appended.body, /- Follow up on pricing/);
    assert.equal(appended.dealId, 'acme-renewal');
  });

  test('search reaches into note bodies', () => {
    const hits = search(vault, 'follow up on pricing');
    assert.ok(hits.some((h) => h.kind === 'note'), 'expected a note hit');
  });
});

describe('export and import', () => {
  let vault;
  before(() => {
    vault = freshVault();
    vault.createPerson({ name: 'Jane Doe', company: 'Acme, Corp', title: 'Head of "Ops"' });
  });
  after(() => rmSync(vault.root, { recursive: true, force: true }));

  test('csv quotes commas and quotes, and parses back identically', () => {
    const csv = exportTable(vault, 'people', 'csv');
    assert.match(csv, /^id,name,companyId/);
    const rows = parseCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Jane Doe');
    assert.equal(rows[0].title, 'Head of "Ops"');
  });

  test('a foreign csv imports on loose column names', () => {
    const target = freshVault();
    const csv = [
      'First Name,Last Name,Organization,Job Title,Email Address,Labels',
      'Mei,Tan,Northwind Freight,COO,mei@northwind.co,champion;warm',
      'Sam,Okafor,Harbourline,Procurement,sam@harbourline.au,',
      ',,,,,',
    ].join('\n');

    const result = importRows(target, 'people', parseCsv(csv));
    assert.equal(result.created, 2);
    assert.equal(result.errors.length, 0);

    const mei = target.person('mei@northwind.co');
    assert.equal(mei.name, 'Mei Tan');
    assert.equal(mei.title, 'COO');
    assert.equal(target.company(mei.companyId).name, 'Northwind Freight');
    assert.deepEqual(mei.tags, ['champion', 'warm']);
    rmSync(target.root, { recursive: true, force: true });
  });

  test('the bundle carries every table plus note bodies', () => {
    vault.createNote({ title: 'A note', body: 'hello' });
    const bundle = exportBundle(vault);
    assert.equal(bundle.format, 'sendapigeon/v1');
    for (const key of ['companies', 'people', 'deals', 'todos', 'notes', 'config']) {
      assert.ok(key in bundle, `bundle missing ${key}`);
    }
    // A body with no heading of its own gets one, so the file stands alone.
    assert.match(bundle.notes[0].body, /^# A note\n\nhello/);
  });
});

describe('activity log', () => {
  test('every mutation is recorded with its actor, newest first', () => {
    const vault = freshVault();
    vault.createCompany({ name: 'Acme Corp' }, { actor: 'hermes' });
    vault.createDeal({ title: 'Acme renewal', company: 'Acme Corp' }, { actor: 'hermes' });
    vault.moveDeal('acme-renewal', 'demo', undefined, { actor: 'jo' });

    const events = vault.activity(10);
    assert.equal(events[0].action, 'stage_changed');
    assert.equal(events[0].actor, 'jo');
    assert.equal(events[0].summary, 'lead → demo');
    assert.ok(events.every((e) => e.ts && e.kind && e.id));
    assert.equal(events.filter((e) => e.actor === 'hermes').length, 2);
    rmSync(vault.root, { recursive: true, force: true });
  });
});

describe('stats', () => {
  test('counts line up with the underlying records', () => {
    const vault = freshVault();
    vault.createPerson({ name: 'Jane Doe', company: 'Acme Corp' });
    vault.createDeal({ title: 'One', company: 'Acme Corp', value: 100 });
    vault.createDeal({ title: 'Two', company: 'Acme Corp', value: 300 });
    vault.closeDeal('two', 'won');
    vault.createTodo({ title: 'Overdue thing', due: '2020-01-01' });

    const s = stats(vault);
    assert.equal(s.companies, 1);
    assert.equal(s.people, 1);
    assert.equal(s.deals.open, 1);
    assert.equal(s.deals.openValue, 100);
    assert.equal(s.deals.won, 1);
    assert.equal(s.todos.overdue, 1);
    rmSync(vault.root, { recursive: true, force: true });
  });
});
