import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/content-scraper/index.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(fetcher = () => { throw Error('Unexpected network'); }, secrets = {}) {
  let handler;
  const context = { exports: {}, Response, Request, AbortSignal, fetch: fetcher,
    Deno: { env: { get: key => secrets[key] }, serve: fn => { handler = fn; } } };
  vm.runInNewContext(js, context);
  return { normalize: context.exports.normalizePosts, handler };
}
const job = { handles: [{ handle: 'marina.lukez', source: 'self' }], cutoff: '2026-07-08T00:00:00Z' };
const post = { shortCode: 'ABC123', ownerUsername: 'marina.lukez', timestamp: '2026-10-01T10:00:00Z', caption: 'Prvi red\nTekst', type: 'Video', likesCount: 11, commentsCount: 3 };
test('normalization filters pinned old posts, foreign accounts and invalid dates; deduplicates', () => {
  const { normalize } = load();
  const rows = normalize([post, post, { ...post, shortCode: 'old', timestamp: '2020-01-01' },
    { ...post, shortCode: 'other', ownerUsername: 'other' }, { ...post, timestamp: 'invalid' }], job);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'Reel');
  assert.equal(rows[0].hook, 'Prvi red');
  assert.equal(rows[0].source, 'self');
  assert.equal(rows[0].views, null);
});
test('hidden metrics stay unknown; collaborative posts use the requested profile', () => {
  const rows = load().normalize([{ ...post, ownerUsername: 'coauthor', inputUrl: 'https://www.instagram.com/marina.lukez/', likesCount: -1, type: 'Sidecar' }], job);
  assert.equal(rows[0].likes, null);
  assert.equal(rows[0].type, 'Carousel');
  assert.throws(() => load().normalize([{ error: 'private' }], job), /access error/);
});
test('unauthorized callers cannot start a billable run', async () => {
  const { handler } = load(undefined, { FUNCTION_SECRET: 'test-only', SUPABASE_SERVICE_ROLE_KEY: 'test-key' });
  const res = await handler(new Request('https://example.test', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 401);
});
test('active job is resumed without starting another actor', async () => {
  const calls = [];
  const { handler } = load(async (url, options) => {
    calls.push([url, options.method]);
    if (url.includes('rest/v1/scrape_jobs?')) return Response.json([{ ...job, id: 'job1', status: 'running', run_id: 'run1' }]);
    if (url.endsWith('actor-runs/run1')) return Response.json({ data: { status: 'RUNNING' } });
    throw Error('Unexpected request');
  }, { FUNCTION_SECRET: 'test-only', SUPABASE_SERVICE_ROLE_KEY: 'test-key', APIFY_TOKEN: 'test-token', SUPABASE_URL: 'https://example.test' });
  const res = await handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test-key', 'x-function-secret': 'test-only' }, body: '{}' }));
  assert.equal((await res.json()).jobId, 'job1');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([, method]) => method === 'GET'));
});
