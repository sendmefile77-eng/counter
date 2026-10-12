const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const a = require('../src/shared/activity'), d = require('../src/shared/domain');
const categories = require('../src/shared/activity-categories');
const { DataStore } = require('../src/main/store');
const { activityXlsx } = require('../src/main/activity-xlsx');
const { zipEntries, unzipEntry } = require('../src/main/history-archive');
const NOW = new Date('2026-06-01T12:00:00Z'), M = 60000;
function setup() { const state = d.defaultState(NOW); const person = d.createEmployee(state, 'Працівник 1', new Date('2025-01-01T12:00:00Z')); const other = d.createEmployee(state, 'Працівник 2', new Date('2025-01-01T12:00:00Z')); return { state, person, other }; }
function input(events, name = 'history.csv') {
  return { name, bytes: Buffer.from(['URL,Visit Time,Visit Duration,Web Browser,Browser Profile,Record ID', ...events.map((event, i) => [event.url || 'https://example.test/', `${event.date} ${event.clock}`, event.duration ?? '00:15:00', event.browser || 'Chrome', event.profile || 'PC-1 Chrome history', event.id ?? i + 1].join(','))].join('\r\n')) };
}
function importEvents(state, person, events, name) { const preview = a.previewImports(state, [input(events, name)]); a.applyImports(state, preview, { assignments: Object.fromEntries(preview.report.sources.map(s => [s.id, person?.id || null])) }); }
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
function day(date, opts = {}) {
  const events = [];
  for (let minute = opts.late ? 585 : 540; minute < (opts.early ? 1020 : 1080); minute += 15) {
    if (minute >= 780 && minute < 840 || opts.gap && minute >= 630 && minute < 660) continue;
    events.push({ date, clock: clock(minute), url: opts.personal && minute >= 900 && minute < 960 ? 'https://personal.test/watch' : 'https://example.test/work' });
  }
  return events;
}
function report(state, startDate, endDate, now = NOW) { return a.report(state, { startDate, endDate, includeAnalytics: true, groupBy: 'week' }, now); }

test('category rules respect employee scope, subdomain boundaries and explicit unknown overrides', () => {
  const { state, person, other } = setup();
  a.setCategory(state, { domain: 'https://Example.test/path', category: 'personal' });
  a.setCategory(state, { domain: 'example.test', employeeId: person.id, category: 'work' });
  assert.equal(categories.categoryFor(state.activity.domainRules, person.id, 'www.example.test').category, 'work');
  assert.equal(categories.categoryFor(state.activity.domainRules, other.id, 'www.example.test').category, 'personal');
  assert.equal(categories.categoryFor(state.activity.domainRules, other.id, 'fakeexample.test').category, 'unknown');
  a.setCategory(state, { domain: 'example.test', employeeId: other.id, category: 'unknown' });
  assert.equal(categories.categoryFor(state.activity.domainRules, other.id, 'example.test').category, 'unknown');
  a.setCategory(state, { domain: 'example.test', employeeId: other.id, category: 'inherit' });
  assert.equal(categories.categoryFor(state.activity.domainRules, other.id, 'example.test').category, 'personal');
  assert.throws(() => a.setCategory(state, { domain: '*.example.test', category: 'work' }));
  assert.throws(() => a.setCategory(state, { domain: 'example.test', employeeId: 'missing', category: 'personal' }));
});

test('category time partitions overlapping browsers conservatively and excludes lunch and outside hours', () => {
  const { state, person } = setup();
  importEvents(state, person, [
    { date: '2026-04-06', clock: '09:00:00', url: 'https://personal.test/', duration: '00:15:00' },
    { date: '2026-04-06', clock: '09:10:00', url: 'https://work.test/', duration: '00:10:00', profile: 'PC-1 Edge history' },
    { date: '2026-04-06', clock: '09:12:00', url: 'https://unknown.test/', duration: '00:10:00' },
    { date: '2026-04-06', clock: '13:00:00', url: 'https://personal.test/', duration: '00:15:00' },
    { date: '2026-04-06', clock: '19:00:00', url: 'https://personal.test/', duration: '00:15:00' },
  ]);
  a.setCategory(state, { domain: 'personal.test', category: 'personal' }); a.setCategory(state, { domain: 'work.test', category: 'work' });
  const row = report(state, '2026-04-06', '2026-04-06').rows[0];
  assert.equal(row.activeMs, 22 * M); assert.equal(row.workMs, 10 * M); assert.equal(row.personalMs, 10 * M); assert.equal(row.unknownMs, 2 * M);
  assert.equal(row.workMs + row.personalMs + row.unknownMs, row.activeMs);
});

