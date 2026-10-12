const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const activity = require('../src/shared/activity');
const domain = require('../src/shared/domain');
const employeeDeletion = require('../src/shared/employee-deletion');
const { DataStore } = require('../src/main/store');
const { activityXlsx } = require('../src/main/activity-xlsx');

const DATE = '2026-09-04';
const csv = (rows, name = 'history.csv', delimiter = ',') => ({ name, bytes: Buffer.from([
  ['URL', 'Title', 'Visit Time', 'Visit Duration', 'Web Browser', 'Browser Profile', 'Record ID', 'History File', 'Visit Count'],
  ...rows.map((row, i) => [`https://example.test/${row.url || i}`, row.title || 'Сторінка, тест', `${DATE.split('-').reverse().join('.')} ${row.time}`, row.duration ?? '', row.browser || 'Chrome', row.profile || 'PC-1 Chrome history', String(row.id ?? i), row.history || 'C:\\history\\20260904_History', '12']),
].map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(delimiter)).join('\r\n')) });
function setup() {
  const state = domain.defaultState(new Date('2026-09-04T12:00:00Z'));
  const person = domain.createEmployee(state, 'Тестовий працівник', new Date('2026-08-01T12:00:00Z'));
  return { state, person };
}
function importRows(state, person, file) {
  const preview = activity.previewImports(state, [file]);
  const assignments = Object.fromEntries(preview.report.sources.map(source => [source.id, person.id]));
  return activity.applyImports(state, preview, { assignments });
}
const report = state => activity.report(state, { startDate: DATE, endDate: DATE }, new Date('2026-09-05T12:00:00Z'));

test('parse quoted titles, semicolon CSV, missing duration, and profile browser override', () => {
  const file = csv([{ time: '9:01:02', duration: '00:08:30.936', title: 'Назва "тест",\nдругий рядок', profile: 'PC-1 Opera history' },
    { time: '10:00:00', browser: 'Firefox', profile: 'PC-1 Firefox history' }], 'export.csv', ';');
  const parsed = activity.parseFile(file);
  assert.equal(parsed.visits.length, 2);
  assert.equal(parsed.visits[0].title, 'Назва "тест",\nдругий рядок');
  assert.equal(parsed.visits[0].durationMs, 510936);
  assert.equal(parsed.sources[0].browser, 'Opera');
  assert.equal(parsed.visits[1].durationMs, null);
  assert.equal(parsed.issues.length, 0);
});

test('Windows-1251 and UTF-16 BOMs decode without corrupting Ukrainian', () => {
  assert.equal(activity.decode(Uint8Array.from([0xcf, 0xf0, 0xe0, 0xf6, 0xb3, 0xe2, 0xed, 0xe8, 0xea])).text, 'Працівник');
  const text = 'URL,Visit Time\r\nhttps://example.test,04.09.2026 09:00:00';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(activity.parseFile({ name: 'utf16.csv', bytes: le }).visits.length, 1);
});

test('identical files in a batch and renamed repeated imports never double count', () => {
  const { state, person } = setup(), file = csv([{ time: '09:00:00', duration: '00:10:00' }]);
  const preview = activity.previewImports(state, [file, { ...file, name: 'renamed.csv' }]);
  assert.equal(preview.report.newCount, 1);
  assert.equal(preview.report.files[1].duplicateFile, true);
  const result = activity.applyImports(state, preview, { assignments: Object.fromEntries(preview.report.sources.map(source => [source.id, person.id])) });
  assert.equal(result.importedFiles, 1);
  assert.equal(result.skippedFiles, 1);
  importRows(state, person, { ...file, name: 'again.csv' });
  assert.equal(state.activity.visits.length, 1);
  assert.equal(state.activity.imports.length, 1);
});

test('overlapping exports reuse events despite different history export filenames', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ id: 1, time: '09:00:00', duration: '00:03:00' }]));
  const file = csv([{ id: 1, time: '09:00:00', duration: '00:05:00', history: 'C:\\other\\20261001_History' },
    { id: 2, time: '10:00:00', duration: '00:10:00' }], 'later.csv');
  const preview = activity.previewImports(state, [file]);
  assert.equal(preview.report.newCount, 1);
  assert.equal(preview.report.files[0].duplicateCount, 1);
  activity.applyImports(state, preview, {});
  assert.equal(state.activity.sources.length, 1);
  assert.equal(report(state).journal.length, 2);
  assert.equal(report(state).journal.find(visit => visit.time === '09:00:00').durationMs, 300000);
  activity.removeImport(state, state.activity.imports[1].id);
  assert.equal(report(state).journal.length, 1);
  assert.equal(report(state).journal[0].durationMs, 180000);
});

