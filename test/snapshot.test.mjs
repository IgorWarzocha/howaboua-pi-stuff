import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSnapshot, mergeLayout, validateSnapshot, sessionOf, terminalLeaves } from '../src/snapshot.mjs';

const leaf = address => ({ id: `pane-${address}`, type: 'block', content: { terminal: address } });
const layout = { spaces: [{ id: 's1', folder: '/tmp', tabs: [{ id: 'tab1', root: leaf('t1') }] }] };
test('snapshot retains exact session identity, and rejects another Core', () => {
  const result = makeSnapshot(layout, [{ address: 't1', state: 'live', cwd: '/tmp', labels: { 'herdr.state.agent': 'pi', 'herdr.state.ref': JSON.stringify({ kind: 'path', value: '/tmp/exact.jsonl' }) } }], 'core1');
  assert.equal(result.snapshot.terminals[0].session.ref.value, '/tmp/exact.jsonl');
  assert.throws(() => validateSnapshot(result.snapshot, 'core2'), /compatible/);
  assert.equal(validateSnapshot(result.snapshot, 'core1'), result.snapshot);
});
test('merge preserves new work and restores missing panes once', () => {
  const current = structuredClone(layout);
  current.spaces[0].tabs[0].root = leaf('t2');
  current.spaces.push({ id: 's2', tabs: [{ id: 'tab2', root: leaf('t3') }] });
  const once = mergeLayout(current, layout, new Map([['t1', 't4']]));
  assert.deepEqual(terminalLeaves(once.spaces[0].tabs[0].root), ['t2', 't4']);
  assert.deepEqual(mergeLayout(once, layout, new Map([['t1', 't4']])), once);
  assert.equal(once.spaces[1].id, 's2');
});
test('malformed or unsupported reported sessions do not become commands', () => {
  assert.equal(sessionOf({ labels: { 'herdr.state.agent': 'pi', 'herdr.state.ref': 'oops' } }), null);
  const saved = makeSnapshot(layout, [{ address: 't1', state: 'live', cwd: '/tmp', status: { app: 'unknown' } }], 'core1');
  assert.equal(saved.snapshot.terminals[0].session, null);
  assert.match(saved.warnings[0], /shell only/);
});
test('a saved address never replaces occupied current work without explicit permission', () => {
  const merged = mergeLayout(layout, layout, new Map([['t1', 't2']]));
  assert.deepEqual(terminalLeaves(merged.spaces[0].tabs[0].root), ['t1', 't2']);
  const parked = mergeLayout(layout, layout, new Map([['t1', 't2']]), new Set(['t1']));
  assert.deepEqual(terminalLeaves(parked.spaces[0].tabs[0].root), ['t2']);
});
