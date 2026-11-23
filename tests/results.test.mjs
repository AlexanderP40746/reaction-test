import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateResults, classifyChange } from '../js/results.js';
import { renderPeriodChart, renderReactionChart } from '../js/charts.js';

const measurement = (elapsedAtAppearanceMs, reactionMs) => ({
  elapsedAtAppearanceMs,
  reactionMs,
});
const fromPeriods = (...periods) => periods.flatMap((values, period) =>
  values.map((value, index) => measurement(period * 20_000 + index * 1000, value)));

test('examples A and B: average, best, period means, and change', () => {
  const stable = calculateResults(fromPeriods([200, 250, 300], [220, 260, 300], [240, 250, 260]));
  assert.equal(stable.hitCount, 9);
  assert.equal(stable.averageMs, 2280 / 9);
  assert.equal(stable.averageMs.toFixed(2), '253.33');
  assert.equal(stable.bestMs, 200);
  assert.deepEqual(stable.periods.map(period => period.averageMs), [250, 260, 250]);
  assert.equal(stable.changePercent, 0);
  assert.equal(stable.classification, 'Стабильно');

  const slower = calculateResults(fromPeriods([200, 250, 300], [250, 270, 290], [250, 275, 300]));
  assert.equal(slower.changePercent, 10);
  assert.equal(slower.classification, 'Ухудшение');
});

test('33 distinct unrounded measurements reconcile overall and period averages', () => {
  const groups = [[12, 804.881], [10, 846.929], [11, 700.652]].map(
    ([count, center]) => Array.from({ length: count }, (_, index) =>
      center + (index - (count - 1) / 2) * 3.125),
  );
  const source = fromPeriods(...groups);
  const result = calculateResults(source);
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  // Different summation orders can introduce floating-point differences.
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10,
    `Expected ${actual} to be within 1e-10 of ${expected}`);

  assert.equal(result.hitCount, 33);
  assert.deepEqual(result.periods.map(period => period.hitCount), [12, 10, 11]);
  assert.equal(result.periods.reduce((sum, period) => sum + period.hitCount, 0), source.length);
  result.periods.forEach((period, index) => near(period.averageMs, mean(groups[index])));
  near(result.averageMs, mean(source.map(hit => hit.reactionMs)));
  near(result.averageMs, result.periods.reduce(
    (sum, period) => sum + period.averageMs * period.hitCount, 0) / result.hitCount);
  assert.deepEqual(result.points.map(point => point.reactionMs), source.map(hit => hit.reactionMs));
  assert.deepEqual(result.points.map(point => point.hitNumber), source.map((_, index) => index + 1));
  assert.equal(result.averageMs.toFixed(2), '782.88');
  assert.equal(result.changePercent.toFixed(2), '-12.95');
});

test('appearance sets the period and press sets X, including 20 s and 40 s boundaries', () => {
  const source = Object.freeze([
    Object.freeze(measurement(19_800, 400)),
    Object.freeze(measurement(20_000, 250)),
    Object.freeze(measurement(40_000, 300)),
  ]);
  const result = calculateResults(source);
  assert.deepEqual(result.periods.map(period => period.hitCount), [1, 1, 1]);
  assert.deepEqual(result.periods.map(period => period.averageMs), [400, 250, 300]);
  assert.deepEqual(result.points, [
    { hitNumber: 1, pressSeconds: 20.2, reactionMs: 400 },
    { hitNumber: 2, pressSeconds: 20.25, reactionMs: 250 },
    { hitNumber: 3, pressSeconds: 40.3, reactionMs: 300 },
  ]);
});

test('inclusive thresholds and unrounded classification just outside them', () => {
  for (const [percent, label] of [
    [-5.001, 'Улучшение'], [-5, 'Стабильно'], [5, 'Стабильно'], [5.001, 'Ухудшение'],
  ]) {
    assert.equal(classifyChange(percent), label);
    const first = [1000, 1000, 1000];
    const third = first.map(value => value + percent * 10);
    assert.equal(calculateResults(fromPeriods(first, first, third)).classification, label);
  }
});

