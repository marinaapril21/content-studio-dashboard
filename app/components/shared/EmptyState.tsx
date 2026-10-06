"use client";
import CopyPromptButton, { FatPromptPreview } from "./CopyPromptButton";

interface EmptyStateProps {
  /** Big headline, e.g. "No pillars yet" */
  title: string;
  /** One-paragraph explanation of what this tab will hold once populated. */
  body: string;
  /**
   * The data-injected prompt builder. When provided, EmptyState renders a
   * primary CopyPromptButton that copies the full text + opens ChatGPT Work
   * in a new tab. This is the ChatGPT Work happy path.
   */
  claudePrompt?: () => Promise<string> | string;
  /** Optional override for the ChatGPT Work button label. */
  claudeButtonLabel?: string;
  /** Optional secondary action (button label + onClick) — used for "Add by hand". */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Shared empty-state card.
 *
 * Two intended paths into a tab once it&apos;s empty:
 *
 *   1. ChatGPT Work path (default & primary): one button → copies the
 *      data-injected prompt + opens ChatGPT Work. The user pastes, gets a
 *      structured reply, pastes the reply back into the relevant editor.
 *
 *   2. Hand path: secondary button opens the section&apos;s inline editor so
 *      they can type their first row without touching ChatGPT Work at all.
 *
 * The customer never has to install a CLI, never has to find a file in their
 * GitHub fork, never has to know what &ldquo;ChatGPT Work&rdquo; is. Everything
 * needed for ChatGPT Work lives inside the button above — the prompt is built with
 * their data baked in, and the round-trip back lands in the editor on this
 * same tab.
 */
export default function EmptyState({
  title,
  body,
  claudePrompt,
  claudeButtonLabel,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const hasClaudeButton = !!claudePrompt;
  const hasHandButton = !!(actionLabel && onAction);

  return (
    <div
      style={{
        background: "#fff",
        border: "2px dashed var(--color-border)",
        borderRadius: "16px",
        padding: "3.25rem 2rem",
        textAlign: "center",
        maxWidth: "640px",
        margin: "0 auto",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-header)",
          fontSize: "1.35rem",
          marginBottom: "0.65rem",
          color: "var(--color-text)",
        }}
      >
        {title}
      </p>
      <p
        style={{
          color: "var(--color-text-dim)",
          fontSize: "0.9rem",
          marginBottom: hasClaudeButton || hasHandButton ? "1.6rem" : 0,
          lineHeight: 1.55,
        }}
      >
        {body}
      </p>

      {/* Visible / copyable / editable fat prompt FIRST — the customer
          READS what would go into ChatGPT Work before they decide to click the
          button. Thessa's UX note: "de prompt boven de claude knop, dat is
          de volgorde waarin ze ook werkt". Opens by default so the prompt
          is the primary visible content of the empty state. */}
      {hasClaudeButton && (
        <div style={{ marginBottom: "1rem" }}>
          {/* The disclosure toggle button inherits the card's textAlign:center
              so it sits centered above the CTAs; the inner cream box that
              holds the textarea has its own textAlign:left so the prompt
              reads naturally inside that box. */}
          <FatPromptPreview buildPrompt={claudePrompt!} defaultOpen />
        </div>
      )}

      {/* Then the CTAs below the prompt. The ChatGPT Work button copies the same
          text the customer just read and opens ChatGPT Work. The hand-action
          button (when present) is the "skip ChatGPT Work, type it myself" path. */}
      {(hasClaudeButton || hasHandButton) && (
        <div
          style={{
            display: "inline-flex",
            gap: "0.55rem",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {hasClaudeButton && (
            <CopyPromptButton
              label={claudeButtonLabel ?? "Copy prompt with my data"}
              buildPrompt={claudePrompt!}
              tone="primary"
            />
          )}
          {hasHandButton && (
            <button
              type="button"
              onClick={onAction}
              style={{
                background: hasClaudeButton ? "#fff" : "var(--color-burgundy)",
                border: hasClaudeButton ? "1px solid var(--color-border)" : "none",
                color: hasClaudeButton ? "var(--color-text)" : "#fff",
                padding: "0.55rem 1.1rem",
                borderRadius: "10px",
                fontSize: "0.82rem",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: hasClaudeButton ? "none" : "var(--shadow-sm)",
              }}
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}

      <p
        style={{
          marginTop: "1.4rem",
          fontSize: "0.72rem",
          color: "var(--color-text-dim)",
          lineHeight: 1.55,
          maxWidth: "440px",
          margin: "1.4rem auto 0",
        }}
      >
        {hasClaudeButton
          ? "Copy the prompt, paste it into your ChatGPT Work chat, then paste the JSON reply back into this tab."
          : "Open ChatGPT Work, paste this prompt, then paste ChatGPT Work’s reply back into the editor here."}
      </p>
    </div>
  );
}