test('same event on separate PCs stays separate; employee assignment combines sources', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ time: '09:00:00', duration: '00:15:00', profile: 'PC-1 Chrome history' },
    { time: '09:00:00', duration: '00:15:00', profile: 'PC-2 Chrome history' },
    { time: '09:00:00', duration: '00:15:00', profile: 'PC-1 Edge history' }]));
  const data = report(state);
  assert.equal(state.activity.sources.length, 3);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].recordCount, 3);
  assert.equal(data.rows[0].activeMs, 15 * 60000);
});

test('09–18 with lunch produces eight hours; continuous evidence has no long gaps or false early finish', () => {
  const { state, person } = setup();
  const rows = [];
  for (let m = 9 * 60; m < 18 * 60; m += 15) rows.push({ time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`, duration: '00:15:00' });
  importRows(state, person, csv(rows));
  const row = report(state).rows[0];
  assert.equal(row.expectedMs, 480 * 60000);
  assert.equal(row.activeMs, 480 * 60000);
  assert.equal(row.deficitMs, 0);
  assert.equal(row.longGaps.length, 0);
  assert.equal(row.earlyMs, 0);
  assert.equal(row.anomalies.length, 0);
});

test('lunch boundaries are exact and lunch never appears as a long pause', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ time: '12:50:00', duration: '00:20:00' }, { time: '13:50:00', duration: '00:20:00' }]));
  activity.updateSettings(state, { maxVisitMinutes: 20 });
  const row = report(state).rows[0];
  assert.equal(row.activeMs, 20 * 60000);
  for (const gap of row.gaps) assert.ok(gap.end <= Date.parse(DATE + 'T13:00:00Z') || gap.start >= Date.parse(DATE + 'T14:00:00Z'));
});

test('a shortfall made of many short gaps is flagged even without a long pause', () => {
  const { state, person } = setup(), rows = [];
  for (let m = 9 * 60; m < 18 * 60; m += 15) {
    if (m >= 13 * 60 && m < 14 * 60) continue;
    rows.push({ time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`, duration: '00:14:30' });
  }
  importRows(state, person, csv(rows));
  const row = report(state).rows[0];
  assert.equal(row.deficitMs, 16 * 60000);
  assert.equal(row.longGaps.length, 0);
  assert.deepEqual(row.anomalies.map(item => item.code), ['under_norm']);
});

test('long visits are capped; late start, early finish, long gaps and out-of-hours are visible', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ time: '09:20:00', duration: '06:00:00' }, { time: '16:00:00', duration: '00:01:00' }]));
  const row = report(state).rows[0];
  assert.equal(row.activeMs, 16 * 60000);
  assert.equal(row.cappedCount, 1);
  assert.equal(row.lateMs, 20 * 60000);
  assert.equal(row.earlyMs, 119 * 60000);
  assert.ok(row.anomalies.some(item => item.code === 'gap'));
  assert.ok(row.anomalies.some(item => item.code === 'late'));
  assert.ok(row.anomalies.some(item => item.code === 'early'));
  importRows(state, person, csv([{ time: '18:10:00', duration: '00:10:00' }], 'after.csv'));
  assert.ok(report(state).rows[0].anomalies.some(item => item.code === 'outside'));
});

test('unknown duration is retained, estimate is configurable, and missing days are not eight-hour absence', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ time: '09:00:00', browser: 'Firefox', profile: 'PC-1 Firefox history' }]));
  assert.equal(report(state).rows[0].missingCount, 1);
  assert.equal(report(state).rows[0].activeMs, 60000);
  activity.updateSettings(state, { missingVisitMinutes: 0 });
  assert.equal(report(state).rows[0].activeMs, 0);
  const missing = activity.report(state, { startDate: '2026-09-03', endDate: DATE }).rows.find(row => row.date === '2026-09-03');
  assert.equal(missing.status, 'no-data');
  assert.equal(missing.activeMs, null);
  assert.equal(missing.deficitMs, null);
});

test('absence and weekends have no eight-hour deficit and never rewrite presence', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ time: '09:00:00', duration: '00:15:00' }]));
  domain.setManualStatus(state, { employeeId: person.id, date: DATE, status: domain.STATUS.VACATION, note: 'Тест' });
  assert.equal(report(state).rows[0].expectedMs, 0);
  assert.equal(report(state).rows[0].deficitMs, 0);
  const count = Object.keys(state.records).length;
  activity.report(state, { startDate: DATE, endDate: '2026-09-06' });
  assert.equal(Object.keys(state.records).length, count);
});

