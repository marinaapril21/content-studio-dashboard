/**
 * fenceData.
 *
 * Wraps a raw data payload in a fenced ```LABEL``` block so ChatGPT Work treats it as
 * literal context, not free-form prose to interpret.
 *
 * Lives in a plain `.ts` util (no React, no "use client") so it can be
 * imported safely from anywhere — promptBuilders.ts, server components,
 * route handlers, client components alike. It used to be re-exported from
 * `CopyPromptButton.tsx` (a client component) which made the dependency
 * graph fragile: any server import path would pull the client module in.
 */
export function fenceData(label: string, payload: unknown): string {
  const body =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

  // If the body itself contains a run of backticks (e.g. a creator pasted a
  // caption that had ```python in it, or a competitor caption included a
  // code block), a 3-backtick fence would terminate early and ChatGPT Work would
  // read the rest as instructions. We compute the longest backtick run in
  // the body and pick a fence one tick longer — Markdown handles this fine
  // (CommonMark spec § 4.5 "Fenced code blocks").
  const matches = body.match(/`+/g) ?? [];
  const longestRun = matches.reduce((max, run) => Math.max(max, run.length), 0);
  const fenceLen = Math.max(3, longestRun + 1);
  const fence = "`".repeat(fenceLen);

  return `\n\n${fence}${label}\n${body}\n${fence}\n`;
}
