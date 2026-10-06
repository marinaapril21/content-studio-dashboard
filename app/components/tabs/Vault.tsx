"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search, Star, Plus } from "lucide-react";
import TabContainer from "../shared/TabContainer";
import TabHeader from "../shared/TabHeader";
import EmptyState from "../shared/EmptyState";
import MarkLegacyModal from "../legacy/MarkLegacyModal";
import StandaloneLegacyModal from "../legacy/StandaloneLegacyModal";
import {
  fetchLegacyPieces,
  buildLegacyIndex,
  legacyKey,
  type LegacyPiece,
} from "../../../lib/legacy";

type VaultPost = {
  id: string;
  source: "self" | "competitor";
  handle: string;
  type: "carousel" | "reel" | "image" | "story";
  caption: string;
  hook?: string;
  hook_type?: string;
  pillar?: string;
  likes: number | null;
  comments: number | null;
  views?: number | null;
  url?: string;
  posted_at?: string;
  scraped_at?: string;
};

type VaultData = {
  posts: VaultPost[];
  scraped_at?: string | null;
};

/**
 * Vault tab.
 *
 * The raw scrape data, searchable + filterable. Source for every prompt you
 * paste into ChatGPT Work (Web, Desktop, or Code). No ChatGPT Work prompt needed to fill
 * this tab — a successful Apify scrape lands posts here directly.
 */
