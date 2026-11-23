const PERIOD_SECONDS = 20;
const MIN_PERIOD_HITS = 3;
const STABILITY_THRESHOLD = 5;

function average(sum, count) {
  return count ? sum / count : null;
}

export function classifyChange(changePercent) {
  if (changePercent < -STABILITY_THRESHOLD) return 'Улучшение';
  if (changePercent > STABILITY_THRESHOLD) return 'Ухудшение';
  return 'Стабильно';
}

export function calculateResults(measurements) {
  const periods = Array.from({ length: 3 }, (_, index) => ({
    startSeconds: index * PERIOD_SECONDS,
    endSeconds: (index + 1) * PERIOD_SECONDS,
    hitCount: 0,
    sumMs: 0,
  }));
  let sumMs = 0;
  let minimumMs = Infinity;

  const points = measurements.map(({ elapsedAtAppearanceMs, reactionMs }, index) => {
    const period = periods[Math.floor(elapsedAtAppearanceMs / (PERIOD_SECONDS * 1000))];
    period.hitCount++;
    period.sumMs += reactionMs;
    sumMs += reactionMs;
    minimumMs = Math.min(minimumMs, reactionMs);

    return {
      hitNumber: index + 1,
      pressSeconds: (elapsedAtAppearanceMs + reactionMs) / 1000,
      reactionMs,
    };
  });

  const periodResults = periods.map(({ sumMs, ...period }) => ({
    ...period,
    averageMs: average(sumMs, period.hitCount),
  }));
  const firstAverage = periodResults[0].averageMs;
  const lastAverage = periodResults[2].averageMs;
  const hasDynamics = firstAverage > 0 &&
    periodResults.every(period => period.hitCount >= MIN_PERIOD_HITS);
  const changePercent = hasDynamics ? (lastAverage - firstAverage) * 100 / firstAverage : null;
  const hitCount = points.length;

  return {
    hitCount,
    singleReactionMs: hitCount === 1 ? minimumMs : null,
    averageMs: hitCount >= 2 ? average(sumMs, hitCount) : null,
    bestMs: hitCount >= 2 ? minimumMs : null,
    periods: periodResults,
    points,
    changePercent,
    classification: hasDynamics ? classifyChange(changePercent) : null,
  };
}
