import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  personBoard,
  search,
  stats,
  type ListFilter,
} from '../core/query.js';
import { exportBundle, exportTable, importRows, parseCsv, type ExportTable } from '../core/export.js';

export interface ServerOptions {
  vault: string;
  port?: number;
  host?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** Web assets live next to the compiled server in dist/, or in web/dist in dev. */
function webRoot(): string | null {
  const candidates = [
    resolve(HERE, '../../web/dist'),
    resolve(HERE, '../web'),
    resolve(process.cwd(), 'web/dist'),
  ];
  return candidates.find((p) => existsSync(join(p, 'index.html'))) ?? null;
}

function parseFilter(query: Record<string, unknown>): ListFilter {
  const str = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : undefined);
  const bool = (k: string) => (query[k] === undefined ? undefined : query[k] === 'true' || query[k] === '1');
  return {
    q: str('q'),
    tag: str('tag'),
    company: str('company'),
    person: str('person'),
    deal: str('deal'),
    owner: str('owner'),
    stage: str('stage'),
    status: str('status'),
    done: bool('done'),
    overdue: bool('overdue'),
    dueBefore: str('dueBefore'),
    archived: bool('archived'),
    sort: str('sort'),
    limit: str('limit') ? Number(str('limit')) : undefined,
    offset: str('offset') ? Number(str('offset')) : undefined,
  };
}

