const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../src/shared/domain');
const journal = require('../src/shared/journal');
const now = new Date(2026, 9, 2, 9);
function fixture() {
  const state = domain.defaultState(new Date(2026, 8, 1, 9));
  const people = ['Іваненко', 'Петренко', 'Сидоренко'].map((name) => domain.createEmployee(state, name, new Date(2026, 8, 1, 9)));
  return { state, people };
}
function statusInput(people, overrides = {}) {
  return { employeeIds: people.map(({ id }) => id), startDate: '2026-09-28', endDate: '2026-10-04',
    action: 'status', status: 'vacation', note: 'Наказ 42', ...overrides };
}
function protectedRecord(state, employeeId, date) {
  state.records[domain.recordKey(employeeId, date)] = { employeeId, date, status: 'submitted', source: 'receipt', receiptId: 'document-1' };
}

test('multi-worker period respects weekdays, omits weekends and commits one audit entry', () => {
  const { state, people } = fixture(); const input = statusInput(people, { weekdays: [1, 3, 5] });
  const before = domain.clone(state); const preview = domain.previewJournalBatch(state, input, now);
  assert.deepEqual(state, before, 'preview must be read only');
  assert.equal(preview.count, 9); assert.equal(preview.canApply, true);
  const auditCount = state.audit.length;
  const applied = domain.applyJournalBatch(state, { ...input, expectedToken: preview.token }, now);
  assert.equal(applied.count, 9); assert.equal(state.audit.length, auditCount + 1);
  assert.equal(state.audit.at(-1).action, 'journal_batch_applied');
  assert.equal(state.records[domain.recordKey(people[0].id, '2026-09-30')].note, 'Наказ 42');
  assert.equal(state.records[domain.recordKey(people[0].id, '2026-09-29')], undefined);
  assert.equal(state.records[domain.recordKey(people[0].id, '2026-10-03')], undefined);
});

test('weekends are skipped unless explicitly included; inclusion records individual workdays', () => {
  const { state, people } = fixture(); const input = statusInput(people);
  const preview = domain.previewJournalBatch(state, input, now);
  assert.equal(preview.count, 15); assert.equal(preview.skipped.length, 6);
  domain.applyJournalBatch(state, { ...input, includeWeekends: true }, now);
  assert.equal(Object.keys(state.records).length, 21); assert.equal(Object.keys(state.workdayOverrides).length, 6);
  assert.equal(journal.cell(state, people[0], '2026-10-03').status, 'vacation');
});

test('a receipt conflict stops the whole batch; explicit skip changes only safe cells', () => {
  const { state, people } = fixture(); const date = '2026-10-02';
  protectedRecord(state, people[0].id, date);
  const input = statusInput(people, { startDate: date, endDate: date });
  const before = domain.clone(state); const preview = domain.previewJournalBatch(state, input, now);
  assert.equal(preview.canApply, false); assert.equal(preview.blocked.length, 1);
  assert.throws(() => domain.applyJournalBatch(state, input, now), /Нічого не змінено/);
  assert.deepEqual(state, before);
  const applied = domain.applyJournalBatch(state, { ...input, skipBlocked: true }, now);
  assert.equal(applied.count, 2); assert.equal(state.records[domain.recordKey(people[0].id, date)].receiptId, 'document-1');
});

test('absence conflicts are checked across inactive duty schedules; skipped weekends leave no override', () => {
  const { state, people } = fixture(); const date = '2026-10-03';
  domain.initializeDutyHistory(state, people.map(({ id }) => ({ employeeId: id, total: 0, realized: 0 })), null, now);
  const oldId = state.activeDutyScheduleId;
  domain.setDutyAssignment(state, { date, employeeIds: [people[0].id], singleApproved: true }, now);
  domain.createDutySchedule(state, 'Інший графік', now);
  assert.notEqual(state.activeDutyScheduleId, oldId);
  const input = statusInput(people, { startDate: date, endDate: date, includeWeekends: true, skipBlocked: true });
  const preview = domain.previewJournalBatch(state, input, now);
  assert.equal(preview.blocked.length, 1); assert.match(preview.blocked[0].reason, /черговим/);
  domain.applyJournalBatch(state, input, now);
  assert.equal(state.records[domain.recordKey(people[0].id, date)], undefined);
  assert.equal(state.workdayOverrides[domain.recordKey(people[0].id, date)], undefined);
  assert.ok(state.workdayOverrides[domain.recordKey(people[1].id, date)]);
});

test('future submission blocks all changes atomically, and skipped future cells do not become workdays', () => {
  const { state, people } = fixture();
  const input = statusInput(people, { status: 'submitted', startDate: '2026-10-02', endDate: '2026-10-03', includeWeekends: true });
  const before = domain.clone(state);
  assert.throws(() => domain.applyJournalBatch(state, input, now), /майбутній/);
  assert.deepEqual(state, before);
  const result = domain.applyJournalBatch(state, { ...input, skipBlocked: true }, now);
  assert.equal(result.count, 3); assert.equal(result.blocked.length, 3);
  assert.deepEqual(state.workdayOverrides, {});
});

