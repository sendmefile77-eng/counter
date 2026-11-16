const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const domain = require('../src/shared/domain');
const work = require('../src/shared/work');
const presence = require('../src/shared/presence');
const productivity = require('../src/shared/productivity');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/results-ui.js'), 'utf8');
const today = '2026-11-16';

function navigation(view, { weekend = false, missing = false } = {}) {
  const ui = { journalView: view, month: '2025-12', journalAnchor: '2025-12-05', journalFrom: '2025-12-01', journalTo: '2025-12-31', journalHideWeekends: true, journalQuery: 'Олена', journalArchived: true };
  let cleared = 0, rendered = 0, focusOptions;
  const column = { getBoundingClientRect: () => ({ left: 1010 - calendar.scrollLeft, width: 56 }), focus(options) { focusOptions = options; } };
  const calendar = { clientWidth: 800, scrollLeft: 100,
    getBoundingClientRect: () => ({ left: 10 }),
    querySelector: selector => selector === `th.sticky-name` ? { getBoundingClientRect: () => ({ width: 180 }) } : selector === `[data-result-column="${today}"]` ? column : null };
  const context = vm.createContext({ ui, localDateKey: () => today, configuredWorkday: () => !weekend,
    clearJournalSelection: () => cleared++, renderShell: () => rendered++,
    appRoot: { querySelector: selector => !missing && selector === '.result-calendar' ? calendar : null } });
  vm.runInContext(source, context);
  context.showResultToday();
  return { ui, calendar, cleared, rendered, focusOptions };
}

for (const view of ['month', 'week', 'period']) {
  test(`Today navigates the ${view} view and centers the date clear of the pinned name`, () => {
    const result = navigation(view);
    assert.equal(result.ui.journalView, view);
    assert.equal(result.ui.month, '2026-11');
    assert.equal(result.ui.journalAnchor, today);
    assert.equal(result.ui.journalFrom, today);
    assert.equal(result.ui.journalTo, today);
    assert.equal(result.ui.journalQuery, 'Олена');
    assert.equal(result.ui.journalArchived, true);
    assert.equal(result.calendar.scrollLeft, 538);
    assert.equal(result.focusOptions.preventScroll, true);
    assert.equal(result.cleared, 1); assert.equal(result.rendered, 1);
  });
}

test('Today reveals a hidden calendar weekend and tolerates a missing table', () => {
  assert.equal(navigation('month', { weekend: true }).ui.journalHideWeekends, false);
  assert.equal(navigation('period', { missing: true }).rendered, 1);
});

test('result calendar exposes the current date, distinct states and accepted weekend objects without rewriting history', () => {
  const now = new Date('2026-11-16T18:00:00Z'), state = domain.defaultState(now);
  const person = domain.createEmployee(state, 'Олена', new Date('2026-11-01T09:00:00Z'));
  work.receiveObjects(state, { id: 'weekend', employeeId: person.id, date: '2026-11-15', objectCount: 2 }, new Date('2026-11-15T18:00:00Z'));
  presence.write(state, { employeeId: person.id, date: today, status: 'sick' }, now);
  work.receiveObjects(state, { id: 'sick', employeeId: person.id, date: today, objectCount: 3 }, now);
  const before = structuredClone(state);
  const context = vm.createContext({ snapshot: state, ui: { journalView: 'month', month: '2026-11', journalQuery: '', journalArchived: false, journalHideWeekends: false },
    LadWork: work, LadPresence: presence, LadProductivity: { ...productivity, report: (s, filter) => productivity.report(s, filter, now) },
    localDateKey: () => today, journalRange: () => ({ startDate: '2026-11-01', endDate: '2026-11-30' }),
    configuredWorkday: date => ![0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay()),
    h: value => String(value ?? ''), formatDate: date => date, dateFromKey: date => new Date(date + 'T12:00:00Z'), WEEKDAY_SHORT: ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] });
  vm.runInContext(source, context);
  const html = context.resultJournalPage();
  assert.match(html, /data-result-column="2026-11-16"[^>]+aria-current="date"/);
  assert.match(html, /data-scroll-key="result-calendar"/);
  assert.match(html, /result-accepted[^>]*data-status="default_work"[^>]*><button[^>]*data-date="2026-11-15"[^>]*>2<\/button>/);
  assert.match(html, /result-excluded result-today[^>]*data-status="sick"[^>]*><button[^>]*data-date="2026-11-16"[^>]*>ЛК<small>\+3<\/small>/);
  assert.match(html, /result-future[^>]*><button[^>]*data-date="2026-11-17"[^>]*><\/button>/);
  assert.deepEqual(state, before);
});
