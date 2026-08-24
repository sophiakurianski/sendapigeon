import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

import { Vault } from '../dist/core/store.js';
import { createApp } from '../dist/server/index.js';

describe('rest api', () => {
  let root;
  let server;
  let base;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'pigeon-api-'));
    const vault = new Vault(root, { actor: 'test' });
    vault.init({ name: 'Test', currency: 'AUD' });
    vault.createPerson({ name: 'Jane Doe', company: 'Acme Corp', email: 'jane@acme.com' });
    vault.createDeal({ title: 'Acme renewal', company: 'Acme Corp', value: 24000, people: ['Jane Doe'] });

    server = createServer(createApp(root));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });

  const get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, body: await res.json() };
  };
  const send = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-pigeon-actor': 'probe' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json() };
  };

  test('the index lists what is available', async () => {
    const { status, body } = await get('/api');
    assert.equal(status, 200);
    assert.equal(body.name, 'sendapigeon');
    assert.ok(body.endpoints.length > 10);
  });

  test('board groups open deals into stage columns', async () => {
    const { body } = await get('/api/board');
    assert.equal(body.columns.length, 5);
    assert.equal(body.totals.open, 1);
    assert.equal(body.columns[0].deals[0].company.name, 'Acme Corp');
    assert.equal(body.columns[0].deals[0].contacts[0].id, 'jane-doe');
  });

  test('creating a person returns 201 and backfills the company', async () => {
    const { status, body } = await send('POST', '/api/people', { name: 'Mei Tan', company: 'Northwind Freight' });
    assert.equal(status, 201);
    assert.equal(body.id, 'mei-tan');
    assert.equal(body.companyId, 'northwind-freight');
  });

  test('manual person creation reuses an existing company by name', async () => {
    const before = await get('/api/companies');
    const acmeBefore = before.body.filter((company) => company.id === 'acme-corp').length;

    const { status, body } = await send('POST', '/api/people', {
      name: 'Alex Smith',
      company: 'Acme Corp',
      linkedin: 'https://www.linkedin.com/in/alex-smith',
    });
    const after = await get('/api/companies');

    assert.equal(status, 201);
    assert.equal(body.companyId, 'acme-corp');
    assert.equal(body.linkedin, 'https://www.linkedin.com/in/alex-smith');
    assert.equal(after.body.filter((company) => company.id === 'acme-corp').length, acmeBefore);
  });

  test('a person can be manually edited with contact and company details', async () => {
    const { status, body } = await send('PATCH', '/api/people/alex-smith', {
      name: 'Alex Smith-Jones',
      company: 'Northwind Freight',
      title: 'Partnerships Lead',
      email: 'alex@northwind.example',
      phone: '+61 400 123 456',
      linkedin: 'https://www.linkedin.com/in/alex-smith-jones',
      location: 'Sydney, Australia',
    });

    assert.equal(status, 200);
    assert.equal(body.id, 'alex-smith');
    assert.equal(body.name, 'Alex Smith-Jones');
    assert.equal(body.companyId, 'northwind-freight');
    assert.equal(body.title, 'Partnerships Lead');
    assert.equal(body.email, 'alex@northwind.example');
    assert.equal(body.phone, '+61 400 123 456');
    assert.equal(body.location, 'Sydney, Australia');
  });

  test('people board stages are linked to todos and advance together', async () => {
    const board = await get('/api/people-board');
    const jane = board.body.columns.flatMap((column) => column.people).find((person) => person.id === 'jane-doe');
    assert.equal(jane.stage, 'lead');
    assert.equal(jane.stageTodo.title, 'Lead In');
    assert.equal(jane.stageTodo.done, false);

    const advanced = await send('POST', '/api/people/jane-doe/stage/advance');
    assert.equal(advanced.body.completed.done, true);
    assert.equal(advanced.body.person.stage, 'contacted');
    assert.equal(advanced.body.next.stageId, 'contacted');

    const todos = await get('/api/todos?person=jane-doe&done=false');
    assert.equal(todos.body.some((todo) => todo.stageId === 'contacted'), true);
  });

  test('people boards can be created, edited and selected through the api', async () => {
    const created = await send('POST', '/api/people-boards', {
      name: 'Community launch',
      stages: [{ name: 'Invite' }, { name: 'Onboard' }],
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.stages.map((stage) => stage.id), ['invite', 'onboard']);

    const assigned = await send('POST', '/api/people/alex-smith/board', { boardId: created.body.id });
    assert.equal(assigned.body.person.boardId, created.body.id);
    assert.equal(assigned.body.todo.title, 'Invite');

    const selected = await get(`/api/people-board?board=${created.body.id}`);
    assert.equal(selected.body.name, 'Community launch');
    assert.equal(selected.body.total, 1);

    const edited = await send('PATCH', `/api/people-boards/${created.body.id}`, {
      name: 'Community partners',
      stages: [...created.body.stages, { name: 'Activate' }],
    });
    assert.equal(edited.body.name, 'Community partners');
    assert.deepEqual(edited.body.stages.map((stage) => stage.id), ['invite', 'onboard', 'activate']);
  });

  test('a deal moves stage and reports it back', async () => {
    const { body } = await send('POST', '/api/deals/acme-renewal/move', { stage: 'negotiation' });
    assert.equal(body.stage, 'negotiation');
    assert.equal(body.probability, 80);
  });

  test('patching only touches the fields sent', async () => {
    const { body } = await send('PATCH', '/api/deals/acme-renewal', { value: 30000 });
    assert.equal(body.value, 30000);
    assert.equal(body.title, 'Acme renewal');
    assert.equal(body.stage, 'negotiation');
  });

  test('a missing record is a 404 with a readable message', async () => {
    const { status, body } = await get('/api/deals/does-not-exist');
    assert.equal(status, 404);
    assert.equal(body.code, 'NOT_FOUND');
    assert.match(body.error, /does-not-exist/);
  });

  test('a bad stage is a 400, not a 500', async () => {
    const { status, body } = await send('POST', '/api/deals/acme-renewal/move', { stage: 'atlantis' });
    assert.equal(status, 400);
    assert.equal(body.code, 'BAD_STAGE');
  });

  test('the actor header is what lands in the activity log', async () => {
    const { body } = await get('/api/activity?limit=5');
    assert.equal(body[0].actor, 'probe');
  });

  test('csv export is served as a downloadable file', async () => {
    const res = await fetch(`${base}/api/export/people?format=csv`);
    assert.equal(res.headers.get('content-type').split(';')[0], 'text/csv');
    assert.match(res.headers.get('content-disposition'), /people\.csv/);
    assert.match(await res.text(), /^id,name,companyId/);
  });

  test('search spans record kinds', async () => {
    const { body } = await get('/api/search?q=acme');
    const kinds = new Set(body.map((h) => h.kind));
    assert.ok(kinds.has('company'));
    assert.ok(kinds.has('deal'));
  });

  test('web follow-ups stay attached to their person', async () => {
    const created = await send('POST', '/api/todos', {
      title: 'Call Jane Doe',
      personId: 'jane-doe',
      companyId: 'acme-corp',
      dueDate: '2026-08-25',
    });
    assert.equal(created.status, 201);

    const { body } = await get('/api/people/jane-doe');
    assert.equal(body.todos.some((todo) => todo.id === created.body.id), true);
  });

  test('notes can be attached to a person and their company', async () => {
    const created = await send('POST', '/api/notes', {
      title: 'Jane follow-up',
      body: 'Discussed the next introduction.',
      companyId: 'acme-corp',
      attendees: ['jane-doe'],
    });
    assert.equal(created.status, 201);

    const person = await get('/api/people/jane-doe');
    const company = await get('/api/companies/acme-corp');
    assert.equal(person.body.notes.some((note) => note.id === created.body.id), true);
    assert.equal(company.body.notes.some((note) => note.id === created.body.id), true);
  });

});
