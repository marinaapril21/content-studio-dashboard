"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

interface ScrapeNowButtonProps {
  /** Called after the scrape API responds, so the parent can refetch its data. */
  onComplete?: () => void;
  /** Optional scrape scope. Defaults to "all" (own handle + competitors). */
  mode?: "all" | "self" | "competitors";
  /**
   * Block the scrape while the parent tab has unsaved local edits open.
   * `onComplete` (usually the tab's `load()`) flips a `loading` flag that
   * unmounts whatever editor is open, discarding anything typed but not
   * saved yet (2026-08-17, same accordion-save bug class found on
   * SellBySunday's Step 4, present here via a different trigger: Scrape
   * now instead of an accordion collapse). Defaults to false so tabs
   * without an edit-mode concept are unaffected.
   */
  disabled?: boolean;
}

/**
 * Shared [Scrape now] button.
 * POSTs to /api/scrape, shows spinner while running, fires onComplete on success.
 * Lives on every tab so the user never has to navigate to refresh data.
 */
export default function ScrapeNowButton({ onComplete, mode = "all", disabled = false }: ScrapeNowButtonProps) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runScrape() {
    if (disabled) return;
    setRunning(true);
    setError(null);
    try {
      type Result = { ok?: boolean; status?: string; jobId?: string; errors?: string[] };
      const request = async (jobId?: string): Promise<Result> => {
        const res = await fetch("/api/scrape", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, jobId }),
        });
        return res.json();
      };
      let result = await request();
      const deadline = Date.now() + 7 * 60 * 1000;
      while (result.ok && result.status === 'running' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        result = await request(result.jobId);
      }
      if (result.ok && result.status === 'running') {
        setError('Still running. Click again to resume checking the same run.');
        return;
      }
      if (!result.ok) {
        setError((result.errors ?? ["Scrape failed"]).join(", "));
      } else {
        // Let any sibling listener (Sidebar footer pill, future widgets)
        // know a scrape just completed, so they can refetch the latest
        // scraped_at and flip from Offline → Live without a reload.
        try {
          window.dispatchEvent(new CustomEvent("cs-scrape:done"));
        } catch {
          // CustomEvent is supported everywhere we target; if a host env
          // somehow rejects it, the sidebar still refreshes on next mount.
        }
        onComplete?.();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35rem" }}>
      <button
        onClick={runScrape}
        disabled={running || disabled}
        title={disabled ? "Finish saving or cancel your open edit first" : undefined}
        style={{
          background: running || disabled ? "var(--color-taupe)" : "var(--color-burgundy)",
          border: "none",
          color: "#fff",
          padding: "0.65rem 1.25rem",
          borderRadius: "10px",
          fontSize: "0.85rem",
          cursor: running || disabled ? "not-allowed" : "pointer",
          opacity: disabled && !running ? 0.55 : 1,
          fontFamily: "var(--font-body)",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.45rem",
          boxShadow: "var(--shadow-sm)",
          transition: "background 180ms ease",
        }}
      >
        <RefreshCw
          size={14}
          strokeWidth={2.2}
          style={{
            animation: running ? "spin 1s linear infinite" : "none",
          }}
        />
        {running ? "Scraping..." : "Scrape now"}
      </button>
      {error && (
        <span style={{ fontSize: "0.7rem", color: "var(--color-burgundy)" }}>{error}</span>
      )}
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
