export type ReelDraftOption = {
  hook: string;
  body: string;
  format: string;
  notes: string;
};

type ParseResult = { ok: true; value: ReelDraftOption[] } | { ok: false; error: string };

/** Recognize only the Reel contract, leaving caption-option imports untouched. */
export function parseReelReply(raw: string): ParseResult | null {
  const text = raw.replace(/\r\n/g, "\n")
    .replace(/^\s*```[^\n]*\n?/gm, "")
    .replace(/[ \t]*Zalijepljeni tekst(?:\(\d+\))?(?:\.txt)?[ \t]*/g, "")
    .trim();
  // Allow Markdown headings, bold labels and timed voiceover headings.
  const labels = /^(?:[ \t]*#{1,6}[ \t]+)?[ \t]*(?:[-*][ \t]+)?(?:\*\*)?(FORMAT|LIBRARY PATTERN|TEXT OVERLAY|VISUAL DIRECTION|AUDIO SUGGESTION|CAPTION|HOOK|PROBLEM\s*\/\s*DESIRE|SHIFT\s*\/\s*SOLUTION|CTA|VOICEOVER SCRIPT)(?:[ \t]*\([^\n)]*\))?(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*/gim;
  const matches = [...text.matchAll(labels)];
  const sections = matches.map((m, i) => ({
    key: m[1].toUpperCase(),
    value: text.slice(m.index! + m[0].length, matches[i + 1]?.index ?? text.length).trim(),
    start: m.index!,
    end: matches[i + 1]?.index ?? text.length,
  }));
  const value = (key: string) => sections.find(s => s.key === key)?.value ?? "";
  const reelFormat = /\b(?:b[- ]?roll|voiceover|reel)\b/i.test(value("FORMAT"));
  if (!reelFormat || !sections.some(s => ["TEXT OVERLAY", "VOICEOVER SCRIPT", "VISUAL DIRECTION"].includes(s.key))) return null;
  const caption = value("CAPTION");
  if (!caption) return { ok: false, error: "Reel skripta je prepoznata, ali nedostaje CAPTION. Kopiraj cijeli odgovor s opisom objave." };
  if (sections.filter(s => s.key === "CAPTION").length !== 1) {
    return { ok: false, error: "Zalijepi jednu Reel skriptu s jednim CAPTION odjeljkom." };
  }
  return { ok: true, value: [{
    // The overlay belongs to the video, not automatically in the public caption.
    hook: caption.split("\n")[0],
    body: caption,
    format: "reel",
    notes: sections.filter(s => s.key !== "CAPTION")
      .map(s => text.slice(s.start, s.end).trim()).join("\n\n"),
  }] };
}

/** Infer only an explicit CTA using a configured trigger, never a new keyword. */
export function inferDraftTrigger(caption: string, words: string[]): string | null {
  const plain = caption.replace(/\*\*|__/g, "");
  const matched = words.filter(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:komentiraj|napiši|napisi|comment)\\s+[„“”"'«»]*${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(plain);
  });
  return matched.length === 1 ? matched[0] : null;
}
