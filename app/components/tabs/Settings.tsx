"use client";
import { useEffect, useState } from "react";
import { Check, Plus, Trash2, Sparkles, AlertCircle } from "lucide-react";
import config from "../../../config.json";
import TabHeader from "../shared/TabHeader";
import {
  fetchEffectiveSettings,
  saveEffectiveSettings,
  type EffectiveSettings,
  type TriggerTriplet,
} from "../../../lib/settings";

/**
 * Settings tab, v2.
 *
 * Three editable sections (all forms — no "ask Claude Code to update
 * config.json" anywhere):
 *   1. Brand identity, editable. Save persists to Supabase via PUT
 *      /api/data?tab=settings. If Supabase is not configured (white-label
 *      demo), persists to localStorage instead so the customer can still
 *      feel the UX. config.json stays the deploy-default fallback.
 *   2. Theme, interactive picker, localStorage-only. Unchanged from v1.
 *   3. Apify scraper, advisory only. Token lives in Vercel env so it never
 *      reaches the browser.
 *   4. Competitors, editable list with autopopulate-from-scrape button.
 *   5. Trigger words, each one now a quartet {word, offer, topic, promise}.
 *      The Drafts tab uses the offer/promise to ground CTAs; the Intel tab
 *      and the prompt builders cross-reference topic to keep posts on-brief.
 *
 * Legacy migration: if Supabase has not been touched yet, config.json may
 * still contain `"triggerWords": ["STUDIO","BUNDLE"]` (pre-triplet shape).
 * `lib/settings.ts` normalises both shapes — string entries surface here
 * with `needs-setup` badges so the customer fills in offer/topic/promise
 * before the prompt builders can use them.
 */

const STORAGE_KEY = "cs-theme";

type Preset = "burgundy" | "dark-pink" | "custom";

type ThemeState = {
  preset: Preset;
  accent: string;
  accentLight: string;
  accentSoft: string;
};

const PRESETS: Record<Exclude<Preset, "custom">, ThemeState> = {
  burgundy: {
    preset: "burgundy",
    accent: "#741616",
    accentLight: "#9a2020",
    accentSoft: "#fdf0f0",
  },
  "dark-pink": {
    preset: "dark-pink",
    accent: "#a8345c",
    accentLight: "#c44878",
    accentSoft: "#fce8ef",
  },
};

