const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { database, zip, file, EPOCH } = require('./helpers/history-fixtures.cjs');
const archive = require('../src/main/history-archive');
const { readActivityFiles } = require('../src/main/activity-reader');
const a = require('../src/shared/activity');
const d = require('../src/shared/domain');
const { DataStore } = require('../src/main/store');
const t = utc => BigInt(Date.parse(utc)) * 1000n;
const rows = [1, 2, 3].map(id => ({ id, utc: `2026-01-08T0${id + 6}:00:00Z`, duration: 60000000n }));
const fixture = (items, name) => archive.parseArchive(file(items, name));
function state() {
  const s = d.defaultState();
  const p = d.createEmployee(s, 'Тестовий працівник', new Date('2025-01-01T00:00:00Z'));
  return { s, p };
}
function apply(s, parsed, employeeId) {
  const preview = a.previewParsedImports(s, parsed);
  const result = a.applyImports(s, preview, { assignments: Object.fromEntries(preview.report.sources.map(source => [source.id, employeeId || null])) });
  return { preview, result };
}

test('Chromium BigInt timestamps and Firefox WAL-mode standalone snapshots are read without mutation', () => {
  const chrome = database('Chrome', rows), firefox = database('Firefox', rows, true);
  const before = Buffer.from(firefox);
  const f = file([['PC-1 Chrome history/a_History', chrome], ['PC-1 Edge history/b_History', chrome], ['PC-1 Firefox history/c_History', firefox], ['PC-1 Chrome history/empty_History', database('Chrome', [])], ['notes.txt', Buffer.from('text')]]);
  const parsed = archive.parseArchive(f);
  assert.equal(parsed.rowCount, 9); assert.equal(parsed.visits.length, 9); assert.equal(parsed.sources.length, 3);
  assert.deepEqual(parsed.sources.map(s => s.browser), ['Chrome', 'Edge', 'Firefox']);
  assert.equal(parsed.visits[0].timestamp, Date.parse('2026-01-08T09:00:00Z'));
  assert.equal(parsed.visits[0].durationMs, 60000); assert.ok(parsed.visits.filter(v => v.rawBrowser === 'Firefox').every(v => v.durationMs === null));
  assert.equal(parsed.databases[3].status, 'empty'); assert.equal(parsed.ignoredFiles, 1); assert.equal(parsed.issues.length, 0);
  assert.deepEqual(firefox, before);
});

test('Kyiv conversion accounts for DST boundaries, local midnight, and microsecond precision', () => {
  const cases = [
    ['2026-01-08T22:30:00Z', '2026-01-09T00:30:00Z'],
    ['2026-07-08T06:00:00Z', '2026-07-08T09:00:00Z'],
    ['2026-03-29T00:59:59Z', '2026-03-29T02:59:59Z'],
    ['2026-03-29T01:00:00Z', '2026-03-29T04:00:00Z'],
    ['2026-10-25T00:59:59Z', '2026-10-25T03:59:59Z'],
    ['2026-10-25T01:00:00Z', '2026-10-25T03:00:00Z'],
  ];
  for (const [utc, wall] of cases) for (const chromium of [true, false]) {
    const raw = t(utc) + (chromium ? EPOCH : 0n) + 123456n;
    assert.equal(archive.visitTime(raw, chromium).timestamp, Date.parse(wall));
  }
  assert.throws(() => archive.visitTime(0n, false));
  assert.throws(() => archive.visitTime(t('1999-01-01T00:00:00Z'), false));
});

test('all-empty archive is a visible zero-record import rather than an absence', () => {
  const parsed = fixture([['PC-1 Chrome history/empty_History', database('Chrome', [])]]);
  assert.equal(parsed.visits.length, 0); assert.equal(parsed.databases[0].status, 'empty');
  const { s } = state(); apply(s, [parsed]);
  assert.equal(s.activity.imports.length, 1); assert.equal(s.activity.sources.length, 0);
  assert.equal(a.report(s, { startDate: '2026-01-08', endDate: '2026-01-08' }).rows.length, 0);
});

test('multiple profiles and computers stay distinct; repacked exports reuse visits and provenance', () => {
  const db = database('Chrome', rows), other = database('Chrome', rows.map(r => ({ ...r, url: `https://other.test/${r.id}` })));
  const { s, p } = state();
  const items = [['PC-1 Chrome history/first_History', db], ['PC-1 Chrome history/second_History', other], ['PC-2 Chrome history/first_History', db]];
  apply(s, [fixture(items)], p.id); assert.equal(s.activity.sources.length, 3);
  const renamed = items.map(([name, bytes]) => [name.replace('_History', '_new_History'), bytes]);
  const { result } = apply(s, [fixture(renamed, 'PC-1_20260109_180000.zip')], p.id);
  assert.equal(result.newCount, 0); assert.equal(result.duplicateCount, 9); assert.equal(s.activity.visits.length, 9);
  assert.ok(s.activity.visits.every(v => v.versions.length === 2));
  a.removeImport(s, s.activity.imports[0].id); assert.equal(s.activity.visits.length, 9);
  assert.ok(s.activity.sources.every(source => source.employeeId === p.id));
});

