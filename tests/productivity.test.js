const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/shared/domain');
const p = require('../src/shared/productivity');
const work = require('../src/shared/work');
const presence = require('../src/shared/presence');
const changes = require('../src/shared/presence-changes');
const tasks = require('../src/shared/tasks');
const management = require('../src/shared/management');
const categories = require('../src/shared/activity-categories');
const activity = require('../src/shared/activity');
const now = new Date('2026-11-16T18:00:00Z');
function fixture() {
  const state = d.defaultState(now), person = d.createEmployee(state, 'Олена', new Date('2026-10-01T09:00:00Z'));
  return { state, person };
}
const report = state => p.report(state, { startDate: '2026-11-02', endDate: '2026-11-15' }, now);
function adjust(state, person, date, count) { return p.setObjects(state, { employeeId: person.id, date, count, expectedCount: p.objectIndex(state).get(person.id + '|' + date) || 0, reason: 'Перевірено звіт' }, now); }
test('calendar attendance is automatic and accepted objects never close or rewrite past days', () => {
  const { state, person } = fixture(), before = structuredClone(state.records);
  work.receiveObjects(state, { id: 'objects', employeeId: person.id, date: '2026-11-16', objectCount: 3 }, now);
  assert.deepEqual(state.records, before);
  const value = p.report(state, { startDate: '2026-11-16', endDate: '2026-11-20' }, now);
  assert.equal(value.total.workedDays, 1); assert.equal(value.total.objectsReceived, 3); assert.equal(value.total.kpi, 450);
  assert.equal(report(state).total.objectsReceived, 0);
});
test('KPI uses 1.5 days per object, full ZKP days and explicit exclusions with reasons', () => {
  const { state, person } = fixture();
  presence.write(state, { employeeId: person.id, date: '2026-11-02', status: 'zkp' }, now);
  presence.write(state, { employeeId: person.id, date: '2026-11-03', status: 'arkan' }, now);
  presence.write(state, { employeeId: person.id, date: '2026-11-04', status: 'special_assignment', note: 'Підготувала довідку керівнику' }, now);
  presence.write(state, { employeeId: person.id, date: '2026-11-05', status: 'vacation' }, now);
  presence.write(state, { employeeId: person.id, date: '2026-11-06', status: 'sick' }, now);
  adjust(state, person, '2026-11-09', 4);
  const value = report(state);
  assert.equal(value.total.calendarWorkdays, 10); assert.equal(value.total.workedDays, 6); assert.equal(value.total.kpi, 100);
  assert.equal(value.rows[0].zkpDays, 1); assert.equal(value.rows[0].reasons.special_assignment, 1);
  assert.match(value.facts.find(f => f.date === '2026-11-04').note, /довідку/);
});
test('special assignments need an explanation before any availability or duty mutation', () => {
  const { state, person } = fixture(), before = structuredClone(state);
  assert.throws(() => changes.save(state, { employeeIds: [person.id], startDate: '2026-11-16', status: 'special_assignment' }, now), /Поясніть/);
  assert.deepEqual(state, before);
});
test('day realization excludes a day across schedules, night duty including a weekend counts once', () => {
  const { state, person } = fixture();
  state.duties.assignments['2026-11-07'] = { date: '2026-11-07', employeeIds: [person.id], realizedEmployeeIds: [] };
  d.setDutyRealized(state, '2026-11-07', person.id, true, now, 'night');
  state.duties.assignments['2026-11-09'] = { date: '2026-11-09', employeeIds: [person.id], realizedEmployeeIds: [] };
  d.setDutyRealized(state, '2026-11-09', person.id, true, now, 'day');
  const value = report(state);
  assert.equal(value.total.calendarWorkdays, 11); assert.equal(value.total.workedDays, 10); assert.equal(value.total.reasons.day_duty, 1);
  assert.equal(d.normalizeState(structuredClone(state), now).duties.assignments['2026-11-09'].realizationModes[person.id], 'day');
});
test('backdated object corrections preserve evidence, reject stale edits and cannot produce negatives', () => {
  const { state, person } = fixture(); adjust(state, person, '2026-11-05', 5); adjust(state, person, '2026-11-05', 2);
  assert.equal(report(state).total.objectsReceived, 2); assert.equal(state.resultAdjustments.length, 2);
  const before = structuredClone(state);
  assert.throws(() => p.setObjects(state, { employeeId: person.id, date: '2026-11-05', count: 0, expectedCount: 5, reason: 'Старе вікно' }, now), /змінилася/);
  assert.deepEqual(state, before);
  assert.throws(() => d.normalizeState({ ...structuredClone(state), resultAdjustments: [{ ...state.resultAdjustments[0], delta: -99 }] }, now), /від’ємну/);
});
test('0.26 migration keeps original records and intakes without inventing object counts', () => {
  const { state, person } = fixture(); state.schemaVersion = 18; delete state.resultAdjustments; delete person.profile;
  state.records[person.id + '|2026-11-02'] = { employeeId: person.id, date: '2026-11-02', status: 'submitted', receiptId: 'old' };
  const oldRecords = structuredClone(state.records), migrated = d.normalizeState(structuredClone(state), now);
  assert.equal(migrated.schemaVersion, 20); assert.deepEqual(migrated.records, oldRecords); assert.deepEqual(migrated.resultAdjustments, []);
  assert.equal(report(migrated).total.objectsReceived, 0); assert.equal(report(migrated).legacyDayCount, 1);
  assert.equal(report(migrated).total.workedDays, 10);
  assert.equal(report(migrated).total.kpi, null); assert.equal(report(migrated).anomalies.some(r => r.kind === 'kpi'), false);
});
test('a reviewed zero can resolve incomplete legacy result history without inventing objects', () => {
  const { state, person } = fixture();
  state.records[person.id + '|2026-11-02'] = { employeeId: person.id, date: '2026-11-02', status: 'submitted', receiptId: 'old' };
  assert.equal(report(state).total.kpi, null);
  adjust(state, person, '2026-11-02', 0);
  assert.equal(report(state).legacyDayCount, 0); assert.equal(report(state).total.kpi, 0);
  assert.equal(d.normalizeState(structuredClone(state), now).resultAdjustments[0].delta, 0);
});
test('arbitrary and January duty periods reset counters while keeping rules, assignments and hard rest constraints', () => {
  const { state, person } = fixture(); state.duties.participantIds = [person.id]; state.duties.initialized = true;
  state.duties.baselines[person.id] = { total: 100, realized: 50 };
  state.duties.assignments['2026-11-08'] = { date: '2026-11-08', employeeIds: [person.id], realizedEmployeeIds: [] };
  state.duties.assignments['2026-11-10'] = { date: '2026-11-10', employeeIds: [person.id], realizedEmployeeIds: [] };
  const original = structuredClone(state.duties), rules = structuredClone(state.duties.rules);
  d.beginDutyPeriod(state, { scheduleId: state.activeDutyScheduleId, startDate: '2026-11-09' }, now);
  assert.equal(d.dutyTotals(state, '2026', '2026-11-16')[person.id].total, 1);
  assert.equal(d.dutyTotals(state, '2026', '2026-11-09')[person.id].total, 0);
  assert.deepEqual(state.duties.rules, rules); assert.deepEqual(state.duties.assignments, original.assignments);
  d.beginDutyPeriod(state, { scheduleId: state.activeDutyScheduleId, startDate: '2027-01-01' }, now);
  assert.equal(d.dutyTotals(state, '2027', '2027-01-01')[person.id].total, 0);
  assert.deepEqual(d.normalizeState(structuredClone(state), now).duties.periodStarts, ['2026-11-09', '2027-01-01']);
  const primaryId = state.activeDutyScheduleId, other = d.createDutySchedule(state, 'Термінові', now);
  d.beginDutyPeriod(state, { scheduleId: other.id, startDate: '2026-11-12' }, now);
  assert.deepEqual(state.dutySchedules.find(s => s.id === primaryId).data.periodStarts, ['2026-11-09', '2027-01-01']); assert.deepEqual(other.data.periodStarts, ['2026-11-12']);
});
test('KPI anomalies require enough workdays and sick episodes differ from sick duration', () => {
  const { state, person } = fixture();
  assert.equal(p.report(state, { startDate: '2026-11-02', endDate: '2026-11-03' }, now).anomalies.some(a => a.kind === 'kpi'), false);
  assert.equal(report(state).anomalies.some(a => a.kind === 'kpi'), true);
  for (const date of ['2026-10-05', '2026-10-06', '2026-10-19', '2026-11-02']) presence.write(state, { employeeId: person.id, date, status: 'sick' }, now);
  const value = report(state), risk = value.anomalies.find(a => a.kind === 'sick');
  assert.ok(risk); assert.equal(value.rows[0].sickEpisodes, 3); assert.equal(risk.dates.length, 4);
});
test('past week task status is reconstructed before later completion or deadline changes', () => {
  const { state, person } = fixture();
  const task = tasks.createTask(state, { title: 'Звіт', assigneeIds: [person.id], dueDate: '2026-11-06' }, new Date('2026-11-02T09:00:00Z'));
  tasks.setTaskStatus(state, task.id, { status: 'done' }, now);
  const value = management.weeklySummary(state, '2026-11-02', now);
  assert.equal(value.completedTasks.length, 0); assert.equal(value.overdueTasks.length, 1); assert.equal(value.scheduledTasks[0].status, 'open');
  const current = management.weeklySummary(state, '2026-11-16', now); assert.equal(current.completedTasks.length, 1);
});
test('NSFW and marketplace flags match exact domains/subdomains with independent manual overrides', () => {
  assert.equal(categories.categoryFor([], null, 'www.pornhub.com').flags.nsfw, true);
  assert.equal(categories.categoryFor([], null, 'pornhub.com.evil.example').flags.nsfw, false);
  assert.equal(categories.categoryFor([], null, 'notpornhub.com').flags.nsfw, false);
  const { state, person } = fixture();
  activity.setCategory(state, { domain: 'rozetka.com.ua', employeeId: person.id, category: 'work', flags: { marketplace: false, nsfw: true } }, now);
  let value = categories.categoryFor(state.activity.domainRules, person.id, 'rozetka.com.ua');
  assert.equal(value.category, 'work'); assert.equal(value.flags.marketplace, false); assert.equal(value.flags.nsfw, true);
  activity.setCategory(state, { domain: 'rozetka.com.ua', employeeId: person.id, category: 'personal' }, now);
  value = categories.categoryFor(state.activity.domainRules, person.id, 'rozetka.com.ua'); assert.equal(value.flags.nsfw, true);
  const next = d.normalizeState(structuredClone(state), now); assert.equal(next.activity.domainRules[0].flags.marketplace, false);
});
test('new duty periods preserve hard rest constraints and archive opening balances across calendar years', () => {
  const { state, person } = fixture(); state.duties.initialized = true; state.duties.participantIds = [person.id];
  state.duties.baselineThroughDate = '2026-10-31'; state.duties.baselines[person.id] = { total: 12, realized: 4 };
  state.duties.assignments['2026-11-08'] = { date: '2026-11-08', employeeIds: [person.id], realizedEmployeeIds: [], source: 'manual' };
  d.beginDutyPeriod(state, { scheduleId: state.activeDutyScheduleId, startDate: '2026-11-09' }, now);
  d.generateDutySchedule(state, { startDate: '2026-11-09', endDate: '2026-11-09' }, now);
  assert.equal(state.duties.assignments['2026-11-09']?.employeeIds?.includes(person.id) || false, false);
  d.initializeDutyHistory(state, [{ employeeId: person.id, total: 0, realized: 0 }], [person.id], new Date('2027-01-01T09:00:00Z'));
  assert.equal(state.duties.baselineArchives['2026'].baselines[person.id].total, 12);
  assert.equal(d.dutyTotals(state, '2026', '2026-11-09')[person.id].total, 0);
  assert.equal(d.dutyTotals(state, '2026', '2026-11-08')[person.id].total, 12);
  assert.doesNotThrow(() => d.normalizeState(structuredClone(state), now));
});
test('document import requires the actual explanation of a special assignment', () => {
  const { state, person } = fixture(), imp = require('../src/shared/document-import');
  const input = { source: 'Наказ', rows: imp.parseBlocks(state, [{ name: 'Робота', text: 'ПІБ\tСтатус\tЗ\nОлена\tОкреме завдання\t16.11.2026' }], 'Наказ') };
  assert.equal(input.rows[0].employeeId, person.id); assert.equal(input.rows[0].status, 'special_assignment');
  assert.equal(imp.preview(state, input, now).canApply, false);
  input.rows[0].assignmentNote = 'Підготовка матеріалів до робочої зустрічі';
  const preview = imp.preview(state, input, now); assert.equal(preview.canApply, true);
  imp.apply(state, input, preview.expectedToken, now);
  assert.match(state.presenceRecords[person.id + '|2026-11-16'].note, /Підготовка матеріалів/);
});
