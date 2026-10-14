import Fastify from 'fastify';
import { forgetToken, resolveToken, saveToken, setSessionToken } from './credentials.ts';
import { listFolders } from './folders.ts';
import { RepoManager, UserError, type ProgressEvent } from './repos.ts';

const PORT = Number(process.env.PORT ?? 4310);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const repos = new RepoManager();

// The UI runs on its own dev server and calls this API directly, so allow local origins.
// (Vite's dev proxy truncates multi-megabyte responses, so it isn't used.)
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
app.addHook('onRequest', (req, reply, done) => {
  const origin = req.headers.origin;
  if (origin && LOCAL_ORIGIN.test(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    return void reply.status(204).send();
  }
  done();
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof UserError) return reply.status(400).send({ error: err.message });
  app.log.error(err);
  return reply.status(500).send({ error: (err as Error).message });
});

app.get<{ Querystring: { path?: string } }>('/api/folders', async (req) => listFolders(req.query.path));

app.post<{ Body: { source?: string; githubToken?: string; rememberToken?: boolean } }>('/api/repos', async (req) => {
  const token = req.body?.githubToken?.trim();
  let notice: string | undefined;
  if (token) {
    if (!req.body?.rememberToken) setSessionToken(token);
    else if (!saveToken(token)) notice = "Couldn't reach the system credential store; the token will be used until the server restarts";
  }
  const entry = await repos.open(req.body?.source ?? '');
  return { ...entry.summary(), notice };
});

/** Where the GitHub token comes from. The token itself is never sent to the browser. */
app.get('/api/github/token', async () => ({ source: (await resolveToken())?.source ?? null }));

app.delete('/api/github/token', async () => {
  forgetToken();
  return { source: (await resolveToken())?.source ?? null };
});

app.get<{ Params: { id: string } }>('/api/repos/:id', async (req, reply) => {
  const entry = repos.get(req.params.id);
  if (!entry) return reply.status(404).send({ error: 'Unknown repository' });
  return entry.summary();
});

/** Server-sent events for clone progress. Ends once the repo is ready or failed. */
app.get<{ Params: { id: string } }>('/api/repos/:id/progress', (req, reply) => {
  const entry = repos.get(req.params.id);
  if (!entry) return reply.status(404).send({ error: 'Unknown repository' });
  reply.hijack();
  const res = reply.raw;
  // Hijacked replies skip Fastify's header handling, so pass the CORS headers through.
  res.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (ev: ProgressEvent) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (ev.type !== 'progress') cleanup();
  };
  const cleanup = () => {
    entry.off('progress', send);
    res.end();
  };
  if (entry.status === 'ready') return send({ type: 'ready', message: 'Ready', percent: 100 });
  if (entry.status === 'error') return send({ type: 'error', message: entry.error ?? 'Failed' });
  if (entry.lastProgress) res.write(`data: ${JSON.stringify(entry.lastProgress)}\n\n`);
  entry.on('progress', send);
  req.raw.on('close', () => entry.off('progress', send));
});

app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>('/api/repos/:id/timeline', async (req, reply) => {
  const entry = repos.get(req.params.id);
  if (!entry) return reply.status(404).send({ error: 'Unknown repository' });
  const started = Date.now();
  const { timeline, warnings } = await entry.timeline(req.query.refresh === '1');
  req.log.info({ repo: entry.name, branches: timeline.branches.length, ms: Date.now() - started }, 'timeline');
  return { repo: entry.summary(), timeline, warnings };
});

await app.listen({ host: '127.0.0.1', port: PORT });
