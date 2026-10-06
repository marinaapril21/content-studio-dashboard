"use client";
import { useEffect, useState, useCallback } from "react";
import { ExternalLink } from "lucide-react";
import TabContainer from "../shared/TabContainer";
import TabHeader from "../shared/TabHeader";
import EmptyState from "../shared/EmptyState";
import PasteFromClaude, { stripCodeFences } from "../shared/PasteFromClaude";
import CopyPromptButton from "../shared/CopyPromptButton";
import { buildCompetitorPrompt } from "../../../lib/promptBuilders";
import { fetchEffectiveSettings } from "../../../lib/settings";

type TrendingPost = {
  hook: string;
  hook_type?: string;
  type: string;
  likes: number | null;
  comments: number | null;
  views?: number;
  url?: string;
  timestamp?: string;
};

type TrendingHook = { hook: string; hook_type?: string; engagement: number; note?: string };

type CompData = {
  handle: string;
  scraped_at?: string;
  top_posts: TrendingPost[];
  trending_hooks: TrendingHook[];
  trending_formats?: Record<string, number>;
  best_hook_type?: string | null;
  best_format?: string | null;
  analysis?: { sample_size?: number; best_hook_types?: string[]; recurring_topics?: string[]; format_notes?: string; replicable?: string; limitations?: string };
};

