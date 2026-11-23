import { calculateResults } from './results.js';

const PREFIX = 'reaction-test:session:';
const FORMAT_VERSION = 1;
const RULES_VERSION = 1;
const DURATION_MS = 60_000;

function createId(random) {
  if (typeof random?.randomUUID === 'function') return random.randomUUID();
  const bytes = random.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function validMeasurements(measurements) {
  if (!Array.isArray(measurements)) return false;
  let previousPress = -Infinity;
  let start;
  for (const hit of measurements) {
    if (!hit) return false;
    const { appearedAtMs, pressedAtMs, reactionMs, elapsedAtAppearanceMs } = hit;
    const inferredStart = appearedAtMs - elapsedAtAppearanceMs;
    start ??= inferredStart;
    if (![appearedAtMs, pressedAtMs, reactionMs, elapsedAtAppearanceMs].every(Number.isFinite) ||
        appearedAtMs < 0 || elapsedAtAppearanceMs < 0 || elapsedAtAppearanceMs >= DURATION_MS ||
        reactionMs < 0 || pressedAtMs - appearedAtMs !== reactionMs ||
        elapsedAtAppearanceMs + reactionMs > DURATION_MS || appearedAtMs < previousPress ||
        Math.abs(inferredStart - start) > 1e-6) return false;
    previousPress = pressedAtMs;
  }
  return true;
}

function summarize(measurements) {
  if (!validMeasurements(measurements)) return null;
  const { hitCount, averageMs, bestMs, periods, changePercent, classification } =
    calculateResults(measurements);
  if (!Number.isFinite(changePercent) || classification === null) return null;
  return { hitCount, averageMs, bestMs, periods, changePercent, classification };
}

function matchesFields(expected, actual) {
  return actual != null && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function validRecord(record, key) {
  if (!record || typeof record.id !== 'string' || !record.id || PREFIX + record.id !== key ||
      record.formatVersion !== FORMAT_VERSION || record.rulesVersion !== RULES_VERSION ||
      record.durationMs !== DURATION_MS || typeof record.completedAt !== 'string') return false;
  const date = new Date(record.completedAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== record.completedAt) return false;
  const expected = summarize(record.measurements);
  if (!expected) return false;
  const { periods, ...expectedMetrics } = expected;
  const actualPeriods = record.summary?.periods;
  return matchesFields(expectedMetrics, record.summary) && Array.isArray(actualPeriods) &&
    actualPeriods.length === periods.length &&
    periods.every((period, index) => matchesFields(period, actualPeriods[index]));
}

export function createHistory({
  getStorage = () => globalThis.localStorage,
  getCrypto = () => globalThis.crypto,
} = {}) {
  return {
    save({ measurements, interruptionReason }, completedAt = new Date()) {
      if (interruptionReason) return null;
      const summary = summarize(measurements);
      if (!summary) return null;

      const storage = getStorage();
      const id = createId(getCrypto());
      const key = PREFIX + id;
      if (storage.getItem(key) !== null) throw new Error('Session identifier already exists');
      const record = {
        id,
        completedAt: completedAt.toISOString(),
        durationMs: DURATION_MS,
        formatVersion: FORMAT_VERSION,
        rulesVersion: RULES_VERSION,
        measurements,
        summary,
      };
      storage.setItem(key, JSON.stringify(record));
      return record;
    },

    list() {
      const storage = getStorage();
      const records = [];
      let skipped = 0;
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(PREFIX)) continue;
        const value = storage.getItem(key);
        if (value === null) continue;
        let record;
        try {
          record = JSON.parse(value);
        } catch {
          // Keep unreadable entries intact so a later version can recover them.
        }
        if (validRecord(record, key)) records.push(record);
        else skipped++;
      }
      records.sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id));
      return { records, skipped };
    },

    remove(id) {
      getStorage().removeItem(PREFIX + id);
    },
  };
}
