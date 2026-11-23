import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistory } from '../js/history.js';
import { calculateResults } from '../js/results.js';

const prefix = 'reaction-test:session:';
const earlier = new Date('2026-11-23T10:00:00Z');
const later = new Date('2026-11-23T12:00:00Z');
const measurements = [0, 20_000, 40_000].flatMap((period, index) =>
  [0, 1000, 2000].map(offset => {
    const elapsedAtAppearanceMs = period + offset;
    const appearedAtMs = 5000 + elapsedAtAppearanceMs;
    const reactionMs = [250, 260, 275][index];
    return { appearedAtMs, pressedAtMs: appearedAtMs + reactionMs, reactionMs, elapsedAtAppearanceMs };
  }));

function setup() {
  const data = new Map();
  const storage = {
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
  let nextId = 0;
  const options = {
    getStorage: () => storage,
    getCrypto: () => ({ randomUUID: () => String(++nextId) }),
  };
  return { data, storage, options, history: createHistory(options) };
}

test('completed eligible session stores raw measurements, versions, and consistent analytics', () => {
  const { history } = setup();
  const saved = history.save({ measurements }, earlier);
  const { points, singleReactionMs, ...summary } = calculateResults(measurements);
  assert.deepEqual(saved, {
    id: '1', completedAt: earlier.toISOString(), durationMs: 60_000,
    formatVersion: 1, rulesVersion: 1, measurements, summary,
  });
  assert.deepEqual(calculateResults(history.list().records[0].measurements).points, points);
});

test('interrupted and insufficient outcomes do not access storage', () => {
  const history = createHistory({ getStorage: () => assert.fail('Storage must not be accessed') });
  assert.equal(history.save({ measurements, interruptionReason: 'interrupted' }), null);
  assert.equal(history.save({ measurements: measurements.slice(0, 8) }), null);
  assert.equal(history.save({ measurements: [] }), null);
  const invalid = measurements.map(hit => ({ ...hit, reactionMs: -1 }));
  assert.equal(history.save({ measurements: invalid }), null);
});

test('multiple sessions are preserved and sorted after creating a fresh history instance', () => {
  const { history, options, data } = setup();
  const first = history.save({ measurements }, earlier);
  const second = history.save({ measurements }, later);
  assert.equal(data.size, 2);
  const reopened = createHistory(options);
  assert.deepEqual(reopened.list(), { records: [second, first], skipped: 0 });
  reopened.remove(second.id);
  assert.deepEqual(reopened.list().records, [first]);
});

test('incompatible versions, invalid JSON and mismatched aggregates do not affect valid records', () => {
  const { history, data } = setup();
  const good = history.save({ measurements }, earlier);
  const variants = [
    { formatVersion: 2 },
    { rulesVersion: 2 },
    { summary: { ...good.summary, averageMs: 1 } },
    { measurements: [...measurements].reverse() },
  ];
  variants.forEach((variant, index) => {
    const id = 'bad' + index;
    data.set(prefix + id, JSON.stringify({ ...good, id, ...variant }));
  });
  data.set(prefix + 'invalid-json', '[');
  data.set('unrelated-key', '[');
  const original = new Map(data);
  assert.deepEqual(history.list(), { records: [good], skipped: 5 });
  assert.deepEqual(data, original);
  history.save({ measurements }, later);
  for (const [key, value] of original) assert.equal(data.get(key), value);
});

test('storage access, quota, and failed deletion leave existing entries intact', () => {
  const blocked = createHistory({ getStorage: () => { throw new Error('blocked'); } });
  assert.throws(() => blocked.list(), /blocked/);
  assert.throws(() => blocked.save({ measurements }), /blocked/);
  const { history, storage } = setup();
  const record = history.save({ measurements });
  storage.setItem = () => { throw new Error('quota'); };
  storage.removeItem = () => { throw new Error('blocked'); };
  assert.throws(() => history.save({ measurements }), /quota/);
  assert.throws(() => history.remove(record.id), /blocked/);
  assert.deepEqual(history.list().records, [record]);
});

test('secure random fallback generates IDs and a collision never overwrites a session', () => {
  const { storage } = setup();
  const history = createHistory({
    getStorage: () => storage,
    getCrypto: () => ({ getRandomValues: bytes => bytes.fill(42) }),
  });
  const record = history.save({ measurements }, earlier);
  assert.match(record.id, /^[a-f0-9]{32}$/);
  assert.throws(() => history.save({ measurements }, later), /identifier/);
  assert.deepEqual(history.list().records, [record]);
});
