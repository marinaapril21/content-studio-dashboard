"use client";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import config from "../../../config.json";
import TabContainer from "../shared/TabContainer";
import TabHeader from "../shared/TabHeader";
import EmptyState from "../shared/EmptyState";
import PasteFromClaude, { stripCodeFences } from "../shared/PasteFromClaude";
import { buildPerformanceAnalysisPrompt } from "../../../lib/promptBuilders";

type TopPost = {
  id: string;
  caption_preview: string;
  hook: string;
  hook_type?: string;
  pillar?: string;
  type: "carousel" | "reel" | "image" | "story";
  likes: number;
  comments: number;
  views?: number;
  url?: string;
  posted_at?: string;
};

type Breakdown = { label: string; share: number }; // share 0..1

type PerformanceData = {
  followers: number | null;
  avg_likes: number | null;
  best_pillar: string | null;
  best_hook_type: string | null;
  top_posts: TopPost[];
  pillar_breakdown: Breakdown[];
  hook_breakdown: Breakdown[];
  scraped_at?: string | null;
};

/**
 * Performance tab.
 *
 * What lives here:
 *  - Headline stats (followers, average likes, best pillar, best hook)
 *  - Top performing posts (sorted by engagement)
 *  - Pillar and hook breakdown bars
 *
 * Populated by the analyse-winners ChatGPT Work prompt after a scrape (the user
 * clicks the in-app button which copies a self-contained prompt + opens
 * ChatGPT Work, then pastes the JSON reply back into a Paste field).
 */