test('trimmed profile keeps its assignment only with a unique exact overlap', () => {
  const { s, p } = state();
  apply(s, [fixture([['PC-1 Chrome history/a_History', database('Chrome', rows)]])], p.id);
  const updated = [...rows.slice(1), { id: 4, utc: '2026-01-08T10:00:00Z' }];
  const prepared = a.previewParsedImports(s, [fixture([['PC-1 Chrome history/b_History', database('Chrome', updated)]], 'updated.zip')]);
  assert.equal(prepared.report.newCount, 1); assert.equal(prepared.report.files[0].duplicateCount, 2);
  assert.equal(prepared.report.sources[0].employeeId, p.id);
  a.applyImports(s, prepared); assert.equal(s.activity.sources.length, 1); assert.equal(s.activity.visits.length, 4);
  // A different PC with the same records must not inherit this employee.
  const distinct = a.previewParsedImports(s, [fixture([['PC-2 Chrome history/b_History', database('Chrome', updated)]], 'other-pc.zip')]);
  assert.equal(distinct.report.newCount, 3); assert.equal(distinct.report.sources[0].employeeId, null);
});

test('ambiguous matching histories do not merge separate profiles', () => {
  const { s } = state();
  const shared = rows.slice(1);
  apply(s, [fixture([['PC-1 Chrome history/a_History', database('Chrome', rows)], ['PC-1 Chrome history/b_History', database('Chrome', [{ id: 10, utc: '2026-01-08T06:00:00Z' }, ...shared])]])]);
  const preview = a.previewParsedImports(s, [fixture([['PC-1 Chrome history/c_History', database('Chrome', shared)]], 'trimmed.zip')]);
  assert.equal(preview.report.newCount, 2); a.applyImports(s, preview); assert.equal(s.activity.sources.length, 3);
});

test('mixed CSV and ZIP reconcile exact records without changing the CSV clock', () => {
  const csv = { name: 'history.csv', bytes: Buffer.from('URL,Visit Time,Web Browser,Browser Profile,Record ID\r\nhttps://example.test/1,08.01.2026 09:00:00,Chrome,PC-1 Chrome history,1\r\nhttps://example.test/2,08.01.2026 10:00:00,Chrome,PC-1 Chrome history,2') };
  const zipFile = file([['PC-1 Chrome history/a_History', database('Chrome', rows)]]);
  for (const inputs of [[csv, zipFile], [zipFile, csv]]) {
    const { s, p } = state(); const { result } = apply(s, archive.parseInputs(inputs), p.id);
    assert.equal(result.newCount, 3); assert.equal(result.duplicateCount, 2); assert.equal(s.activity.sources.length, 1);
    assert.equal(a.effectiveVisit(s.activity.visits[0]).durationMs, 60000);
  }
});

test('corrupt databases are disclosed and importing the sound part requires acknowledgement', () => {
  const parsed = fixture([['PC-1 Chrome history/good_History', database()], ['PC-1 Chrome history/bad_History', Buffer.from('broken')]]);
  assert.equal(parsed.visits.length, 1); assert.equal(parsed.databases[1].status, 'error'); assert.ok(parsed.issues[0].entry.endsWith('bad_History'));
  const { s } = state(); const preview = a.previewParsedImports(s, [parsed]);
  assert.throws(() => a.applyImports(s, preview), /підтвердьте/); a.applyImports(s, preview, { acceptIssues: true });
  assert.equal(s.activity.imports[0].databases[1].status, 'error');
  assert.throws(() => fixture([['bad_History', Buffer.from('broken')]]), /Не вдалося прочитати/);
});

test('ZIP rejects unsafe paths, encryption, unsupported compression and corrupt sizes/checksums', () => {
  for (const name of ['../escape', '/absolute', 'C:/drive', 'safe/../../escape']) assert.throws(() => archive.zipEntries(zip([[name, Buffer.from('x')]])), /шлях/);
  assert.throws(() => archive.zipEntries(zip([['same', Buffer.from('a')], ['same', Buffer.from('b')]])), /шлях/);
  const mutate = fn => { const buffer = zip([['item', Buffer.from('safe')]], 0); const central = buffer.readUInt32LE(buffer.length - 6); fn(buffer, central); return buffer; };
  assert.throws(() => archive.zipEntries(mutate((b, c) => b.writeUInt16LE(1, c + 8))), /паролем/);
  assert.throws(() => archive.zipEntries(mutate((b, c) => b.writeUInt16LE(99, c + 10))), /стиснення/);
  assert.throws(() => archive.zipEntries(mutate((b, c) => b.writeUInt32LE(100 * 1024 * 1024, c + 24))), /межу/);
  const bad = mutate(b => { b[34] ^= 255; }); assert.throws(() => archive.unzipEntry(bad, archive.zipEntries(bad)[0]), /контрольна сума/);
  assert.throws(() => archive.zipEntries(Buffer.from('not a zip')), /структуру/);
});