test('manual clear leaves documents and automatic misses intact', () => {
  const { state, people } = fixture(); const date = '2026-10-01';
  domain.setManualStatus(state, { employeeId: people[0].id, date, status: 'sick' }, now);
  protectedRecord(state, people[1].id, date);
  state.records[domain.recordKey(people[2].id, date)] = { employeeId: people[2].id, date, status: 'missed', source: 'automatic_close' };
  const input = statusInput(people, { action: 'clear', startDate: date, endDate: date, skipBlocked: true });
  const result = domain.applyJournalBatch(state, input, now);
  assert.equal(result.count, 1); assert.equal(result.blocked.length, 1); assert.equal(result.skipped.length, 1);
  assert.equal(state.records[domain.recordKey(people[0].id, date)], undefined);
  assert.equal(state.records[domain.recordKey(people[1].id, date)].receiptId, 'document-1');
  assert.equal(state.records[domain.recordKey(people[2].id, date)].source, 'automatic_close');
});

test('returning weekends removes their override and manual status, but never receipt allocations', () => {
  const { state, people } = fixture(); const date = '2026-10-03';
  for (const person of people) domain.setWorkdayOverride(state, person.id, date, '', now);
  domain.setManualStatus(state, { employeeId: people[0].id, date, status: 'sick' }, now);
  protectedRecord(state, people[1].id, date);
  const input = statusInput(people, { action: 'restore_weekend', startDate: date, endDate: date, skipBlocked: true });
  const result = domain.applyJournalBatch(state, input, now);
  assert.equal(result.count, 2); assert.equal(result.blocked.length, 1);
  assert.equal(state.workdayOverrides[domain.recordKey(people[0].id, date)], undefined);
  assert.equal(state.records[domain.recordKey(people[0].id, date)], undefined);
  assert.ok(state.workdayOverrides[domain.recordKey(people[1].id, date)]);
  assert.equal(state.records[domain.recordKey(people[1].id, date)].receiptId, 'document-1');
});

test('existing status option preserves manual entries and cell input is deduplicated', () => {
  const { state, people } = fixture(); const date = '2026-10-02';
  domain.setManualStatus(state, { employeeId: people[0].id, date, status: 'other_tasks' }, now);
  const cell = { employeeId: people[1].id, date };
  const result = domain.applyJournalBatch(state, { action: 'status', status: 'sick', replaceExisting: false,
    cells: [{ employeeId: people[0].id, date }, cell, cell] }, now);
  assert.equal(result.count, 1); assert.equal(result.skipped.length, 1);
  assert.equal(state.records[domain.recordKey(people[0].id, date)].status, 'other_tasks');
});

test('preview token rejects changes to records, duties, workdays and employee activity', () => {
  for (const change of ['record', 'duty', 'workdays', 'employee']) {
    const { state, people } = fixture(); const input = statusInput(people, { startDate: '2026-10-02', endDate: '2026-10-02' });
    const preview = domain.previewJournalBatch(state, input, now);
    if (change === 'record') domain.setManualStatus(state, { employeeId: people[0].id, date: input.startDate, status: 'other_tasks' }, now);
    if (change === 'duty') {
      domain.initializeDutyHistory(state, people.map(({ id }) => ({ employeeId: id, total: 0, realized: 0 })), null, now);
      domain.setDutyAssignment(state, { date: input.startDate, employeeIds: [people[0].id], singleApproved: true }, now);
    }
    if (change === 'workdays') state.settings.workdays = [1, 2, 3];
    if (change === 'employee') domain.archiveEmployee(state, people[0].id, now);
    const before = domain.clone(state);
    assert.throws(() => domain.applyJournalBatch(state, { ...input, expectedToken: preview.token }, now), /Дані змінилися/);
    assert.deepEqual(state, before);
  }
});

test('invalid dates, reversed periods and empty selections are rejected without mutation', () => {
  const { state, people } = fixture(); const before = domain.clone(state);
  for (const input of [statusInput(people, { startDate: '2026-02-30' }), statusInput(people, { startDate: '2026-10-05' }),
    statusInput(people, { startDate: '2025-01-01', endDate: '2026-10-04' }), statusInput(people, { weekdays: [] }),
    { cells: [{ employeeId: people[0].id, date: '2026-02-30' }], action: 'clear' }, { cells: [], action: 'clear' }]) {
    assert.throws(() => domain.applyJournalBatch(state, input, now));
  }
  assert.deepEqual(state, before);
});