export default function Performance() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/data?tab=performance")
      .then((r) => r.json())
      .then((r) => {
        setData(r.data ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, []);

  /**
   * Persist a fresh analysis snapshot. POSTs to /api/data?tab=performance
   * which inserts a new row (history is preserved). On success we refetch so
   * the UI shows the row just written, not the previous one.
   */
  const applyPerformance = async (value: PerformanceData) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/data?tab=performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      load();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const hasPosts = (data?.top_posts ?? []).length > 0;

  const stats: Array<{ label: string; value: string; sub?: string }> = [
    {
      label: "Followers",
      value: data?.followers != null ? data.followers.toLocaleString() : "—",
      sub: config.instagramHandle ? `@${config.instagramHandle}` : undefined,
    },
    {
      label: "Avg likes",
      value: data?.avg_likes != null ? data.avg_likes.toLocaleString() : "—",
      sub: "last 30 posts",
    },
    {
      label: "Best pillar",
      value: data?.best_pillar ?? "—",
    },
    {
      label: "Best hook",
      value: data?.best_hook_type ?? "—",
    },
  ];

  return (
    <TabContainer>
      <TabHeader
        title="Performance"
        subtitle="What's actually working. Top posts, hooks, and pillars sorted by engagement."
        scrapedAt={data?.scraped_at}
        onScrapeComplete={load}
      />

      {loading && (
        <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: "100px" }} />
          ))}
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          style={{
            background: "var(--color-cream)",
            border: "1px solid var(--color-burgundy)",
            color: "var(--color-burgundy)",
            padding: "0.6rem 0.9rem",
            borderRadius: "8px",
            fontSize: "0.82rem",
            marginBottom: "1rem",
          }}
        >
          Could not save the analysis: {saveError}
        </div>
      )}

      {saving && (
        <div
          style={{
            background: "var(--color-cream)",
            color: "var(--color-text)",
            padding: "0.55rem 0.9rem",
            borderRadius: "8px",
            fontSize: "0.78rem",
            marginBottom: "1rem",
          }}
        >
          Saving analysis…
        </div>
      )}

      {/* "Re-run analysis" Paste widget. Shown whenever a scrape exists so the
          customer can refresh the snapshot after a new scrape without leaving
          the tab. On a fresh install (no posts) the EmptyState below carries
          its own ChatGPT Work button + prompt preview, so this widget hides itself
          to avoid a confusing double-up. */}
      {!loading && hasPosts && (
        <div style={{ marginBottom: "1.4rem" }}>
          <PasteFromClaude<PerformanceData>
            label="Re-run analysis with ChatGPT Work"
            parse={parsePerformanceReply}
            onApply={applyPerformance}
            render={renderPerformancePreview}
          />
        </div>
      )}

      {!loading && !hasPosts && (
        <EmptyState
          title="No performance data yet"
          body="After your first scrape, ChatGPT Work surfaces your top posts, best hooks and strongest pillar here. Trigger a scrape with the button above, then click the button below to copy the analysis prompt and run it in ChatGPT Work. Paste the JSON reply back and your Performance tab fills in."
          claudePrompt={buildPerformanceAnalysisPrompt}
          claudeButtonLabel="Copy analysis prompt"
        />
      )}

      {/* Below the EmptyState (no posts yet), give the customer the exact
          Paste field they will need once ChatGPT Work replies. Sitting under the
          EmptyState means the read-prompt → copy-prompt → paste-reply flow
          is one vertical scroll, no tab-switching. */}
      {!loading && !hasPosts && (
        <div style={{ marginTop: "1.4rem", maxWidth: "640px", margin: "1.4rem auto 0" }}>
          <PasteFromClaude<PerformanceData>
            label="Paste ChatGPT Work's analysis reply"
            parse={parsePerformanceReply}
            onApply={applyPerformance}
            render={renderPerformancePreview}
          />
        </div>
      )}

      {!loading && hasPosts && (
        <>
          {/* Stat cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "1rem",
              marginBottom: "2rem",
            }}
          >
            {stats.map((s) => (
              <div
                key={s.label}
                style={{
                  background: "#fff",
                  border: "1px solid var(--color-border)",
                  borderRadius: "12px",
                  padding: "1.1rem 1.25rem",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <p
                  style={{
                    fontSize: "0.62rem",
                    color: "var(--color-text-dim)",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    marginBottom: "0.4rem",
                    fontWeight: 700,
                  }}
                >
                  {s.label}
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-header)",
                    fontSize: "1.5rem",
                    color: s.value === "—" ? "var(--color-taupe)" : "var(--color-text)",
                    lineHeight: 1.1,
                  }}
                >
                  {s.value}
                </p>
                {s.sub && (
                  <p style={{ fontSize: "0.72rem", color: "var(--color-text-dim)", marginTop: "0.3rem" }}>{s.sub}</p>
                )}
              </div>
            ))}
          </div>

          {/* Top posts table */}
          <h2 style={{ fontFamily: "var(--font-header)", fontSize: "1.2rem", marginBottom: "0.85rem" }}>
            Top performing posts
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", marginBottom: "2.25rem" }}>
            {data!.top_posts.slice(0, 10).map((p) => (
              <div
                key={p.id}
                style={{
                  background: "#fff",
                  border: "1px solid var(--color-border)",
                  borderRadius: "10px",
                  padding: "0.85rem 1.15rem",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.35rem", flexWrap: "wrap" }}>
                  <Pill>{p.type}</Pill>
                  {p.pillar && <Pill tone="cream">{p.pillar}</Pill>}
                  {p.hook_type && <Pill tone="cream">{p.hook_type}</Pill>}
                </div>
                <p style={{ fontSize: "0.88rem", marginBottom: "0.3rem", lineHeight: 1.45 }}>
                  {p.hook || p.caption_preview}
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.74rem",
                    color: "var(--color-text-dim)",
                  }}
                >
                  <span>
                    {p.likes.toLocaleString()} likes
                    {p.views ? ` · ${p.views.toLocaleString()} views` : ""} · {p.comments} comments
                  </span>
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--color-burgundy)", display: "inline-flex", alignItems: "center", gap: "0.3rem", textDecoration: "none" }}
                    >
                      Open <ExternalLink size={11} strokeWidth={2} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Breakdown bars */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
            <BreakdownCard title="By pillar" rows={data!.pillar_breakdown} />
            <BreakdownCard title="By hook type" rows={data!.hook_breakdown} />
          </div>
        </>
      )}
    </TabContainer>
  );
}