test('a current unfinished day has no early-finish allegation or final eight-hour deficit', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ time: '09:00:00', duration: '00:15:00' }]));
  // Use local components, just like the native Windows process clock.
  const midday = new Date(2026, 8, 4, 12, 0, 0);
  const row = activity.report(state, { startDate: DATE, endDate: DATE }, midday).rows[0];
  assert.equal(row.inProgress, true);
  assert.equal(row.deficitMs, null);
  assert.ok(!row.anomalies.some(item => item.code === 'early'));
  assert.ok(row.gaps.every(gap => gap.end <= Date.parse(DATE + 'T12:00:00Z')));
});

test('bad dates, malformed CSV and invalid durations are exposed and partial import needs acknowledgement', () => {
  assert.throws(() => activity.parseTime('31.02.2026 09:00:00'));
  assert.throws(() => activity.parseTime('04.09.2026 24:00:00'));
  assert.throws(() => activity.parseDuration('00:80:00'));
  assert.throws(() => activity.csvRows('"URL,Visit Time', ','));
  const { state } = setup();
  const preview = activity.previewImports(state, [csv([{ time: '09:00:00' }, { time: '25:00:00' }])]);
  assert.equal(preview.report.issueCount, 1);
  assert.throws(() => activity.applyImports(state, preview), /підтвердьте/);
  assert.equal(state.activity.visits.length, 0);
  activity.applyImports(state, preview, { acceptIssues: true });
  assert.equal(state.activity.imports[0].issues.length, 1);
});

test('stale previews, nonexistent employees and invalid settings fail before mutation', () => {
  const { state } = setup(), file = csv([{ time: '09:00:00' }]);
  let preview = activity.previewImports(state, [file]);
  assert.throws(() => activity.applyImports(state, preview, { assignments: { [preview.report.sources[0].id]: 'missing' } }));
  assert.equal(state.activity.visits.length, 0);
  preview = activity.previewImports(state, [file]);
  activity.updateSettings(state, { gapMinutes: 45 });
  assert.throws(() => activity.applyImports(state, preview), /змінилися/);
  assert.throws(() => activity.updateSettings(state, { maxVisitMinutes: -1 }));
  assert.equal(state.activity.settings.maxVisitMinutes, 15);
});

test('restart and backup restore retain sources, visits, settings and report; old backups gain an empty section', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ time: '09:00:00', duration: '00:10:00' }]));
  activity.updateSettings(state, { gapMinutes: 40 });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-activity-test-'));
  try {
    const store = new DataStore(directory); store.state = state; store.save();
    const restored = new DataStore(directory).load();
    assert.deepEqual(restored.activity, state.activity);
    assert.equal(report(restored).rows[0].activeMs, 10 * 60000);
    const old = structuredClone(state); delete old.activity; old.schemaVersion = 16;
    assert.deepEqual(domain.normalizeState(old).activity, activity.empty());
    const bad = structuredClone(state); bad.activity.visits[0].versions[0].importId = 'broken';
    assert.throws(() => domain.normalizeState(bad), /Пошкоджено/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('deleting an archived employee removes their monitoring sources and visits', () => {
  const { state, person } = setup();
  importRows(state, person, csv([{ time: '09:00:00' }]));
  person.active = false; person.archivedDate = DATE; person.archivedAt = DATE + 'T12:00:00Z';
  const preview = employeeDeletion.preview(state, person.id);
  assert.equal(preview.activityVisits, 1);
  employeeDeletion.apply(state, { employeeId: person.id, expectedToken: preview.token });
  assert.equal(state.activity.sources.length, 0);
  assert.equal(state.activity.visits.length, 0);
  assert.doesNotThrow(() => domain.normalizeState(state));
});

test('exports preserve numeric measurements and do not interpret source text as formulas', () => {
  const { state, person } = setup(); person.name = '=HYPERLINK("x")';
  importRows(state, person, csv([{ time: '09:00:00', duration: '00:10:00', title: '=1+2' }]));
  const data = report(state), csvText = activity.reportCsv(data), bytes = activityXlsx(data);
  assert.ok(csvText.includes("'=HYPERLINK"));
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  // A valid central directory and EOCD are required, not merely an XLSX extension.
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  const zlib = require('node:zlib'), entries = {};
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    entries[name] = zlib.inflateRawSync(bytes.subarray(start, start + size)).toString(); offset = start + size;
  }
  assert.ok(entries['xl/worksheets/sheet2.xml'].includes('t="inlineStr"><is><t xml:space="preserve">=1+2'));
  assert.ok(!entries['xl/worksheets/sheet2.xml'].includes('<f>'));
  assert.ok(entries['xl/worksheets/sheet1.xml'].includes('state="frozen"'));
  assert.ok(entries['xl/worksheets/sheet1.xml'].includes('<autoFilter'));
});