test('report counts only current and past pending, preserves history and can include archived workers', () => {
  const { state, people } = fixture();
  domain.setManualStatus(state, { employeeId: people[0].id, date: '2026-09-28', status: 'submitted' }, now);
  domain.setManualStatus(state, { employeeId: people[0].id, date: '2026-09-29', status: 'other_tasks' }, now);
  domain.setManualStatus(state, { employeeId: people[0].id, date: '2026-09-30', status: 'vacation' }, now);
  domain.setManualStatus(state, { employeeId: people[0].id, date: '2026-10-01', status: 'missed' }, now);
  domain.archiveEmployee(state, people[2].id, new Date(2026, 8, 30, 9));
  const report = domain.calculateJournalReport(state, { startDate: '2026-09-28', endDate: '2026-10-09' }, now);
  assert.equal(report.rows.length, 2);
  assert.deepEqual(report.rows[0].totals, { submitted: 1, missed: 1, other: 1, absent: 1, pending: 1, worked: 2 });
  const archived = domain.calculateJournalReport(state, { startDate: '2026-09-28', endDate: '2026-10-09', employeeIds: [people[2].id] }, now);
  assert.equal(archived.rows.length, 1); assert.equal(archived.rows[0].totals.pending, 2);
  assert.equal(archived.rows[0].cells.find((cell) => cell.date === '2026-10-02').status, 'outside');
  assert.throws(() => domain.calculateJournalReport(state, { startDate: '2026-09-28', endDate: '2026-10-09', employeeIds: ['missing'] }, now));
});

test('historical records before employment and individual working weekends remain visible', () => {
  const { state, people } = fixture(); const person = people[0];
  domain.setManualStatus(state, { employeeId: person.id, date: '2026-08-31', status: 'submitted' }, now);
  domain.setWorkdayOverride(state, person.id, '2026-10-03', '', now);
  const report = domain.calculateJournalReport(state, { startDate: '2026-08-30', endDate: '2026-10-04', employeeIds: [person.id] }, now);
  assert.equal(report.rows[0].cells[0].status, 'outside'); assert.equal(report.rows[0].cells[1].status, 'submitted');
  assert.equal(report.rows[0].cells.find((cell) => cell.date === '2026-10-03').symbol, 'РД');
});

test('rectangle selection covers reversed row and date bounds and ignores stale anchors', () => {
  const dates = journal.datesBetween('2026-10-01', '2026-10-03');
  const selected = journal.rectangle(['a', 'b', 'c'], dates, { employeeId: 'c', date: dates[2] }, { employeeId: 'a', date: dates[0] });
  assert.equal(selected.length, 9);
  const target = { employeeId: 'a', date: dates[0] };
  assert.deepEqual(journal.rectangle(['a'], dates, { employeeId: 'x', date: dates[2] }, target), [target]);
  assert.equal(journal.datesBetween('2024-01-01', '2024-12-31').length, 366);
  assert.throws(() => journal.datesBetween('2024-01-01', '2025-01-01'));
});

test('return weekend respects a changed global calendar without deleting the day status', () => {
  const { state, people } = fixture(); const date = '2026-10-03'; const person = people[0];
  domain.setWorkdayOverride(state, person.id, date, '', now);
  domain.setManualStatus(state, { employeeId: person.id, date, status: 'sick' }, now);
  state.settings.workdays.push(6);
  const before = domain.clone(state);
  const input = { cells: [{ employeeId: person.id, date }], action: 'restore_weekend' };
  const preview = domain.previewJournalBatch(state, input, now);
  assert.equal(preview.canApply, false); assert.equal(preview.skipped.length, 1);
  assert.match(preview.skipped[0].reason, /загальним робочим днем/);
  assert.throws(() => domain.applyJournalBatch(state, input, now)); assert.deepEqual(state, before);
});

test('manual clear preview explains the automatic miss that will reappear after closing', () => {
  const { state, people } = fixture(); const date = '2026-10-01'; const person = people[0];
  domain.setManualStatus(state, { employeeId: person.id, date, status: 'sick' }, now);
  const input = { cells: [{ employeeId: person.id, date }], action: 'clear' };
  assert.equal(domain.previewJournalBatch(state, input, now).changes[0].to, 'missed');
  domain.applyJournalBatch(state, input, now); domain.ensureAutomaticMisses(state, now);
  assert.equal(state.records[domain.recordKey(person.id, date)].status, 'missed');
  domain.setManualStatus(state, { employeeId: person.id, date, status: 'sick' }, now);
  state.settings.automaticClose = false;
  assert.equal(domain.previewJournalBatch(state, input, now).changes[0].to, 'pending');
});

test('clear preview expires when automatic closing settings or the closing time changes', () => {
  for (const clockChange of [false, true]) {
    const { state, people } = fixture(); const date = '2026-10-02'; const person = people[0];
    domain.setManualStatus(state, { employeeId: person.id, date, status: 'sick' }, now);
    const input = { cells: [{ employeeId: person.id, date }], action: 'clear' };
    const preview = domain.previewJournalBatch(state, input, now);
    if (!clockChange) state.settings.automaticClose = false;
    const before = domain.clone(state);
    assert.throws(() => domain.applyJournalBatch(state, { ...input, expectedToken: preview.token },
      clockChange ? new Date(2026, 9, 2, 19) : now), /Дані змінилися/);
    assert.deepEqual(state, before);
  }
});
