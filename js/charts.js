const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const decimal = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatDecimal(value) {
  return decimal.format(value);
}

function svgElement(name, attributes, content) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (content !== undefined) element.textContent = content;
  return element;
}

export function renderReactionChart(container, points, limitMs) {
  const left = 62;
  const right = 678;
  const top = 18;
  const bottom = 210;
  const maximum = limitMs ?? Math.ceil(points.reduce((max, point) => Math.max(max, point.reactionMs), 1) / 100) * 100;
  const x = seconds => left + seconds / 60 * (right - left);
  const y = milliseconds => bottom - milliseconds / maximum * (bottom - top);
  const chart = svgElement('svg', {
    viewBox: '0 0 700 260',
    'aria-label': 'Время реакции по попаданиям',
    class: 'reaction-chart',
  });
  for (const milliseconds of [0, maximum / 4, maximum / 2, maximum * 0.75, maximum]) {
    chart.append(
      svgElement('line', { x1: left, x2: right, y1: y(milliseconds), y2: y(milliseconds), class: 'chart-grid' }),
      svgElement('text', { x: left - 8, y: y(milliseconds) + 4, 'text-anchor': 'end' }, milliseconds),
    );
  }
  for (const seconds of [0, 10, 20, 30, 40, 50, 60]) {
    if (seconds % 20 === 0) {
      chart.append(svgElement('line', { x1: x(seconds), x2: x(seconds), y1: top, y2: bottom, class: 'chart-grid' }));
    }
    chart.append(svgElement('text', { x: x(seconds), y: bottom + 19, 'text-anchor': 'middle' }, seconds));
  }
  chart.append(
    svgElement('text', { x: 12, y: 20 }, 'мс'),
    svgElement('text', { x: (left + right) / 2, y: 252, 'text-anchor': 'middle' }, 'Время нажатия от старта, с'),
  );
  if (points.length > 1) {
    // Clip the true line segments without moving out-of-range measurements to the boundary.
    const clip = svgElement('clipPath', { id: `${container.id}-plot` });
    clip.append(svgElement('rect', { x: left, y: top, width: right - left, height: bottom - top }));
    chart.append(svgElement('polyline', {
      points: points.map(point => `${x(point.pressSeconds)},${y(point.reactionMs)}`).join(' '),
      class: 'chart-series',
      'clip-path': `url(#${container.id}-plot)`,
    }));
    chart.append(clip);
  }
  for (const point of points) {
    const label = `Попадание ${point.hitNumber} · ${formatDecimal(point.pressSeconds)} с от старта · реакция ${formatDecimal(point.reactionMs)} мс`;
    const position = x(point.pressSeconds);
    const accessible = { tabindex: 0, 'aria-label': label };
    const dot = point.reactionMs > maximum
      ? svgElement('polygon', {
        ...accessible,
        points: `${position},${top - 5} ${position - 4},${top + 4} ${position + 4},${top + 4}`,
        class: 'chart-point chart-overflow',
      })
      : svgElement('circle', {
        ...accessible, cx: position, cy: y(point.reactionMs), r: 3, class: 'chart-point',
      });
    dot.append(svgElement('title', {}, label));
    chart.append(dot);
  }
  container.replaceChildren(chart);
}

export function renderPeriodChart(container, periods) {
  const maximum = Math.max(1, ...periods.map(period => period.averageMs ?? 0));
  const columns = periods.map(period => {
    const column = document.createElement('div');
    column.className = 'period-column';
    const plot = document.createElement('div');
    plot.className = 'period-plot';
    const value = document.createElement('span');
    value.className = 'period-value';
    if (period.averageMs === null) {
      value.textContent = 'Нет данных';
      plot.append(value);
    } else {
      value.textContent = `${formatDecimal(period.averageMs)} мс`;
      const bar = document.createElement('div');
      bar.className = 'period-bar';
      plot.style.setProperty('--bar-height', `${period.averageMs / maximum * 100}%`);
      plot.append(value, bar);
    }

    const label = document.createElement('div');
    label.className = 'period-label';
    label.textContent = `${period.startSeconds}–${period.endSeconds} с · попаданий: ${period.hitCount}`;
    column.append(plot, label);
    return column;
  });
  container.replaceChildren(...columns);
}