test('zero, one and two hits, example C, and undefined change from zero baseline', () => {
  for (const count of [0, 1]) {
    const result = calculateResults(fromPeriods(Array(count).fill(200)));
    assert.equal(result.hitCount, count);
    assert.equal(result.singleReactionMs, count ? 200 : null);
    assert.equal(result.averageMs, null);
    assert.equal(result.bestMs, null);
    assert.equal(result.classification, null);
    assert.equal(result.points.length, count);
  }
  const two = calculateResults(fromPeriods([200, 300]));
  assert.equal(two.averageMs, 250);
  assert.equal(two.bestMs, 200);
  assert.deepEqual(two.periods.map(period => period.averageMs), [250, null, null]);
  assert.equal(two.changePercent, null);
  const sparse = calculateResults(fromPeriods(...[8, 5, 2].map(count => Array(count).fill(250))));
  assert.deepEqual(sparse.periods.map(period => period.hitCount), [8, 5, 2]);
  assert.equal(sparse.changePercent, null);
  assert.equal(sparse.classification, null);
  const zeroBaseline = calculateResults(fromPeriods([0, 0, 0], [200, 200, 200], [250, 250, 250]));
  assert.equal(zeroBaseline.changePercent, null);
  assert.equal(zeroBaseline.classification, null);
});

function element(tag) {
  return {
    tag, children: [], attributes: {}, style: { setProperty() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; },
  };
}

test('SVG and period chart preserve points, tooltips and missing columns', t => {
  t.after(() => { delete globalThis.document; });
  globalThis.document = {
    createElement: element,
    createElementNS: (_namespace, tag) => element(tag),
  };
  const container = element('div');
  const result = calculateResults(Array.from({ length: 100 }, (_, i) => measurement(i * 590, 80)));
  renderReactionChart(container, result.points);
  const nodes = container.children[0].children;
  const dots = nodes.filter(node => node.tag === 'circle');
  assert.equal(dots.length, 100);
  assert.equal(nodes.find(node => node.tag === 'polyline').attributes.points.split(' ').length, 100);
  assert.match(dots[99].children[0].textContent, /100.*58,49 с.*80,00 мс/);
  assert.ok(dots.every((dot, i) => i === 0 || dot.attributes.cx > dots[i - 1].attributes.cx));

  renderReactionChart(container, result.points.slice(0, 1));
  assert.equal(container.children[0].children.filter(node => node.tag === 'circle').length, 1);
  assert.ok(!container.children[0].children.some(node => node.tag === 'polyline'));

  renderPeriodChart(container, calculateResults(fromPeriods([0, 0])).periods);
  const [first, second, third] = container.children;
  assert.equal(first.children[0].children[1].className, 'period-bar');
  for (const missing of [second, third]) {
    assert.equal(missing.children[0].children.length, 1);
    assert.equal(missing.children[0].children[0].textContent, 'Нет данных');
  }
});

test('reaction chart switches range, preserves raw points, and clips overflow segments', t => {
  t.after(() => { delete globalThis.document; });
  globalThis.document = {
    createElementNS: (_namespace, tag) => element(tag),
  };
  const container = { ...element('div'), id: 'test-reaction-chart' };
  const normal = calculateResults([measurement(0, 400), measurement(1000, 1500), measurement(3000, 900)]);
  for (const limit of [undefined, 2000]) {
    renderReactionChart(container, normal.points, limit);
    const nodes = container.children[0].children;
    assert.equal(nodes.filter(node => node.tag === 'circle').length, 3);
    assert.equal(nodes.filter(node => node.tag === 'polygon').length, 0);
  }

  const source = [
    measurement(0, 400), measurement(1000, 1500),
    measurement(3000, 37_700), measurement(42_000, 900),
  ].map(Object.freeze);
  Object.freeze(source);
  const result = calculateResults(source);
  result.points.forEach(Object.freeze);
  Object.freeze(result.points);
  const getNodes = () => container.children[0].children;
  const getDots = () => getNodes().filter(node => ['circle', 'polygon'].includes(node.tag));
  renderReactionChart(container, result.points);
  const fullDots = getDots();
  assert.equal(fullDots.length, 4);
  assert.ok(fullDots.every(dot => dot.tag === 'circle'));
  const fullDistance = Math.abs(fullDots[0].attributes.cy - fullDots[1].attributes.cy);

  for (const [limit, overflowCount] of [[1000, 2], [2000, 1], [5000, 1]]) {
    renderReactionChart(container, result.points, limit);
    const dots = getDots();
    assert.equal(dots.length, 4);
    assert.equal(dots.filter(dot => dot.tag === 'polygon').length, overflowCount);
    assert.equal(dots[2].tag, 'polygon');
    assert.match(dots[2].children[0].textContent, /Попадание 3.*40,70 с.*37\s700,00 мс/);
    assert.deepEqual(dots.map(dot => dot.children[0].textContent),
      fullDots.map(dot => dot.children[0].textContent));
    const line = getNodes().find(node => node.tag === 'polyline');
    const clip = getNodes().find(node => node.tag === 'clipPath');
    assert.equal(line.attributes['clip-path'], `url(#${clip.attributes.id})`);
    const overflowY = Number(line.attributes.points.split(' ')[2].split(',')[1]);
    assert.ok(overflowY < clip.children[0].attributes.y);
    if (limit === 2000) {
      assert.ok(Math.abs(dots[0].attributes.cy - dots[1].attributes.cy) > fullDistance * 10);
    }
  }
  assert.deepEqual(calculateResults(source), result);
});

