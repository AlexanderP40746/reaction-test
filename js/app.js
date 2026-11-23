import { createSession } from './session.js';
import { calculateResults } from './results.js';
import { formatDecimal, renderPeriodChart, renderReactionChart } from './charts.js';
import { createHistory } from './history.js';

const mainScreen = document.getElementById('main-screen');
const testScreen = document.getElementById('test-session');
const arena = document.getElementById('play-area');
const startButton = document.getElementById('start-test');
const preparation = document.getElementById('test-preparation');
const beginButton = document.getElementById('begin-session');
const startStatus = document.getElementById('start-status');
const timeRemaining = document.getElementById('time-remaining');
const hitCount = document.getElementById('hit-count');
const sessionResult = document.getElementById('session-result');
const resultMetrics = document.getElementById('result-metrics');
const reactionFigure = document.getElementById('reaction-figure');
const reactionChart = document.getElementById('reaction-chart');
const reactionScale = document.getElementById('reaction-scale');
const reactionLimit = document.getElementById('reaction-limit');
const reactionLimitControl = document.getElementById('reaction-limit-control');
const reactionScaleNote = document.getElementById('reaction-scale-note');
const periodFigure = document.getElementById('period-figure');
const periodChart = document.getElementById('period-chart');
const historyTitle = document.getElementById('history-title');
const historyStatus = document.getElementById('history-status');
const historyList = document.getElementById('history-list');
const returnResult = document.getElementById('return-result');
const resultDate = document.getElementById('result-date');
const history = createHistory();
const sessionDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'medium' });

let screenState = 'main';
let startWidth;
let startHeight;
let reactionPoints = [];
let latestOutcome;
let latestScale;
let viewedId;

const session = createSession({
  arena,
  onTime: (seconds) => { timeRemaining.textContent = `${seconds} с`; },
  onHits: (count) => { hitCount.textContent = String(count); },
  onFinish: showResult,
});

function showMainScreen() {
  preparation.hidden = true;
  testScreen.hidden = true;
  mainScreen.hidden = false;
  startButton.disabled = false;
  screenState = 'main';
}

function addMetric(label, value) {
  const group = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  group.append(term, description);
  resultMetrics.append(group);
}

function updateReactionChart() {
  if (!reactionPoints.length) return;
  const detailed = reactionScale.value === 'detail';
  reactionLimitControl.hidden = !detailed;
  reactionScaleNote.hidden = !detailed;
  renderReactionChart(reactionChart, reactionPoints, detailed ? Number(reactionLimit.value) : undefined);
}

reactionScale.addEventListener('change', updateReactionChart);
reactionLimit.addEventListener('change', updateReactionChart);

function renderResult({ measurements, interruptionReason } = {}, scale = {}) {
  reactionPoints = [];
  resultMetrics.replaceChildren();
  reactionChart.replaceChildren();
  periodChart.replaceChildren();
  resultMetrics.hidden = true;
  reactionFigure.hidden = true;
  periodFigure.hidden = true;

  if (!measurements && !interruptionReason) {
    sessionResult.textContent = 'Здесь будет показан итог сессии.';
    return;
  }

  if (interruptionReason) {
    sessionResult.textContent = `Тест прерван. Причина: ${interruptionReason}. Нажмите «Начать тест», чтобы пройти его заново.`;
    return;
  }

  const result = calculateResults(measurements);
  if (result.hitCount === 0) {
    sessionResult.textContent = 'Недостаточно данных';
    return;
  }

  reactionPoints = result.points;
  reactionScale.value = scale.mode ?? 'all';
  reactionLimit.value = scale.limit ?? '2000';
  updateReactionChart();
  reactionFigure.hidden = false;

  if (result.hitCount === 1) {
    sessionResult.textContent = `Время реакции: ${formatDecimal(result.singleReactionMs)} мс`;
    return;
  }

  addMetric('Попадания', result.hitCount);
  addMetric('Средняя реакция', `${formatDecimal(result.averageMs)} мс`);
  addMetric('Лучшая реакция', `${formatDecimal(result.bestMs)} мс`);
  resultMetrics.hidden = false;
  renderPeriodChart(periodChart, result.periods);
  periodFigure.hidden = false;

  if (result.changePercent === null) {
    sessionResult.textContent = 'Недостаточно данных для анализа динамики';
    if (result.periods.every(period => period.hitCount >= 3)) {
      sessionResult.textContent += '. Среднее первого периода равно нулю.';
    }
    return;
  }

  const change = result.changePercent;
  const percentage = `${change > 0 ? '+' : ''}${formatDecimal(change)}%`;
  addMetric('Изменение', percentage);
  addMetric('Оценка', result.classification);
  if (change < 0) {
    sessionResult.textContent = 'В третьем периоде вы в среднем реагировали быстрее, чем в первом.';
  } else if (change > 0) {
    sessionResult.textContent = 'В третьем периоде вы в среднем реагировали медленнее, чем в первом.';
  } else {
    sessionResult.textContent = 'Среднее время реакции в первом и третьем периодах одинаковое.';
  }
  if (Math.abs(change) > 5 && formatDecimal(Math.abs(change)) === formatDecimal(5)) {
    sessionResult.textContent += change < 0
      ? '. До округления изменение меньше −5%.'
      : '. До округления изменение больше +5%.';
  }
}