test('night records cannot conceal late first evidence in the working schedule', () => {
  const { state, person } = setup();
  importEvents(state, person, [{ date: '2026-04-06', clock: '00:30:00' }, { date: '2026-04-06', clock: '10:00:00' }, { date: '2026-04-06', clock: '22:00:00' }]);
  const row = report(state, '2026-04-06', '2026-04-06').rows[0];
  assert.equal(row.first, '00:30:00'); assert.equal(row.firstWork, '10:00:00'); assert.equal(row.lateMs, 60 * M); assert.ok(row.earlyMs > 0);
});

test('repeated late Mondays expose their exact sample and dates rather than a general late claim', () => {
  const { state, person } = setup(); const dates = ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10', '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-20'];
  importEvents(state, person, dates.flatMap(date => day(date, { late: date.endsWith('06') || date.endsWith('13') || date.endsWith('20') })));
  const personReport = report(state, '2026-04-01', '2026-04-30').analysis.people[0];
  assert.equal(personReport.summary.sampleDays, 10);
  const monday = personReport.risks.find(r => r.code === 'late_weekday');
  assert.equal(monday.count, 3); assert.equal(monday.denominator, 3); assert.equal(monday.percent, 100); assert.deepEqual(monday.dates, ['2026-04-06', '2026-04-13', '2026-04-20']);
  assert.ok(!personReport.risks.some(r => r.code === 'late'));
});

test('recurring clock pauses are based on different dates and lunch never forms a pattern', () => {
  const { state, person } = setup(); const dates = ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10'];
  importEvents(state, person, dates.flatMap(date => day(date, { gap: true, personal: true })));
  a.setCategory(state, { domain: 'personal.test', employeeId: person.id, category: 'personal' });
  const result = report(state, '2026-04-06', '2026-04-10').analysis.people[0];
  const pause = result.risks.find(r => r.code === 'clock_gap'); assert.equal(pause.from, '10:30'); assert.equal(pause.to, '11:00'); assert.equal(pause.count, 5);
  assert.ok(!result.risks.some(r => r.from === '13:00' || r.to === '14:00')); assert.ok(result.risks.some(r => r.code === 'personal'));
  assert.equal(result.summary.personalMs, 5 * 60 * M);
  assert.ok(result.risks.every(r => new Set(r.dates).size === r.count));
});

test('missing data, leave, weekends, incomplete and future days cannot create employee violations', () => {
  const { state, person } = setup(); const dates = ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11', '2026-04-13'];
  importEvents(state, person, dates.flatMap(date => day(date, { late: true })));
  state.presenceRecords[person.id + '|2026-04-09'] = { employeeId: person.id, date: '2026-04-09', status: 'vacation', note: '' };
  const result = report(state, '2026-04-06', '2026-04-15', new Date('2026-04-10T07:30:00Z')).analysis.people[0];
  assert.equal(result.summary.sampleDays, 3); assert.equal(result.summary.inProgressDays, 1); assert.equal(result.risks.length, 0);
  const noData = report(state, '2026-04-06', '2026-04-30').rows.find(r => r.date === '2026-04-14'); assert.equal(noData.activeMs, null); assert.equal(noData.deficitMs, null);
});

test('trend comparisons normalize by observed days and reject insufficient samples', () => {
  const { state, person } = setup();
  const past = ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];
  const current = ['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24'];
  importEvents(state, person, [...past.flatMap(date => day(date)), ...current.flatMap(date => day(date, { late: true }))]);
  const personReport = report(state, '2026-04-20', '2026-05-01').analysis.people[0];
  assert.equal(personReport.trend.comparable, true); assert.equal(personReport.trend.current.sampleDays, 5); assert.equal(personReport.trend.previous.sampleDays, 8);
  assert.equal(personReport.trend.activeChangeMs, -45 * M); assert.equal(personReport.trend.lateChangePoints, 100);
  assert.equal(report(state, '2026-04-20', '2026-04-20').analysis.people[0].trend.comparable, false);
});