function mixWithWhite(hex: string, ratio: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  const to = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to(mix(r))}${to(mix(g))}${to(mix(b))}`;
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function defaultThemeState(): ThemeState {
  const accent = config.theme?.accent ?? "#741616";
  if (accent === PRESETS.burgundy.accent) return PRESETS.burgundy;
  if (accent === PRESETS["dark-pink"].accent) return PRESETS["dark-pink"];
  return {
    preset: "custom",
    accent,
    accentLight: config.theme?.accentLight ?? mixWithWhite(accent, 0.2),
    accentSoft: config.theme?.accentSoft ?? mixWithWhite(accent, 0.92),
  };
}

function readStoredTheme(): ThemeState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ThemeState>;
    if (!parsed.accent || !isValidHex(parsed.accent)) return null;
    const preset: Preset =
      parsed.preset === "burgundy" || parsed.preset === "dark-pink"
        ? parsed.preset
        : "custom";
    return {
      preset,
      accent: parsed.accent,
      accentLight: parsed.accentLight ?? mixWithWhite(parsed.accent, 0.2),
      accentSoft: parsed.accentSoft ?? mixWithWhite(parsed.accent, 0.92),
    };
  } catch {
    return null;
  }
}

function applyThemeToDOM(theme: ThemeState) {
  const root = document.documentElement;
  root.style.setProperty("--color-burgundy", theme.accent);
  root.style.setProperty("--color-burgundy-light", theme.accentLight);
  root.style.setProperty("--color-burgundy-soft", theme.accentSoft);
}

function persistTheme(theme: ThemeState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // ignore quota / disabled storage
  }
}

/** Make a blank trigger row the customer can fill in. */
const blankTrigger = (): TriggerTriplet => ({ word: "", offer: "", topic: "", promise: "" });

export default function Settings() {
  // ── Theme picker state (unchanged) ────────────────────────────────────────
  const [theme, setTheme] = useState<ThemeState>(defaultThemeState);
  const [customHex, setCustomHex] = useState<string>(defaultThemeState().accent);
  const [themeSavedFlash, setThemeSavedFlash] = useState<boolean>(false);

  // ── Editable settings (new) ───────────────────────────────────────────────
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<EffectiveSettings>({
    brand_name: "",
    instagram_handle: "",
    competitors: [],
    trigger_words: [],
    source: "config",
    has_legacy_triggers: false,
  });
  const [newCompetitor, setNewCompetitor] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    // Guard against fast tab-switching / HMR: a `cancelled` flag stops the
    // resolved promise from setting state on an unmounted component (React
    // 19 logs that as a warning). Drafts.tsx and Intel.tsx use the same
    // pattern — Settings was the only holdout.
    let cancelled = false;
    fetchEffectiveSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    const stored = readStoredTheme();
    if (stored) {
      setTheme(stored);
      setCustomHex(stored.accent);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await saveEffectiveSettings({
        brand_name: settings.brand_name,
        instagram_handle: settings.instagram_handle,
        competitors: settings.competitors,
        trigger_words: settings.trigger_words,
      });
      if (res.ok) {
        setSaveMsg({
          kind: "ok",
          text:
            res.source === "supabase"
              ? "Saved to Supabase."
              : "Saved locally (Supabase not configured on this deploy).",
        });
        // Refetch so the source flag updates and any legacy rows clear.
        const fresh = await fetchEffectiveSettings();
        setSettings(fresh);
        // Tell the rest of the app the effective settings just changed so
        // the Sidebar (and any other listener) picks up the new brand name /
        // handle / triggers without a page reload. Thessa was typing a brand
        // name in this form and seeing nothing change in the sidebar — this
        // event is the bridge between writer (this tab) and readers (sidebar
        // and elsewhere). The "storage" event covers the cross-tab case;
        // this custom event covers same-tab live updates.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("cs-settings:saved"));
        }
      } else {
        setSaveMsg({ kind: "err", text: res.error ?? "Could not save." });
      }
    } finally {
      setSaving(false);
      window.setTimeout(() => setSaveMsg(null), 4000);
    }
  }

  // ── Theme handlers (unchanged) ───────────────────────────────────────────
  function pickPreset(preset: Exclude<Preset, "custom">) {
    const next = PRESETS[preset];
    setTheme(next);
    setCustomHex(next.accent);
    persistTheme(next);
    applyThemeToDOM(next);
    flashThemeSaved();
  }

  function applyCustom() {
    const hex = customHex.trim();
    if (!isValidHex(hex)) return;
    const next: ThemeState = {
      preset: "custom",
      accent: hex,
      accentLight: mixWithWhite(hex, 0.2),
      accentSoft: mixWithWhite(hex, 0.92),
    };
    setTheme(next);
    persistTheme(next);
    applyThemeToDOM(next);
    flashThemeSaved();
  }

  function resetTheme() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    const fromConfig: ThemeState = {
      preset: "burgundy",
      accent: config.theme?.accent ?? PRESETS.burgundy.accent,
      accentLight: config.theme?.accentLight ?? PRESETS.burgundy.accentLight,
      accentSoft: config.theme?.accentSoft ?? PRESETS.burgundy.accentSoft,
    };
    setTheme(fromConfig);
    setCustomHex(fromConfig.accent);
    applyThemeToDOM(fromConfig);
    flashThemeSaved();
  }

  function flashThemeSaved() {
    setThemeSavedFlash(true);
    window.setTimeout(() => setThemeSavedFlash(false), 1400);
  }

  const customHexValid = isValidHex(customHex);

  // ── Competitor + trigger helpers ─────────────────────────────────────────
  function addCompetitor() {
    const cleaned = newCompetitor.replace(/^@/, "").trim();
    if (!cleaned) return;
    if (settings.competitors.includes(cleaned)) return;
    if (settings.competitors.length >= 5) return;
    setSettings({ ...settings, competitors: [...settings.competitors, cleaned] });
    setNewCompetitor("");
  }

  function removeCompetitor(handle: string) {
    setSettings({
      ...settings,
      competitors: settings.competitors.filter((c) => c !== handle),
    });
  }

  async function autopopulateCompetitors() {
    try {
      const res = await fetch("/api/data?tab=vault", { cache: "no-store" });
      const j = await res.json();
      const posts = j?.data?.posts ?? [];
      // Walk own posts, harvest @-mentions in captions, rank by frequency.
      const counts = new Map<string, number>();
      for (const p of posts) {
        if (p.source !== "self") continue;
        const matches: string[] = (p.caption ?? "").match(/@[a-zA-Z0-9._]+/g) ?? [];
        for (const m of matches) {
          const handle = m.replace(/^@/, "").toLowerCase();
          if (!handle || handle === settings.instagram_handle.toLowerCase()) continue;
          counts.set(handle, (counts.get(handle) ?? 0) + 1);
        }
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
      const merged = [...new Set([...settings.competitors, ...ranked])].slice(0, 5);
      if (merged.length === settings.competitors.length) {
        setSaveMsg({
          kind: "err",
          text: "No new handles detected. Scrape your account first, or add manually below.",
        });
        window.setTimeout(() => setSaveMsg(null), 4000);
        return;
      }
      setSettings({ ...settings, competitors: merged });
    } catch {
      setSaveMsg({ kind: "err", text: "Could not read scrape vault." });
      window.setTimeout(() => setSaveMsg(null), 4000);
    }
  }

  function updateTrigger(i: number, patch: Partial<TriggerTriplet>) {
    const next = settings.trigger_words.slice();
    next[i] = { ...next[i], ...patch };
    setSettings({ ...settings, trigger_words: next });
  }

  function addTrigger() {
    setSettings({ ...settings, trigger_words: [...settings.trigger_words, blankTrigger()] });
  }

  function removeTrigger(i: number) {
    const next = settings.trigger_words.slice();
    next.splice(i, 1);
    setSettings({ ...settings, trigger_words: next });
  }

  async function autopopulateTriggers() {
    try {
      const res = await fetch("/api/data?tab=vault", { cache: "no-store" });
      const j = await res.json();
      const posts = j?.data?.posts ?? [];
      // Look for ALL-CAPS words 3+ letters in own captions — these are the
      // lead-magnet keywords creators use ("Comment STUDIO and I'll send…").
      const counts = new Map<string, number>();
      for (const p of posts) {
        if (p.source !== "self") continue;
        const matches: string[] =
          (p.caption ?? "").match(/\b[A-Z]{3,}\b/g) ?? [];
        for (const m of matches) {
          // Skip obvious noise: brand names sometimes are all caps too. Filter
          // is intentionally loose — the customer reviews + accepts each one.
          if (["AI", "USA", "CEO", "CTA", "DM", "IG"].includes(m)) continue;
          counts.set(m, (counts.get(m) ?? 0) + 1);
        }
      }
      const known = new Set(settings.trigger_words.map((t) => t.word.toUpperCase()));
      const fresh = [...counts.entries()]
        .filter(([w]) => !known.has(w))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([w]) => ({ word: w, offer: "", topic: "", promise: "" }));
      if (fresh.length === 0) {
        setSaveMsg({
          kind: "err",
          text: "No new uppercase keywords detected in your last posts.",
        });
        window.setTimeout(() => setSaveMsg(null), 4000);
        return;
      }
      setSettings({
        ...settings,
        trigger_words: [...settings.trigger_words, ...fresh],
      });
    } catch {
      setSaveMsg({ kind: "err", text: "Could not read scrape vault." });
      window.setTimeout(() => setSaveMsg(null), 4000);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem 1.5rem" }}>
      <TabHeader
        title="Settings"
        subtitle="Your brand, competitors, and trigger words live here. Every other tab reads from this page. Save persists to Supabase; on demo deploys without Supabase keys it saves locally to your browser."
        hideScrape
      />

      {/* ── Brand identity ──────────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Brand</h2>
        <p style={paragraphStyle}>
          What this dashboard calls you. Brand name shows in the sidebar header,
          Instagram handle is the &ldquo;self&rdquo; account every scrape pulls
          and every prompt grounds in.
        </p>
        <Field
          label="Brand name"
          value={settings.brand_name}
          placeholder="Your Brand"
          onChange={(v) => setSettings({ ...settings, brand_name: v })}
        />
        <Field
          label="Instagram handle"
          value={settings.instagram_handle}
          placeholder="your_handle"
          prefix="@"
          onChange={(v) =>
            setSettings({ ...settings, instagram_handle: v.replace(/^@/, "") })
          }
        />
      </section>

      {/* ── Theme picker (unchanged from v1) ─────────────────────────────── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Theme</h2>
        <p style={paragraphStyle}>
          Pick a preset or set a custom accent. The change applies instantly and is
          remembered in this browser. Use the reset button to fall back to your
          deploy default.
        </p>
        <div style={presetGridStyle}>
          <PresetTile
            label="Burgundy"
            sample={PRESETS.burgundy.accent}
            active={theme.preset === "burgundy"}
            onClick={() => pickPreset("burgundy")}
          />
          <PresetTile
            label="Dark pink"
            sample={PRESETS["dark-pink"].accent}
            active={theme.preset === "dark-pink"}
            onClick={() => pickPreset("dark-pink")}
          />
          <PresetTile
            label="Custom"
            sample={theme.preset === "custom" ? theme.accent : "#cccccc"}
            active={theme.preset === "custom"}
            onClick={() => {
              const next: ThemeState = {
                preset: "custom",
                accent: customHex,
                accentLight: mixWithWhite(customHex, 0.2),
                accentSoft: mixWithWhite(customHex, 0.92),
              };
              if (isValidHex(customHex)) {
                setTheme(next);
                persistTheme(next);
                applyThemeToDOM(next);
                flashThemeSaved();
              }
            }}
          />
        </div>
        <div style={customRowStyle}>
          <label htmlFor="custom-hex" style={hexLabelStyle}>Custom hex</label>
          <input
            id="custom-hex"
            type="text"
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
            placeholder="#741616"
            spellCheck={false}
            style={{
              ...inputStyle,
              borderColor: customHexValid
                ? "var(--color-border)"
                : "var(--color-burgundy-light)",
            }}
          />
          <input
            aria-label="Color preview"
            type="color"
            value={customHexValid ? customHex : "#741616"}
            onChange={(e) => {
              const hex = e.target.value.toUpperCase();
              setCustomHex(hex);
              if (isValidHex(hex)) {
                const next: ThemeState = {
                  preset: "custom",
                  accent: hex,
                  accentLight: mixWithWhite(hex, 0.2),
                  accentSoft: mixWithWhite(hex, 0.92),
                };
                setTheme(next);
                persistTheme(next);
                applyThemeToDOM(next);
              }
            }}
            style={colorChipStyle}
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={!customHexValid}
            style={applyButtonStyle}
          >
            Apply
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
          <button type="button" onClick={resetTheme} style={resetButtonStyle}>
            Reset to deploy default
          </button>
          {themeSavedFlash && (
            <span style={savedFlashStyle}>
              <Check size={14} strokeWidth={2.4} /> Saved
            </span>
          )}
        </div>
      </section>

      {/* ── Apify scraper (advisory) ─────────────────────────────────────── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Apify scraper</h2>
        <p style={paragraphStyle}>
          Your Apify token lives in your Supabase project as the
          <code style={codeStyle}>APIFY_TOKEN</code> environment variable, used
          by the Supabase Edge Function. It is never sent to the browser.
        </p>
        <p style={paragraphStyle}>
          To change it, open Supabase
          <span style={dotStyle}>·</span> Edge Functions
          <span style={dotStyle}>·</span> Secrets and update
          <code style={codeStyle}>APIFY_TOKEN</code>.
          Each run checks the last 90 days, up to 300 posts per profile,
          with an Apify spending cap of $1 for the whole run.
        </p>
      </section>

      {/* ── Competitors ─────────────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={sectionHeaderRow}>
          <h2 style={{ ...h2Style, marginBottom: 0 }}>Competitors</h2>
          <button
            type="button"
            onClick={autopopulateCompetitors}
            style={autopopBtn}
            title="Suggest competitor handles from @-mentions in your own captions"
          >
            <Sparkles size={12} strokeWidth={2.2} /> Suggest from scrape
          </button>
        </div>
        <p style={paragraphStyle}>
          Up to 5 handles. Each one gets its own tab on Intel. Add now or hit
          the suggest button to pull handles you already mention in your own
          captions.
        </p>

        {settings.competitors.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.85rem" }}>
            {settings.competitors.map((handle) => (
              <li key={handle} style={rowStyle}>
                <span style={{ fontWeight: 500 }}>@{handle}</span>
                <button
                  type="button"
                  onClick={() => removeCompetitor(handle)}
                  style={miniGhost}
                  aria-label={`Remove @${handle}`}
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ ...paragraphStyle, fontStyle: "italic" }}>None added yet.</p>
        )}

        {settings.competitors.length < 5 && (
          <div style={addRowStyle}>
            <input
              type="text"
              placeholder="@handle"
              value={newCompetitor}
              onChange={(e) => setNewCompetitor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCompetitor();
                }
              }}
              style={{ ...inputStyle, flex: "1 1 220px" }}
            />
            <button type="button" onClick={addCompetitor} style={addBtn}>
              <Plus size={13} strokeWidth={2.2} /> Add
            </button>
          </div>
        )}
      </section>

      {/* ── Trigger words ───────────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={sectionHeaderRow}>
          <h2 style={{ ...h2Style, marginBottom: 0 }}>Trigger words</h2>
          <button
            type="button"
            onClick={autopopulateTriggers}
            style={autopopBtn}
            title="Detect ALL-CAPS keywords from your own captions (e.g. STUDIO, BUNDLE)"
          >
            <Sparkles size={12} strokeWidth={2.2} /> Detect from posts
          </button>
        </div>
        <p style={paragraphStyle}>
          Each trigger word is linked to an offer, a topic, and a promise. The
          Drafts tab uses these to keep the post on topic and the CTA grounded
          in the offer&apos;s promise &mdash; no &ldquo;link in bio&rdquo;
          handwaving.
        </p>

        {settings.has_legacy_triggers && (
          <p style={legacyHintStyle}>
            <AlertCircle size={13} strokeWidth={2} />
            One or more triggers were imported from the old plain-list format.
            Fill in offer, topic, and promise below so prompts can use them.
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {settings.trigger_words.map((t, i) => {
            const needsSetup = !t.offer || !t.topic || !t.promise;
            return (
              <div key={i} style={triggerCardStyle}>
                <div style={triggerHeaderRow}>
                  <input
                    type="text"
                    placeholder="WORD"
                    value={t.word}
                    onChange={(e) =>
                      updateTrigger(i, { word: e.target.value.toUpperCase() })
                    }
                    style={{ ...inputStyle, flex: "0 0 160px", fontWeight: 700, letterSpacing: "0.05em" }}
                  />
                  {needsSetup && <span style={needsSetupBadge}>needs setup</span>}
                  <button
                    type="button"
                    onClick={() => removeTrigger(i)}
                    style={{ ...miniGhost, marginLeft: "auto" }}
                    aria-label={`Remove trigger ${t.word}`}
                  >
                    <Trash2 size={12} strokeWidth={1.8} />
                  </button>
                </div>
                <Field
                  label="Offer"
                  value={t.offer}
                  placeholder="e.g. Sold Out Salespage AI"
                  onChange={(v) => updateTrigger(i, { offer: v })}
                  compact
                />
                <Field
                  label="Topic"
                  value={t.topic}
                  placeholder="e.g. AI tool that builds your salespage"
                  onChange={(v) => updateTrigger(i, { topic: v })}
                  compact
                />
                <Field
                  label="Promise"
                  value={t.promise}
                  placeholder="e.g. A converting salespage in under an hour"
                  onChange={(v) => updateTrigger(i, { promise: v })}
                  compact
                />
              </div>
            );
          })}
        </div>

        <button type="button" onClick={addTrigger} style={{ ...addBtn, marginTop: "0.85rem" }}>
          <Plus size={13} strokeWidth={2.2} /> Add trigger word
        </button>
      </section>

      {/* ── Save bar ─────────────────────────────────────────────────────── */}
      <div style={saveBarStyle}>
        <button
          type="button"
          onClick={save}
          disabled={saving || !loaded}
          style={{
            ...applyButtonStyle,
            opacity: saving || !loaded ? 0.6 : 1,
            padding: "0.7rem 1.4rem",
            fontSize: 14,
          }}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saveMsg && (
          <span
            style={{
              fontSize: 13,
              color: saveMsg.kind === "ok" ? "var(--color-burgundy)" : "#9a2020",
              fontWeight: 600,
            }}
          >
            {saveMsg.text}
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--color-text-dim)", marginLeft: "auto" }}>
          Source:{" "}
          <code style={codeStyle}>
            {settings.source === "supabase"
              ? "Supabase"
              : settings.source === "localStorage"
              ? "your browser"
              : "config.json"}
          </code>
        </span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*                          Reusable field + tiles                          */
/* ──────────────────────────────────────────────────────────────────────── */

function Field({
  label,
  value,
  placeholder,
  prefix,
  onChange,
  compact,
}: {
  label: string;
  value: string;
  placeholder?: string;
  prefix?: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <div style={{ marginBottom: compact ? 8 : 12 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          color: "var(--color-text-dim)",
          fontWeight: 600,
          marginBottom: 4,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        {prefix && (
          <span
            style={{
              padding: "0.6rem 0.7rem",
              border: "1px solid var(--color-border)",
              borderRight: "none",
              borderRadius: "8px 0 0 8px",
              background: "var(--color-cream)",
              color: "var(--color-text-dim)",
              fontSize: 14,
              display: "inline-flex",
              alignItems: "center",
              fontWeight: 600,
            }}
          >
            {prefix}
          </span>
        )}
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{
            ...inputStyle,
            flex: 1,
            borderRadius: prefix ? "0 8px 8px 0" : "8px",
          }}
        />
      </div>
    </div>
  );
}

function PresetTile({
  label,
  sample,
  active,
  onClick,
}: {
  label: string;
  sample: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        ...presetTileStyle,
        borderColor: active ? "var(--color-burgundy)" : "var(--color-border)",
        boxShadow: active ? "var(--shadow-burgundy)" : "var(--shadow-xs)",
        background: active ? "var(--color-burgundy-soft)" : "#fff",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "block",
          width: "100%",
          height: 28,
          borderRadius: 6,
          background: sample,
          border: "1px solid rgba(0,0,0,0.06)",
          marginBottom: 10,
        }}
      />
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
        {label}
      </span>
      <span
        style={{
          display: "block",
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          color: "var(--color-text-dim)",
          marginTop: 2,
        }}
      >
        {sample.toUpperCase()}
      </span>
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*                                  Styles                                  */
/* ──────────────────────────────────────────────────────────────────────── */

const sectionStyle: React.CSSProperties = {
  marginBottom: "2rem",
  paddingBottom: "1.5rem",
  borderBottom: "1px solid var(--color-border-light)",
};

const sectionHeaderRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "0.85rem",
  flexWrap: "wrap",
  gap: 10,
};

const h2Style: React.CSSProperties = {
  fontFamily: "var(--font-header)",
  fontSize: "1.15rem",
  marginBottom: "1rem",
  color: "var(--color-text)",
};

const paragraphStyle: React.CSSProperties = {
  color: "var(--color-text-dim)",
  fontSize: 14,
  lineHeight: 1.55,
  marginBottom: 12,
};

const presetGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
  marginBottom: 16,
};

const presetTileStyle: React.CSSProperties = {
  appearance: "none",
  textAlign: "left",
  padding: "14px 14px 12px",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  background: "#fff",
};

const customRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const hexLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-text-dim)",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  flex: "1 1 160px",
  minWidth: 0,
  padding: "0.6rem 0.85rem",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "#fff",
  fontFamily: "var(--font-body)",
  fontSize: "0.9rem",
  color: "var(--color-text)",
  outline: "none",
  boxSizing: "border-box",
};

const colorChipStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  padding: 0,
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "transparent",
  cursor: "pointer",
};

const applyButtonStyle: React.CSSProperties = {
  padding: "0.55rem 1rem",
  border: "1px solid var(--color-burgundy)",
  borderRadius: "var(--radius-pill)",
  background: "var(--color-burgundy)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const resetButtonStyle: React.CSSProperties = {
  padding: "0.5rem 0.9rem",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-pill)",
  background: "#fff",
  color: "var(--color-text)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

const savedFlashStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 13,
  color: "var(--color-burgundy)",
  fontWeight: 600,
};

const codeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "0.85em",
  background: "var(--color-cream)",
  padding: "0.1rem 0.35rem",
  borderRadius: 4,
  margin: "0 0.2rem",
};

const dotStyle: React.CSSProperties = {
  display: "inline-block",
  margin: "0 6px",
  color: "var(--color-text-dim)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.6rem 0.85rem",
  background: "#fff",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  marginBottom: 6,
  fontSize: 14,
};

const addRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const addBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "0.55rem 0.9rem",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "#fff",
  color: "var(--color-text)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const miniGhost: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--color-text-dim)",
  cursor: "pointer",
  padding: 4,
};

const autopopBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "0.4rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: 999,
  background: "var(--color-cream)",
  color: "var(--color-text-dim)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const triggerCardStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  padding: "0.85rem 1rem",
  background: "#fff",
  boxShadow: "var(--shadow-xs)",
};

const triggerHeaderRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
};

const needsSetupBadge: React.CSSProperties = {
  fontSize: 11,
  background: "#fdf0e6",
  color: "#a85b1c",
  padding: "0.15rem 0.55rem",
  borderRadius: 999,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const legacyHintStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "0.55rem 0.75rem",
  borderRadius: 8,
  background: "#fdf0e6",
  color: "#a85b1c",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 12,
};

const saveBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
  marginTop: "2rem",
  padding: "1rem 1.15rem",
  background: "var(--color-cream)",
  borderRadius: 10,
};
