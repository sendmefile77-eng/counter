const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/shared/domain');
const imp = require('../src/shared/document-import');
const profiles = require('../src/shared/employee-profiles');
const deletion = require('../src/shared/employee-deletion');
const now = new Date('2026-10-19T10:00:00Z');
function fixture() {
  const state = d.defaultState(now), a = d.createEmployee(state, 'Юлия*О', now), b = d.createEmployee(state, 'Юлия*_С', now);
  return { state, a, b };
}
function inputFor(state, text, source = 'Список відділу', shortRule = '') {
  return { source, shortRule, rows: imp.parseBlocks(state, [{ name: 'test.docx', text }], source, shortRule) };
}
test('two Julias are explicitly linked by patronymic, then full names survive reload', () => {
  const { state, a, b } = fixture();
  const text = 'ПІБ\tДата народження\nКоваленко Юлія Олександрівна\t12.03.1985\nМельник Юлія Сергіївна\t05.07';
  const unresolved = inputFor(state, text);
  assert.equal(unresolved.rows[0].employeeId, '');
  assert.equal(imp.preview(state, unresolved, now).canApply, false);
  const input = { ...inputFor(state, text, 'Список відділу', 'patronymic'), rememberShortRule: true };
  assert.equal(input.rows[0].employeeId, a.id); assert.equal(input.rows[1].employeeId, b.id);
  const before = structuredClone(state), report = imp.preview(state, input, now);
  assert.equal(report.canApply, true); assert.deepEqual(state, before);
  imp.apply(state, input, report.expectedToken, now);
  const reloaded = d.normalizeState(structuredClone(state), now);
  assert.equal(reloaded.employees[0].name, 'Юлия*О');
  assert.equal(reloaded.employees[0].profile.fullName, 'Коваленко Юлія Олександрівна');
  assert.equal(reloaded.employees[0].profile.birthDate, '1985-03-12');
  assert.equal(reloaded.employees[1].profile.birthDate, '--07-05');
  assert.equal(inputFor(reloaded, text).rows[0].employeeId, a.id);
  assert.equal(reloaded.documentImport.rules[0].value, 'patronymic');
});
test('same patronymic initials stay ambiguous and remembered mappings are scoped', () => {
  const { state, a, b } = fixture(); b.name = 'Юлия_О';
  assert.deepEqual(imp.candidates(state, 'Коваленко Юлія Олександрівна', 'A', 'patronymic'), [a.id, b.id]);
  const input = inputFor(state, 'Коваленко Юлія Олександрівна');
  input.rows[0].employeeId = a.id; input.rows[0].resolutionScope = 'source';
  imp.apply(state, input, imp.preview(state, input, now).expectedToken, now);
  assert.equal(state.documentImport.rules[0].source, input.source);
  // Unknown abbreviations are learned only for the explicitly chosen source.
  const mark = inputFor(state, 'ПІБ\tСтатус\tЗ\tДо\nЮлия*О\tнавч.\t20.10.2026\t20.10.2026', 'A');
  mark.rows[0].status = 'training_online'; mark.rows[0].statusScope = 'source';
  imp.apply(state, mark, imp.preview(state, mark, now).expectedToken, now);
  assert.equal(imp.knownStatus('навч.', state, 'A'), 'training_online');
  assert.equal(imp.knownStatus('навч.', state, 'B'), '');
});
test('missing years, invalid dates and inclusive end dates require explicit answers', () => {
  const { state, a } = fixture();
  const input = inputFor(state, 'ПІБ\tСтатус\tЗ\tДо\nЮлия*О\tВідпустка\t21.10\t25.10');
  assert.equal(input.rows[0].employeeId, a.id);
  assert.match(imp.preview(state, input, now).errors.join(), /рік/);
  input.year = '2026';
  assert.match(imp.preview(state, input, now).errors.join(), /останній день/);
  input.rows[0].endConfirmed = true;
  const report = imp.preview(state, input, now); assert.equal(report.canApply, true);
  imp.apply(state, input, report.expectedToken, now);
  assert.equal(state.presenceRecords[a.id + '|2026-10-25'].status, 'vacation');
  assert.throws(() => profiles.birthday('31.02.1985'));
  assert.throws(() => profiles.birthday('01.13'));
  assert.equal(profiles.birthday('29.02'), '--02-29');
  assert.throws(() => imp.parseDate('29.02.2026'));
});
test('profile conflicts, duplicate input and stale previews cannot mutate the database', () => {
  const { state, a } = fixture();
  profiles.update(state, a.id, { birthDate: '1985-03-12' }, now);
  const input = inputFor(state, 'ПІБ\tДата народження\nЮлия*О\t13.03.1985');
  const before = structuredClone(state);
  const report = imp.preview(state, input, now);
  assert.equal(report.canApply, false);
  assert.throws(() => imp.apply(state, input, report.expectedToken, now)); assert.deepEqual(state, before);
  input.rows[0].replaceProfile = true;
  const valid = imp.preview(state, input, now); assert.equal(valid.canApply, true);
  d.renameEmployee(state, a.id, 'Юлія О', now);
  assert.throws(() => imp.apply(state, input, valid.expectedToken, now), /змінилися/);
  imp.apply(state, input, imp.preview(state, input, now).expectedToken, now);
  assert.equal(imp.preview(state, input, now).canApply, false);
});
test('invalid rows block atomically; explicit skip imports only the reviewed part', () => {
  const { state, a } = fixture();
  const input = inputFor(state, 'ПІБ\tДата народження\nЮлия*О\t12.03.1985\nНевідомий працівник\t31.02.2000');
  const before = structuredClone(state), report = imp.preview(state, input, now);
  assert.equal(report.canApply, false);
  assert.throws(() => imp.apply(state, input, report.expectedToken, now)); assert.deepEqual(state, before);
  input.rows[1].skip = true;
  imp.apply(state, input, imp.preview(state, input, now).expectedToken, now);
  assert.equal(state.employees.find(person => person.id === a.id).profile.birthDate, '1985-03-12');
  assert.equal(state.documentImport.history[0].skipped, 1);
});
test('presence import previews affected duties and protects realized assignments', () => {
  const { state, a, b } = fixture();
  state.duties.initialized = true; state.duties.participantIds = [a.id, b.id];
  d.setDutyAssignment(state, { date: '2026-10-21', employeeIds: [a.id, b.id], singleApproved: false }, now);
  const input = inputFor(state, 'ПІБ\tСтатус\tЗ\nЮлия*О\tЛікарняний\t21.10.2026');
  const report = imp.preview(state, input, now); assert.equal(report.canApply, true); assert.equal(report.rows[0].duties.length, 1);
  assert.deepEqual(state.duties.assignments['2026-10-21'].employeeIds, [a.id, b.id]);
  const protectedState = structuredClone(state); protectedState.duties.assignments['2026-10-21'].realizedEmployeeIds = [a.id];
  const blocked = imp.preview(protectedState, input, now); assert.equal(blocked.canApply, false);
  const saved = structuredClone(protectedState);
  assert.throws(() => imp.apply(protectedState, input, blocked.expectedToken, now)); assert.deepEqual(protectedState, saved);
  imp.apply(state, input, report.expectedToken, now);
  assert.deepEqual(state.duties.assignments['2026-10-21'].employeeIds, [b.id]);
});
test('backup migration retains profile history and removal cleans employee rules', () => {
  const { state, a } = fixture();
  profiles.update(state, a.id, { fullName: 'Коваленко Юлія Олександрівна', aliases: 'Юлія О; Юлия*О', birthDate: '12.03' }, now);
  state.documentImport.rules.push({ id: 'x', source: 'A', kind: 'name', value: 'Коваленко', employeeId: a.id });
  const roundtrip = d.normalizeState(structuredClone(state), now);
  assert.equal(roundtrip.employees[0].profile.history.length, 1);
  const old = structuredClone(state); delete old.documentImport; old.schemaVersion = 18; delete old.employees[0].profile;
  const migrated = d.normalizeState(old, now); assert.equal(migrated.schemaVersion, 19); assert.equal(migrated.employees[0].profile.fullName, '');
  d.archiveEmployee(state, a.id, now);
  const report = deletion.preview(state, a.id);
  deletion.apply(state, { employeeId: a.id, expectedToken: report.token }, now);
  assert.equal(state.documentImport.rules.length, 0);
});
test('document-wide answers propagate only to equal source values', () => {
  const { state, a } = fixture();
  const input = inputFor(state, 'ПІБ\tПідрозділ\nЮлія\tВідділ А\nЮлія\tВідділ А');
  input.rows[0].employeeId = a.id; input.rows[0].resolutionScope = 'document';
  const report = imp.preview(state, input, now); assert.equal(report.canApply, true);
  imp.apply(state, input, report.expectedToken, now); assert.equal(state.documentImport.rules.length, 0);
  assert.deepEqual(state.employees[0].profile.aliases, []);
  assert.equal(imp.candidates(state, 'Юлія', 'Інше джерело').length, 0);
});

test('quoted CSV, plain-text presence and birthdays are parsed without losing source text', () => {
  const { state, a } = fixture();
  const csv = inputFor(state, 'ПІБ,Підрозділ,Дата народження\n"Юлия*О","Відділ; група А",12.03.1985');
  assert.equal(csv.rows[0].employeeId, a.id); assert.equal(csv.rows[0].department, 'Відділ; група А');
  const prose = inputFor(state, 'Юлия*О — відпустка з 21.10.2026 по 25.10.2026');
  assert.equal(prose.rows[0].status, 'vacation'); assert.equal(prose.rows[0].from, '21.10.2026');
  assert.equal(prose.rows[0].to, '25.10.2026');
  assert.match(imp.preview(state, prose, now).errors.join(), /останній день/);
  const born = inputFor(state, 'Коваленко Юлія Олександрівна — дата народження 12.03.1985');
  assert.equal(born.rows[0].birthDate, '12.03.1985');
});