export default function Vault() {
  const [data, setData] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "self" | "competitor">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | VaultPost["type"]>("all");

  // Legacy state. We hold the raw list so the "Edit legacy" path can hand the
  // existing row straight to the modal (no second fetch), and we hold the
  // O(1) index so per-card render stays cheap on a 200-post Vault.
  const [legacyPieces, setLegacyPieces] = useState<LegacyPiece[]>([]);
  const legacyIndex = useMemo(() => buildLegacyIndex(legacyPieces), [legacyPieces]);
  const standaloneLegacies = useMemo(
    () => legacyPieces.filter((p) => p.source_type === "standalone"),
    [legacyPieces]
  );
  const [legacyOnly, setLegacyOnly] = useState(false);

  // Modal-control state. `markTarget` is the library_post we're marking /
  // editing; `standaloneTarget` is null for "create new" or a LegacyPiece for
  // "edit existing standalone".
  const [markTarget, setMarkTarget] = useState<VaultPost | null>(null);
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const [standaloneTarget, setStandaloneTarget] = useState<LegacyPiece | null>(null);

  const loadLegacy = () => {
    fetchLegacyPieces()
      .then((p) => setLegacyPieces(p))
      .catch(() => setLegacyPieces([]));
  };

  const load = () => {
    setLoading(true);
    fetch("/api/data?tab=vault")
      .then((r) => r.json())
      .then((r) => {
        setData(r.data ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    loadLegacy();
  };

  useEffect(load, []);

  const posts = data?.posts ?? [];
  const hasPosts = posts.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((p) => {
      if (sourceFilter !== "all" && p.source !== sourceFilter) return false;
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (legacyOnly && !legacyIndex.has(legacyKey("library_post", p.id))) return false;
      if (q) {
        const hay = `${p.caption} ${p.hook ?? ""} ${p.handle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [posts, query, sourceFilter, typeFilter, legacyOnly, legacyIndex]);

  // Standalone legacies surface only inside the Legacy filter — they have no
  // source row, so showing them in the unfiltered Vault would mix two
  // different shapes ("scraped post" vs "manual entry") that don't render
  // identically. Inside Legacy mode they show up as their own cards above
  // the library_post hits, respecting the search query and type filter so
  // Thessa can still narrow by caption / hook / story-only.
  const visibleStandalones = useMemo(() => {
    if (!legacyOnly) return [];
    const q = query.trim().toLowerCase();
    return standaloneLegacies.filter((sl) => {
      if (typeFilter !== "all" && sl.type !== typeFilter) return false;
      if (q) {
        const hay = `${sl.caption ?? ""} ${sl.hook ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // sourceFilter doesn't apply here — standalone has no handle / no
      // "self vs competitor" axis. We show them regardless of that pill.
      return true;
    });
  }, [legacyOnly, standaloneLegacies, query, typeFilter]);

  return (
    <TabContainer>
      <TabHeader
        title="Vault"
        subtitle="The raw scrape. Every post ChatGPT Work reads when running a prompt lives here, searchable and filterable."
        scrapedAt={data?.scraped_at}
        onScrapeComplete={load}
      />

      {loading && (
        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: "88px" }} />
          ))}
        </div>
      )}

      {!loading && !hasPosts && (
        <EmptyState
          title="Vault is empty"
          body="Click [Scrape now] above to pull your latest posts + your competitors. Once they land here, every other tab can be filled by copy-pasting a prompt into ChatGPT Work → pasting ChatGPT Work's reply back."
        />
      )}

      {!loading && hasPosts && (
        <>
          {/* Filters */}
          <div
            style={{
              display: "flex",
              gap: "0.6rem",
              marginBottom: "1.25rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "#fff",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                padding: "0.5rem 0.85rem",
                flex: "1 1 220px",
                minWidth: 0,
              }}
            >
              <Search size={14} strokeWidth={1.8} style={{ color: "var(--color-text-dim)", flexShrink: 0 }} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search captions, hooks, handles"
                style={{
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: "0.85rem",
                  fontFamily: "var(--font-body)",
                  width: "100%",
                  color: "var(--color-text)",
                }}
              />
            </div>

            <FilterGroup
              value={sourceFilter}
              onChange={(v) => setSourceFilter(v as typeof sourceFilter)}
              options={[
                { value: "all", label: "All" },
                { value: "self", label: "Mine" },
                { value: "competitor", label: "Competitors" },
              ]}
            />

            <FilterGroup
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as typeof typeFilter)}
              options={[
                { value: "all", label: "Any" },
                { value: "carousel", label: "Carousels" },
                { value: "reel", label: "Reels" },
                { value: "image", label: "Images" },
                { value: "story", label: "Stories" },
              ]}
            />

            {/* Legacy chip — toggle, not part of the FilterGroup pattern
                because it isn't a 1-of-N choice but a "winners only" gate
                that stacks on top of the other filters. ★ icon mirrors the
                per-card badge so the UI reads as one consistent symbol. */}
            <button
              onClick={() => setLegacyOnly((v) => !v)}
              style={{
                background: legacyOnly ? "var(--color-burgundy)" : "#fff",
                border: `1px solid ${legacyOnly ? "var(--color-burgundy)" : "var(--color-border)"}`,
                color: legacyOnly ? "#fff" : "var(--color-text-dim)",
                padding: "0.4rem 0.85rem",
                borderRadius: "20px",
                fontSize: "0.74rem",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
              }}
            >
              <Star
                size={12}
                strokeWidth={2}
                fill={legacyOnly ? "#fff" : "none"}
              />
              Legacy{legacyPieces.length > 0 ? ` (${legacyPieces.length})` : ""}
            </button>

            {/* "Add a legacy story" — for winners Apify can't scrape (stories
                in particular). Sits in the filter row so it's discoverable
                the moment you flip the Legacy chip on. */}
            <button
              onClick={() => {
                setStandaloneTarget(null);
                setStandaloneOpen(true);
              }}
              style={{
                background: "var(--color-cream)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
                padding: "0.4rem 0.85rem",
                borderRadius: "20px",
                fontSize: "0.74rem",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                marginLeft: "auto",
              }}
            >
              <Plus size={12} strokeWidth={2.2} />
              Add a legacy story
            </button>
          </div>

          <p style={{ fontSize: "0.78rem", color: "var(--color-text-dim)", marginBottom: "1rem" }}>
            {filtered.length} of {posts.length} posts
            {legacyOnly && visibleStandalones.length > 0 && ` · ${visibleStandalones.length} standalone`}
          </p>

          {filtered.length === 0 && visibleStandalones.length === 0 && (
            <div
              style={{
                background: "var(--color-cream)",
                border: "1px dashed var(--color-border)",
                borderRadius: "10px",
                padding: "1.5rem",
                fontSize: "0.85rem",
                color: "var(--color-text-dim)",
                textAlign: "center",
              }}
            >
              {legacyOnly
                ? "No legacy pieces match these filters. Try [Add a legacy story] or mark a Vault post as legacy."
                : "No posts match these filters."}
            </div>
          )}

          {/* Standalone legacy cards — only shown when Legacy chip is on.
              These have no source row to decorate, so they live in their
              own block above the library_post hits. Clicking the body opens
              the edit modal (same surface that created them). */}
          {legacyOnly && visibleStandalones.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.85rem" }}>
              {visibleStandalones.map((sl) => (
                <div
                  key={sl.id}
                  style={{
                    background: "#fff",
                    border: "1px solid var(--color-border)",
                    borderLeft: "3px solid var(--color-burgundy)",
                    borderRadius: "10px",
                    padding: "0.85rem 1.15rem",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: "0.4rem",
                      marginBottom: "0.4rem",
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.65rem",
                        background: "var(--color-burgundy-soft, #fdf0f0)",
                        color: "var(--color-burgundy)",
                        padding: "0.1rem 0.55rem",
                        borderRadius: "20px",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                      }}
                    >
                      <Star size={10} strokeWidth={2} fill="var(--color-burgundy)" />
                      Standalone legacy
                    </span>
                    <Tag>{sl.type}</Tag>
                    {sl.recycle_status === "active" && (
                      <Tag tone="dim">
                        ♻ every {sl.recycle_interval_days}d
                      </Tag>
                    )}
                    {sl.posted_at && (
                      <span style={{ fontSize: "0.7rem", color: "var(--color-text-dim)", marginLeft: "auto" }}>
                        {new Date(sl.posted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: "0.86rem", marginBottom: "0.3rem", lineHeight: 1.5 }}>
                    {sl.hook || (sl.caption ? sl.caption.slice(0, 180) : "(no caption)")}
                    {!sl.hook && sl.caption && sl.caption.length > 180 ? "..." : ""}
                  </p>
                  {sl.performance_note && (
                    <p style={{ fontSize: "0.74rem", color: "var(--color-text-dim)", marginBottom: "0.4rem", fontStyle: "italic" }}>
                      {sl.performance_note}
                    </p>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => {
                        setStandaloneTarget(sl);
                        setStandaloneOpen(true);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--color-burgundy)",
                        fontSize: "0.74rem",
                        cursor: "pointer",
                        fontWeight: 600,
                        padding: 0,
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {filtered.map((p) => {
              const legacyHit = legacyIndex.get(legacyKey("library_post", p.id));
              return (
              <div
                key={p.id}
                style={{
                  background: "#fff",
                  border: "1px solid var(--color-border)",
                  borderLeft: `3px solid ${legacyHit ? "var(--color-burgundy)" : p.source === "self" ? "var(--color-burgundy)" : "var(--color-taupe)"}`,
                  borderRadius: "10px",
                  padding: "0.85rem 1.15rem",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "0.4rem",
                    marginBottom: "0.4rem",
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: p.source === "self" ? "var(--color-burgundy)" : "var(--color-taupe)",
                    }}
                  >
                    @{p.handle}
                  </span>
                  <Tag>{p.type}</Tag>
                  {p.pillar && <Tag tone="dim">{p.pillar}</Tag>}
                  {p.hook_type && <Tag tone="dim">{p.hook_type}</Tag>}
                  {legacyHit && (
                    <span
                      style={{
                        fontSize: "0.62rem",
                        background: "var(--color-burgundy-soft, #fdf0f0)",
                        color: "var(--color-burgundy)",
                        padding: "0.1rem 0.5rem",
                        borderRadius: "20px",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        letterSpacing: "0.04em",
                      }}
                      title={
                        legacyHit.recycle_status === "active"
                          ? `Auto-recycle every ${legacyHit.recycle_interval_days} days`
                          : "Marked as legacy"
                      }
                    >
                      <Star size={9} strokeWidth={2} fill="var(--color-burgundy)" />
                      Legacy
                      {legacyHit.recycle_status === "active" && " ♻"}
                    </span>
                  )}
                  {p.posted_at && (
                    <span style={{ fontSize: "0.7rem", color: "var(--color-text-dim)", marginLeft: "auto" }}>
                      {new Date(p.posted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: "0.86rem", marginBottom: "0.3rem", lineHeight: 1.5 }}>
                  {p.hook || p.caption.slice(0, 180)}
                  {!p.hook && p.caption.length > 180 ? "..." : ""}
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.74rem",
                    color: "var(--color-text-dim)",
                    gap: "0.6rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    {p.likes == null ? 'Likes unavailable' : `${p.likes.toLocaleString()} likes`}
                    {p.views != null ? ` · ${p.views.toLocaleString()} views` : ""} · {p.comments == null ? 'Comments unavailable' : `${p.comments} comments`}
                  </span>
                  <div style={{ display: "inline-flex", gap: "0.85rem", alignItems: "center" }}>
                    <button
                      onClick={() => setMarkTarget(p)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: legacyHit ? "var(--color-burgundy)" : "var(--color-text-dim)",
                        cursor: "pointer",
                        fontFamily: "var(--font-body)",
                        fontWeight: 600,
                        fontSize: "0.74rem",
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                      }}
                    >
                      <Star
                        size={11}
                        strokeWidth={2}
                        fill={legacyHit ? "var(--color-burgundy)" : "none"}
                      />
                      {legacyHit ? "Edit legacy" : "Mark as legacy"}
                    </button>
                    {p.url && (
                      <a
                        href={p.url}
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
              </div>
              );
            })}
          </div>
        </>
      )}

      {/* Mark-as-legacy modal — only mounted when a target exists, so the
          form state resets cleanly between cards (the modal's own
          useEffect(open, existing) handles the rest). */}
      {markTarget && (
        <MarkLegacyModal
          open={true}
          onClose={() => setMarkTarget(null)}
          onSaved={loadLegacy}
          source_type="library_post"
          source_id={markTarget.id}
          type={markTarget.type}
          source_hook={markTarget.hook ?? null}
          source_caption={markTarget.caption ?? null}
          source_posted_at={markTarget.posted_at ?? null}
          existing={legacyIndex.get(legacyKey("library_post", markTarget.id)) ?? null}
        />
      )}

      <StandaloneLegacyModal
        open={standaloneOpen}
        onClose={() => {
          setStandaloneOpen(false);
          setStandaloneTarget(null);
        }}
        onSaved={loadLegacy}
        existing={standaloneTarget}
      />
    </TabContainer>
  );
}

function FilterGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              background: active ? "var(--color-burgundy)" : "#fff",
              border: `1px solid ${active ? "var(--color-burgundy)" : "var(--color-border)"}`,
              color: active ? "#fff" : "var(--color-text-dim)",
              padding: "0.4rem 0.85rem",
              borderRadius: "20px",
              fontSize: "0.74rem",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              fontWeight: 600,
            }}
          >
            {o.label}
          </button>
        );
      })}
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
