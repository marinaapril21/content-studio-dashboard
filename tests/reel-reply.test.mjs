import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReelReply, inferDraftTrigger } from '../lib/reelReply.ts';
import { draftToRecord, draftFromRecord } from '../lib/draftRecord.ts';

const broll = `FORMAT: B-roll \u2014 Kratki vizualni reel.
Zalijepljeni tekst
LIBRARY PATTERN: other
TEXT OVERLAY:
10 proteinskih recepata ispod 500 kcal
VISUAL DIRECTION:
- Opening visual (1-2s): Krupni kadar obroka.
- Scene progression: Brzi rezovi.
AUDIO SUGGESTION:
Lagani instrumental.
CAPTION:
Kad mi ponestane ideja što jesti, trebam nekoliko brzih obroka.

Komentiraj **RECEPTI** i šaljem ti vodič.
Zalijepljeni tekst`;

test('B-roll import keeps production directions out of the complete caption after save/read', () => {
  const parsed = parseReelReply(broll);
  assert.equal(parsed.ok, true);
  const draft = parsed.value[0];
  assert.equal(draft.format, 'reel');
  assert.match(draft.notes, /TEXT OVERLAY:[\s\S]*VISUAL DIRECTION:/);
  assert.doesNotMatch(draft.notes, /CAPTION:|Kad mi ponestane/);
  assert.doesNotMatch(draft.body, /Zalijepljeni tekst|VISUAL DIRECTION|FORMAT:/);
  const row = draftToRecord({hook:draft.hook, caption:draft.body, type:'reel', notes:draft.notes});
  assert.equal(row.caption, draft.body);
  const saved = draftFromRecord(row);
  assert.equal(saved.notes, draft.notes);
  assert.equal(saved.type, 'reel');
  assert.equal(inferDraftTrigger(saved.caption, ['RECEPTI', 'TAVA']), 'RECEPTI');
});

test('fenced Markdown voiceover supports timed bold headings and multiline speech', () => {
  const parsed = parseReelReply('```markdown\n## **FORMAT:** Voiceover\n**HOOK (0-1s):** Otvori hladnjak.\n**VOICEOVER SCRIPT (word for word):**\nPrva rečenica.\nDruga rečenica.\n**VISUAL DIRECTION:** Priprema hrane.\n**CAPTION:**\nOpis.\n\nNapiši „RECEPTI” i šaljem vodič.\n```');
  assert.equal(parsed.ok, true);
  assert.match(parsed.value[0].notes, /Druga rečenica/);
  assert.equal(parsed.value[0].body, 'Opis.\n\nNapiši „RECEPTI” i šaljem vodič.');
});

test('caption options bypass Reel handling; incomplete Reel is rejected', () => {
  assert.equal(parseReelReply('Hook: Obrok\nBody: Recept\nCTA: Komentiraj RECEPTI\nFormat: reel'), null);
  const incomplete = parseReelReply('FORMAT: B-roll\nTEXT OVERLAY: Obrok\nVISUAL DIRECTION: Kuhinja');
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /CAPTION/);
  assert.equal(parseReelReply(broll + '\nCAPTION: Drugi opis').ok, false);
});

test('only configured, unambiguous CTA keywords are inferred', () => {
  assert.equal(inferDraftTrigger('Recepti za danas', ['RECEPTI']), null);
  assert.equal(inferDraftTrigger('Komentiraj RECEPTIMA', ['RECEPTI']), null);
  assert.equal(inferDraftTrigger('Komentiraj TAJNA', ['RECEPTI']), null);
  assert.equal(inferDraftTrigger('Komentiraj RECEPTI ili napiši TAVA', ['RECEPTI','TAVA']), null);
});