function renderLatestResult() {
  viewedId = undefined;
  returnResult.hidden = true;
  resultDate.hidden = true;
  renderResult(latestOutcome, latestScale);
}

returnResult.addEventListener('click', () => {
  renderLatestResult();
  sessionResult.focus();
});

function refreshHistory() {
  let listing;
  try {
    listing = history.list();
  } catch {
    historyStatus.textContent = 'История недоступна. Проверьте, разрешено ли браузеру хранить данные сайта.';
    return;
  }

  historyList.replaceChildren();
  historyList.hidden = listing.records.length === 0;
  historyStatus.textContent = listing.records.length ? '' : 'Сохранённых сессий пока нет';
  if (listing.skipped) {
    historyStatus.textContent = [historyStatus.textContent, 'Некоторые записи повреждены или имеют несовместимую версию.']
      .filter(Boolean).join('. ');
  }

  for (const record of listing.records) {
    const date = sessionDate.format(new Date(record.completedAt));
    const { hitCount, averageMs, classification } = record.summary;
    const row = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'history-action history-open';
    open.textContent = `${date} · Попадания: ${hitCount} · Средняя реакция: ${formatDecimal(averageMs)} мс · ${classification}`;
    open.addEventListener('click', () => {
      if (!viewedId) latestScale = { mode: reactionScale.value, limit: reactionLimit.value };
      viewedId = record.id;
      resultDate.textContent = `Сохранённая сессия · ${date} · ${record.durationMs / 1000} с`;
      resultDate.hidden = false;
      returnResult.hidden = false;
      renderResult(record);
      sessionResult.focus();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history-action';
    remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', `Удалить сессию от ${date}`);
    remove.addEventListener('click', () => {
      if (!window.confirm(`Удалить сессию от ${date}?`)) return;
      try {
        history.remove(record.id);
      } catch {
        historyStatus.textContent = 'Не удалось удалить сессию. Проверьте доступ к хранилищу браузера.';
        return;
      }
      if (viewedId === record.id) renderLatestResult();
      refreshHistory();
      historyTitle.focus();
    });
    row.append(open, remove);
    historyList.append(row);
  }
}

async function showResult(outcome) {
  screenState = 'returning';
  const completedAt = new Date();
  latestOutcome = outcome;
  latestScale = undefined;
  renderLatestResult();
  try {
    if (history.save(outcome, completedAt)) refreshHistory();
  } catch {
    historyStatus.textContent = 'Не удалось сохранить сессию. Хранилище браузера недоступно или заполнено.';
  }

  try {
    if (document.fullscreenElement === testScreen) {
      await document.exitFullscreen();
    }
  } catch {
    if (document.fullscreenElement === testScreen) {
      startStatus.textContent = 'Браузер не завершил полноэкранный режим. Нажмите Esc.';
    }
  } finally {
    showMainScreen();
    sessionResult.focus();
  }
}

startButton.addEventListener('click', async () => {
  if (screenState !== 'main' || startButton.disabled) return;
  screenState = 'requesting';
  startButton.disabled = true;
  startStatus.textContent = '';
  testScreen.hidden = false;

  try {
    await testScreen.requestFullscreen();
    if (document.fullscreenElement !== testScreen) {
      throw new Error('Fullscreen did not activate');
    }
  } catch {
    showMainScreen();
    startStatus.textContent = 'Не удалось открыть полноэкранный режим. Разрешите его в браузере и попробуйте снова.';
    startButton.focus();
    return;
  }

  mainScreen.hidden = true;
  timeRemaining.textContent = '60 с';
  hitCount.textContent = '0';
  screenState = 'preparing';
  preparation.hidden = false;
  beginButton.focus();
});

beginButton.addEventListener('click', () => {
  if (screenState !== 'preparing' || document.hidden ||
      document.fullscreenElement !== testScreen) return;

  screenState = 'running';
  preparation.hidden = true;
  startWidth = window.innerWidth;
  startHeight = window.innerHeight;
  session.start();
});

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === testScreen) return;
  if (screenState === 'preparing') {
    showMainScreen();
    startButton.focus();
  } else if (screenState === 'running') {
    session.interrupt('досрочный выход из полноэкранного режима');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screenState === 'running') {
    session.interrupt('вкладка была скрыта');
  }
});

window.addEventListener('resize', () => {
  if (screenState !== 'running') return;
  if (document.fullscreenElement !== testScreen) {
    session.interrupt('досрочный выход из полноэкранного режима');
  } else if (window.innerWidth !== startWidth || window.innerHeight !== startHeight) {
    session.interrupt('изменился размер окна');
  }
});

startButton.disabled = false;
refreshHistory();
