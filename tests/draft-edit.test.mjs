import test from 'node:test';
import assert from 'node:assert/strict';
import { draftCaptionForEditor, draftToRecord } from '../lib/draftRecord.ts';

test('editing replaces opening and preserves separate filming notes and format', () => {
  const original = 'Stari hook\n\nPrvi odlomak.\n\nKomentiraj RECEPTI.';
  const editor = draftCaptionForEditor(original);
  assert.equal(editor.caption, 'Prvi odlomak.\n\nKomentiraj RECEPTI.');
  assert.equal(draftToRecord(editor).caption, original);
  const updated = draftToRecord({...editor, hook:'Novi hook', type:'reel', notes:'Kadar 1'});
  assert.equal(updated.caption, 'Novi hook\n\nPrvi odlomak.\n\nKomentiraj RECEPTI.');
  assert.equal(updated.format, 'reel');
  assert.equal(updated.notes, 'Kadar 1');
  assert.equal('status' in updated, false);
  assert.equal('scheduled_for' in updated, false);
});
test('status-only patches never erase caption or notes', () => {
  assert.deepEqual(draftToRecord({status:'scheduled',scheduled_for:'2026-10-08T09:00:00Z'}), {status:'scheduled',scheduled_for:'2026-10-08T09:00:00Z'});
  assert.deepEqual(draftToRecord({type:'carousel'}), {format:'carousel'});
});
test('single-line drafts can be edited; copy parts remain disjoint', () => {
  const parts = draftCaptionForEditor('Samo hook');
  assert.equal(parts.caption, '');
  assert.equal(draftToRecord(parts).caption, 'Samo hook');
  assert.deepEqual(draftCaptionForEditor('Hook\r\n\r\nCaption\nCTA'), {hook:'Hook',caption:'Caption\nCTA'});
});
