"use client";
import { useEffect, useState } from "react";
import { Sparkles, Pencil, Plus, X, Check } from "lucide-react";
import config from "../../../config.json";
import TabContainer from "../shared/TabContainer";
import TabHeader from "../shared/TabHeader";
import EmptyState from "../shared/EmptyState";
import PasteFromClaude, { stripCodeFences } from "../shared/PasteFromClaude";
import CopyPromptButton, { FatPromptPreview } from "../shared/CopyPromptButton";
import { buildPillarsPrompt, buildVoicePrompt, buildHooksPrompt } from "../../../lib/promptBuilders";

type Pillar = {
  name: string;
  description?: string;
  share?: number; // 0..1
  color?: string;
};

type Campaign = {
  name: string;
  status: "active" | "planned" | "done";
  note?: string;
};

type Voice = {
  tone?: string | null;
  rules?: string[];
  signature_phrases?: string[];
  forbidden?: string[];
};

type Hook = {
  text: string;
  type?: string;             // curiosity | contrarian | promise | numbered | …
  source?: "mine" | "competitor";
  note?: string;
};

type StrategyData = {
  id?: string;
  pillars: Pillar[];
  voice?: Voice;
  voice_rules?: string[];
  voice_tone?: string | null;
  voice_signature_phrases?: string[];
  voice_forbidden?: string[];
  campaigns: Campaign[];
  hooks: Hook[];
  ica_notes?: string | null;
  scraped_at?: string | null;
  updated_at?: string | null;
};

type EditSection = "pillars" | "voice" | "hooks" | "campaigns" | "ica" | null;

/**
 * Strategy tab.
 *
 * What lives here:
 *  - Content pillars (extracted via the Pillars prompt button, editable here)
 *  - Voice rules     (extracted via the Voice prompt button, editable here)
 *  - Current campaigns + ICA notes (editable here by hand)
 *
 * Each section has its own inline edit mode. Saves PATCH the most recent
 * strategy row, or POST a brand-new one on first install.
 *
 * No CLI, no file paths. Every section that needs ChatGPT Work has its own button
 * that builds a prompt with the user's data baked in and opens ChatGPT Work.
 */
