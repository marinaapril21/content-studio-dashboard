import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { draftToRecord, draftFromRecord } from "../../../lib/draftRecord";

/**
 * Single read/write API for every tab in the dashboard.
 *
 *   GET    /api/data?tab=performance           → latest stats snapshot
 *   GET    /api/data?tab=strategy              → pillars + voice + campaigns
 *   GET    /api/data?tab=drafts                → all drafts (newest first)
 *   GET    /api/data?tab=intel&handle=foo      → latest snapshot for one handle
 *   GET    /api/data?tab=vault                 → raw scrape feed (posts)
 *   GET    /api/data?tab=settings              → brand / competitors / triggers
 *   GET    /api/data?tab=scrape-meta           → most recent scraped_at
 *
 *   POST   /api/data?tab=drafts                → create draft
 *   PUT    /api/data?tab=settings              → upsert singleton settings
 *   PATCH  /api/data?tab=drafts                → update draft (body: { id, ...fields })
 *   DELETE /api/data?tab=drafts&id=…           → delete draft
 *
 * Schema lives in milestone-5 (Supabase migration). Until the tables exist,
 * every GET returns a sentinel ({ data: null } or { data: [] }) so the
 * frontend renders its empty-state UI cleanly on a fresh deploy.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

function notReady(extra: Record<string, unknown> = {}) {
  // Supabase env not set yet (fresh Vercel deploy, before user pastes creds).
  return NextResponse.json({ data: null, ...extra });
}

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab");
  if (!supabase) return notReady();

  try {
    if (tab === "performance") {
      const { data } = await supabase
        .from("performance")
        .select("*")
        .order("scraped_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return NextResponse.json({ data: null });
      // Schema lag: the table stores `pillar_mix` / `hook_type_mix` as jsonb
      // OBJECTS keyed by label, the UI renders `pillar_breakdown` /
      // `hook_breakdown` as ARRAYS of `{label, share}`. Normalize here so the
      // UI never has to nil-check or shape-check, and so the same row written
      // by either the legacy CLI prompt (object shape) or the in-app ChatGPT Work
      // analysis (array shape, see POST below) renders correctly.
      const toBreakdown = (raw: unknown): Array<{ label: string; share: number }> => {
        if (Array.isArray(raw)) {
          return raw
            .map((r) => {
              if (!r || typeof r !== "object") return null;
              const o = r as Record<string, unknown>;
              const label = typeof o.label === "string" ? o.label.trim() : "";
              const share =
                typeof o.share === "number" && Number.isFinite(o.share)
                  ? Math.max(0, Math.min(1, o.share))
                  : 0;
              if (!label) return null;
              return { label, share };
            })
            .filter((b): b is { label: string; share: number } => b !== null);
        }
        if (raw && typeof raw === "object") {
          const entries = Object.entries(raw as Record<string, unknown>)
            .map(([label, v]) => {
              const n = typeof v === "number" ? v : Number(v);
              return Number.isFinite(n) ? { label, share: Math.max(0, n) } : null;
            })
            .filter((b): b is { label: string; share: number } => b !== null);
          // If shares look like counts (not 0..1 fractions), normalize to
          // shares so the UI's percentage bars render correctly. We detect
          // "counts" by total > 1.5; below that we assume it's already a
          // fraction distribution.
          const total = entries.reduce((s, e) => s + e.share, 0);
          if (total > 1.5 && total > 0) {
            return entries.map((e) => ({ label: e.label, share: e.share / total }));
          }
          return entries;
        }
        return [];
      };
      return NextResponse.json({
        data: {
          ...data,
          pillar_breakdown: toBreakdown(data.pillar_breakdown ?? data.pillar_mix),
          hook_breakdown: toBreakdown(data.hook_breakdown ?? data.hook_type_mix),
          top_posts: Array.isArray(data.top_posts) ? data.top_posts : [],
        },
      });
    }

    if (tab === "strategy") {
      const { data } = await supabase
        .from("strategy")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return NextResponse.json({ data: null });
      // Normalize: the DB stores `voice` as a jsonb object
      // { tone, rules, signature_phrases, forbidden }. The UI also expects
      // top-level `voice_rules` for back-compat with /prompts/2-extract-voice.md
      // output and the config.json fallback. Surface both shapes.
      const voice = (data.voice ?? {}) as {
        tone?: string;
        rules?: string[];
        signature_phrases?: string[];
        forbidden?: string[];
      };
      return NextResponse.json({
        data: {
          ...data,
          // `hooks` is an optional jsonb column. Older installs that haven't
          // run the additive ALTER yet return undefined; surface an empty
          // array so the UI never has to nil-check.
          hooks: Array.isArray(data.hooks) ? data.hooks : [],
          voice_rules: Array.isArray(voice.rules) ? voice.rules : [],
          voice_tone: typeof voice.tone === "string" ? voice.tone : null,
          voice_signature_phrases: Array.isArray(voice.signature_phrases)
            ? voice.signature_phrases
            : [],
          voice_forbidden: Array.isArray(voice.forbidden) ? voice.forbidden : [],
        },
      });
    }

    if (tab === "drafts") {
      const { data } = await supabase
        .from("drafts")
        .select("*")
        .order("created_at", { ascending: false });
      return NextResponse.json({ data: (data ?? []).map(draftFromRecord) });
    }

    if (tab === "intel") {
      const handle = req.nextUrl.searchParams.get("handle");
      if (!handle) return NextResponse.json({ data: null });
      const cleaned = handle.replace(/^@/, "");
      const { data } = await supabase
        .from("competitors")
        .select("*")
        .eq("handle", cleaned)
        .order("scraped_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return NextResponse.json({ data: data ?? null });
    }

    if (tab === "vault") {
      const { data: settings } = await supabase.from('settings')
        .select('instagram_handle').eq('singleton', true).maybeSingle();
      const { data } = await supabase
        .from("library_posts")
        .select("*")
        .order("posted_at", { ascending: false })
        .limit(500);

      const { data: meta } = await supabase
        .from("scrape_log")
        .select("scraped_at")
        .order("scraped_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return NextResponse.json({
        data: {
          posts: (data ?? []).map(({ raw, ...post }) => ({
            ...post,
            source: post.source === 'self' ? 'self' : 'competitor',
            handle: post.source === 'self'
              ? settings?.instagram_handle ?? raw?.ownerUsername ?? ''
              : String(post.source).replace(/^@/, ''),
            type: String(post.type ?? 'image').toLowerCase(),
          })),
          scraped_at: meta?.scraped_at ?? null,
        },
      });
    }

    if (tab === "settings") {
      const { data } = await supabase
        .from("settings")
        .select("*")
        .eq("singleton", true)
        .maybeSingle();
      return NextResponse.json({ data: data ?? null });
    }

    if (tab === "scrape-meta") {
      const { data } = await supabase
        .from("scrape_log")
        .select("scraped_at")
        .order("scraped_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return NextResponse.json({ data: data ?? null });
    }

    return NextResponse.json({ error: "Unknown tab" }, { status: 400 });
  } catch (e) {
    // Tables not yet created (first boot before migration). Treat as empty.
    return NextResponse.json({ data: null, warning: (e as Error).message });
  }
}

export async function POST(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab");
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  if (tab === "intel") {
    const body = await req.json().catch(() => null);
    const reports = body?.competitors;
    if (!Array.isArray(reports) || reports.length < 1 || reports.length > 5 || JSON.stringify(body).length > 100000) {
      return NextResponse.json({ error: "Expected 1 to 5 competitor reports." }, { status: 400 });
    }
    const { data: settings } = await supabase.from("settings").select("competitors").eq("singleton", true).maybeSingle();
    const allowed = new Set((settings?.competitors ?? []).map((h: string) => h.replace(/^@/, "").toLowerCase()));
    const types = new Set(["contrarian", "callout", "promise", "curiosity-gap", "numbered-list", "story-open", "confession", "stat-shock", "question"]);
    const text = (v: unknown, n = 1500) => typeof v === "string" ? v.trim().slice(0, n) : "";
    const list = (v: unknown) => Array.isArray(v) ? v.slice(0, 8).map(x => text(x, 300)).filter(Boolean) : [];
    const rows = [];
    const seen = new Set<string>();
    for (const report of reports) {
      const handle = text(report?.handle, 80).replace(/^@/, "").toLowerCase();
      if (!allowed.has(handle) || seen.has(handle)) return NextResponse.json({ error: "Unknown or repeated handle." }, { status: 400 });
      seen.add(handle);
      const { data: posts, error } = await supabase.from("library_posts").select("id,hook,type,likes,comments,views,url,posted_at,scraped_at").eq("source", `@${handle}`).limit(500);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!posts?.length) return NextResponse.json({ error: `No collected posts for @${handle}.` }, { status: 400 });
      const byId = new Map(posts.map(p => [p.id, p]));
      const top: Array<{ id: string; hook_type: string }> = Array.isArray(report.top_posts) ? report.top_posts.slice(0, 10) : [];
      const hooks: Array<{ id: string; hook_type: string; note?: string }> = Array.isArray(report.trending_hooks) ? report.trending_hooks.slice(0, 5) : [];
      if (!top.length || [...top, ...hooks].some(p => !p || !byId.has(p.id))) return NextResponse.json({ error: "Analysis contains an unknown post ID." }, { status: 400 });
      const a = report.analysis ?? {};
      rows.push({
        handle,
        scraped_at: posts.map(p => p.scraped_at).filter(Boolean).sort().at(-1),
        best_hook_type: types.has(report.best_hook_type) ? report.best_hook_type : null,
        best_format: ["reel", "carousel", "image", "story"].includes(report.best_format) ? report.best_format : null,
        top_posts: top.map(p => { const q = byId.get(p.id)!; return { ...q, type: String(q.type ?? "image").toLowerCase(), timestamp: q.posted_at, hook_type: types.has(p.hook_type) ? p.hook_type : null }; }),
        trending_hooks: hooks.map(p => { const q = byId.get(p.id)!; return { id: q.id, hook: q.hook, hook_type: types.has(p.hook_type) ? p.hook_type : null, engagement: Math.round((q.likes ?? 0) + 4 * (q.comments ?? 0) + 0.05 * (q.views ?? 0)), note: text(p.note), url: q.url }; }),
        trending_formats: posts.reduce((acc: Record<string, number>, p) => { const format = String(p.type ?? "unknown").toLowerCase(); acc[format] = (acc[format] ?? 0) + 1; return acc; }, {}),
        analysis: { sample_size: posts.length, best_hook_types: list(a.best_hook_types).filter(t => types.has(t)), recurring_topics: list(a.recurring_topics), format_notes: text(a.format_notes), replicable: text(a.replicable), limitations: text(a.limitations) },
      });
    }
    const { data, error } = await supabase.from("competitors").insert(rows).select("handle");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (tab === "drafts") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body.caption) {
      return NextResponse.json({ error: "Missing caption" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("drafts")
      .insert([{ ...draftToRecord(body), status: body.status ?? "draft" }])
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (tab === "performance") {
    // In-app ChatGPT Work analysis path. The customer clicks "Run analysis with
    // ChatGPT Work" on the Performance tab → copies a fat prompt seeded with their
    // vault posts + strategy → pastes ChatGPT Work's JSON reply into the Paste
    // widget → the editor POSTs that JSON here. We insert a NEW row (vs
    // upsert) so the Performance table keeps a history ChatGPT Work or future
    // chart code can trend across.
    //
    // Performance was deliberately excluded from WRITABLE_TABS at the bottom
    // of this file (those are mutate-by-id PATCH/DELETE paths exposed to
    // the customer). This POST is a separate, narrow write that only accepts
    // the analysis-snapshot shape and lands in a single column-shape we
    // control. No id, no PATCH, no DELETE — just append.
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const toBreakdownArray = (
      raw: unknown
    ): Array<{ label: string; share: number }> => {
      if (!Array.isArray(raw)) return [];
      return raw
        .map((r) => {
          if (!r || typeof r !== "object") return null;
          const o = r as Record<string, unknown>;
          const label = typeof o.label === "string" ? o.label.trim() : "";
          const share =
            typeof o.share === "number" && Number.isFinite(o.share)
              ? Math.max(0, Math.min(1, o.share))
              : 0;
          if (!label) return null;
          return { label, share };
        })
        .filter((b): b is { label: string; share: number } => b !== null);
    };
    const pillarBreakdown = toBreakdownArray(body.pillar_breakdown);
    const hookBreakdown = toBreakdownArray(body.hook_breakdown);
    // Also write the legacy *_mix object shape so any downstream code that
    // reads it directly still works. Same data, two surfaces.
    const toMixObject = (
      arr: Array<{ label: string; share: number }>
    ): Record<string, number> => {
      const o: Record<string, number> = {};
      for (const b of arr) o[b.label] = b.share;
      return o;
    };
    // Whitelist + cap each top_post so a tampered ChatGPT Work reply (or a curious
    // customer poking the network tab) cannot land megabytes of arbitrary
    // jsonb into the table via the service-role write path. Each field has
    // a fixed type + a length cap, and any unknown key is dropped on the
    // floor. Cap at 20 posts; the UI only renders 10 anyway.
    const cap = (s: string, n: number) =>
      typeof s === "string" ? s.slice(0, n) : "";
    type SafeTopPost = {
      id: string;
      caption_preview: string;
      hook: string;
      hook_type?: string;
      pillar?: string;
      type: "carousel" | "reel" | "image" | "story";
      likes: number | null;
      comments: number | null;
      views?: number | null;
      url?: string;
      posted_at?: string;
    };
    const sanitizeTopPosts = (raw: unknown): SafeTopPost[] => {
      if (!Array.isArray(raw)) return [];
      return raw
        .slice(0, 20)
        .map((p): SafeTopPost | null => {
          if (!p || typeof p !== "object") return null;
          const o = p as Record<string, unknown>;
          const id = typeof o.id === "string" ? cap(o.id, 80) : "";
          if (!id) return null;
          const t = typeof o.type === "string" ? o.type : "image";
          const type: SafeTopPost["type"] =
            t === "carousel" || t === "reel" || t === "story" ? t : "image";
          const num = (v: unknown): number | null => {
            if (v === null || v === undefined || v === "") return null;
            const n = typeof v === "number" ? v : Number(v);
            return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
          };
          return {
            id,
            caption_preview: cap(
              typeof o.caption_preview === "string" ? o.caption_preview : "",
              280
            ),
            hook: cap(typeof o.hook === "string" ? o.hook : "", 280),
            hook_type:
              typeof o.hook_type === "string"
                ? cap(o.hook_type, 40)
                : undefined,
            pillar:
              typeof o.pillar === "string" ? cap(o.pillar, 80) : undefined,
            type,
            likes: num(o.likes),
            comments: num(o.comments),
            views:
              o.views !== undefined && o.views !== null
                ? num(o.views)
                : undefined,
            url:
              typeof o.url === "string" && o.url.startsWith("http")
                ? cap(o.url, 500)
                : undefined,
            posted_at:
              typeof o.posted_at === "string"
                ? cap(o.posted_at, 40)
                : undefined,
          };
        })
        .filter((p): p is SafeTopPost => p !== null);
    };

    const insertRow: Record<string, unknown> = {
      followers:
        typeof body.followers === "number" && Number.isFinite(body.followers)
          ? Math.max(0, Math.round(body.followers))
          : null,
      avg_likes:
        typeof body.avg_likes === "number" && Number.isFinite(body.avg_likes)
          ? Math.max(0, Math.round(body.avg_likes))
          : null,
      best_pillar:
        typeof body.best_pillar === "string" && body.best_pillar.trim().length > 0
          ? cap(body.best_pillar.trim(), 80)
          : null,
      best_hook_type:
        typeof body.best_hook_type === "string" &&
        body.best_hook_type.trim().length > 0
          ? cap(body.best_hook_type.trim(), 40)
          : null,
      top_posts: sanitizeTopPosts(body.top_posts),
      pillar_mix: toMixObject(pillarBreakdown),
      hook_type_mix: toMixObject(hookBreakdown),
    };

    // Carry the original vault scrape timestamp through if ChatGPT Work echoed it
    // back. Without this, the row's `scraped_at` defaults to NOW() and the
    // UI reads "Last scraped: just now" even though the underlying posts
    // came from a scrape that ran days ago. Validate as an ISO date string;
    // if anything off, leave it to the DB default.
    if (
      typeof body.scraped_at === "string" &&
      body.scraped_at.length > 0 &&
      body.scraped_at.length < 40
    ) {
      const t = Date.parse(body.scraped_at);
      if (Number.isFinite(t) && t > 0 && t < Date.now() + 86_400_000) {
        insertRow.scraped_at = new Date(t).toISOString();
      }
    }
    const { data, error } = await supabase
      .from("performance")
      .insert([insertRow])
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (tab === "strategy") {
    // Initial strategy row. Used by the UI when the table is empty (first time
    // the user opens the Edit form on a fresh deploy). Subsequent edits go
    // through PATCH so we keep a single rolling row instead of one per save.
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const isPlainObject = (v: unknown): v is Record<string, unknown> =>
      v !== null && typeof v === "object" && !Array.isArray(v);
    const { data, error } = await supabase
      .from("strategy")
      .insert([
        {
          pillars: Array.isArray(body.pillars) ? body.pillars : [],
          voice: isPlainObject(body.voice) ? body.voice : {},
          campaigns: Array.isArray(body.campaigns) ? body.campaigns : [],
          hooks: Array.isArray(body.hooks) ? body.hooks : [],
          ica_notes: typeof body.ica_notes === "string" ? body.ica_notes : null,
        },
      ])
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  return NextResponse.json({ error: "POST not supported for this tab" }, { status: 405 });
}

// Whitelist of tabs that may be mutated through PATCH/DELETE. Read-only
// tabs (performance, vault, competitors, scrape_log) are written exclusively
// by the Apify Edge Function, never by the dashboard. Without this whitelist
// the `tab` query param would let a caller target any table via the service
// role key.
const WRITABLE_TABS = ["drafts", "strategy"] as const;
type WritableTab = (typeof WRITABLE_TABS)[number];
const isWritableTab = (t: string | null): t is WritableTab =>
  t !== null && (WRITABLE_TABS as readonly string[]).includes(t);

export async function PUT(req: NextRequest) {
  // Singleton upsert for settings. Customer Settings tab calls this on every
  // Save. We keep a single row identified by `singleton = true` (DB unique
  // constraint enforces this). First save inserts; subsequent saves update.
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const tab = req.nextUrl.searchParams.get("tab");
  if (tab !== "settings") {
    return NextResponse.json({ error: "PUT only supported for tab=settings" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Normalize/whitelist the fields we accept so a stray field cannot land in
  // the table. trigger_words must be an array of plain objects shaped like
  // { word, offer, topic, promise } — we shape-check each entry here so the
  // UI cannot accidentally send a string array (which is the OLD config.json
  // shape pre-triplet) and break the schema downstream.
  type TriggerTriplet = { word: string; offer: string; topic: string; promise: string };
  const normalizeTriggers = (raw: unknown): TriggerTriplet[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((t) => {
        if (typeof t === "string") {
          // Pre-triplet legacy shape — fill blanks so the row is still valid.
          return { word: t, offer: "", topic: "", promise: "" };
        }
        if (t && typeof t === "object") {
          const o = t as Record<string, unknown>;
          return {
            word: typeof o.word === "string" ? o.word : "",
            offer: typeof o.offer === "string" ? o.offer : "",
            topic: typeof o.topic === "string" ? o.topic : "",
            promise: typeof o.promise === "string" ? o.promise : "",
          };
        }
        return null;
      })
      .filter((t): t is TriggerTriplet => t !== null && t.word.trim().length > 0);
  };

  const competitors = Array.isArray(body.competitors)
    ? (body.competitors as unknown[])
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.replace(/^@/, "").trim())
        .slice(0, 5)
    : [];

  const payload = {
    singleton: true,
    // Trim before persist so a customer who fat-fingers a trailing space in
    // the Brand form doesn't see "REVENU " everywhere in the dashboard. An
    // empty string after trim collapses to null so the column is
    // unambiguously "not set" rather than "set to whitespace".
    brand_name:
      typeof body.brand_name === "string" ? body.brand_name.trim() || null : null,
    instagram_handle:
      typeof body.instagram_handle === "string"
        ? body.instagram_handle.replace(/^@/, "").trim() || null
        : null,
    competitors,
    trigger_words: normalizeTriggers(body.trigger_words),
  };

  const { data, error } = await supabase
    .from("settings")
    .upsert(payload, { onConflict: "singleton" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { id?: string } & Record<string, unknown>;
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const tab = req.nextUrl.searchParams.get("tab") ?? "drafts";
  if (!isWritableTab(tab)) {
    return NextResponse.json({ error: "Tab not writable" }, { status: 400 });
  }
  const table: WritableTab = tab;

  // The drafts table has a touch_updated_at trigger; strategy does not.
  // Bump it here so the UI's "last edited" hint stays accurate.
  if (table === "strategy") {
    updates.updated_at = new Date().toISOString();
  }

  if (table === "drafts" && updates.hook !== undefined && updates.caption === undefined) {
    return NextResponse.json({ error: "Include caption when editing the hook" }, { status: 400 });
  }
  const record = table === "drafts" ? draftToRecord(updates) : updates;
  if (table === "drafts" && record.caption !== undefined && !String(record.caption).trim()) {
    return NextResponse.json({ error: "Caption cannot be empty" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from(table)
    .update(record)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const tab = req.nextUrl.searchParams.get("tab") ?? "drafts";
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (!isWritableTab(tab)) {
    return NextResponse.json({ error: "Tab not writable" }, { status: 400 });
  }
  const table: WritableTab = tab;

  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
