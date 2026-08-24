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
});