export default function Strategy() {
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EditSection>(null);

  const load = (signal?: AbortSignal) => {
    setLoading(true);
    fetch("/api/data?tab=strategy", { signal })
      .then((r) => r.json())
      .then((r) => {
        if (signal?.aborted) return;
        setData(r.data ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setLoading(false);
      });
  };

  // Abort the in-flight fetch on unmount so we never setState on a dead
  // component (tab switch mid-load, navigation away during save reload).
  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, []);

  // Normalize the GET response shape into the UI-side flat fields so a fresh
  // POST response can be slotted straight into `data` without waiting for the
  // next load() round-trip — prevents the second click from triggering a
  // second POST while `data.id` is still undefined.
  function normalizeRow(row: Record<string, unknown> | null): StrategyData | null {
    if (!row) return null;
    const voice = (row.voice && typeof row.voice === "object" && !Array.isArray(row.voice)
      ? (row.voice as Voice)
      : {}) as Voice;
    return {
      ...(row as unknown as StrategyData),
      voice_rules: Array.isArray(voice.rules) ? voice.rules : [],
      voice_tone: typeof voice.tone === "string" ? voice.tone : null,
      voice_signature_phrases: Array.isArray(voice.signature_phrases) ? voice.signature_phrases : [],
      voice_forbidden: Array.isArray(voice.forbidden) ? voice.forbidden : [],
    };
  }

  async function save(patch: Partial<StrategyData> & { voice?: Voice }) {
    if (saving) return; // Hard guard against double-clicks before saving flips
    setSaving(true);
    try {
      if (data?.id) {
        // Existing row → PATCH
        const res = await fetch("/api/data?tab=strategy", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: data.id, ...patch }),
        });
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          // Slot the fresh row straight in so subsequent edits PATCH instead
          // of POST-ing a duplicate.
          const normalized = normalizeRow(json?.data ?? null);
          if (normalized) setData(normalized);
          setEditing(null);
        }
      } else {
        // First save → POST a brand-new row.
        // Every editable column must appear here, otherwise the very first save
        // from inside that editor (e.g. opening Hooks editor before pillars
        // exist) would land an empty value in the DB and the user's input
        // would disappear on next reload.
        const res = await fetch("/api/data?tab=strategy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pillars: patch.pillars ?? [],
            voice: patch.voice ?? {},
            hooks: patch.hooks ?? [],
            campaigns: patch.campaigns ?? [],
            ica_notes: patch.ica_notes ?? null,
          }),
        });
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          // Critical: the POST response carries the new row's id. Storing it
          // immediately means a fast second Save click goes through PATCH, not
          // a second POST that would leave duplicate rows in the table.
          const normalized = normalizeRow(json?.data ?? null);
          if (normalized) setData(normalized);
          setEditing(null);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  const pillars = data?.pillars ?? [];
  const campaigns = data?.campaigns ?? [];
  const hooks = data?.hooks ?? [];
  const voiceRules = data?.voice_rules ?? config.voice?.rules ?? [];
  const voiceTone = data?.voice_tone ?? null;
  const voiceSignaturePhrases = data?.voice_signature_phrases ?? [];
  const voiceForbidden = data?.voice_forbidden ?? [];

  const hasPillars = pillars.length > 0;
  const hasVoice = voiceRules.length > 0 || !!voiceTone;
  const hasHooks = hooks.length > 0;
  const hasCampaigns = campaigns.length > 0;
  const hasAny = hasPillars || hasVoice || hasHooks || hasCampaigns || !!data?.ica_notes;

  return (
    <TabContainer>
      <TabHeader
        title="Strategy"
        subtitle="Your content pillars, voice rules, and current campaigns. Edit them by hand here, or click any section's empty-state button to copy a prompt for ChatGPT Work and paste the JSON reply back."
        scrapedAt={data?.scraped_at}
        onScrapeComplete={load}
        scrapeDisabled={editing !== null}
      />

      {loading && (
        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: "120px" }} />
          ))}
        </div>
      )}

      {!loading && !hasAny && editing === null && (
        <EmptyState
          title="No strategy mapped yet"
          body="Click below to copy a prompt pre-filled with your last 30 posts. Paste the copied prompt into your ChatGPT Work chat. Paste, wait for the JSON reply, paste it back here. Or skip ChatGPT Work and fill the fields by hand with the second button."
          claudePrompt={buildPillarsPrompt}
          claudeButtonLabel="Get pillars from ChatGPT Work"
          actionLabel="Start by hand"
          onAction={() => setEditing("pillars")}
        />
      )}

      {!loading && (hasAny || editing !== null) && (
        <>
          {/* Pillars */}
          <Section
            title="Content pillars"
            onEdit={() => setEditing("pillars")}
            isEditing={editing === "pillars"}
            editDisabled={editing !== null && editing !== "pillars"}
          >
            {editing === "pillars" ? (
              <PillarsEditor
                initial={pillars}
                saving={saving}
                onCancel={() => setEditing(null)}
                onSave={(next) => save({ pillars: next })}
              />
            ) : hasPillars ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "1rem",
                }}
              >
                {pillars.map((p) => (
                  <div
                    key={p.name}
                    style={{
                      background: "#fff",
                      border: "1px solid var(--color-border)",
                      borderLeft: `4px solid ${p.color ?? "var(--color-burgundy)"}`,
                      borderRadius: "12px",
                      padding: "1rem 1.25rem",
                      boxShadow: "var(--shadow-sm)",
                    }}
                  >
                    <p style={{ fontFamily: "var(--font-header)", fontSize: "1.1rem", marginBottom: "0.3rem" }}>
                      {p.name}
                    </p>
                    {p.description && (
                      <p style={{ fontSize: "0.82rem", color: "var(--color-text-dim)", lineHeight: 1.5 }}>
                        {p.description}
                      </p>
                    )}
                    {typeof p.share === "number" && (
                      <p style={{ fontSize: "0.7rem", color: "var(--color-taupe)", marginTop: "0.5rem" }}>
                        {Math.round(p.share * 100)}% of recent posts
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <InlineEmptyWithClaude
                body="Click Edit to add your first pillar by hand, or copy a prompt for ChatGPT Work and paste the JSON reply back."
                buildPrompt={buildPillarsPrompt}
                claudeLabel="Get pillars from ChatGPT Work"
              />
            )}
          </Section>

          {/* Voice */}
          <Section
            title="Voice rules"
            onEdit={() => setEditing("voice")}
            isEditing={editing === "voice"}
            editDisabled={editing !== null && editing !== "voice"}
          >
            {editing === "voice" ? (
              <VoiceEditor
                initialTone={voiceTone ?? ""}
                initialRules={voiceRules}
                initialSignaturePhrases={voiceSignaturePhrases}
                initialForbidden={voiceForbidden}
                saving={saving}
                onCancel={() => setEditing(null)}
                onSave={(voice) => save({ voice })}
              />
            ) : hasVoice ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {voiceTone && (
                  <div
                    style={{
                      background: "var(--color-cream)",
                      borderRadius: "8px",
                      padding: "0.7rem 1rem",
                      fontSize: "0.85rem",
                      color: "var(--color-text)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.65rem",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--color-taupe)",
                        fontWeight: 700,
                        marginRight: "0.6rem",
                      }}
                    >
                      Tone
                    </span>
                    {voiceTone}
                  </div>
                )}

                {voiceRules.length > 0 && (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
                    {voiceRules.map((rule) => (
                      <li
                        key={rule}
                        style={{
                          background: "#fff",
                          border: "1px solid var(--color-border)",
                          borderRadius: "8px",
                          padding: "0.6rem 0.95rem",
                          fontSize: "0.88rem",
                          color: "var(--color-text)",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.55rem",
                        }}
                      >
                        <Sparkles size={13} strokeWidth={1.8} style={{ color: "var(--color-taupe)", flexShrink: 0 }} />
                        {rule}
                      </li>
                    ))}
                  </ul>
                )}

                {voiceSignaturePhrases.length > 0 && (
                  <div>
                    <p
                      style={{
                        fontSize: "0.65rem",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--color-taupe)",
                        fontWeight: 700,
                        marginBottom: "0.45rem",
                      }}
                    >
                      Signature phrases
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {voiceSignaturePhrases.map((phrase) => (
                        <span
                          key={phrase}
                          style={{
                            background: "var(--color-burgundy-soft, #fdf0f0)",
                            color: "var(--color-burgundy)",
                            padding: "0.25rem 0.7rem",
                            borderRadius: "20px",
                            fontSize: "0.78rem",
                            fontWeight: 600,
                          }}
                        >
                          {phrase}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {voiceForbidden.length > 0 && (
                  <div>
                    <p
                      style={{
                        fontSize: "0.65rem",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--color-taupe)",
                        fontWeight: 700,
                        marginBottom: "0.45rem",
                      }}
                    >
                      Forbidden
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {voiceForbidden.map((item) => (
                        <span
                          key={item}
                          style={{
                            background: "var(--color-cream)",
                            color: "var(--color-text-dim)",
                            padding: "0.25rem 0.7rem",
                            borderRadius: "20px",
                            fontSize: "0.78rem",
                            fontWeight: 600,
                            textDecoration: "line-through",
                            textDecorationThickness: "1px",
                          }}
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <InlineEmptyWithClaude
                body="Click Edit to write your voice rules by hand, or copy a prompt for ChatGPT Work and paste the JSON reply back."
                buildPrompt={buildVoicePrompt}
                claudeLabel="Get voice rules from ChatGPT Work"
              />
            )}
          </Section>

          {/* Hooks */}
          <Section
            title="Hook library"
            onEdit={() => setEditing("hooks")}
            isEditing={editing === "hooks"}
            editDisabled={editing !== null && editing !== "hooks"}
          >
            {editing === "hooks" ? (
              <HooksEditor
                initial={hooks}
                saving={saving}
                onCancel={() => setEditing(null)}
                onSave={(next) => save({ hooks: next })}
              />
            ) : hasHooks ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {hooks.map((h, i) => (
                  <div
                    key={`${h.text}-${i}`}
                    style={{
                      background: "#fff",
                      border: "1px solid var(--color-border)",
                      borderLeft: `3px solid ${
                        h.source === "competitor" ? "var(--color-taupe)" : "var(--color-burgundy)"
                      }`,
                      borderRadius: "10px",
                      padding: "0.75rem 1.1rem",
                    }}
                  >
                    <p style={{ fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "0.3rem" }}>
                      &ldquo;{h.text}&rdquo;
                    </p>
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      {h.type && <Pill>{h.type}</Pill>}
                      {h.source && <Pill tone="dim">{h.source === "mine" ? "Mine" : "Competitor"}</Pill>}
                      {h.note && (
                        <span style={{ fontSize: "0.72rem", color: "var(--color-text-dim)" }}>{h.note}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <InlineEmptyWithClaude
                body="Click Edit to log a hook by hand, or copy a prompt for ChatGPT Work and paste the JSON reply back."
                buildPrompt={buildHooksPrompt}
                claudeLabel="Get hooks from ChatGPT Work"
              />
            )}
          </Section>

          {/* Campaigns */}
          <Section
            title="Current campaigns"
            onEdit={() => setEditing("campaigns")}
            isEditing={editing === "campaigns"}
            editDisabled={editing !== null && editing !== "campaigns"}
          >
            {editing === "campaigns" ? (
              <CampaignsEditor
                initial={campaigns}
                saving={saving}
                onCancel={() => setEditing(null)}
                onSave={(next) => save({ campaigns: next })}
              />
            ) : hasCampaigns ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {campaigns.map((c) => (
                  <div
                    key={c.name}
                    style={{
                      background: "#fff",
                      border: "1px solid var(--color-border)",
                      borderRadius: "10px",
                      padding: "0.75rem 1.1rem",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <div>
                      <p style={{ fontSize: "0.95rem", fontWeight: 600 }}>{c.name}</p>
                      {c.note && (
                        <p style={{ fontSize: "0.78rem", color: "var(--color-text-dim)", marginTop: "0.2rem" }}>
                          {c.note}
                        </p>
                      )}
                    </div>
                    <CampaignPill status={c.status} />
                  </div>
                ))}
              </div>
            ) : (
              <InlineEmpty body="Click Edit to log a campaign you&apos;re running this week. Name it, set status, add an optional note." />
            )}
          </Section>

          {/* ICA notes */}
          <Section
            title="ICA notes"
            onEdit={() => setEditing("ica")}
            isEditing={editing === "ica"}
            editDisabled={editing !== null && editing !== "ica"}
          >
            {editing === "ica" ? (
              <IcaEditor
                initial={data?.ica_notes ?? ""}
                saving={saving}
                onCancel={() => setEditing(null)}
                onSave={(next) => save({ ica_notes: next })}
              />
            ) : data?.ica_notes ? (
              <div
                style={{
                  background: "var(--color-cream)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "10px",
                  padding: "1rem 1.25rem",
                  fontSize: "0.88rem",
                  lineHeight: 1.6,
                  color: "var(--color-text)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {data.ica_notes}
              </div>
            ) : (
              <InlineEmpty body="Click Edit to describe your ideal customer in your own words." />
            )}
          </Section>
        </>
      )}
    </TabContainer>
  );
}

/* ─────────── Section frame with Edit toggle ─────────── */

function Section({
  title,
  onEdit,
  isEditing,
  editDisabled,
  children,
}: {
  title: string;
  onEdit?: () => void;
  isEditing?: boolean;
  // True when a DIFFERENT section is currently being edited. Each editor
  // keeps its typed text in local useState with no autosave/draft, so
  // switching to another section's Edit before Save/Cancel would unmount
  // this one and silently discard whatever was typed (2026-08-17, same bug
  // class Thessa reported on SellBySunday's Step 4 accordions, found here
  // during that follow-up check). Blocking the switch is simpler and safer
  // than trying to auto-flush local component state across five independent
  // editors, so the Edit button is disabled instead of hidden, with a title
  // explaining why, until the open editor is saved or cancelled.
  editDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: "2.25rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "0.85rem",
          gap: "0.6rem",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ fontFamily: "var(--font-header)", fontSize: "1.2rem", margin: 0 }}>{title}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          {onEdit && !isEditing && (
            <button
              onClick={editDisabled ? undefined : onEdit}
              disabled={editDisabled}
              style={editDisabled ? { ...editBtn, opacity: 0.45, cursor: "not-allowed" } : editBtn}
              aria-label={`Edit ${title}`}
              title={editDisabled ? "Finish saving or cancel the section you're editing first" : undefined}
            >
              <Pencil size={12} strokeWidth={1.8} style={{ marginRight: "0.3rem" }} />
              Edit
            </button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/* ─────────── Pillars editor ─────────── */

function PillarsEditor({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: Pillar[];
  saving: boolean;
  onCancel: () => void;
  onSave: (next: Pillar[]) => void;
}) {
  const [items, setItems] = useState<Pillar[]>(
    initial.length > 0 ? initial : [{ name: "", description: "" }]
  );

  const update = (i: number, patch: Partial<Pillar>) =>
    setItems(items.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const add = () => setItems([...items, { name: "", description: "" }]);

  // Preserve color + share when ChatGPT Work returned them so pillar cards keep
  // their distinct hue + percentage. We only strip empty fields, not typed
  // ones — losing color/share here was the bug.
  const cleaned = items
    .map((p) => ({
      name: p.name.trim(),
      description: p.description?.trim() || undefined,
      color: typeof p.color === "string" && p.color.trim() ? p.color.trim() : undefined,
      share: typeof p.share === "number" && Number.isFinite(p.share) ? p.share : undefined,
    }))
    .filter((p) => p.name.length > 0);

  return (
    <EditorShell saving={saving} onCancel={onCancel} onSave={() => onSave(cleaned)} disabled={cleaned.length === 0}>
      <PasteFromClaude<Pillar[]>
        label="Paste ChatGPT Work's pillars JSON"
        parse={parsePillarsReply}
        render={(arr) => (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.35rem" }}>
            {arr.map((p, idx) => (
              <li key={idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {p.color && (
                  <span
                    aria-hidden
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      background: p.color,
                      flexShrink: 0,
                    }}
                  />
                )}
                <strong style={{ fontFamily: "var(--font-header)" }}>{p.name}</strong>
                {typeof p.share === "number" && (
                  <span style={{ color: "var(--color-text-dim)", fontSize: "0.72rem" }}>
                    {Math.round(p.share * 100)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        onApply={(arr) => setItems(arr.length > 0 ? arr : [{ name: "", description: "" }])}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {items.map((p, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.4fr auto",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={p.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Pillar name (e.g. Mindset)"
              style={inputStyle}
            />
            <input
              type="text"
              value={p.description ?? ""}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="One-line description (optional)"
              style={inputStyle}
            />
            <button onClick={() => remove(i)} style={iconBtn} aria-label="Remove pillar">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} style={addRowBtn}>
        <Plus size={13} strokeWidth={2} style={{ marginRight: "0.3rem" }} />
        Add pillar
      </button>
    </EditorShell>
  );
}

/* ─────────── Voice editor ─────────── */

function VoiceEditor({
  initialTone,
  initialRules,
  initialSignaturePhrases,
  initialForbidden,
  saving,
  onCancel,
  onSave,
}: {
  initialTone: string;
  initialRules: string[];
  initialSignaturePhrases: string[];
  initialForbidden: string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (voice: Voice) => void;
}) {
  const [tone, setTone] = useState(initialTone);
  const [rules, setRules] = useState<string[]>(initialRules.length ? initialRules : [""]);
  const [signaturePhrases, setSignaturePhrases] = useState<string[]>(
    initialSignaturePhrases.length ? initialSignaturePhrases : [""]
  );
  const [forbidden, setForbidden] = useState<string[]>(initialForbidden.length ? initialForbidden : [""]);

  const clean = (arr: string[]) => arr.map((s) => s.trim()).filter((s) => s.length > 0);

  return (
    <EditorShell
      saving={saving}
      onCancel={onCancel}
      onSave={() =>
        onSave({
          tone: tone.trim() || undefined,
          rules: clean(rules),
          signature_phrases: clean(signaturePhrases),
          forbidden: clean(forbidden),
        })
      }
      disabled={
        !tone.trim() &&
        clean(rules).length === 0 &&
        clean(signaturePhrases).length === 0 &&
        clean(forbidden).length === 0
      }
    >
      <PasteFromClaude<Voice>
        label="Paste ChatGPT Work's voice JSON"
        parse={parseVoiceReply}
        render={(v) => (
          <div style={{ display: "grid", gap: "0.3rem" }}>
            {v.tone && (
              <p style={{ margin: 0 }}>
                <strong>Tone:</strong> {v.tone}
              </p>
            )}
            <p style={{ margin: 0, color: "var(--color-text-dim)" }}>
              {v.rules?.length ?? 0} rules · {v.signature_phrases?.length ?? 0} signature phrases ·{" "}
              {v.forbidden?.length ?? 0} forbidden
            </p>
          </div>
        )}
        onApply={(v) => {
          setTone(v.tone ?? "");
          setRules(v.rules && v.rules.length > 0 ? v.rules : [""]);
          setSignaturePhrases(
            v.signature_phrases && v.signature_phrases.length > 0 ? v.signature_phrases : [""]
          );
          setForbidden(v.forbidden && v.forbidden.length > 0 ? v.forbidden : [""]);
        }}
      />

      <FieldLabel>Tone (one short phrase)</FieldLabel>
      <input
        type="text"
        value={tone}
        onChange={(e) => setTone(e.target.value)}
        placeholder='e.g. "warm, declarative, direct"'
        style={inputStyle}
      />

      <FieldLabel>Rules (do/don't statements)</FieldLabel>
      <StringList values={rules} onChange={setRules} placeholder='e.g. "Always opens with a declaration, never a question"' />

      <FieldLabel>Signature phrases</FieldLabel>
      <StringList
        values={signaturePhrases}
        onChange={setSignaturePhrases}
        placeholder="e.g. that one phrase you keep coming back to"
      />

      <FieldLabel>Forbidden (words/punctuation you never use)</FieldLabel>
      <StringList values={forbidden} onChange={setForbidden} placeholder='e.g. "no em dashes", "no hashtag spam"' />
    </EditorShell>
  );
}

/* ─────────── Hooks editor ─────────── */

function HooksEditor({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: Hook[];
  saving: boolean;
  onCancel: () => void;
  onSave: (next: Hook[]) => void;
}) {
  const [items, setItems] = useState<Hook[]>(
    initial.length > 0 ? initial : [{ text: "", type: "", source: "mine", note: "" }]
  );

  const update = (i: number, patch: Partial<Hook>) =>
    setItems(items.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const add = () => setItems([...items, { text: "", type: "", source: "mine", note: "" }]);

  const cleaned = items
    .map((h) => ({
      text: h.text.trim(),
      type: h.type?.trim() || undefined,
      source: h.source ?? "mine",
      note: h.note?.trim() || undefined,
    }))
    .filter((h) => h.text.length > 0);

  return (
    <EditorShell
      saving={saving}
      onCancel={onCancel}
      onSave={() => onSave(cleaned)}
      disabled={cleaned.length === 0}
    >
      <PasteFromClaude<Hook[]>
        label="Paste ChatGPT Work's hooks JSON"
        parse={parseHooksReply}
        render={(arr) => (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.3rem" }}>
            {arr.slice(0, 10).map((h, idx) => (
              <li key={idx} style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
                <span style={{ fontSize: "0.78rem" }}>&ldquo;{h.text}&rdquo;</span>
                <span style={{ fontSize: "0.7rem", color: "var(--color-text-dim)" }}>
                  {h.type ?? "(no type)"} · {h.source === "mine" ? "Mine" : "Competitor"}
                </span>
              </li>
            ))}
            {arr.length > 10 && (
              <li style={{ fontSize: "0.72rem", color: "var(--color-text-dim)" }}>
                ...and {arr.length - 10} more
              </li>
            )}
          </ul>
        )}
        onApply={(arr) =>
          setItems(arr.length > 0 ? arr : [{ text: "", type: "", source: "mine", note: "" }])
        }
      />

      <p style={{ fontSize: "0.78rem", color: "var(--color-text-dim)", marginBottom: "0.4rem" }}>
        One hook per row. These are the opening lines (or first 1-2 sentences) of posts that worked, your own or your competitors&apos;.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {items.map((h, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1.8fr 0.9fr 0.9fr auto",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={h.text}
              onChange={(e) => update(i, { text: e.target.value })}
              placeholder='e.g. "The reason your captions don’t convert is not the words. It’s the order."'
              style={inputStyle}
            />
            <input
              type="text"
              value={h.type ?? ""}
              onChange={(e) => update(i, { type: e.target.value })}
              placeholder="Type (curiosity, contrarian, promise…)"
              style={inputStyle}
            />
            <select
              value={h.source ?? "mine"}
              onChange={(e) => update(i, { source: e.target.value as Hook["source"] })}
              style={selectStyle}
            >
              <option value="mine">Mine</option>
              <option value="competitor">Competitor</option>
            </select>
            <button onClick={() => remove(i)} style={iconBtn} aria-label="Remove hook">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} style={addRowBtn}>
        <Plus size={13} strokeWidth={2} style={{ marginRight: "0.3rem" }} />
        Add hook
      </button>
    </EditorShell>
  );
}

/* ─────────── Campaigns editor ─────────── */

function CampaignsEditor({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: Campaign[];
  saving: boolean;
  onCancel: () => void;
  onSave: (next: Campaign[]) => void;
}) {
  const [items, setItems] = useState<Campaign[]>(
    initial.length > 0 ? initial : [{ name: "", status: "active", note: "" }]
  );

  const update = (i: number, patch: Partial<Campaign>) =>
    setItems(items.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const add = () => setItems([...items, { name: "", status: "planned", note: "" }]);

  const cleaned = items
    .map((c) => ({ ...c, name: c.name.trim(), note: c.note?.trim() || undefined }))
    .filter((c) => c.name.length > 0);

  return (
    <EditorShell
      saving={saving}
      onCancel={onCancel}
      onSave={() => onSave(cleaned)}
      disabled={cleaned.length === 0}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {items.map((c, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1.6fr auto auto",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={c.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Campaign name"
              style={inputStyle}
            />
            <input
              type="text"
              value={c.note ?? ""}
              onChange={(e) => update(i, { note: e.target.value })}
              placeholder="Note (optional)"
              style={inputStyle}
            />
            <select
              value={c.status}
              onChange={(e) => update(i, { status: e.target.value as Campaign["status"] })}
              style={selectStyle}
            >
              <option value="active">Active</option>
              <option value="planned">Planned</option>
              <option value="done">Done</option>
            </select>
            <button onClick={() => remove(i)} style={iconBtn} aria-label="Remove campaign">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} style={addRowBtn}>
        <Plus size={13} strokeWidth={2} style={{ marginRight: "0.3rem" }} />
        Add campaign
      </button>
    </EditorShell>
  );
}

/* ─────────── ICA editor ─────────── */

function IcaEditor({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (next: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <EditorShell
      saving={saving}
      onCancel={onCancel}
      onSave={() => onSave(text.trim())}
      disabled={false}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Who is this content for? Their situation, their pain, their words. Write like you're describing one person."
        rows={8}
        style={{ ...inputStyle, resize: "vertical" }}
      />
    </EditorShell>
  );
}

/* ─────────── Editor shell (Save / Cancel footer) ─────────── */

function EditorShell({
  saving,
  onCancel,
  onSave,
  disabled,
  children,
}: {
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--color-burgundy)",
        borderRadius: "14px",
        padding: "1.25rem 1.5rem",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>{children}</div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.1rem" }}>
        <button
          onClick={onSave}
          disabled={saving || disabled}
          style={{
            ...primaryBtn,
            opacity: saving || disabled ? 0.55 : 1,
            cursor: saving || disabled ? "not-allowed" : "pointer",
          }}
        >
          <Check size={13} strokeWidth={2.2} style={{ marginRight: "0.3rem" }} />
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={onCancel} style={ghostBtn} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ─────────── String-list helper (rules / phrases / forbidden) ─────────── */

function StringList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const update = (i: number, v: string) => onChange(values.map((s, idx) => (idx === i ? v : s)));
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const add = () => onChange([...values, ""]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {values.map((v, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="text"
            value={v}
            onChange={(e) => update(i, e.target.value)}
            placeholder={placeholder}
            style={inputStyle}
          />
          <button onClick={() => remove(i)} style={iconBtn} aria-label="Remove">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      ))}
      <button onClick={add} style={{ ...addRowBtn, alignSelf: "flex-start" }}>
        <Plus size={13} strokeWidth={2} style={{ marginRight: "0.3rem" }} />
        Add
      </button>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: "0.65rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--color-taupe)",
        fontWeight: 700,
        margin: "0.4rem 0 0.25rem",
      }}
    >
      {children}
    </p>
  );
}

/* ─────────── Inline empty + campaign pill ─────────── */

function InlineEmpty({ body }: { body: string }) {
  return (
    <div
      style={{
        background: "var(--color-cream)",
        border: "1px dashed var(--color-border)",
        borderRadius: "10px",
        padding: "1rem 1.25rem",
        fontSize: "0.82rem",
        color: "var(--color-text-dim)",
      }}
    >
      {body}
    </div>
  );
}

/**
 * InlineEmptyWithClaude.
 *
 * The per-section empty state. Same dashed cream block as InlineEmpty, but
 * includes a "Get X from ChatGPT Work" button that copies the section-specific
 * prompt and opens ChatGPT Work. Customer then comes back, hits Edit, and
 * pastes the JSON via the editor's PasteFromClaude block.
 *
 * The CopyPromptButton lives inline next to the body copy so the customer
 * sees the path in one glance: read sentence → click button → come back →
 * edit + paste reply.
 */
function InlineEmptyWithClaude({
  body,
  buildPrompt,
  claudeLabel,
}: {
  body: string;
  buildPrompt: () => Promise<string>;
  claudeLabel: string;
}) {
  return (
    <div
      style={{
        background: "var(--color-cream)",
        border: "1px dashed var(--color-border)",
        borderRadius: "10px",
        padding: "1rem 1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.65rem",
      }}
    >
      <p style={{ fontSize: "0.82rem", color: "var(--color-text-dim)", margin: 0 }}>{body}</p>
      {/* Prompt FIRST — the customer reads what would go into ChatGPT Work before
          the button. Thessa's UX note: "de prompt boven de claude knop, dat
          is de volgorde waarin ze ook werkt". Opens by default.
          Negative marginTop neutralizes FatPromptPreview's built-in 0.55rem
          top margin, which would otherwise stack on top of the parent flex
          gap (0.65rem) and create uneven vertical rhythm versus the gap
          below this block to the CopyPromptButton. */}
      <div style={{ marginTop: "-0.55rem" }}>
        <FatPromptPreview buildPrompt={buildPrompt} defaultOpen />
      </div>
      <div>
        <CopyPromptButton label={claudeLabel} buildPrompt={buildPrompt} tone="secondary" />
      </div>
    </div>
  );
}

function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "dim" }) {
  return (
    <span
      style={{
        fontSize: "0.66rem",
        background: tone === "dim" ? "var(--color-cream)" : "var(--color-burgundy-soft, #fdf0f0)",
        color: tone === "dim" ? "var(--color-text-dim)" : "var(--color-burgundy)",
        padding: "0.12rem 0.55rem",
        borderRadius: "20px",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </span>
  );
}

function CampaignPill({ status }: { status: Campaign["status"] }) {
  const map = {
    active: { bg: "var(--color-burgundy)", color: "#fff", label: "Active" },
    planned: { bg: "var(--color-cream)", color: "var(--color-burgundy)", label: "Planned" },
    done: { bg: "var(--color-cream)", color: "var(--color-text-dim)", label: "Done" },
  } as const;
  const s = map[status];
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "0.2rem 0.65rem",
        borderRadius: "20px",
        fontSize: "0.72rem",
        fontWeight: 600,
        letterSpacing: "0.04em",
        flexShrink: 0,
      }}
    >
      {s.label}
    </span>
  );
}

/* ─────────── Shared styles ─────────── */

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.55rem 0.85rem",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "0.85rem",
  fontFamily: "var(--font-body)",
  background: "#fff",
  color: "var(--color-text)",
  boxSizing: "border-box",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "0.82rem",
  fontFamily: "var(--font-body)",
  background: "#fff",
  color: "var(--color-text)",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  background: "var(--color-burgundy)",
  border: "none",
  color: "#fff",
  padding: "0.5rem 1.1rem",
  borderRadius: "8px",
  fontSize: "0.82rem",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
};

const ghostBtn: React.CSSProperties = {
  background: "var(--color-cream)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-dim)",
  padding: "0.45rem 0.95rem",
  borderRadius: "8px",
  fontSize: "0.8rem",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
};

const editBtn: React.CSSProperties = {
  background: "var(--color-cream)",
  border: "1px solid var(--color-border)",
  color: "var(--color-burgundy)",
  padding: "0.3rem 0.75rem",
  borderRadius: "8px",
  fontSize: "0.72rem",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
};

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-dim)",
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const addRowBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px dashed var(--color-border)",
  color: "var(--color-burgundy)",
  padding: "0.4rem 0.85rem",
  borderRadius: "8px",
  fontSize: "0.78rem",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "0.6rem",
  display: "inline-flex",
  alignItems: "center",
};

/* ─────────── ChatGPT Work-reply parsers ───────────
 *
 * Each parser accepts whatever ChatGPT Work returned (with or without ```json```
 * fences, with or without prose surrounding the JSON), and returns a
 * discriminated union: { ok: true; value } or { ok: false; error }.
 *
 * Errors must be short and actionable so the customer can fix their paste
 * without reading docs. The most common failure is: ChatGPT Work wrapped the JSON
 * in prose ("Here are your pillars: …") — stripCodeFences handles that.
 */

function parsePillarsReply(raw: string): { ok: true; value: Pillar[] } | { ok: false; error: string } {
  try {
    const body = stripCodeFences(raw);
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "Expected a JSON array of pillars at the top level." };
    }
    const value: Pillar[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (!name) continue;
      value.push({
        name,
        description: typeof r.description === "string" ? r.description.trim() : undefined,
        color: typeof r.color === "string" && /^#?[0-9a-f]{3,8}$/i.test(r.color.trim()) ?
          (r.color.trim().startsWith("#") ? r.color.trim() : "#" + r.color.trim()) : undefined,
        share: typeof r.share === "number" && Number.isFinite(r.share) ? Math.max(0, Math.min(1, r.share)) : undefined,
      });
    }
    if (value.length === 0) {
      return { ok: false, error: "Parsed JSON but found no pillars with a name." };
    }
    return { ok: true, value };
  } catch (e) {
    return {
      ok: false,
      error: "Could not parse as JSON. Make sure you copied ChatGPT Work's full reply, including the [ and ].",
    };
  }
}

function parseVoiceReply(raw: string): { ok: true; value: Voice } | { ok: false; error: string } {
  try {
    const body = stripCodeFences(raw);
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Expected a JSON object with tone / rules / signature_phrases / forbidden." };
    }
    const r = parsed as Record<string, unknown>;
    const cleanList = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim()) : [];
    return {
      ok: true,
      value: {
        tone: typeof r.tone === "string" ? r.tone.trim() : undefined,
        rules: cleanList(r.rules),
        signature_phrases: cleanList(r.signature_phrases ?? r.signaturePhrases),
        forbidden: cleanList(r.forbidden),
      },
    };
  } catch {
    return {
      ok: false,
      error: "Could not parse as JSON. Make sure you copied the whole object including the { and }.",
    };
  }
}

function parseHooksReply(raw: string): { ok: true; value: Hook[] } | { ok: false; error: string } {
  try {
    const body = stripCodeFences(raw);
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "Expected a JSON array of hooks." };
    }
    const value: Hook[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const text = typeof r.text === "string" ? r.text.trim() : "";
      if (!text) continue;
      // Source mapping: prompt schema says "mine" or "@handle". Editor only
      // knows "mine" | "competitor", so anything not "mine" or "self" becomes
      // "competitor". The handle itself is preserved into the note field if
      // not already present, so the customer doesn't lose attribution.
      const srcRaw = typeof r.source === "string" ? r.source.trim() : "";
      const isMine = srcRaw === "mine" || srcRaw === "self";
      const noteRaw = typeof r.note === "string" ? r.note.trim() : "";
      const note = !isMine && srcRaw && !noteRaw ? `via ${srcRaw}` :
                   !isMine && srcRaw && noteRaw && !noteRaw.includes(srcRaw) ? `${noteRaw} (via ${srcRaw})` :
                   noteRaw || undefined;
      value.push({
        text,
        type: typeof r.type === "string" ? r.type.trim() : undefined,
        source: isMine ? "mine" : "competitor",
        note,
      });
    }
    if (value.length === 0) {
      return { ok: false, error: "Parsed JSON but found no hooks with text." };
    }
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      error: "Could not parse as JSON. Make sure you copied ChatGPT Work's full reply, including the [ and ].",
    };
  }
}