function shortDate(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Intel tab.
 *
 * Up to 5 competitor handles from config.json. For each: top hooks, top posts,
 * format mix. Filled by the competitor-patterns ChatGPT Work prompt after a scrape
 * (in-app button → ChatGPT Work → paste reply back).
 */
export default function Intel() {
  // Competitors used to read straight from config.json. Now they come from
  // the effective settings (Supabase → localStorage → config.json fallback)
  // so customers who edit the list in Settings see it reflected here without
  // a redeploy. Initial state is empty until the async fetch resolves —
  // that's fine, the tabs render once the list arrives.
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [data, setData] = useState<CompData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEffectiveSettings()
      .then((s) => {
        if (cancelled) return;
        const list = s.competitors.slice(0, 5);
        setCompetitors(list);
        // Auto-select the first handle once the list loads. We do NOT
        // overwrite an existing `active` selection — the customer may have
        // already clicked a different tab while settings were loading.
        setActive((cur) => cur || list[0] || "");
      })
      .catch(() => {
        if (!cancelled) setCompetitors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback((handle: string) => {
    if (!handle) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setData(null);
    fetch(`/api/data?tab=intel&handle=${encodeURIComponent(handle)}`)
      .then((r) => r.json())
      .then((r) => {
        setData(r.data ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (active) load(active);
  }, [active, load]);

  const hasCompetitors = competitors.length > 0;
  const hasPosts = (data?.top_posts ?? []).length > 0;
  async function saveAnalysis(value: { competitors: Array<{ handle: string }> }) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/data?tab=intel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Could not save analysis");
      load(active);
    } catch (e) { setSaveError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <TabContainer>
      <TabHeader
        title="Competitor intel"
        subtitle="Up to 5 handles from your Settings. For each: top hooks, top posts, what's working."
        scrapedAt={data?.scraped_at}
        onScrapeComplete={() => load(active)}
      />

      {!hasCompetitors && (
        <EmptyState
          title="No competitors added"
          body="Open the Settings tab and add up to 5 competitor Instagram handles. Once scraped, their top hooks and patterns appear here."
        />
      )}

      {hasCompetitors && (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <CopyPromptButton label="Copy competitor analysis prompt" buildPrompt={buildCompetitorPrompt} />
            <PasteFromClaude
              label="Paste ChatGPT Work's competitor analysis"
              parse={(raw) => {
                try {
                  const value = JSON.parse(stripCodeFences(raw));
                  if (!Array.isArray(value?.competitors) || !value.competitors.length || value.competitors.some((r: { handle?: string }) => !r?.handle)) return { ok: false, error: "Expected a competitors array with a handle for each report." };
                  return { ok: true, value };
                } catch { return { ok: false, error: "Paste the full JSON response." }; }
              }}
              render={(value: { competitors: Array<{ handle: string }> }) => <p>{value.competitors.map(r => `@${r.handle}`).join(", ")}</p>}
              onApply={saveAnalysis}
            />
            {saving && <p>Saving analysis...</p>}
            {saveError && <p role="alert">{saveError}</p>}
          </div>
          {/* Handle tabs */}
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
            {competitors.map((h) => {
              const cleaned = h.replace(/^@/, "");
              const isActive = active === cleaned || active === h;
              return (
                <button
                  key={h}
                  onClick={() => setActive(cleaned)}
                  style={{
                    background: isActive ? "var(--color-burgundy)" : "#fff",
                    border: `1px solid ${isActive ? "var(--color-burgundy)" : "var(--color-border)"}`,
                    color: isActive ? "#fff" : "var(--color-text-dim)",
                    padding: "0.45rem 1.05rem",
                    borderRadius: "20px",
                    fontSize: "0.78rem",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                    fontWeight: 600,
                  }}
                >
                  @{cleaned}
                </button>
              );
            })}
          </div>

          {loading && (
            <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: "76px" }} />
              ))}
            </div>
          )}

          {!loading && !hasPosts && (
            <EmptyState
              title={`No data for @${active} yet`}
              body="Run a scrape with the button above, then run the competitor analysis prompt. Top hooks and posts will land here."
            />
          )}

          {!loading && hasPosts && (
            <>
              {data?.analysis && <section style={{ marginBottom: "1.5rem", padding: "1rem", background: "#fff", borderRadius: "10px" }}>
                <h2>Analiza profila</h2>
                <p>{data.analysis.sample_size} prikupljenih objava</p>
                <h3>Teme koje se ponavljaju</h3>
                <ul>{data.analysis.recurring_topics?.map(t => <li key={t}>{t}</li>)}</ul>
                <p>{data.analysis.format_notes}</p>
                <h3>Što možeš primijeniti</h3>
                <p>{data.analysis.replicable}</p>
                <p>{data.analysis.limitations}</p>
                <small>Rangiranje koristi dostupne lajkove, komentare i preglede. Nedostupne metrike nisu nula.</small>
              </section>}
              {/* Summary cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "1rem",
                  marginBottom: "1.75rem",
                }}
              >
                <Card label="Top posts" value={`${data!.top_posts.length}`} />
                <Card label="Best hook type" value={data?.best_hook_type ?? "—"} />
                <Card label="Best format" value={data?.best_format ?? "—"} />
                <Card label="Last scraped" value={shortDate(data?.scraped_at) || "—"} />
              </div>

              {/* Top hooks */}
              {(data?.trending_hooks ?? []).length > 0 && (
                <>
                  <h2 style={{ fontFamily: "var(--font-header)", fontSize: "1.1rem", marginBottom: "0.85rem" }}>
                    Top hooks
                  </h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "2rem" }}>
                    {data!.trending_hooks.slice(0, 5).map((h, i) => (
                      <div
                        key={i}
                        style={{
                          background: "#fff",
                          border: "1px solid var(--color-border)",
                          borderRadius: "10px",
                          padding: "0.8rem 1.15rem",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "1rem",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          {h.hook_type && (
                            <span
                              style={{
                                fontSize: "0.65rem",
                                background: "var(--color-cream)",
                                color: "var(--color-taupe)",
                                padding: "0.1rem 0.5rem",
                                borderRadius: "20px",
                                marginRight: "0.55rem",
                                fontWeight: 600,
                              }}
                            >
                              {h.hook_type}
                            </span>
                          )}
                          <span style={{ fontSize: "0.85rem" }}>&ldquo;{h.hook.slice(0, 140)}&rdquo;</span>
                          {h.note && <p>{h.note}</p>}
                        </div>
                        <span
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--color-taupe)",
                            fontFamily: "var(--font-header)",
                            flexShrink: 0,
                          }}
                        >
                          {h.engagement.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Top posts */}
              <h2 style={{ fontFamily: "var(--font-header)", fontSize: "1.1rem", marginBottom: "0.85rem" }}>
                Top posts
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {data!.top_posts.slice(0, 8).map((post, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#fff",
                      border: "1px solid var(--color-border)",
                      borderRadius: "10px",
                      padding: "0.85rem 1.15rem",
                      boxShadow: "var(--shadow-sm)",
                    }}
                  >
                    <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.35rem", flexWrap: "wrap" }}>
                      <Tag>{post.type}</Tag>
                      {post.hook_type && <Tag tone="dim">{post.hook_type}</Tag>}
                    </div>
                    <p style={{ fontSize: "0.86rem", marginBottom: "0.3rem", lineHeight: 1.45 }}>
                      {post.url ? (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--color-text)", textDecoration: "none" }}
                        >
                          {post.hook.slice(0, 160)}
                        </a>
                      ) : (
                        post.hook.slice(0, 160)
                      )}
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
                        {post.likes == null ? "Likes unavailable" : `${post.likes.toLocaleString()} likes`} · {post.comments == null ? "Comments unavailable" : `${post.comments} comments`}
                        {post.timestamp && (
                          <span style={{ color: "var(--color-taupe)", marginLeft: "0.5rem" }}>
                            · {shortDate(post.timestamp)}
                          </span>
                        )}
                      </span>
                      {post.url && (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: "var(--color-burgundy)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            textDecoration: "none",
                          }}
                        >
                          Open <ExternalLink size={11} strokeWidth={2} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </TabContainer>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--color-border)",
        borderRadius: "12px",
        padding: "1rem 1.15rem",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <p
        style={{
          fontSize: "0.62rem",
          color: "var(--color-text-dim)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          marginBottom: "0.35rem",
          fontWeight: 700,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-header)",
          fontSize: "1.25rem",
          color: value === "—" ? "var(--color-taupe)" : "var(--color-text)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function Tag({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "dim" }) {
  return (
    <span
      style={{
        fontSize: "0.65rem",
        background: "var(--color-cream)",
        color: tone === "dim" ? "var(--color-text-dim)" : "var(--color-taupe)",
        padding: "0.1rem 0.5rem",
        borderRadius: "20px",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