/**
 * Parse ChatGPT Work's analysis reply. The fat prompt
 * (`buildPerformanceAnalysisPrompt`) asks for a single JSON object matching
 * PerformanceData. Common gotchas this parser absorbs:
 *
 *   - ChatGPT Work wraps the JSON in ```json``` fences ~80% of the time. stripCodeFences handles that.
 *   - ChatGPT Work returns numeric strings ("1240") for likes/comments. We coerce.
 *   - ChatGPT Work returns `null` instead of omitting `followers`. We tolerate both.
 *   - ChatGPT Work sometimes returns the breakdowns as an object `{ "Pillar": 0.4 }`
 *     instead of the requested array. We convert.
 */
function parsePerformanceReply(
  raw: string
): { ok: true; value: PerformanceData } | { ok: false; error: string } {
  try {
    const body = stripCodeFences(raw);
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: "Expected a JSON object with avg_likes, top_posts, pillar_breakdown, hook_breakdown.",
      };
    }
    const r = parsed as Record<string, unknown>;

    const toNum = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const toBreakdown = (raw: unknown): Breakdown[] => {
      if (Array.isArray(raw)) {
        return raw
          .map((b) => {
            if (!b || typeof b !== "object") return null;
            const o = b as Record<string, unknown>;
            const label = typeof o.label === "string" ? o.label.trim() : "";
            const share = toNum(o.share) ?? 0;
            if (!label) return null;
            return { label, share: Math.max(0, Math.min(1, share)) };
          })
          .filter((b): b is Breakdown => b !== null);
      }
      if (raw && typeof raw === "object") {
        const entries = Object.entries(raw as Record<string, unknown>)
          .map(([label, v]) => {
            const n = toNum(v);
            return n !== null ? { label, share: Math.max(0, n) } : null;
          })
          .filter((b): b is Breakdown => b !== null);
        const total = entries.reduce((s, e) => s + e.share, 0);
        if (total > 1.5 && total > 0) {
          return entries.map((e) => ({ label: e.label, share: e.share / total }));
        }
        return entries;
      }
      return [];
    };

    const top_posts: TopPost[] = Array.isArray(r.top_posts)
      ? r.top_posts
          .map((p): TopPost | null => {
            if (!p || typeof p !== "object") return null;
            const o = p as Record<string, unknown>;
            const id = typeof o.id === "string" ? o.id : "";
            if (!id) return null;
            const likes = toNum(o.likes) ?? 0;
            const comments = toNum(o.comments) ?? 0;
            const views = toNum(o.views);
            const type = typeof o.type === "string" ? o.type : "image";
            const validType: TopPost["type"] =
              type === "carousel" || type === "reel" || type === "story"
                ? type
                : "image";
            return {
              id,
              caption_preview:
                typeof o.caption_preview === "string"
                  ? o.caption_preview
                  : typeof o.caption === "string"
                    ? (o.caption as string).slice(0, 110)
                    : "",
              hook: typeof o.hook === "string" ? o.hook : "",
              hook_type: typeof o.hook_type === "string" ? o.hook_type : undefined,
              pillar: typeof o.pillar === "string" ? o.pillar : undefined,
              type: validType,
              likes: Math.max(0, Math.round(likes)),
              comments: Math.max(0, Math.round(comments)),
              views: views !== null ? Math.max(0, Math.round(views)) : undefined,
              url: typeof o.url === "string" ? o.url : undefined,
              posted_at:
                typeof o.posted_at === "string" ? o.posted_at : undefined,
            };
          })
          .filter((p): p is TopPost => p !== null)
      : [];

    const pillar_breakdown = toBreakdown(r.pillar_breakdown ?? r.pillar_mix);
    const hook_breakdown = toBreakdown(r.hook_breakdown ?? r.hook_type_mix);

    // We accept the reply if it has EITHER top_posts OR usable breakdowns.
    // Refusing when top_posts is empty was a false negative: a vault with
    // only competitor posts (none scraped from the customer's own handle)
    // still produces a valid analysis snapshot — just one where the
    // top_posts list is genuinely empty. Only reject the reply when there
    // is no signal at all to render.
    if (
      top_posts.length === 0 &&
      pillar_breakdown.length === 0 &&
      hook_breakdown.length === 0
    ) {
      return {
        ok: false,
        error:
          "Parsed JSON but it contained no top_posts and no breakdowns. Did ChatGPT Work include the analysis fields from the prompt?",
      };
    }

    const value: PerformanceData = {
      followers: toNum(r.followers),
      avg_likes: toNum(r.avg_likes),
      best_pillar:
        typeof r.best_pillar === "string" && r.best_pillar.trim().length > 0
          ? r.best_pillar.trim()
          : null,
      best_hook_type:
        typeof r.best_hook_type === "string" && r.best_hook_type.trim().length > 0
          ? r.best_hook_type.trim()
          : null,
      top_posts,
      pillar_breakdown,
      hook_breakdown,
      // Forward `scraped_at` if ChatGPT Work echoed it back (the prompt embeds it
      // in the DATA block). The POST handler validates + stores so the
      // snapshot's timestamp reflects the underlying scrape, not the
      // moment-of-paste.
      scraped_at:
        typeof r.scraped_at === "string" && r.scraped_at.length > 0
          ? r.scraped_at
          : null,
    };
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      error: "Could not parse as JSON. Make sure you copied ChatGPT Work's full reply, including the { and }.",
    };
  }
}