test('session, scale controls, saved results, confirmed deletion, and storage errors', async t => {
  class MockElement extends EventTarget {
    children = [];
    attributes = {};
    style = { setProperty() {} };
    clientWidth = 800;
    clientHeight = 500;

    append(...nodes) {
      this.children.push(...nodes);
      for (const node of nodes) {
        node.remove = () => { this.children = this.children.filter(child => child !== node); };
      }
    }

    replaceChildren(...nodes) {
      this.children = nodes;
    }

    setAttribute(name, value) { this.attributes[name] = value; }
    focus() {}
  }

  const nodes = new Map();
  const fakeDocument = Object.assign(new EventTarget(), {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new MockElement());
      return nodes.get(id);
    },
    createElement: () => new MockElement(),
    createElementNS: () => new MockElement(),
    async exitFullscreen() { this.fullscreenElement = null; },
  });
  globalThis.document = fakeDocument;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 });
  let storageAccesses = 0;
  let storage;
  for (const object of [globalThis, window]) {
    const originalStorage = Object.getOwnPropertyDescriptor(object, 'localStorage');
    Object.defineProperty(object, 'localStorage', {
      configurable: true,
      get() {
        storageAccesses++;
        if (!storage) throw new Error('Storage blocked');
        return storage;
      },
    });
    t.after(() => {
      if (originalStorage) Object.defineProperty(object, 'localStorage', originalStorage);
      else delete object.localStorage;
    });
  }
  t.after(() => { delete globalThis.document; delete globalThis.window; });

  let now = 0;
  const scheduled = new Map();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', fn => {
    const id = Symbol();
    scheduled.set(id, fn);
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => scheduled.delete(id));
  const screen = fakeDocument.getElementById('test-session');
  screen.requestFullscreen = async () => { fakeDocument.fullscreenElement = screen; };
  await import('../js/app.js');

  const arena = nodes.get('play-area');
  async function start() {
    nodes.get('start-test').dispatchEvent(new Event('click'));
    await Promise.resolve();
    assert.equal(nodes.get('test-preparation').hidden, false);
    assert.equal(arena.children.length, 0);
    nodes.get('begin-session').dispatchEvent(new Event('click'));
  }

  function hitTarget() {
    const hit = new Event('pointerdown');
    for (const [name, value] of Object.entries({
      target: arena.children[0], pointerType: 'mouse', isPrimary: true, button: 0,
    })) Object.defineProperty(hit, name, { value });
    arena.dispatchEvent(hit);
  }

  await start();
  now += 250;
  hitTarget();
  const [nextTargetId, showTarget] = [...scheduled].at(-1);
  scheduled.delete(nextTargetId);
  now += 1500;
  showTarget();
  now += 750;
  hitTarget();
  now = 60_000;
  scheduled.values().next().value();
  await Promise.resolve();
  assert.equal(nodes.get('session-result').textContent, 'Недостаточно данных для анализа динамики');
  assert.equal(nodes.get('reaction-figure').hidden, false);
  const scale = nodes.get('reaction-scale');
  const limit = nodes.get('reaction-limit');
  const chart = nodes.get('reaction-chart');
  const original = chart.children[0];
  const originalBars = nodes.get('period-chart').children;
  const originalMetrics = nodes.get('result-metrics').children;
  assert.equal(originalBars.length, 3);
  assert.equal(originalMetrics.length, 3);
  assert.equal(scale.value, 'all');
  scale.value = 'detail';
  scale.dispatchEvent(new Event('change'));
  assert.equal(nodes.get('reaction-limit-control').hidden, false);
  assert.notEqual(chart.children[0], original);
  const detail = chart.children[0];
  limit.value = '5000';
  limit.dispatchEvent(new Event('change'));
  assert.notEqual(chart.children[0], detail);
  assert.equal(nodes.get('period-chart').children, originalBars);
  assert.equal(nodes.get('result-metrics').children, originalMetrics);
  scale.value = 'all';
  scale.dispatchEvent(new Event('change'));
  assert.equal(nodes.get('reaction-limit-control').hidden, true);

  scale.value = 'detail';
  scale.dispatchEvent(new Event('change'));
  await start();
  fakeDocument.fullscreenElement = null;
  fakeDocument.dispatchEvent(new Event('fullscreenchange'));
  assert.match(nodes.get('session-result').textContent, /^Тест прерван/);
  assert.equal(nodes.get('reaction-figure').hidden, true);
  assert.equal(chart.children.length, 0);
  scale.dispatchEvent(new Event('change'));
  assert.equal(chart.children.length, 0);
  assert.equal(nodes.get('period-figure').hidden, true);
  assert.equal(nodes.get('result-metrics').children.length, 0);
  assert.equal(scheduled.size, 0);

  await start();
  now += 350;
  hitTarget();
  now += 59_650;
  scheduled.values().next().value();
  await Promise.resolve();
  assert.equal(scale.value, 'all');
  assert.equal(limit.value, '2000');
  assert.match(nodes.get('session-result').textContent, /350,00 мс/);
  assert.equal(chart.children[0].children.filter(node => node.attributes.class === 'chart-point').length, 1);

  await start();
  now += 60_000;
  scheduled.values().next().value();
  await Promise.resolve();
  assert.equal(nodes.get('session-result').textContent, 'Недостаточно данных');
  assert.equal(nodes.get('reaction-figure').hidden, true);
  assert.equal(storageAccesses, 1, 'Only the initial history read accesses storage');
  assert.match(nodes.get('history-status').textContent, /История недоступна/);

  const saved = new Map();
  storage = {
    get length() { return saved.size; },
    key: index => [...saved.keys()][index] ?? null,
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  };
  async function finishEligible(reactionMs) {
    await start();
    const startedAt = now;
    for (const elapsed of [0, 2000, 4000, 20_000, 22_000, 24_000, 40_000, 42_000, 44_000]) {
      now = startedAt + elapsed;
      if (elapsed > 0) {
        const [timer, showTarget] = [...scheduled].at(-1);
        scheduled.delete(timer);
        showTarget();
      }
      now += reactionMs;
      hitTarget();
    }
    now = startedAt + 60_000;
    scheduled.values().next().value();
    await Promise.resolve();
  }

  await finishEligible(300);
  await finishEligible(400);
  assert.equal(saved.size, 2);
  const historyList = nodes.get('history-list');
  const oldRow = historyList.children.find(row => row.children[0].textContent.includes('300,00'));
  assert.ok(oldRow);
  const originalRecords = new Map(saved);
  oldRow.children[0].dispatchEvent(new Event('click'));
  assert.equal(nodes.get('result-date').hidden, false);
  assert.equal(nodes.get('return-result').hidden, false);
  const displayed = () => nodes.get('result-metrics').children.map(group => group.children[1].textContent);
  assert.deepEqual(displayed(), [9, '300,00 мс', '300,00 мс', '0,00%', 'Стабильно']);
  assert.equal(chart.children[0].children.filter(node => node.attributes.class === 'chart-point').length, 9);
  assert.equal(nodes.get('period-chart').children.length, 3);
  scale.value = 'detail';
  scale.dispatchEvent(new Event('change'));
  assert.equal(nodes.get('reaction-limit-control').hidden, false);
  nodes.get('return-result').dispatchEvent(new Event('click'));
  assert.equal(nodes.get('result-date').hidden, true);
  assert.equal(displayed()[1], '400,00 мс');
  assert.deepEqual(saved, originalRecords);

  window.confirm = () => false;
  oldRow.children[1].dispatchEvent(new Event('click'));
  assert.deepEqual(saved, originalRecords);
  oldRow.children[0].dispatchEvent(new Event('click'));
  window.confirm = () => true;
  oldRow.children[1].dispatchEvent(new Event('click'));
  assert.equal(historyList.children.length, 1);
  assert.equal(saved.size, 1);
  assert.equal(displayed()[1], '400,00 мс');
  const [remainingKey, remainingValue] = [...saved][0];
  assert.equal(remainingValue, originalRecords.get(remainingKey));

  storage.setItem = () => { throw new Error('Quota exceeded'); };
  await finishEligible(500);
  assert.equal(saved.size, 1);
  assert.match(nodes.get('history-status').textContent, /Не удалось сохранить/);
  assert.equal(displayed()[1], '500,00 мс');
});
