const DURATION_MS = 60_000;
const TARGET_SIZE = 64;
const EDGE_PADDING = 8;

export function createSession({ arena, onTime, onHits, onFinish }) {
  let running = false;
  let startedAt;
  let deadline;
  let measurements;
  let activeTarget;
  let nextTargetTimer;
  let clockTimer;

  function positionTarget(target) {
    function coordinate(length) {
      const space = Math.max(0, length - TARGET_SIZE);
      const padding = Math.min(EDGE_PADDING, space / 2);
      return padding + Math.random() * (space - 2 * padding);
    }

    target.style.left = `${coordinate(arena.clientWidth)}px`;
    target.style.top = `${coordinate(arena.clientHeight)}px`;
  }

  function finish(interruptionReason) {
    running = false;
    clearTimeout(clockTimer);
    clearTimeout(nextTargetTimer);
    activeTarget?.element.remove();
    activeTarget = undefined;
    const completedMeasurements = interruptionReason ? undefined : measurements;
    measurements = undefined;
    if (!interruptionReason) onTime(0);
    onFinish({ measurements: completedMeasurements, interruptionReason });
  }

  function isBeforeDeadline(now) {
    if (!running) return false;
    if (now < deadline) return true;
    finish();
    return false;
  }

  function showTarget() {
    if (!isBeforeDeadline(performance.now())) return;
    const element = document.createElement('div');
    element.className = 'target';
    positionTarget(element);
    arena.append(element);
    // Timestamp the insertion into the rendered area on the browser's clock.
    activeTarget = { element, appearedAtMs: performance.now() };
  }

  function updateClock() {
    const now = performance.now();
    if (!isBeforeDeadline(now)) return;
    const remaining = deadline - now;
    const seconds = Math.ceil(remaining / 1000);
    onTime(seconds);
    clockTimer = setTimeout(updateClock, remaining - (seconds - 1) * 1000);
  }

  arena.addEventListener('pointerdown', (event) => {
    const pressedAtMs = performance.now();
    if (!isBeforeDeadline(pressedAtMs) || !activeTarget ||
        event.target !== activeTarget.element || event.pointerType !== 'mouse' ||
        !event.isPrimary || event.button !== 0) return;

    const { element, appearedAtMs } = activeTarget;
    activeTarget = undefined;
    element.remove();
    measurements.push({
      appearedAtMs,
      pressedAtMs,
      reactionMs: pressedAtMs - appearedAtMs,
      elapsedAtAppearanceMs: appearedAtMs - startedAt,
    });
    onHits(measurements.length);
    nextTargetTimer = setTimeout(showTarget, 500 + Math.random() * 1000);
  });

  return {
    start() {
      if (running) return;
      running = true;
      startedAt = performance.now();
      deadline = startedAt + DURATION_MS;
      measurements = [];
      onHits(0);
      showTarget();
      updateClock();
    },

    interrupt(reason) {
      if (isBeforeDeadline(performance.now())) {
        finish(reason);
      }
    },
  };
}