/**
 * Render a compact preview of the parsed analysis so the customer sees what
 * will be saved before they click Apply. Mirrors the same fields the tab
 * itself will show, but condensed to ~6 lines.
 */
function renderPerformancePreview(value: PerformanceData): React.ReactNode {
  return (
    <div style={{ fontSize: "0.78rem", lineHeight: 1.55 }}>
      <p style={{ margin: "0 0 0.3rem" }}>
        <strong>Top posts:</strong> {value.top_posts.length}
      </p>
      <p style={{ margin: "0 0 0.3rem" }}>
        <strong>Avg likes:</strong> {value.avg_likes ?? "—"} ·{" "}
        <strong>Best pillar:</strong> {value.best_pillar ?? "—"} ·{" "}
        <strong>Best hook:</strong> {value.best_hook_type ?? "—"}
      </p>
      <p style={{ margin: "0 0 0.3rem" }}>
        <strong>Pillar breakdown:</strong>{" "}
        {value.pillar_breakdown.length > 0
          ? value.pillar_breakdown
              .map((b) => `${b.label} ${Math.round(b.share * 100)}%`)
              .join(", ")
          : "—"}
      </p>
      <p style={{ margin: 0 }}>
        <strong>Hook breakdown:</strong>{" "}
        {value.hook_breakdown.length > 0
          ? value.hook_breakdown
              .map((b) => `${b.label} ${Math.round(b.share * 100)}%`)
              .join(", ")
          : "—"}
      </p>
    </div>
  );
}

function Pill({
  children,
  tone = "burgundy",
}: {
  children: React.ReactNode;
  tone?: "burgundy" | "cream";
}) {
  const styles =
    tone === "burgundy"
      ? { bg: "var(--color-burgundy-soft, #fdf0f0)", color: "var(--color-burgundy)" }
      : { bg: "var(--color-cream)", color: "var(--color-taupe)" };
  return (
    <span
      style={{
        background: styles.bg,
        color: styles.color,
        padding: "0.12rem 0.55rem",
        borderRadius: "20px",
        fontSize: "0.68rem",
        fontWeight: 600,
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </span>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: Breakdown[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--color-border)",
        borderRadius: "12px",
        padding: "1.1rem 1.25rem",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <h3 style={{ fontFamily: "var(--font-header)", fontSize: "1rem", marginBottom: "0.8rem" }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: "0.2rem" }}>
              <span style={{ color: "var(--color-text)" }}>{r.label}</span>
              <span style={{ color: "var(--color-text-dim)" }}>{Math.round(r.share * 100)}%</span>
            </div>
            <div style={{ background: "var(--color-cream)", borderRadius: "4px", height: "6px", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.round(r.share * 100)}%`,
                  background: "var(--color-burgundy)",
                  height: "100%",
                  transition: "width 320ms var(--ease-out)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
