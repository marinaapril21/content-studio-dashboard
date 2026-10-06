"use client";
import { useState } from "react";
import { ClipboardPaste, Check, AlertTriangle, X } from "lucide-react";

/**
 * PasteFromClaude.
 *
 * The "close the loop" component. Customer copies the prompt, pastes into
 * ChatGPT Work, gets back JSON (or Markdown for the caption case). They paste
 * that reply into this textarea, hit Parse, see what was extracted, and hit
 * Apply to populate the editor above with the parsed values.
 *
 * Generic over the parser's output type T. The editor passes:
 *   - parse: (text: string) -> { ok: true; value: T } | { ok: false; error: string }
 *     A pure function that accepts ChatGPT Work's raw reply and returns either the
 *     parsed value or a human-readable error. Use this hook to strip code
 *     fences, validate the schema, and coerce field types.
 *   - render: (value: T) -> ReactNode (optional)
 *     A small preview of what will be applied. Defaults to JSON pretty-print.
 *   - onApply: (value: T) -> void
 *     Editor populates its state from this.
 *   - label: string
 *     The collapsible button label ("Paste ChatGPT Work's JSON", "Paste ChatGPT Work's reply").
 *
 * Why one component, not 4 copies: the parse/preview/apply flow is identical
 * across pillars / voice / hooks / draft. Only the schema differs. Keeping it
 * in one place means a fix to the UX (e.g. "auto-strip ```json fences") lands
 * in every editor at once.
 */
export default function PasteFromClaude<T>({
  label = "Paste ChatGPT Work's reply",
  parse,
  render,
  onApply,
}: {
  label?: string;
  parse: (text: string) => { ok: true; value: T } | { ok: false; error: string };
  render?: (value: T) => React.ReactNode;
  onApply: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleParse() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Paste the reply ChatGPT Work gave you first.");
      setParsed(null);
      return;
    }
    const r = parse(trimmed);
    if (r.ok) {
      setParsed(r.value);
      setError(null);
    } else {
      setParsed(null);
      setError(r.error);
    }
  }

  function handleApply() {
    if (parsed === null) return;
    onApply(parsed);
    setText("");
    setParsed(null);
    setError(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: "var(--color-cream)",
          border: "1px dashed var(--color-burgundy)",
          color: "var(--color-burgundy)",
          padding: "0.5rem 0.95rem",
          borderRadius: "8px",
          fontSize: "0.78rem",
          fontFamily: "var(--font-body)",
          fontWeight: 600,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          marginBottom: "0.85rem",
        }}
      >
        <ClipboardPaste size={13} strokeWidth={2} />
        {label}
      </button>
    );
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--color-burgundy)",
        borderRadius: "10px",
        padding: "0.85rem 1rem",
        marginBottom: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
        }}
      >
        <p
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-burgundy)",
            fontWeight: 700,
            margin: 0,
          }}
        >
          {label}
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
            setParsed(null);
            setError(null);
          }}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-text-dim)",
            cursor: "pointer",
            padding: "0.2rem",
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setParsed(null);
          setError(null);
        }}
        placeholder="Paste exactly what ChatGPT Work returned. The parser will strip code fences automatically."
        rows={8}
        style={{
          width: "100%",
          padding: "0.6rem 0.85rem",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          fontSize: "0.82rem",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          background: "#fff",
          color: "var(--color-text)",
          boxSizing: "border-box",
          outline: "none",
          resize: "vertical",
        }}
      />

      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.4rem",
            background: "var(--color-cream)",
            color: "var(--color-burgundy)",
            padding: "0.5rem 0.75rem",
            borderRadius: "8px",
            fontSize: "0.78rem",
            marginTop: "0.55rem",
          }}
        >
          <AlertTriangle size={13} strokeWidth={2} style={{ flexShrink: 0, marginTop: "1px" }} />
          {error}
        </div>
      )}

      {parsed !== null && (
        <div
          style={{
            marginTop: "0.65rem",
            padding: "0.65rem 0.85rem",
            background: "var(--color-cream)",
            borderRadius: "8px",
            fontSize: "0.78rem",
            color: "var(--color-text)",
            maxHeight: "260px",
            overflowY: "auto",
          }}
        >
          <p
            style={{
              fontSize: "0.65rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--color-burgundy)",
              fontWeight: 700,
              marginBottom: "0.4rem",
              margin: 0,
            }}
          >
            Parsed. Apply to populate the editor below?
          </p>
          <div style={{ marginTop: "0.4rem" }}>
            {render
              ? render(parsed)
              : (
                  <pre style={{ margin: 0, fontFamily: "var(--font-mono, ui-monospace, monospace)", whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(parsed, null, 2)}
                  </pre>
                )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.7rem" }}>
        <button
          type="button"
          onClick={handleParse}
          disabled={text.trim().length === 0}
          style={{
            background: "var(--color-cream)",
            border: "1px solid var(--color-burgundy)",
            color: "var(--color-burgundy)",
            padding: "0.45rem 0.95rem",
            borderRadius: "8px",
            fontSize: "0.78rem",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            cursor: text.trim().length === 0 ? "not-allowed" : "pointer",
            opacity: text.trim().length === 0 ? 0.55 : 1,
          }}
        >
          Parse
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={parsed === null}
          style={{
            background: parsed === null ? "var(--color-cream)" : "var(--color-burgundy)",
            border: "none",
            color: parsed === null ? "var(--color-text-dim)" : "#fff",
            padding: "0.45rem 0.95rem",
            borderRadius: "8px",
            fontSize: "0.78rem",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            cursor: parsed === null ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
          }}
        >
          <Check size={13} strokeWidth={2.2} />
          Apply
        </button>
      </div>
    </div>
  );
}

/**
 * stripCodeFences.
 *
 * ChatGPT Work wraps its JSON reply in ```json … ``` about 80% of the time.
 * This util pulls the inner block, ignoring leading prose, the language tag,
 * and surrounding whitespace. Falls back to the raw input if no fence is
 * found.
 *
 * Exported so individual parsers can compose it before JSON.parse.
 */
export function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:json|markdown|md)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  return raw.trim();
}
