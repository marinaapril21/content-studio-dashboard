// Keep JWT verification ON. The protected Next.js server supplies both keys.
// APIFY_TOKEN and FUNCTION_SECRET belong in Supabase Edge Function secrets.
const env = (name: string) => Deno.env.get(name) ?? '';
const reply = (body: unknown, status = 200) => Response.json(body, { status });
type Handle = { handle: string; source: string };
type Job = { id: string; status: string; created_at: string; cutoff: string;
  handles: Handle[]; mode: string; run_id: string | null; imported: number; error: string | null };
async function db(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method, headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Database request failed (${res.status}).`);
  return res.status === 204 ? null : res.json();
}
async function apify(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://api.apify.com/v2/${path}`, {
    method, headers: { Authorization: `Bearer ${env('APIFY_TOKEN')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Apify request failed (${res.status}). Check token permissions and account credit.`);
  return res.json();
}
const cleanHandle = (x: unknown) => typeof x === 'string' ? x.replace(/^@/, '').trim().toLowerCase() : '';
const metric = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : null;
export function normalizePosts(items: Record<string, unknown>[], job: Pick<Job, 'handles' | 'cutoff'>) {
  const rows = new Map<string, Record<string, unknown>>();
  for (const p of items) {
    if (p.error) throw new Error('Apify returned an Instagram access error. Check the run in Apify.');
    const input = typeof p.inputUrl === 'string' ? p.inputUrl.match(/instagram\.com\/([^/?#]+)/)?.[1] : '';
    const account = job.handles.find(h => h.handle === cleanHandle(input)) ?? job.handles.find(h => h.handle === cleanHandle(p.ownerUsername));
    const timestamp = typeof p.timestamp === 'string' ? Date.parse(p.timestamp) : NaN;
    if (!account || !Number.isFinite(timestamp) || timestamp < Date.parse(job.cutoff)) continue;
    const code = typeof p.shortCode === 'string' && /^[A-Za-z0-9_-]+$/.test(p.shortCode) ? p.shortCode : null;
    if (!code) continue;
    const url = `https://www.instagram.com/p/${code}/`;
    const caption = typeof p.caption === 'string' ? p.caption : '';
    rows.set(url, { source: account.source, type: p.type === 'Sidecar' ? 'Carousel' : p.type === 'Video' ? 'Reel' : 'Image',
      posted_at: new Date(timestamp).toISOString(), caption, hook: caption.split('\n').find(s => s.trim()) ?? '',
      likes: metric(p.likesCount), comments: metric(p.commentsCount), views: metric(p.videoViewCount ?? p.videoPlayCount), url, raw: p });
  }
  return [...rows.values()];
}
async function poll(job: Job) {
  if (job.status === 'success') return reply({ ok: true, status: 'success', count: job.imported });
  if (job.status === 'error') return reply({ ok: false, errors: [job.error ?? 'Scrape failed.'] }, 400);
  if (!job.run_id) {
    // Never retry an ambiguous start, which could charge twice.
    if (Date.now() - Date.parse(job.created_at) > 60000)
      return reply({ ok: false, errors: ['Start was interrupted. Check Apify Runs before starting another scrape.'] }, 409);
    return reply({ ok: true, status: 'running', jobId: job.id });
  }
  const { data: run } = await apify(`actor-runs/${encodeURIComponent(job.run_id)}`);
  if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    const error = `Apify run ended with ${run.status}.`;
    await db(`scrape_jobs?id=eq.${job.id}`, 'PATCH', { status: 'error', error });
    await db('scrape_log', 'POST', { mode: job.mode, status: 'error', notes: error });
    return reply({ ok: false, errors: [error] }, 400);
  }
  if (run.status !== 'SUCCEEDED') return reply({ ok: true, status: 'running', jobId: job.id });
  const items = await apify(`datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&limit=2000`);
  let rows;
  try {
    rows = normalizePosts(items, job);
    if (!rows.length) throw new Error('No usable public posts found in the last 90 days. Check the profile and Apify results.');
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Invalid Apify results.';
    await db(`scrape_jobs?id=eq.${job.id}`, 'PATCH', { status: 'error', error });
    return reply({ ok: false, errors: [error] }, 400);
  }
  const count = await db('rpc/finish_scrape', 'POST', { job_id: job.id, posts: rows });
  return reply({ ok: true, status: 'success', count });
}
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply({ ok: false, errors: ['Method not allowed.'] }, 405);
  if (!env('FUNCTION_SECRET') || req.headers.get('x-function-secret') !== env('FUNCTION_SECRET') ||
      req.headers.get('authorization') !== `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`)
    return reply({ ok: false, errors: ['Unauthorized.'] }, 401);
  if (!env('APIFY_TOKEN')) return reply({ ok: false, errors: ['Add APIFY_TOKEN in Supabase Edge Function secrets.'] }, 503);
  try {
    const body = await req.json();
    if (body.jobId) {
      if (typeof body.jobId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.jobId)) return reply({ ok: false }, 400);
      const jobs = await db(`scrape_jobs?id=eq.${body.jobId}`);
      return jobs[0] ? await poll(jobs[0]) : reply({ ok: false, errors: ['Unknown job.'] }, 404);
    }
    const active = await db('scrape_jobs?status=in.(starting,running)&limit=1');
    if (active[0]) return await poll(active[0]);
    const mode = body.mode ?? 'all';
    if (!['all', 'self', 'competitors'].includes(mode)) return reply({ ok: false }, 400);
    const settings = (await db('settings?singleton=eq.true&limit=1'))[0];
    const own = cleanHandle(settings?.instagram_handle);
    const handles: Handle[] = [];
    if (mode !== 'competitors' && own) handles.push({ handle: own, source: 'self' });
    if (mode !== 'self') for (const c of (settings?.competitors ?? []).slice(0, 5)) {
      const handle = cleanHandle(c);
      if (handle && !handles.some(h => h.handle === handle)) handles.push({ handle, source: `@${handle}` });
    }
    if (!handles.length || handles.some(h => !/^[a-z0-9._]{1,30}$/.test(h.handle)))
      return reply({ ok: false, errors: ['Save valid Instagram handles in Settings first.'] }, 400);
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    let job: Job;
    try { job = (await db('scrape_jobs', 'POST', { mode, handles, cutoff }))[0]; }
    catch (e) {
      const concurrent = await db('scrape_jobs?status=in.(starting,running)&limit=1');
      if (concurrent[0]) return await poll(concurrent[0]);
      throw e;
    }
    const { data: run } = await apify('acts/apify~instagram-scraper/runs?timeout=300&maxTotalChargeUsd=1', 'POST', {
      directUrls: handles.map(h => `https://www.instagram.com/${h.handle}/`),
      resultsType: 'posts', resultsLimit: 300, onlyPostsNewerThan: cutoff, addParentData: false,
    });
    await db(`scrape_jobs?id=eq.${job.id}`, 'PATCH', { run_id: run.id, status: 'running' });
    return reply({ ok: true, status: 'running', jobId: job.id });
  } catch (e) {
    return reply({ ok: false, errors: [e instanceof Error ? e.message : 'Scrape failed.'] }, 500);
  }
});
