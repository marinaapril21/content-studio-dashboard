// The SQL schema stores the complete caption and calls the format `format`.
// The editor has a separate hook input and calls the format `type`.
export function draftToRecord(body: Record<string, unknown>) {
  const { hook, type, ...record } = body;
  if (type !== undefined) record.format = type;
  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  const opening = typeof hook === "string" ? hook.trim() : "";
  record.caption = opening && !caption.startsWith(opening)
    ? `${opening}\n\n${caption}`
    : caption;
  return record;
}

export function draftFromRecord(row: Record<string, unknown>) {
  const caption = typeof row.caption === "string" ? row.caption : "";
  return {
    ...row,
    hook: typeof row.hook === "string" ? row.hook : caption.split(/\r?\n/)[0],
    type: row.type ?? row.format ?? "image",
  };
}
