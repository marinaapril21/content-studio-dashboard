// The SQL schema stores the complete caption and calls the format `format`.
// The editor has a separate hook input and calls the format `type`.
export function draftToRecord(body: Record<string, unknown>) {
  const { hook, type, ...record } = body;
  if (type !== undefined) record.format = type;
  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  const opening = typeof hook === "string" ? hook.trim() : "";
  if (body.caption !== undefined || hook !== undefined) {
    record.caption = opening && !caption.startsWith(opening)
      ? (caption ? `${opening}\n\n${caption}` : opening)
      : caption;
  }
  return record;
}

/** Split the stored opening from the body so replacing it does not duplicate it. */
export function draftCaptionForEditor(caption: string) {
  const newline = caption.indexOf("\n");
  return newline < 0
    ? { hook: caption, caption: "" }
    : { hook: caption.slice(0, newline).replace(/\r$/, ""), caption: caption.slice(newline + 1).replace(/^\r?\n/, "") };
}

export function draftFromRecord(row: Record<string, unknown>) {
  const caption = typeof row.caption === "string" ? row.caption : "";
  return {
    ...row,
    hook: typeof row.hook === "string" ? row.hook : caption.split(/\r?\n/)[0],
    type: row.type ?? row.format ?? "image",
  };
}