export function createApp(vaultPath: string) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(express.text({ type: ['text/*'], limit: '8mb' }));

  /** A fresh Vault per request so edits made outside the server are picked up. */
  const withVault = (req: Request): Vault => {
    const actor = (req.header('x-pigeon-actor') || (req.query.actor as string) || 'web').slice(0, 64);
    const v = new Vault(vaultPath, { actor });
    v.assertExists();
    return v;
  };

  const wrap =
    (handler: (req: Request, res: Response, v: Vault) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = handler(req, res, withVault(req));
        if (result !== undefined && !res.headersSent) res.json(result);
      } catch (err) {
        next(err);
      }
    };

  const api = express.Router();

  api.get('/', (_req, res) => {
    res.json({
      name: 'sendapigeon',
      version: '0.1.0',
      vault: vaultPath,
      endpoints: [
        'GET /api/config', 'GET /api/stats', 'GET /api/board', 'GET /api/people-board', 'POST|PATCH|DELETE /api/people-boards', 'GET /api/search?q=',
        'GET|POST /api/companies', 'GET|PATCH|DELETE /api/companies/:id',
        'GET|POST /api/people', 'GET|PATCH|DELETE /api/people/:id', 'POST /api/people/:id/stage/{ensure,advance,move}',
        'GET|POST /api/deals', 'GET|PATCH|DELETE /api/deals/:id',
        'POST /api/deals/:id/move', 'POST /api/deals/:id/win', 'POST /api/deals/:id/lose',
        'GET|POST /api/todos', 'GET|PATCH|DELETE /api/todos/:id', 'POST /api/todos/:id/toggle',
        'GET|POST /api/notes', 'GET|PATCH|DELETE /api/notes/:id', 'POST /api/notes/:id/append',
        'GET /api/activity', 'GET /api/export/:table', 'POST /api/import/:table',
      ],
    });
  });

  api.get('/config', wrap((_req, _res, v) => v.config));
  api.patch('/config', wrap((req, _res, v) => v.setConfig(req.body)));
  api.get('/stats', wrap((_req, _res, v) => stats(v)));
  api.get('/board', wrap((req, _res, v) => board(v, parseFilter(req.query as Record<string, unknown>))));
  api.get('/people-board', wrap((req, _res, v) => personBoard(v, typeof req.query.board === 'string' ? req.query.board : undefined)));
  api.post('/people-boards', wrap((req, res, v) => { res.status(201); return v.createPeopleBoard(req.body); }));
  api.patch('/people-boards/:id', wrap((req, _res, v) => v.updatePeopleBoard(req.params.id, req.body)));
  api.delete('/people-boards/:id', wrap((req, _res, v) => v.deletePeopleBoard(req.params.id)));
  api.get('/activity', wrap((req, _res, v) => v.activity(Number(req.query.limit ?? 50))));
  api.get('/search', wrap((req, _res, v) => search(v, String(req.query.q ?? ''), Number(req.query.limit ?? 30))));

  // companies
  api.get('/companies', wrap((req, _res, v) => listCompanies(v, parseFilter(req.query as Record<string, unknown>))));
  api.post('/companies', wrap((req, res, v) => { res.status(201); return v.createCompany(req.body); }));
  api.get('/companies/:id', wrap((req, _res, v) => expandCompany(v, v.requireCompany(req.params.id))));
  api.patch('/companies/:id', wrap((req, _res, v) => v.updateCompany(req.params.id, req.body)));
  api.delete('/companies/:id', wrap((req, _res, v) => v.deleteCompany(req.params.id, { cascade: req.query.cascade === 'true' })));

  // people
  api.get('/people', wrap((req, _res, v) => listPeople(v, parseFilter(req.query as Record<string, unknown>))));
  api.post('/people', wrap((req, res, v) => { res.status(201); return v.createPerson(req.body, { createCompany: true }); }));
  api.get('/people/:id', wrap((req, _res, v) => expandPerson(v, v.requirePerson(req.params.id))));
  api.patch('/people/:id', wrap((req, _res, v) => v.updatePerson(req.params.id, req.body, { createCompany: true })));
  api.post('/people/:id/board', wrap((req, _res, v) => v.movePersonBoard(req.params.id, String(req.body?.boardId ?? ''))));
  api.post('/people/:id/stage/advance', wrap((req, _res, v) => v.advancePersonStage(req.params.id)));
  api.post('/people/:id/stage/move', wrap((req, _res, v) => v.movePersonStage(req.params.id, String(req.body?.stage ?? ''))));
  api.post('/people/:id/stage/ensure', wrap((req, _res, v) => v.ensurePersonStageTodo(req.params.id)));
  api.delete('/people/:id', wrap((req, _res, v) => v.deletePerson(req.params.id)));

  // deals
  api.get('/deals', wrap((req, _res, v) => listDeals(v, parseFilter(req.query as Record<string, unknown>))));
  api.post('/deals', wrap((req, res, v) => { res.status(201); return v.createDeal(req.body, { createCompany: true }); }));
  api.get('/deals/:id', wrap((req, _res, v) => expandDealFull(v, v.requireDeal(req.params.id))));
  api.patch('/deals/:id', wrap((req, _res, v) => v.updateDeal(req.params.id, req.body, { createCompany: true })));
  api.delete('/deals/:id', wrap((req, _res, v) => v.deleteDeal(req.params.id)));
  api.post('/deals/:id/move', wrap((req, _res, v) => v.moveDeal(req.params.id, req.body.stage, req.body.position)));
  api.post('/deals/:id/win', wrap((req, _res, v) => v.closeDeal(req.params.id, 'won', { value: req.body?.value })));
  api.post('/deals/:id/lose', wrap((req, _res, v) => v.closeDeal(req.params.id, 'lost', { reason: req.body?.reason })));
  api.post('/deals/:id/reopen', wrap((req, _res, v) => v.reopenDeal(req.params.id, req.body?.stage)));

  // todos
  api.get('/todos', wrap((req, _res, v) => listTodos(v, parseFilter(req.query as Record<string, unknown>))));
  api.post('/todos', wrap((req, res, v) => { res.status(201); return v.createTodo(req.body); }));
  api.get('/todos/:id', wrap((req, _res, v) => v.requireTodo(req.params.id)));
  api.patch('/todos/:id', wrap((req, _res, v) => v.updateTodo(req.params.id, req.body)));
  api.delete('/todos/:id', wrap((req, _res, v) => v.deleteTodo(req.params.id)));
  api.post('/todos/:id/toggle', wrap((req, _res, v) => {
    const current = v.requireTodo(req.params.id);
    return v.completeTodo(current.id, req.body?.done ?? !current.done);
  }));

  // notes
  api.get('/notes', wrap((req, _res, v) => listNotes(v, parseFilter(req.query as Record<string, unknown>))));
  api.post('/notes', wrap((req, res, v) => { res.status(201); return v.createNote(req.body, { createCompany: true }); }));
  api.get('/notes/:id', wrap((req, _res, v) => v.requireNote(req.params.id)));
  api.patch('/notes/:id', wrap((req, _res, v) => v.updateNote(req.params.id, req.body)));
  api.post('/notes/:id/append', wrap((req, _res, v) => v.appendNote(req.params.id, typeof req.body === 'string' ? req.body : req.body.markdown)));
  api.delete('/notes/:id', wrap((req, _res, v) => v.deleteNote(req.params.id)));

  // export / import
  api.get('/export/:table', wrap((req, res, v) => {
    const table = req.params.table;
    const format = String(req.query.format ?? 'json') as 'csv' | 'json' | 'jsonl';
    if (table === 'all') {
      res.json(exportBundle(v));
      return undefined;
    }
    const payload = exportTable(v, table as ExportTable, format);
    res.type(format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${table}.${format}"`);
    res.send(payload);
    return undefined;
  }));

  api.post('/import/:table', wrap((req, _res, v) => {
    const rows = typeof req.body === 'string' ? parseCsv(req.body) : (req.body.rows ?? req.body);
    return importRows(v, req.params.table as 'companies' | 'people' | 'deals' | 'todos', rows, { actor: 'api' });
  }));

  app.use('/api', api);

  const web = webRoot();
  if (web) {
    app.use(express.static(web));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(web, 'index.html')));
  } else {
    app.get('/', (_req, res) =>
      res
        .status(200)
        .type('html')
        .send('<h1>SendAPigeon</h1><p>The web UI is not built yet. Run <code>npm run build:web</code>.</p><p>The API is live at <a href="/api">/api</a>.</p>'),
    );
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof VaultError ? (err.code === 'NOT_FOUND' ? 404 : 400) : 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ ok: false, error: message, code: err instanceof VaultError ? err.code : 'INTERNAL' });
  });

  return app;
}

export function startServer(opts: ServerOptions): Promise<string> {
  const app = createApp(opts.vault);
  const port = opts.port ?? 4477;
  const host = opts.host ?? '127.0.0.1';
  return new Promise((resolvePromise, reject) => {
    const server = createServer(app);
    server.on('error', reject);
    server.listen(port, host, () => resolvePromise(`http://${host}:${port}`));
  });
}

// `node dist/server/index.js` starts a server directly; importing it does not.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { resolveVault } = await import('../core/config.js');
  const url = await startServer({ vault: resolveVault(), port: Number(process.env.PORT ?? 4477) });
  process.stdout.write(`SendAPigeon serving on ${url}\n`);
}
