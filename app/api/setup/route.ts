import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Setup gate.
 *
 *   GET /api/setup → {
 *     ready: boolean,                  // true once every required table exists
 *     missingTables: string[],         // tables that need to be created
 *     supabaseConfigured: boolean,     // env vars present?
 *     sql: string,                     // the migration SQL (inline, ready to paste)
 *     supabaseSqlEditorUrl: string|null,  // deep link to the user's SQL editor
 *   }
 *
 * Why this exists: ChatGPT Work users have no terminal and no
 * Supabase CLI. The dashboard greets them with empty data on a fresh deploy,
 * and they need a *one-click* path to a populated DB. PostgREST does not allow
 * arbitrary DDL, so true zero-config auto-migrate is impossible without the
 * Supabase Management API token. The compromise:
 *
 *   1. We detect missing tables here.
 *   2. We hand back the full migration SQL inline + a deep link to the user's
 *      Supabase SQL editor (`/project/<ref>/sql/new`).
 *   3. The frontend renders a "Run setup" banner → user clicks → SQL editor
 *      opens → paste → Run → done.
 *
 * Two clicks instead of "find the file in your GitHub fork, open it, copy
 * everything, find the SQL editor, paste, run". Same security model.
 *
 * Security note (reviewed, accepted risk):
 *   - The returned `sql` is the same static migration file checked into the
 *     public GitHub repo — it is not a secret.
 *   - The returned `supabaseSqlEditorUrl` embeds the project ref, which is
 *     already shipped to every visitor in `NEXT_PUBLIC_SUPABASE_URL`.
 *   - The endpoint is read-only and never accepts user input — no DDL, no
 *     mutation, no echo of body params.
 *   - The Supabase service role key stays server-side; only table presence
 *     and the static SQL leave the server.
 *   Therefore this endpoint is intentionally unauthenticated, matching the
 *   public nature of the surfaced data. If a future revision adds anything
 *   sensitive (logs, row counts, env values) it must gain a shared-secret
 *   gate before merge.
 */

const REQUIRED_TABLES = [
  "performance",
  "strategy",
  "drafts",
  "competitors",
  "library_posts",
  "scrape_log",
] as const;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Pull the project ref out of e.g. https://abcdefghij.supabase.co
function deriveProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host;
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function loadMigrationSql(): Promise<string> {
  const p = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "0001_initial_schema.sql"
  );
  try {
    return await readFile(p, "utf-8");
  } catch {
    return "";
  }
}

export async function GET() {
  const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
  const sql = await loadMigrationSql();
  const projectRef = deriveProjectRef(SUPABASE_URL);
  const supabaseSqlEditorUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
    : null;

  if (!supabaseConfigured) {
    return NextResponse.json({
      ready: false,
      supabaseConfigured: false,
      missingTables: [...REQUIRED_TABLES],
      sql,
      supabaseSqlEditorUrl,
      reason:
        "Supabase env vars not set. Paste NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY into your Vercel project settings, then redeploy.",
    });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Probe each required table with a HEAD-style count. If the table is
  // missing, PostgREST returns a PGRST205 / 42P01 error which we treat as
  // "table absent". Any other error (auth, network) bubbles up as an
  // unknown state so the UI can show a generic message instead of nudging
  // the user toward re-running the migration.
  const probes = await Promise.all(
    REQUIRED_TABLES.map(async (t) => {
      const { error } = await supabase
        .from(t)
        .select("*", { count: "exact", head: true });
      if (!error) return { table: t, exists: true as const };
      const code = (error as { code?: string }).code ?? "";
      const message = (error.message ?? "").toLowerCase();
      const missing =
        code === "42P01" ||
        code === "PGRST205" ||
        message.includes("does not exist") ||
        message.includes("relation") ||
        message.includes("not found");
      return { table: t, exists: !missing, errorCode: code, errorMessage: error.message };
    })
  );

  const missingTables = probes.filter((p) => !p.exists).map((p) => p.table);
  const ready = missingTables.length === 0;

  return NextResponse.json({
    ready,
    supabaseConfigured: true,
    missingTables,
    sql,
    supabaseSqlEditorUrl,
  });
}
