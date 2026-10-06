import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.FUNCTION_SECRET;
  if (!url || !key || !secret)
    return NextResponse.json({ ok: false, errors: ['Scraper connection is not configured.'] }, { status: 503 });
  try {
    const body = await req.json();
    const res = await fetch(`${url}/functions/v1/content-scraper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`, 'x-function-secret': secret },
      body: JSON.stringify({ mode: body.mode ?? 'all', jobId: body.jobId }),
      signal: AbortSignal.timeout(50000), cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ ok: false, errors: ['Could not reach the scraper. Try again to resume the existing run.'] }, { status: 502 });
  }
}