test('background worker imports synthetic SQLite ZIP; JSON reload preserves database metadata and provenance', async () => {
  const input = file([['PC-1 Firefox history/places.sqlite', database('Firefox', rows, true)]]);
  const parsed = await readActivityFiles([input]); const { s, p } = state(); apply(s, parsed, p.id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-reload-'));
  try {
    const store = new DataStore(dir); store.state = s; store.save(); const reloaded = new DataStore(dir); reloaded.load();
    assert.deepEqual(reloaded.state.activity, s.activity);
    const preview = a.previewParsedImports(reloaded.state, await readActivityFiles([{ ...input, name: 'renamed.zip' }]));
    assert.equal(preview.report.newCount, 0); assert.equal(preview.report.files[0].duplicateFile, true);
    assert.equal(a.report(reloaded.state, { startDate: '2026-01-08', endDate: '2026-01-08' }).rows[0].expectedMs, 8 * 3600000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  await assert.rejects(readActivityFiles([null]), /CSV/);
});

test('screen pagination keeps every journal record available and leaves exports and stored data complete', () => {
  const { s } = state(); const many = Array.from({ length: 123 }, (_, i) => ({ id: i + 1, utc: '2026-01-08T07:00:00Z' }));
  apply(s, [fixture([['PC-1 Chrome history/a_History', database('Chrome', many)]])]);
  const filter = { startDate: '2026-01-08', endDate: '2026-01-08' };
  const complete = a.screenReport(s, filter), pages = [0, 1, 2].map(journalPage => a.screenReport(s, { ...filter, journalPage }));
  assert.equal(complete.journal.length, 123); assert.deepEqual(pages.map(p => p.journal.length), [50, 50, 23]);
  assert.deepEqual(pages.flatMap(p => p.journal.map(v => v.id)), complete.journal.map(v => v.id));
  assert.ok(pages.every(p => p.totals.recordCount === 123 && p.journalCount === 123));
  assert.equal(a.screenReport(s, { ...filter, journalPage: 999 }).journalPage, 2);
  const summary = a.screenSummary(s); assert.equal(summary.visitCount, 123); assert.equal(summary.visits, undefined);
  assert.equal(s.activity.visits.length, 123); assert.equal(a.report(s, filter).journal.length, 123);
});

test('a SQLite WAL sidecar contributes committed visits instead of being ignored', () => {
  const { DatabaseSync } = require('node:sqlite'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-live-wal-'));
  const dbPath = path.join(dir, 'places.sqlite'); let db;
  try {
    fs.writeFileSync(dbPath, database('Firefox', [])); db = new DatabaseSync(dbPath); db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;');
    db.prepare('INSERT INTO moz_places VALUES(?,?,?,?,?)').run(1, 'https://example.test/wal', 'WAL test', 1, 0);
    db.prepare('INSERT INTO moz_historyvisits VALUES(?,?,?,?,?)').run(1, 1, t('2026-01-08T07:00:00Z'), 1, 0);
    const main = fs.readFileSync(dbPath), wal = fs.readFileSync(dbPath + '-wal');
    const parsed = fixture([['PC-1 Firefox history/places.sqlite', main], ['PC-1 Firefox history/places.sqlite-wal', wal]]);
    assert.equal(parsed.visits.length, 1); assert.equal(parsed.visits[0].timestamp, Date.parse('2026-01-08T09:00:00Z'));
    assert.deepEqual(fs.readFileSync(dbPath), main); assert.deepEqual(fs.readFileSync(dbPath + '-wal'), wal);
  } finally { db?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('invalid SQLite visits are disclosed while Chromium zero durations remain unknown', () => {
  const parsed = fixture([['PC-1 Chrome history/a_History', database('Chrome', [{ id: 1, utc: '2026-01-08T07:00:00Z' }, { id: 2, utc: '1999-01-01T07:00:00Z' }, { id: 3, utc: '2026-01-08T08:00:00Z', duration: -1n }])]]);
  assert.equal(parsed.rowCount, 3); assert.equal(parsed.visits.length, 1); assert.equal(parsed.visits[0].durationMs, null); assert.equal(parsed.issues.length, 2);
  const { s } = state(); const preview = a.previewParsedImports(s, [parsed]); assert.throws(() => a.applyImports(s, preview), /підтвердьте/);
});

test('backup validation rejects malformed archive metadata and still accepts earlier CSV backups', () => {
  const { s } = state(); apply(s, [fixture([['PC-1 Chrome history/a_History', database()]])]);
  const invalid = structuredClone(s); invalid.activity.imports[0].databases[0].readRecords = '<img src=x>';
  assert.throws(() => d.normalizeState(invalid), /Пошкоджено/);
  const old = structuredClone(s); for (const key of ['format', 'databases', 'ignoredFiles']) delete old.activity.imports[0][key];
  assert.equal(d.normalizeState(old).activity.visits.length, 1);
});