test('employee folders combine computers, retain years and exclude other employees in source/file views', () => {
  const { state, person, other } = setup();
  importEvents(state, person, [{ date: '2024-01-08', clock: '09:00:00' }], '2024.csv');
  importEvents(state, person, [{ date: '2026-04-06', clock: '09:00:00', profile: 'PC-2 Edge history' }], '2026.csv');
  importEvents(state, other, [{ date: '2026-04-06', clock: '09:00:00', profile: 'PC-3 Chrome history' }], 'other.csv');
  const folder = a.folders(state).find(f => f.employeeId === person.id); assert.equal(folder.fileCount, 2); assert.equal(folder.sourceCount, 2); assert.equal(folder.recordCount, 2); assert.equal(folder.firstDate, '2024-01-08');
  const data = a.report(state, { startDate: '2024-01-01', endDate: '2026-12-31', employeeId: person.id, includeAnalytics: true, groupBy: 'year' }, NOW);
  assert.equal(data.journal.length, 2); assert.equal(data.imports.length, 2); assert.equal(data.sources.length, 2); assert.equal(data.analysis.people.length, 1); assert.equal(data.analysis.people[0].periods.length, 3);
  assert.equal(data.folders.find(f => f.employeeId === other.id).recordCount, 1);
});

test('search and anomaly filters cannot bias analytics sample denominators', () => {
  const { state, person } = setup(); importEvents(state, person, ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10'].flatMap((date, i) => day(date, { late: i < 3 })));
  const filtered = a.report(state, { startDate: '2026-04-06', endDate: '2026-04-10', query: 'not found', onlyAnomalies: true, includeAnalytics: true }, NOW);
  assert.equal(filtered.rows.length, 0); assert.equal(filtered.analysis.people[0].summary.sampleDays, 5); assert.equal(filtered.analysis.people[0].risks.find(r => r.code === 'late').denominator, 5);
});

test('category history survives reload; previous backups migrate; deleted employee rules are removed', () => {
  const { state, person } = setup(); importEvents(state, person, day('2026-04-06', { personal: true })); a.setCategory(state, { domain: 'personal.test', employeeId: person.id, category: 'personal' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-analytics-reload-'));
  try { const store = new DataStore(dir); store.state = state; store.save(); const restored = new DataStore(dir); restored.load(); assert.deepEqual(restored.state.activity, state.activity); assert.equal(report(restored.state, '2026-04-06', '2026-04-06').analysis.people[0].summary.personalMs, 60 * M); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const old = structuredClone(state); old.schemaVersion = 17; delete old.activity.domainRules; const normalized = d.normalizeState(old); assert.equal(normalized.schemaVersion, 18); assert.deepEqual(normalized.activity.domainRules, []);
  a.removeEmployee(state.activity, person.id); assert.equal(state.activity.domainRules.length, 0);
});

test('Excel statistics, periods and pattern dates are complete and maintain valid workbook relationships', () => {
  const { state, person } = setup(); importEvents(state, person, ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10'].flatMap(date => day(date, { gap: true })));
  const buffer = activityXlsx(report(state, '2026-04-06', '2026-04-10'));
  const entries = zipEntries(buffer); const read = name => unzipEntry(buffer, entries.find(e => e.name === name)).toString('utf8');
  assert.match(read('xl/workbook.xml'), /name="Статистика"/); assert.match(read('xl/workbook.xml'), /name="Повторення"/);
  assert.equal(entries.filter(e => /worksheets\/sheet\d+\.xml/.test(e.name)).length, 6);
  assert.match(read('xl/_rels/workbook.xml.rels'), /Id="rId7".*styles/);
  assert.equal((read('xl/worksheets/sheet6.xml').match(/<row /g) || []).length, 6);
});

test('a shared upload identifies all affected folders while each employee sees only their own contribution', () => {
  const { state, person, other } = setup();
  const preview = a.previewImports(state, [input([{ date: '2026-04-06', clock: '09:00:00', profile: 'PC-1 Chrome history' }, { date: '2026-04-06', clock: '10:00:00', profile: 'PC-2 Chrome history' }])]);
  a.applyImports(state, preview, { assignments: { [preview.report.sources[0].id]: person.id, [preview.report.sources[1].id]: other.id } });
  const personal = a.report(state, { startDate: '2026-04-06', endDate: '2026-04-06', employeeId: person.id }, NOW);
  assert.equal(personal.imports[0].retainedCount, 1); assert.equal(personal.imports[0].affectedFolders, 2); assert.equal(personal.sources.length, 1); assert.equal(personal.totals.unassignedSources, 0);
  assert.ok(a.folders(state).filter(folder => folder.employeeId !== 'unassigned').every(folder => folder.fileCount === 1));
});

test('categories reject non-string keys in API calls and backups', () => {
  const { state, person } = setup();
  assert.throws(() => a.setCategory(state, { domain: 'example.test', category: ['personal'] }));
  state.activity.domainRules = [{ domain: 'example.test', employeeId: person.id, category: ['personal'] }];
  assert.throws(() => d.normalizeState(state), /Некоректне правило/);
});
