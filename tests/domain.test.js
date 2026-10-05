const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  addDays,
  allocateReceiptBackward,
  allocateReceiptForward,
  calculateDutyFairness,
  calculateDutyStatistics,
  calculateStatistics,
  calculateAnalyticsTrend,
  clearDutyWeek,
  clearDutyRestriction,
  clone,
  correctReceipt,
  createDutySchedule,
  createEmployee,
  createTimeOffEntry,
  defaultState,
  deleteDutySchedule,
  deleteTimeOffEntry,
  duplicateDutySchedule,
  ensureAutomaticMisses,
  generateDutySchedule,
  getDutyExplanation,
  initializeDutyHistory,
  normalizeState,
  moveEmployee,
  previewReceiptCorrection,
  previewManualStatuses,
  previewSubmission,
  previewDutySchedule,
  archiveEmployee,
  recordKey,
  recordSubmission,
  renameEmployee,
  removeDutyAssignment,
  renameDutySchedule,
  restoreEmployee,
  setDutyAssignment,
  setDutyDayException,
  setDutyRealized,
  setDutyRestriction,
  setDutyWeekLocked,
  setManualStatus,
  setManualStatuses,
  setWorkdayOverride,
  switchDutySchedule,
  toggleDutyAssignment,
  updateDutyScheduleRules,
  updateSettings,
  updateTimeOffEntry,
} = require('../src/shared/domain');

function localDate(year, monthIndex, day, hour = 9, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

function flexibleDutyState(size = 4) {
  const now = localDate(2026, 7, 1);
  const state = defaultState(now);
  const people = Array.from({ length: size }, (_, i) => createEmployee(state, `Гнучкий ${i + 1}`, now));
  initializeDutyHistory(state, people.map(({ id }) => ({ employeeId: id, total: 0, realized: 0 })), null, now);
  return { state, people, now };
}

test('розширені правила зберігаються без прихованого скидання і незалежно для кожного графіка', () => {
  const { state, now } = flexibleDutyState();
  const primaryId = state.activeDutyScheduleId;
  const rules = updateDutyScheduleRules(state, primaryId, {
    weekdayDutyCount: 15, weekendDutyCount: 0, requiredByWeekday: { 1: 0, 2: 3, 3: '', 4: null },
    minimumRestDays: 30, minimumRestMode: 'require', maximumDutiesPerWeek: 7,
    weekendRestWeeks: 8, compensationFrom: 0, compensationTarget: 7,
    pairHistoryPeriod: 'rolling', pairHistoryDays: 366, shortageBehavior: 'require_full_day',
    preventConsecutiveDays: false, preventConsecutiveWeekends: false,
    compensateNextWeek: false, avoidRepeatedPairs: false, planningPriority: 'rotation',
  }, now);
  assert.equal(rules.weekdayDutyCount, 15);
  assert.equal(rules.weekendDutyCount, 0);
  assert.deepEqual(rules.requiredByWeekday, { 1: 0, 2: 3 });
  const restored = normalizeState(clone(state), now);
  assert.deepEqual(restored.duties.rules, rules);
  const copy = duplicateDutySchedule(restored, primaryId, 'Гнучка копія', now);
  assert.deepEqual(copy.data.rules, rules);
  updateDutyScheduleRules(restored, copy.id, { ...rules, minimumRestDays: 0 }, now);
  assert.equal(restored.dutySchedules.find(({ id }) => id === primaryId).data.rules.minimumRestDays, 30);
});

test('нуль вимикає день, а порожнє перевизначення успадковує правило; довгий діапазон працює', () => {
  const { state, people, now } = flexibleDutyState(2);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 1, weekendDutyCount: 0, requiredByWeekday: { 1: 0, 2: '' },
    preventConsecutiveDays: false, preventConsecutiveWeekends: false, minimumRestDays: 0,
  }, now);
  const preview = previewDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-09-06' }, now);
  assert.equal(preview.shortages.length, 0);
  assert.deepEqual(preview.assignments.slice(0, 7).map(({ requiredCount }) => requiredCount), [0, 1, 1, 1, 1, 0, 0]);
  assert.ok(preview.assignments.every((day) => day.employeeIds.length === day.requiredCount));
  assert.throws(() => setDutyAssignment(state, { date: '2026-08-24', employeeIds: [people[0].id] }, now), /правилами/);
  assert.throws(() => previewDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-30',
    pinnedAssignments: [{ date: '2026-08-24', employeeIds: [people[0].id] }] }, now), /готовий/);
});

test('три чергових працюють у ручному складі, закріпленні, генерації та статистиці всіх пар', () => {
  const { state, people, now } = flexibleDutyState(4);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 3, weekendDutyCount: 3, preventConsecutiveDays: false,
    preventConsecutiveWeekends: false, minimumRestDays: 0,
  }, now);
  const ids = people.slice(0, 3).map(({ id }) => id);
  setDutyAssignment(state, { date: '2026-08-24', employeeIds: ids }, now);
  const preview = previewDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-26',
    pinnedAssignments: [{ date: '2026-08-25', employeeIds: ids }] }, now);
  assert.equal(preview.shortages.length, 0);
  assert.ok(preview.assignments.every(({ employeeIds }) => employeeIds.length === 3));
  assert.deepEqual(preview.assignments[1].employeeIds, ids);
  assert.equal(calculateDutyFairness(state, { startDate: '2026-08-24', endDate: '2026-08-24' }).pairs.length, 3);
  toggleDutyAssignment(state, people[0].id, '2026-08-27', now);
  toggleDutyAssignment(state, people[1].id, '2026-08-27', now);
  toggleDutyAssignment(state, people[2].id, '2026-08-27', now);
  assert.equal(state.duties.assignments['2026-08-27'].employeeIds.length, 3);
});

test('15 чергових можна сформувати одним складом без старого ліміту двох людей', () => {
  const { state, now } = flexibleDutyState(15);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 15, weekendDutyCount: 0, preventConsecutiveDays: false,
    preventConsecutiveWeekends: false, minimumRestDays: 0,
  }, now);
  const preview = previewDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24' }, now);
  assert.equal(preview.assignments[0].employeeIds.length, 15);
  assert.equal(preview.shortages.length, 0);
  assert.equal(preview.fairness.pairs.length, 105);
});

test('вимкнені заборони і нуль відпочинку справді дозволяють щоденні чергування', () => {
  const { state, people, now } = flexibleDutyState(1);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 1, weekendDutyCount: 1, preventConsecutiveDays: false,
    preventConsecutiveWeekends: false, minimumRestDays: 0, maximumDutiesPerWeek: 0,
  }, now);
  const preview = previewDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-09-06' }, now);
  assert.equal(preview.shortages.length, 0);
  assert.ok(preview.assignments.every(({ employeeIds }) => employeeIds[0] === people[0].id));
});

test('30 днів обов’язкового відпочинку враховують історію за межами тижня', () => {
  const { state, people, now } = flexibleDutyState(1);
  setDutyAssignment(state, { date: '2026-08-01', employeeIds: [people[0].id], singleApproved: true }, now);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 1, weekendDutyCount: 1, preventConsecutiveDays: false,
    minimumRestDays: 30, minimumRestMode: 'require', preventConsecutiveWeekends: false,
  }, now);
  const filter = { startDate: '2026-08-24', endDate: '2026-08-24' };
  assert.equal(previewDutySchedule(state, filter, now).shortages.length, 1);
  assert.throws(() => previewDutySchedule(state, { ...filter,
    pinnedAssignments: [{ date: filter.startDate, employeeIds: [people[0].id] }] }, now), /відпочинку/);
  assert.equal(previewDutySchedule(state, { startDate: '2026-09-01', endDate: '2026-09-01' }, now).shortages.length, 0);
});

test('перерва між уікендами налаштовується і враховує майбутнє ручне чергування', () => {
  const { state, people, now } = flexibleDutyState(1);
  setDutyAssignment(state, { date: '2026-08-15', employeeIds: [people[0].id], singleApproved: true }, now);
  const rules = { weekdayDutyCount: 0, weekendDutyCount: 1, minimumRestDays: 0,
    preventConsecutiveDays: false, preventConsecutiveWeekends: true, weekendRestWeeks: 2 };
  updateDutyScheduleRules(state, state.activeDutyScheduleId, rules, now);
  const filter = { startDate: '2026-08-29', endDate: '2026-08-29' };
  assert.equal(previewDutySchedule(state, filter, now).shortages.length, 1);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, { ...rules, weekendRestWeeks: 1 }, now);
  assert.equal(previewDutySchedule(state, filter, now).shortages.length, 0);
  setDutyAssignment(state, { date: '2026-09-12', employeeIds: [people[0].id] }, now);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, rules, now);
  assert.equal(previewDutySchedule(state, filter, now).shortages.length, 1);
  setDutyDayException(state, '2026-08-29', { allowConsecutiveWeekend: true }, now);
  assert.equal(previewDutySchedule(state, filter, now).shortages.length, 1, 'майбутній день має власний виняток');
  setDutyDayException(state, '2026-09-12', { allowConsecutiveWeekend: true }, now);
  assert.equal(previewDutySchedule(state, filter, now).shortages.length, 0);
});

test('компенсація підтримує нуль минулого тижня і ціль три чергування', () => {
  const { state, people, now } = flexibleDutyState(4);
  setDutyAssignment(state, { date: '2026-08-17', employeeIds: [people[1].id, people[2].id] }, now);
  setDutyAssignment(state, { date: '2026-08-18', employeeIds: [people[3].id], singleApproved: true }, now);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 3, weekendDutyCount: 0, minimumRestDays: 0,
    preventConsecutiveDays: false, preventConsecutiveWeekends: false,
    compensateNextWeek: true, compensationFrom: 0, compensationTarget: 3,
  }, now);
  const preview = previewDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-26' }, now);
  assert.equal(preview.assignments.filter(({ employeeIds }) => employeeIds.includes(people[0].id)).length, 3);
  assert.ok(preview.assignments[0].explanation.selected.find(({ employeeId }) => employeeId === people[0].id)
    .reasons.some((reason) => reason.includes('було 0') && reason.includes('до 3')));
});

test('режим повного складу не додає частину людей, але зберігає ручні закріплення', () => {
  const { state, people, now } = flexibleDutyState(2);
  const rules = { weekdayDutyCount: 3, weekendDutyCount: 3, minimumRestDays: 0,
    preventConsecutiveDays: false, preventConsecutiveWeekends: false };
  const filter = { startDate: '2026-08-24', endDate: '2026-08-24' };
  updateDutyScheduleRules(state, state.activeDutyScheduleId, rules, now);
  assert.equal(previewDutySchedule(state, filter, now).assignments[0].employeeIds.length, 2);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, { ...rules, shortageBehavior: 'require_full_day' }, now);
  assert.equal(previewDutySchedule(state, filter, now).assignments[0].employeeIds.length, 0);
  toggleDutyAssignment(state, people[0].id, filter.startDate, now);
  const preview = previewDutySchedule(state, filter, now);
  assert.deepEqual(preview.assignments[0].employeeIds, [people[0].id]);
  assert.equal(preview.shortages[0].missing, 2);
});

test('кожне автоматичне призначення має збережені факти й перевірку замін за повним періодом', () => {
  const { state, people, now } = flexibleDutyState(4);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 2, weekendDutyCount: 0, minimumRestDays: 0,
    preventConsecutiveDays: false, preventConsecutiveWeekends: false,
  }, now);
  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-26' }, now);
  for (const assignment of Object.values(state.duties.assignments)) {
    const explanation = getDutyExplanation(state, assignment.date, now);
    assert.equal(explanation.version, 2);
    assert.equal(explanation.createdAt, now.toISOString());
    assert.equal(explanation.reconstructed, false);
    assert.deepEqual(explanation.selected.map(({ employeeId }) => employeeId), assignment.employeeIds);
    assert.equal(explanation.decision.score.length, explanation.decision.labels.length);
    for (const item of explanation.selected) {
      const actual = Object.values(state.duties.assignments).filter(({ employeeIds }) => employeeIds.includes(item.employeeId)).length;
      assert.equal(item.evidence.weekTotal, actual);
      assert.equal(item.alternatives.length, people.length - assignment.employeeIds.length);
      assert.ok(item.alternatives.every(({ outcome }) => outcome !== 'better'));
      assert.ok(item.alternatives.some(({ outcome }) => ['worse', 'equal', 'blocked'].includes(outcome)));
    }
  }
});

test('пояснення лишається доказом моменту призначення після зміни правил, імені й відновлення бази', () => {
  const { state, people, now } = flexibleDutyState(2);
  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24' }, now);
  const saved = getDutyExplanation(state, '2026-08-24', now);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, { weekdayDutyCount: 0, minimumRestDays: 30 }, now);
  renameEmployee(state, people[0].id, 'Нове ім’я', now);
  const restored = normalizeState(clone(state), now);
  assert.deepEqual(getDutyExplanation(restored, '2026-08-24', now), saved);
});

test('ручне призначення має власну причину і не видається за вибір генератора', () => {
  const { state, people, now } = flexibleDutyState(3);
  setDutyAssignment(state, { date: '2026-08-24', employeeIds: [people[0].id, people[1].id], note: 'Підміна на прохання працівника' }, now);
  let explanation = getDutyExplanation(state, '2026-08-24', now);
  assert.equal(explanation.provenance, 'manual');
  assert.equal(explanation.decision, null);
  assert.equal(explanation.note, 'Підміна на прохання працівника');
  assert.ok(explanation.selected.every(({ reasons }) => reasons.some((reason) => reason.includes('Підміна'))));
  assert.ok(explanation.selected.flatMap(({ alternatives }) => alternatives).every(({ outcome }) => outcome === 'manual'));
  removeDutyAssignment(state, people[1].id, '2026-08-24', now);
  explanation = getDutyExplanation(state, '2026-08-24', now);
  assert.deepEqual(explanation.selected.map(({ employeeId }) => employeeId), [people[0].id]);
  assert.equal(explanation.reconstructed, false);
});

test('старі або застарілі пояснення чесно відновлюються без вигаданого первісного рішення', () => {
  const { state, people, now } = flexibleDutyState(2);
  setDutyAssignment(state, { date: '2026-08-24', employeeIds: people.map(({ id }) => id) }, now);
  state.duties.assignments['2026-08-24'].explanation = { selected: [], rules: { minimumRestDays: 99 } };
  const before = clone(state);
  const explanation = getDutyExplanation(state, '2026-08-24', now);
  assert.equal(explanation.reconstructed, true);
  assert.equal(explanation.decision, null);
  assert.equal(explanation.rules.minimumRestDays, 2);
  assert.ok(explanation.selected.every(({ reasons }) => reasons[0].includes('не збережено')));
  assert.deepEqual(state, before);
});

test('закріплення відрізняється від автоматичного добору, а причина винятку збережена', () => {
  const { state, people, now } = flexibleDutyState(3);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, { minimumRestDays: 0, preventConsecutiveDays: false }, now);
  setDutyDayException(state, '2026-08-24', { allowWeeklyLimit: true, note: 'Термінова підміна' }, now);
  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24',
    pinnedAssignments: [{ date: '2026-08-24', employeeIds: [people[0].id] }] }, now);
  const explanation = getDutyExplanation(state, '2026-08-24', now);
  assert.equal(explanation.exception.note, 'Термінова підміна');
  assert.ok(explanation.selected.find(({ employeeId }) => employeeId === people[0].id).reasons[0].includes('вручну'));
  assert.ok(explanation.selected.find(({ employeeId }) => employeeId !== people[0].id).reasons[0].includes('автоматично'));
});

test('рухома й повна історія пар мають різні перевірні межі', () => {
  const { state, people, now } = flexibleDutyState(2);
  setDutyAssignment(state, { date: '2026-08-01', employeeIds: people.map(({ id }) => id) }, now);
  const rules = { pairHistoryPeriod: 'rolling', pairHistoryDays: 5, minimumRestDays: 0 };
  updateDutyScheduleRules(state, state.activeDutyScheduleId, rules, now);
  const filter = { startDate: '2026-08-24', endDate: '2026-08-24' };
  let preview = previewDutySchedule(state, filter, now);
  assert.equal(preview.assignments[0].explanation.selected[0].evidence.partners[0].repeats, 0);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, { ...rules, pairHistoryPeriod: 'all' }, now);
  preview = previewDutySchedule(state, filter, now);
  assert.equal(preview.assignments[0].explanation.selected[0].evidence.partners[0].repeats, 1);
  assert.deepEqual(preview.assignments[0].explanation.selected[0].evidence.partners[0].dates, ['2026-08-01']);
});

test('о 18:00 незаповнений робочий день автоматично стає пропуском', () => {
  const beforeClose = localDate(2026, 7, 17, 17, 59);
  const state = defaultState(beforeClose);
  const employee = createEmployee(state, 'Іваненко О. В.', beforeClose);

  assert.equal(ensureAutomaticMisses(state, beforeClose), 0);
  assert.equal(state.records[recordKey(employee.id, '2026-08-17')], undefined);

  const atClose = localDate(2026, 7, 17, 18, 0);
  assert.equal(ensureAutomaticMisses(state, atClose), 1);
  assert.equal(state.records[recordKey(employee.id, '2026-08-17')].status, STATUS.MISSED);
});

test('дата з правильним форматом, але неіснуючим днем відхиляється', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employee = createEmployee(state, 'Працівник', now);
  assert.throws(() => setManualStatus(state, {
    employeeId: employee.id, date: '2026-02-30', status: STATUS.MISSED,
  }, now), /календарна дата/);
});

test('додаткові одиниці закривають найближчі попередні пропуски, а не найстаріші', () => {
  const createdAt = localDate(2026, 7, 10, 9, 0);
  const state = defaultState(createdAt);
  const employee = createEmployee(state, 'Петренко І. М.', createdAt);
  const now = localDate(2026, 7, 20, 12, 0);
  ensureAutomaticMisses(state, now);
  setManualStatus(state, {
    employeeId: employee.id,
    date: '2026-08-18',
    status: STATUS.OTHER_TASKS,
  }, now);

  const receipt = recordSubmission(state, {
    employeeId: employee.id,
    requestCount: 3,
  }, now);

  assert.deepEqual(receipt.allocations.map((item) => item.date), [
    '2026-08-20',
    '2026-08-19',
    '2026-08-17',
  ]);
  assert.equal(state.records[recordKey(employee.id, '2026-08-10')].status, STATUS.MISSED);
  assert.equal(state.records[recordKey(employee.id, '2026-08-18')].status, STATUS.OTHER_TASKS);
});

test('один складний запит за дозволом дає дві залікові одиниці, але лишається одним фактичним запитом', () => {
  const createdAt = localDate(2026, 7, 19, 9, 0);
  const state = defaultState(createdAt);
  const employee = createEmployee(state, 'Шевченко А. С.', createdAt);
  const now = localDate(2026, 7, 20, 11, 0);
  ensureAutomaticMisses(state, now);

  const receipt = recordSubmission(state, {
    employeeId: employee.id,
    requestCount: 1,
    complexTwoDay: true,
    documentRef: 'Складний документ №7',
  }, now);

  assert.equal(receipt.actualRequestCount, 1);
  assert.equal(receipt.creditUnits, 2);
  assert.equal(receipt.allocations.length, 2);
  assert.deepEqual(receipt.allocations.map((item) => item.date), ['2026-08-20', '2026-08-19']);
});

test('майбутній день не закривається без окремого підтвердження', () => {
  const now = localDate(2026, 7, 20, 10, 0);
  const state = defaultState(now);
  const employee = createEmployee(state, 'Коваль Н. П.', now);

  const receipt = recordSubmission(state, {
    employeeId: employee.id,
    requestCount: 1,
    complexTwoDay: true,
  }, now);

  assert.equal(receipt.allocations.length, 1);
  assert.equal(receipt.unallocatedCredit, 1);
  assert.equal(state.records[recordKey(employee.id, '2026-08-21')], undefined);

  allocateReceiptForward(state, receipt.id, 1, now);
  assert.equal(state.records[recordKey(employee.id, '2026-08-21')].status, STATUS.SUBMITTED_ADVANCE);
  assert.equal(receipt.unallocatedCredit, 0);
});

test('перегляд запиту не змінює базу, а виправлення перераховує дні одним кроком', () => {
  const now = localDate(2026, 7, 20, 12, 0);
  const state = defaultState(localDate(2026, 7, 17, 9, 0));
  const employee = createEmployee(state, 'Працівник', localDate(2026, 7, 17, 9, 0));
  ensureAutomaticMisses(state, now);
  const input = { employeeId: employee.id, requestCount: 2, documentRef: 'Документ 1' };
  const before = clone(state);
  assert.deepEqual(previewSubmission(state, input, now).dates, ['2026-08-20', '2026-08-19']);
  assert.deepEqual(state, before);
  const receipt = recordSubmission(state, input, now);
  const preview = previewReceiptCorrection(state, receipt.id, { requestCount: 1, documentRef: 'Виправлено' }, now);
  assert.deepEqual(preview.dates, ['2026-08-20']);
  assert.equal(state.receipts[0].actualRequestCount, 2);
  correctReceipt(state, receipt.id, { requestCount: 1, documentRef: 'Виправлено' }, now);
  assert.equal(state.records[recordKey(employee.id, '2026-08-20')].receiptId, receipt.id);
  assert.equal(state.records[recordKey(employee.id, '2026-08-19')].status, STATUS.MISSED);
  assert.equal(state.receipts[0].documentRef, 'Виправлено');
  assert.equal(state.audit.at(-1).action, 'receipt_corrected');
  assert.equal(state.audit.filter((item) => item.action === 'receipt_recorded').length, 1);
});

test('статус на період пропускає вихідні та не змінює частину днів при конфлікті', () => {
  const now = localDate(2026, 7, 24, 10, 0);
  const state = defaultState(now);
  const employee = createEmployee(state, 'Працівник', now);
  const payload = { employeeId: employee.id, startDate: '2026-08-24', endDate: '2026-08-30', status: STATUS.VACATION };
  const beforePreview = clone(state);
  assert.equal(previewManualStatuses(state, payload, now).count, 5);
  assert.deepEqual(state, beforePreview);
  const result = setManualStatuses(state, payload, now);
  assert.equal(result.count, 5);
  assert.equal(state.records[recordKey(employee.id, '2026-08-29')], undefined);
  setManualStatus(state, { employeeId: employee.id, date: '2026-08-26', status: STATUS.MISSED }, now);
  const receipt = recordSubmission(state, { employeeId: employee.id, requestCount: 1 }, localDate(2026, 7, 26, 10, 0));
  assert.ok(receipt.allocations.length);
  const before = clone(state.records);
  assert.throws(() => setManualStatuses(state, payload, now), /пов’язаний із запитом/);
  assert.deepEqual(state.records, before);
});

test('ім’я і порядок працівників можна виправити без втрати ідентифікаторів', () => {
  const now = localDate(2026, 7, 24, 10, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Перший', now);
  const second = createEmployee(state, 'Другий', now);
  renameEmployee(state, first.id, 'Перший виправлений', now);
  moveEmployee(state, second.id, -1, now);
  assert.deepEqual(state.employees.map((employee) => employee.id), [second.id, first.id]);
  assert.equal(state.employees[1].name, 'Перший виправлений');
});

test('відлучення редагується, але два записи однієї людини не можуть перетинатися', () => {
  const now = localDate(2026, 7, 24, 10, 0);
  const state = defaultState(now);
  const employee = createEmployee(state, 'Працівник', now);
  const input = { employeeId: employee.id, date: '2026-08-24', startTime: '10:00', endTime: '11:00', destination: 'Лікар' };
  const first = createTimeOffEntry(state, input, now);
  const second = createTimeOffEntry(state, { ...input, startTime: '12:00', endTime: '13:00' }, now);
  assert.throws(() => updateTimeOffEntry(state, second.id, { ...input, startTime: '10:30', endTime: '12:00' }, now), /перетинається/);
  updateTimeOffEntry(state, first.id, { ...input, endTime: '11:30', destination: 'Зустріч' }, now);
  assert.equal(state.timeOffEntries[0].durationMinutes, 90);
  assert.equal(state.timeOffEntries[0].destination, 'Зустріч');
});

test('відпрацьовані дні включають запити та інші завдання, але не особисті справи', () => {
  const createdAt = localDate(2026, 7, 17, 9, 0);
  const state = defaultState(createdAt);
  const employee = createEmployee(state, 'Бондар Л. В.', createdAt);
  const now = localDate(2026, 7, 20, 12, 0);
  ensureAutomaticMisses(state, now);

  recordSubmission(state, { employeeId: employee.id, requestCount: 1 }, localDate(2026, 7, 17, 12, 0));
  setManualStatus(state, { employeeId: employee.id, date: '2026-08-18', status: STATUS.OTHER_TASKS }, now);
  setManualStatus(state, { employeeId: employee.id, date: '2026-08-19', status: STATUS.PERSONAL_PERMISSION }, now);

  const result = calculateStatistics(state, {
    employeeId: employee.id,
    startDate: '2026-08-17',
    endDate: '2026-08-20',
  });
  const row = result.rows[0];
  assert.equal(row.workedDays, 2);
  assert.equal(row.requestDays, 1);
  assert.equal(row.otherTasks, 1);
  assert.equal(row.personalPermission, 1);
  assert.equal(row.missed, 0);
  assert.equal(row.pending, 1);
});

test('місячна динаміка узгоджується з аналітикою вибраного періоду', () => {
  const now = localDate(2026, 7, 31, 12, 0);
  const state = defaultState(localDate(2026, 7, 24, 9, 0));
  const employee = createEmployee(state, 'Працівник', localDate(2026, 7, 24, 9, 0));
  setManualStatus(state, { employeeId: employee.id, date: '2026-08-24', status: STATUS.OTHER_TASKS }, now);
  const filter = { employeeId: employee.id, startDate: '2026-08-24', endDate: '2026-09-06' };
  const trend = calculateAnalyticsTrend(state, filter);
  assert.deepEqual(trend.map((row) => row.month), ['2026-08', '2026-09']);
  assert.equal(trend.reduce((sum, row) => sum + row.workedDays, 0),
    calculateStatistics(state, filter).total.workedDays);
});

test('подання після 18:00 закриває поточний день як запізніле', () => {
  const now = localDate(2026, 7, 20, 18, 5);
  const state = defaultState(now);
  const employee = createEmployee(state, 'Сидоренко М. А.', now);

  const receipt = recordSubmission(state, {
    employeeId: employee.id,
    requestCount: 1,
  }, now);

  assert.equal(receipt.allocations[0].allocationType, 'late_current');
  assert.equal(state.records[recordKey(employee.id, '2026-08-20')].status, STATUS.SUBMITTED_LATE);
});

test('період перебування працівника в архіві не створює штучних пропусків після повернення', () => {
  const state = defaultState(localDate(2026, 7, 3, 9, 0));
  const employee = createEmployee(state, 'Романенко К. Ю.', localDate(2026, 7, 3, 9, 0));
  archiveEmployee(state, employee.id, localDate(2026, 7, 4, 9, 0));
  restoreEmployee(state, employee.id, localDate(2026, 7, 10, 9, 0));

  ensureAutomaticMisses(state, localDate(2026, 7, 11, 12, 0));

  assert.equal(state.records[recordKey(employee.id, '2026-08-03')].status, STATUS.MISSED);
  assert.equal(state.records[recordKey(employee.id, '2026-08-05')], undefined);
  assert.equal(state.records[recordKey(employee.id, '2026-08-10')].status, STATUS.MISSED);
});

test('субота й неділя автоматично не створюють пропусків, але ручний робочий вихідний створює', () => {
  const state = defaultState(localDate(2026, 7, 21, 9, 0));
  const employee = createEmployee(state, 'Литвин О. С.', localDate(2026, 7, 21, 9, 0));
  setWorkdayOverride(state, employee.id, '2026-08-22', '', localDate(2026, 7, 21, 10, 0));

  ensureAutomaticMisses(state, localDate(2026, 7, 24, 9, 0));

  assert.equal(state.records[recordKey(employee.id, '2026-08-22')].status, STATUS.MISSED);
  assert.equal(state.records[recordKey(employee.id, '2026-08-23')], undefined);
});

test('історичні дні до додавання працівника можна заповнювати вручну', () => {
  const createdAt = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(createdAt);
  const employee = createEmployee(state, 'Архівний працівник', createdAt);
  setManualStatus(state, {
    employeeId: employee.id,
    date: '2026-08-03',
    status: STATUS.OTHER_TASKS,
  }, createdAt);
  setWorkdayOverride(state, employee.id, '2026-08-01', '', createdAt);
  setManualStatus(state, {
    employeeId: employee.id,
    date: '2026-08-01',
    status: STATUS.SICK,
  }, createdAt);

  ensureAutomaticMisses(state, localDate(2026, 7, 21, 9, 0));
  assert.equal(state.records[recordKey(employee.id, '2026-08-04')], undefined);
  const stats = calculateStatistics(state, {
    employeeId: employee.id,
    startDate: '2026-08-01',
    endDate: '2026-08-19',
  });
  assert.equal(stats.rows[0].otherTasks, 1);
  assert.equal(stats.rows[0].sick, 1);
  assert.equal(stats.rows[0].workedDays, 1);
});

test('у табелі можна вручну позначити минулий день як поданий без створення документа', () => {
  const now = localDate(2026, 7, 20, 12, 0);
  const state = defaultState(localDate(2026, 7, 17, 9, 0));
  const employee = createEmployee(state, 'Коваль І. П.', localDate(2026, 7, 17, 9, 0));
  ensureAutomaticMisses(state, now);

  setManualStatus(state, {
    employeeId: employee.id,
    date: '2026-08-18',
    status: STATUS.SUBMITTED,
    note: 'Внесено за журналом',
  }, now);

  const record = state.records[recordKey(employee.id, '2026-08-18')];
  assert.equal(record.status, STATUS.SUBMITTED);
  assert.equal(record.source, 'manual');
  assert.equal(record.receiptId, null);
  assert.equal(state.receipts.length, 0);
  const stats = calculateStatistics(state, {
    employeeId: employee.id,
    startDate: '2026-08-18',
    endDate: '2026-08-18',
  }).rows[0];
  assert.equal(stats.requestDays, 1);
  assert.equal(stats.workedDays, 1);
  assert.equal(stats.documentsReceived, 0);

  assert.throws(() => setManualStatus(state, {
    employeeId: employee.id,
    date: '2026-08-21',
    status: STATUS.SUBMITTED,
  }, now), /майбутній день/);
});

test('нерозподілений залишок можна вручну зарахувати назад до початку обліку працівника', () => {
  const now = localDate(2026, 7, 20, 10, 0);
  const state = defaultState(now);
  const employee = createEmployee(state, 'Мельник Т. В.', now);
  const receipt = recordSubmission(state, {
    employeeId: employee.id,
    requestCount: 1,
    complexTwoDay: true,
  }, now);

  assert.equal(receipt.unallocatedCredit, 1);
  allocateReceiptBackward(state, receipt.id, 1, now);
  assert.equal(state.records[recordKey(employee.id, '2026-08-19')].status, STATUS.SUBMITTED_LATE);
  assert.equal(employee.createdDate, '2026-08-19');
});

test('генератор чергувань розподіляє по двоє і уникає повтору наступного дня', () => {
  const state = defaultState(localDate(2026, 7, 20, 9, 0));
  const employees = ['Андрій', 'Богдан', 'Віра', 'Галина']
    .map((name) => createEmployee(state, name, localDate(2026, 7, 20, 9, 0)));
  initializeDutyHistory(state, employees.map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })));

  const result = generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-26' });
  assert.equal(result.generated, 3);
  assert.equal(result.shortages.length, 0);
  const first = new Set(state.duties.assignments['2026-08-24'].employeeIds);
  const second = new Set(state.duties.assignments['2026-08-25'].employeeIds);
  assert.equal([...first].some((id) => second.has(id)), false);
  assert.equal(state.duties.assignments['2026-08-26'].employeeIds.length, 2);
});

test('якщо другого чергового без повтору наступного дня немає, місце лишається порожнім', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = ['Оксана', 'Віктор', 'Ганна']
    .map((name) => createEmployee(state, name, now));
  initializeDutyHistory(
    state,
    employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    null,
    now,
  );
  setDutyAssignment(state, {
    date: '2026-08-28',
    employeeIds: [employees[0].id, employees[1].id],
  }, now);

  const result = generateDutySchedule(state, {
    startDate: '2026-08-29',
    endDate: '2026-08-30',
  }, now);
  const friday = new Set(state.duties.assignments['2026-08-28'].employeeIds);
  const saturday = state.duties.assignments['2026-08-29'].employeeIds;
  const sunday = state.duties.assignments['2026-08-30'].employeeIds;

  assert.deepEqual(saturday, [employees[2].id]);
  assert.equal(saturday.some((employeeId) => friday.has(employeeId)), false);
  assert.equal(sunday.some((employeeId) => saturday.includes(employeeId)), false);
  assert.deepEqual(result.shortages, [{ date: '2026-08-29', missing: 1 }]);
  assert.equal(state.duties.assignments['2026-08-29'].singleApproved, false);
  assert.equal(state.duties.assignments['2026-08-29'].source, 'generated_shortage');
});

test('повторне формування може замінити тимчасовий вибір, але береже ручний склад наступного дня', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const [first, second, third, fourth] = ['Анна', 'Богдан', 'Віра', 'Ганна']
    .map((name) => createEmployee(state, name, now));
  initializeDutyHistory(state, [first, second, third, fourth].map((employee) => ({
    employeeId: employee.id, total: 0, realized: 0,
  })), null, now);
  setDutyAssignment(state, {
    date: '2026-08-28', employeeIds: [first.id, second.id],
  }, now);
  setDutyRestriction(state, {
    employeeId: fourth.id, date: '2026-08-29', type: 'planning_block',
  }, now);
  generateDutySchedule(state, { startDate: '2026-08-29', endDate: '2026-08-29' }, now);
  assert.deepEqual(state.duties.assignments['2026-08-29'].employeeIds, [third.id]);
  assert.deepEqual(state.duties.assignments['2026-08-29'].manualEmployeeIds, []);

  setDutyAssignment(state, {
    date: '2026-08-30', employeeIds: [third.id, first.id],
  }, now);
  clearDutyRestriction(state, fourth.id, '2026-08-29', now);
  const result = generateDutySchedule(state, {
    startDate: '2026-08-29', endDate: '2026-08-29',
  }, now);
  assert.deepEqual(result.shortages, [{ date: '2026-08-29', missing: 1 }]);
  assert.deepEqual(state.duties.assignments['2026-08-29'].employeeIds, [fourth.id]);
  assert.deepEqual(state.duties.assignments['2026-08-30'].employeeIds, [third.id, first.id]);
});

test('повторне формування неповного дня зберігає вже реалізоване чергування', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = ['Анна', 'Богдан', 'Віра', 'Ганна']
    .map((name) => createEmployee(state, name, now));
  initializeDutyHistory(state, employees.map((employee) => ({
    employeeId: employee.id, total: 0, realized: 0,
  })), null, now);
  setDutyAssignment(state, {
    date: '2026-08-28', employeeIds: [employees[0].id, employees[1].id],
  }, now);
  setDutyRestriction(state, {
    employeeId: employees[3].id, date: '2026-08-29', type: 'planning_block',
  }, now);
  generateDutySchedule(state, { startDate: '2026-08-29', endDate: '2026-08-29' }, now);
  const realizedId = state.duties.assignments['2026-08-29'].employeeIds[0];
  setDutyRealized(state, '2026-08-29', realizedId, true, now);
  clearDutyRestriction(state, employees[3].id, '2026-08-29', now);
  generateDutySchedule(state, { startDate: '2026-08-29', endDate: '2026-08-29' }, now);
  assert.ok(state.duties.assignments['2026-08-29'].employeeIds.includes(realizedId));
  assert.ok(state.duties.assignments['2026-08-29'].realizedEmployeeIds.includes(realizedId));
});

test('учасник з одним доступним днем не випадає з тижневого розподілу', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 8 }, (_, index) => (
    createEmployee(state, `Учасник ${index + 1}`, now)
  ));
  initializeDutyHistory(state, employees.map((employee) => ({
    employeeId: employee.id, total: 0, realized: 0,
  })), null, now);
  for (let date = '2026-08-25'; date <= '2026-08-30'; date = addDays(date, 1)) {
    setDutyRestriction(state, {
      employeeId: employees[7].id, date, type: 'planning_block',
    }, now);
  }
  const result = generateDutySchedule(state, {
    startDate: '2026-08-24', endDate: '2026-08-30',
  }, now);
  assert.deepEqual(result.shortages, []);
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.includes(employees[7].id), true);
  const counts = employees.map((employee) => Object.values(state.duties.assignments)
    .filter((assignment) => assignment.employeeIds.includes(employee.id)).length);
  assert.deepEqual([...counts].sort((a, b) => a - b), [1, 1, 2, 2, 2, 2, 2, 2]);
});

test('після «А» чергування дозволене, але «А» після чергування заборонена', () => {
  const state = defaultState(localDate(2026, 7, 20, 9, 0));
  const first = createEmployee(state, 'Данило', localDate(2026, 7, 20, 9, 0));
  const second = createEmployee(state, 'Євген', localDate(2026, 7, 20, 9, 0));
  const third = createEmployee(state, 'Жанна', localDate(2026, 7, 20, 9, 0));
  initializeDutyHistory(state, [first, second, third].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, localDate(2026, 7, 20, 9, 0));
  setDutyRestriction(state, { employeeId: first.id, date: '2026-08-24', type: 'a' });

  assert.throws(() => setDutyAssignment(state, {
    date: '2026-08-23',
    employeeIds: [first.id, third.id],
  }), /недоступний/);
  generateDutySchedule(state, { startDate: '2026-08-25', endDate: '2026-08-25' });
  assert.equal(state.duties.assignments['2026-08-25'].employeeIds.includes(first.id), true);
  assert.throws(() => setDutyAssignment(state, {
    date: '2026-08-26',
    employeeIds: [second.id],
  }), /підтвердження/);
  setDutyAssignment(state, {
    date: '2026-08-26',
    employeeIds: [second.id],
    singleApproved: true,
  });
  assert.equal(state.duties.assignments['2026-08-26'].singleApproved, true);
  assert.throws(() => setDutyRestriction(state, {
    employeeId: second.id,
    date: '2026-08-27',
    type: 'a',
  }), /Після чергування/);

  setDutyRealized(state, '2026-08-26', second.id, true);
  const stats = calculateDutyStatistics(state, '2026');
  assert.equal(stats.find((row) => row.employeeId === second.id).realized, 1);
  assert.ok(third.id);
});

test('база попередньої версії автоматично отримує нові поля без втрати записів', () => {
  const oldState = defaultState(localDate(2026, 7, 20, 9, 0));
  const employee = createEmployee(oldState, 'Зоряна', localDate(2026, 7, 20, 9, 0));
  delete oldState.duties;
  delete oldState.dutySchedules;
  delete oldState.activeDutyScheduleId;
  delete oldState.timeOffEntries;
  delete oldState.workdayOverrides;
  oldState.schemaVersion = 1;

  const normalized = normalizeState(oldState, localDate(2026, 7, 20, 9, 0));
  assert.equal(normalized.schemaVersion, 12);
  assert.equal(normalized.employees[0].id, employee.id);
  assert.deepEqual(normalized.workdayOverrides, {});
  assert.equal(normalized.duties.initialized, false);
  assert.deepEqual(normalized.duties.assignments, {});
  assert.deepEqual(normalized.duties.planningBlocks, {});
  assert.deepEqual(normalized.duties.participantIds, [employee.id]);
  assert.equal(normalized.duties.baselineYear, '2026');
  assert.equal(normalized.duties.baselineThroughDate, '2026-08-23');
  assert.equal(normalized.dutySchedules.length, 1);
  assert.equal(normalized.dutySchedules[0].name, 'Основний');
  assert.equal(normalized.activeDutyScheduleId, normalized.dutySchedules[0].id);
  assert.equal(normalized.duties, normalized.dutySchedules[0].data);
});

test('початкові Σ і Р не дублюють ручну історію та зростають лише після контрольної дати', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Перший', now);
  const second = createEmployee(state, 'Другий', now);
  initializeDutyHistory(state, [
    { employeeId: first.id, total: 5, realized: 2 },
    { employeeId: second.id, total: 4, realized: 1 },
  ], null, now);
  assert.equal(state.duties.baselineThroughDate, '2026-08-23');

  setDutyAssignment(state, {
    date: '2026-08-22',
    employeeIds: [first.id, second.id],
  }, now);
  setDutyRealized(state, '2026-08-22', first.id, true, now);
  let stats = calculateDutyStatistics(state, '2026');
  assert.deepEqual(stats.map((row) => [row.total, row.realized]), [[5, 2], [4, 1]]);

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24' }, now);
  stats = calculateDutyStatistics(state, '2026');
  assert.deepEqual(stats.map((row) => [row.total, row.realized]), [[6, 2], [5, 1]]);
  setDutyRealized(state, '2026-08-24', first.id, true, now);
  stats = calculateDutyStatistics(state, '2026');
  assert.deepEqual(stats.map((row) => [row.total, row.realized]), [[6, 3], [5, 1]]);

  const nextYear = calculateDutyStatistics(state, '2027');
  assert.deepEqual(nextYear.map((row) => [row.total, row.realized]), [[0, 0], [0, 0]]);
});

test('зміна учасників у новому році не стирає вже накопичені січневі чергування', () => {
  const initialNow = localDate(2026, 11, 20, 9, 0);
  const state = defaultState(initialNow);
  const first = createEmployee(state, 'Перший', initialNow);
  const second = createEmployee(state, 'Другий', initialNow);
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, initialNow);
  setDutyAssignment(state, {
    date: '2027-01-01',
    employeeIds: [first.id, second.id],
  }, initialNow);
  setDutyAssignment(state, {
    date: '2027-01-02',
    employeeIds: [first.id, second.id],
  }, initialNow);
  setDutyRealized(state, '2027-01-02', first.id, true, initialNow);

  const januaryNow = localDate(2027, 0, 5, 9, 0);
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, januaryNow);

  assert.equal(state.duties.baselineYear, '2027');
  assert.equal(state.duties.baselineThroughDate, '2026-12-31');
  assert.deepEqual(calculateDutyStatistics(state, '2027').map((row) => [row.total, row.realized]), [
    [2, 1],
    [2, 0],
  ]);
  assert.equal(
    normalizeState(clone(state), januaryNow).duties.baselineThroughDate,
    '2026-12-31',
  );
});

test('учасників чергувань можна обрати окремо від загального списку працівників', () => {
  const state = defaultState(localDate(2026, 7, 20, 9, 0));
  const employees = ['Ірина', 'Катерина', 'Леся']
    .map((name) => createEmployee(state, name, localDate(2026, 7, 20, 9, 0)));
  initializeDutyHistory(
    state,
    employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    [employees[0].id, employees[2].id],
  );

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24' });
  assert.deepEqual(new Set(state.duties.assignments['2026-08-24'].employeeIds), new Set([
    employees[0].id,
    employees[2].id,
  ]));
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.includes(employees[1].id), false);
});

test('лівий клік циклічно змінює порожню клітинку на 1, зелену 1 та знову порожню', () => {
  const state = defaultState(localDate(2026, 7, 20, 9, 0));
  const first = createEmployee(state, 'Марія', localDate(2026, 7, 20, 9, 0));
  const second = createEmployee(state, 'Назар', localDate(2026, 7, 20, 9, 0));
  initializeDutyHistory(state, [first, second].map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })));

  toggleDutyAssignment(state, first.id, '2026-08-24');
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, [first.id]);
  assert.equal(state.duties.assignments['2026-08-24'].singleApproved, false);
  toggleDutyAssignment(state, second.id, '2026-08-24');
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.length, 2);
  toggleDutyAssignment(state, first.id, '2026-08-24');
  assert.equal(state.duties.assignments['2026-08-24'].realizedEmployeeIds.includes(first.id), true);
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.includes(first.id), true);
  toggleDutyAssignment(state, first.id, '2026-08-24');
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, [second.id]);
});

test('реалізоване чергування з’являється лише після ручного другого кліку', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Марко', now);
  const second = createEmployee(state, 'Олена', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, now);
  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24' }, now);
  assert.deepEqual(state.duties.assignments['2026-08-24'].realizedEmployeeIds, []);

  toggleDutyAssignment(state, first.id, '2026-08-24', now);
  let firstStats = calculateDutyStatistics(state, '2026')
    .find((row) => row.employeeId === first.id);
  assert.equal(firstStats.total, 1);
  assert.equal(firstStats.realized, 1);

  toggleDutyAssignment(state, first.id, '2026-08-24', now);
  firstStats = calculateDutyStatistics(state, '2026')
    .find((row) => row.employeeId === first.id);
  assert.equal(firstStats.total, 0);
  assert.equal(firstStats.realized, 0);

  removeDutyAssignment(state, second.id, '2026-08-24', now);
  assert.equal(state.duties.assignments['2026-08-24'], undefined);
});

test('за достатнього складу генератор залишає щонайменше два повних дні між чергуваннями', () => {
  const state = defaultState(localDate(2026, 7, 20, 9, 0));
  const employees = Array.from({ length: 7 }, (_, index) => (
    createEmployee(state, `Учасник ${index + 1}`, localDate(2026, 7, 20, 9, 0))
  ));
  initializeDutyHistory(state, employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })));

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-30' });
  const dutyDates = new Map(employees.map((employee) => [employee.id, []]));
  for (const assignment of Object.values(state.duties.assignments)) {
    for (const employeeId of assignment.employeeIds) dutyDates.get(employeeId).push(assignment.date);
  }
  for (const dates of dutyDates.values()) {
    for (let index = 1; index < dates.length; index += 1) {
      const previous = new Date(`${dates[index - 1]}T12:00:00Z`);
      const current = new Date(`${dates[index]}T12:00:00Z`);
      assert.ok((current - previous) / 86_400_000 >= 3);
    }
  }
  const counts = [...dutyDates.values()].map((dates) => dates.length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  assert.equal(counts.every((count) => count > 0), true);
});

test('коли дводенний проміжок неможливий, рівномірність важливіша за нього', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 4 }, (_, index) => (
    createEmployee(state, `Черговий ${index + 1}`, now)
  ));
  initializeDutyHistory(state, employees.map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, now);

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-30' }, now);
  const counts = employees.map((employee) => (
    Object.values(state.duties.assignments)
      .filter((assignment) => assignment.employeeIds.includes(employee.id)).length
  ));
  for (let date = '2026-08-25'; date <= '2026-08-30'; date = addDays(date, 1)) {
    const previousIds = new Set(state.duties.assignments[addDays(date, -1)].employeeIds);
    assert.equal(
      state.duties.assignments[date].employeeIds.some((employeeId) => previousIds.has(employeeId)),
      false,
    );
  }
  assert.deepEqual([...counts].sort((left, right) => left - right), [3, 3, 4, 4]);
});

test('тижнева модель не дає трьох чергувань одним, поки інші мають лише одне', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 9 }, (_, index) => (
    createEmployee(state, `Черговий ${index + 1}`, now)
  ));
  initializeDutyHistory(
    state,
    employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    null,
    now,
  );
  setDutyAssignment(state, {
    date: '2026-08-22',
    employeeIds: [employees[0].id, employees[1].id],
  }, now);
  setDutyAssignment(state, {
    date: '2026-08-23',
    employeeIds: [employees[2].id, employees[3].id],
  }, now);
  for (let date = '2026-08-24'; date <= '2026-08-30'; date = addDays(date, 1)) {
    setDutyRestriction(state, {
      employeeId: employees[8].id,
      date,
      type: 'vacation',
    }, now);
  }

  const result = generateDutySchedule(state, {
    startDate: '2026-08-24',
    endDate: '2026-08-30',
  }, now);
  const datesByEmployee = new Map(employees.slice(0, 8).map((employee) => [employee.id, []]));
  const pairKeys = new Set();
  for (let date = '2026-08-24'; date <= '2026-08-30'; date = addDays(date, 1)) {
    const ids = state.duties.assignments[date].employeeIds;
    assert.equal(ids.length, 2);
    const previousIds = new Set(state.duties.assignments[addDays(date, -1)]?.employeeIds || []);
    assert.equal(ids.some((employeeId) => previousIds.has(employeeId)), false);
    for (const employeeId of ids) datesByEmployee.get(employeeId).push(date);
    pairKeys.add([...ids].sort().join('|'));
  }
  const counts = [...datesByEmployee.values()].map((dates) => dates.length);
  assert.equal(Math.max(...counts), 2);
  assert.equal(Math.min(...counts), 1);
  assert.ok(pairKeys.size >= 6);
  const previousWeekend = new Set(employees.slice(0, 4).map((employee) => employee.id));
  const currentWeekend = [
    ...state.duties.assignments['2026-08-29'].employeeIds,
    ...state.duties.assignments['2026-08-30'].employeeIds,
  ];
  assert.equal(currentWeekend.some((employeeId) => previousWeekend.has(employeeId)), false);
  for (const dates of datesByEmployee.values()) {
    for (let index = 1; index < dates.length; index += 1) {
      const gap = (new Date(`${dates[index]}T12:00:00Z`) - new Date(`${dates[index - 1]}T12:00:00Z`)) / 86_400_000;
      assert.ok(gap >= 3);
    }
  }
  assert.deepEqual(result.shortages, []);
  assert.deepEqual(result.weekendConflicts, []);
});

test('наступний тиждень компенсує одне чергування двома та не повторює пари', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 9 }, (_, index) => (
    createEmployee(state, `Учасник ${index + 1}`, now)
  ));
  initializeDutyHistory(
    state,
    employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    null,
    now,
  );

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-30' }, now);
  const firstWeekCounts = new Map(employees.map((employee) => [employee.id, 0]));
  const firstWeekPairs = new Set();
  for (let date = '2026-08-24'; date <= '2026-08-30'; date = addDays(date, 1)) {
    const employeeIds = state.duties.assignments[date].employeeIds;
    employeeIds.forEach((employeeId) => (
      firstWeekCounts.set(employeeId, firstWeekCounts.get(employeeId) + 1)
    ));
    firstWeekPairs.add([...employeeIds].sort().join('|'));
  }

  generateDutySchedule(state, { startDate: '2026-08-31', endDate: '2026-09-06' }, now);
  const secondWeekCounts = new Map(employees.map((employee) => [employee.id, 0]));
  const secondWeekPairs = new Set();
  for (let date = '2026-08-31'; date <= '2026-09-06'; date = addDays(date, 1)) {
    const employeeIds = state.duties.assignments[date].employeeIds;
    employeeIds.forEach((employeeId) => (
      secondWeekCounts.set(employeeId, secondWeekCounts.get(employeeId) + 1)
    ));
    const pairKey = [...employeeIds].sort().join('|');
    assert.equal(firstWeekPairs.has(pairKey), false);
    assert.equal(secondWeekPairs.has(pairKey), false);
    secondWeekPairs.add(pairKey);
  }

  for (const [employeeId, count] of firstWeekCounts) {
    if (count === 1) assert.equal(secondWeekCounts.get(employeeId), 2);
  }
  const secondWeekValues = [...secondWeekCounts.values()];
  assert.ok(Math.max(...secondWeekValues) - Math.min(...secondWeekValues) <= 1);
});

test('якщо всі доступні люди вже чергували минулого вікенду, новий вікенд показує нестачу', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 4 }, (_, index) => (
    createEmployee(state, `Черговий ${index + 1}`, now)
  ));
  initializeDutyHistory(
    state,
    employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    null,
    now,
  );
  setDutyAssignment(state, {
    date: '2026-08-22',
    employeeIds: [employees[0].id, employees[1].id],
  }, now);
  setDutyAssignment(state, {
    date: '2026-08-23',
    employeeIds: [employees[2].id, employees[3].id],
  }, now);

  const result = generateDutySchedule(state, {
    startDate: '2026-08-29',
    endDate: '2026-08-30',
  }, now);
  assert.deepEqual(state.duties.assignments['2026-08-29'].employeeIds, []);
  assert.deepEqual(state.duties.assignments['2026-08-30'].employeeIds, []);
  assert.deepEqual(result.shortages, [
    { date: '2026-08-29', missing: 2 },
    { date: '2026-08-30', missing: 2 },
  ]);
  assert.deepEqual(result.weekendConflicts, []);
});

test('повторне формування не змінює вже готовий автоматичний або ручний графік', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 9 }, (_, index) => (
    createEmployee(state, `Учасник ${index + 1}`, now)
  ));
  initializeDutyHistory(
    state,
    employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    null,
    now,
  );
  setDutyAssignment(state, {
    date: '2026-08-22',
    employeeIds: [employees[0].id, employees[1].id],
  }, now);
  setDutyAssignment(state, {
    date: '2026-08-23',
    employeeIds: [employees[2].id, employees[3].id],
  }, now);
  setDutyAssignment(state, {
    date: '2026-08-24',
    employeeIds: [employees[4].id, employees[5].id],
  }, now);
  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-30' }, now);
  const beforeAssignments = clone(state.duties.assignments);
  const beforeAuditLength = state.audit.length;

  const result = generateDutySchedule(state, {
    startDate: '2026-08-24',
    endDate: '2026-08-30',
  }, localDate(2026, 7, 20, 10, 0));

  assert.equal(result.generated, 0);
  assert.deepEqual(state.duties.assignments, beforeAssignments);
  assert.equal(state.audit.length, beforeAuditLength);
  assert.equal(state.duties.assignments['2026-08-24'].source, 'manual');
});

test('формування нового тижня не змінює жодних даних за його межами', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 9 }, (_, index) => (
    createEmployee(state, `Працівник ${index + 1}`, now)
  ));
  initializeDutyHistory(
    state,
    employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    null,
    now,
  );
  setDutyAssignment(state, {
    date: '2026-08-17',
    employeeIds: [employees[0].id, employees[1].id],
  }, now);
  setDutyAssignment(state, {
    date: '2026-08-18',
    employeeIds: [employees[2].id, employees[3].id],
  }, now);
  setDutyRestriction(state, {
    employeeId: employees[8].id,
    date: '2026-08-19',
    type: 'planning_block',
    note: 'Ручне обмеження',
  }, now);
  setDutyAssignment(state, {
    date: '2026-08-24',
    employeeIds: [employees[4].id, employees[5].id],
  }, now);
  const beforeOutsideAssignments = Object.fromEntries(
    Object.entries(state.duties.assignments)
      .filter(([date]) => date < '2026-08-24' || date > '2026-08-30'),
  );
  const beforeRestrictions = {
    aDays: clone(state.duties.aDays),
    unavailable: clone(state.duties.unavailable),
    planningBlocks: clone(state.duties.planningBlocks),
  };
  const manualTargetDay = clone(state.duties.assignments['2026-08-24']);

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-30' }, now);

  const afterOutsideAssignments = Object.fromEntries(
    Object.entries(state.duties.assignments)
      .filter(([date]) => date < '2026-08-24' || date > '2026-08-30'),
  );
  assert.deepEqual(afterOutsideAssignments, beforeOutsideAssignments);
  assert.deepEqual({
    aDays: state.duties.aDays,
    unavailable: state.duties.unavailable,
    planningBlocks: state.duties.planningBlocks,
  }, beforeRestrictions);
  assert.deepEqual(state.duties.assignments['2026-08-24'], manualTargetDay);
});

test('жовта позначка блокує лише планування чергування і знімається окремо', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 4 }, (_, index) => (
    createEmployee(state, `Працівник ${index + 1}`, now)
  ));
  initializeDutyHistory(
    state,
    employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    null,
    now,
  );
  setDutyRestriction(state, {
    employeeId: employees[0].id,
    date: '2026-08-24',
    type: 'planning_block',
  }, now);

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24' }, now);
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.includes(employees[0].id), false);
  assert.equal(state.records[recordKey(employees[0].id, '2026-08-24')], undefined);
  assert.equal(clearDutyRestriction(state, employees[0].id, '2026-08-24', now), true);
  assert.equal(state.duties.planningBlocks[recordKey(employees[0].id, '2026-08-24')], undefined);
});

test('стара різниця у кількості не виключає працівника з нового кола чергувань', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 7 }, (_, index) => (
    createEmployee(state, `Черговий ${index + 1}`, now)
  ));
  initializeDutyHistory(state, employees.map((employee, index) => ({
    employeeId: employee.id,
    total: index === 0 ? 47 : 3,
    realized: 0,
  })), null, now);

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-30' }, now);
  const generatedCounts = employees.map((employee) => (
    Object.values(state.duties.assignments)
      .filter((assignment) => assignment.employeeIds.includes(employee.id)).length
  ));
  assert.equal(generatedCounts.every((count) => count === 2), true);
});

test('генератор продовжує чергу після вручну заповненого графіка', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 6 }, (_, index) => (
    createEmployee(state, `Працівник ${index + 1}`, now)
  ));
  initializeDutyHistory(state, employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })), null, now);
  setDutyAssignment(state, { date: '2026-08-21', employeeIds: [employees[0].id, employees[1].id] }, now);
  setDutyAssignment(state, { date: '2026-08-22', employeeIds: [employees[2].id, employees[3].id] }, now);
  setDutyAssignment(state, { date: '2026-08-23', employeeIds: [employees[4].id, employees[5].id] }, now);

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24' }, now);
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, [
    employees[0].id,
    employees[1].id,
  ]);
});

test('тимчасова відсутність пропускає день, але не викидає працівника з черги', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 6 }, (_, index) => (
    createEmployee(state, `Учасник ${index + 1}`, now)
  ));
  initializeDutyHistory(state, employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })), null, now);
  setDutyRestriction(state, { employeeId: employees[0].id, date: '2026-08-24', type: 'off' }, now);

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-25' }, now);
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.includes(employees[0].id), false);
  assert.equal(state.duties.assignments['2026-08-25'].employeeIds.includes(employees[0].id), true);
});

test('підсумки чергувань рахуються окремо для кожного року', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Ігор', now);
  const second = createEmployee(state, 'Лариса', now);
  initializeDutyHistory(state, [
    { employeeId: first.id, total: 5, realized: 2 },
    { employeeId: second.id, total: 0, realized: 0 },
  ], null, now);
  setDutyAssignment(state, { date: '2026-12-20', employeeIds: [first.id, second.id] }, now);
  setDutyAssignment(state, { date: '2027-01-03', employeeIds: [first.id, second.id] }, now);

  const stats2026 = calculateDutyStatistics(state, '2026');
  const stats2027 = calculateDutyStatistics(state, '2027');
  assert.equal(stats2026.find((row) => row.employeeId === first.id).total, 6);
  assert.equal(stats2027.find((row) => row.employeeId === first.id).total, 1);
});

test('генератор доповнює вручну розпочату пару другим доступним черговим', () => {
  const state = defaultState(localDate(2026, 7, 20, 9, 0));
  const employees = ['Олег', 'Павло', 'Руслана']
    .map((name) => createEmployee(state, name, localDate(2026, 7, 20, 9, 0)));
  initializeDutyHistory(state, employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })));
  toggleDutyAssignment(state, employees[0].id, '2026-08-24');

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-24' });
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.length, 2);
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.includes(employees[0].id), true);
});

test('вилучений зі складу учасник зберігається в історії, але прибирається з майбутнього графіка', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Світлана', now);
  const second = createEmployee(state, 'Тарас', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })), null, now);
  toggleDutyAssignment(state, first.id, '2026-08-19', now);
  toggleDutyAssignment(state, first.id, '2026-08-24', now);

  initializeDutyHistory(
    state,
    [first, second].map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })),
    [second.id],
    now,
  );
  assert.equal(state.duties.assignments['2026-08-19'].employeeIds.includes(first.id), true);
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, []);
  assert.equal(state.duties.assignments['2026-08-24'].source, 'participant_removed');
});

test('архівований працівник не залишається невидимим у майбутньому графіку', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Світлана', now);
  const second = createEmployee(state, 'Тарас', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, now);
  setDutyAssignment(state, {
    date: '2026-08-19',
    employeeIds: [first.id, second.id],
  }, now);
  setDutyAssignment(state, {
    date: '2026-08-24',
    employeeIds: [first.id, second.id],
  }, now);

  archiveEmployee(state, first.id, now);

  assert.equal(state.duties.participantIds.includes(first.id), false);
  assert.equal(state.duties.assignments['2026-08-19'].employeeIds.includes(first.id), true);
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, [second.id]);
  assert.equal(state.duties.assignments['2026-08-24'].singleApproved, false);
  assert.equal(state.duties.assignments['2026-08-24'].source, 'participant_archived');
});

test('окремі графіки зберігають власних учасників, історію та підсумки', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Андрій', now);
  const second = createEmployee(state, 'Богдан', now);
  const third = createEmployee(state, 'Віра', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id,
    total: 4,
    realized: 1,
  })), [first.id, second.id], now);
  setDutyAssignment(state, {
    date: '2026-08-24',
    employeeIds: [first.id, second.id],
  }, now);
  const primaryId = state.activeDutyScheduleId;

  const secondSchedule = createDutySchedule(state, 'Резервна група', now);
  initializeDutyHistory(state, [second, third].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), [second.id, third.id], now);
  setDutyAssignment(state, {
    date: '2026-08-25',
    employeeIds: [second.id, third.id],
  }, now);

  switchDutySchedule(state, primaryId, now);
  assert.deepEqual(state.duties.participantIds, [first.id, second.id]);
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, [first.id, second.id]);
  assert.equal(state.duties.assignments['2026-08-25'], undefined);

  renameDutySchedule(state, secondSchedule.id, 'Друга зміна', now);
  switchDutySchedule(state, secondSchedule.id, now);
  assert.deepEqual(state.duties.participantIds, [second.id, third.id]);
  assert.deepEqual(state.duties.assignments['2026-08-25'].employeeIds, [second.id, third.id]);
  assert.equal(state.dutySchedules.find((item) => item.id === secondSchedule.id).name, 'Друга зміна');

  deleteDutySchedule(state, secondSchedule.id, now);
  assert.equal(state.dutySchedules.length, 1);
  assert.equal(state.activeDutyScheduleId, primaryId);
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, [first.id, second.id]);
});

test('архівація прибирає майбутні призначення з усіх окремих графіків', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Ірина', now);
  const second = createEmployee(state, 'Марко', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, now);
  setDutyAssignment(state, { date: '2026-08-19', employeeIds: [first.id, second.id] }, now);
  setDutyAssignment(state, { date: '2026-08-24', employeeIds: [first.id, second.id] }, now);
  const primaryId = state.activeDutyScheduleId;

  const extra = createDutySchedule(state, 'Пост 2', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, now);
  setDutyAssignment(state, { date: '2026-08-19', employeeIds: [first.id, second.id] }, now);
  setDutyAssignment(state, { date: '2026-08-25', employeeIds: [first.id, second.id] }, now);

  archiveEmployee(state, first.id, now);
  for (const scheduleId of [primaryId, extra.id]) {
    switchDutySchedule(state, scheduleId, now);
    assert.equal(state.duties.participantIds.includes(first.id), false);
    assert.equal(state.duties.assignments['2026-08-19'].employeeIds.includes(first.id), true);
  }
  switchDutySchedule(state, primaryId, now);
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, [second.id]);
  switchDutySchedule(state, extra.id, now);
  assert.deepEqual(state.duties.assignments['2026-08-25'].employeeIds, [second.id]);
});

test('журнал «Відпросився» рахує час окремо й не змінює табель', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employee = createEmployee(state, 'Оксана', now);
  const entry = createTimeOffEntry(state, {
    employeeId: employee.id,
    date: '2026-08-20',
    startTime: '10:15',
    endTime: '12:45',
    destination: 'До лікаря',
    note: 'Повернулася вчасно',
  }, now);

  assert.equal(entry.durationMinutes, 150);
  assert.equal(state.records[recordKey(employee.id, '2026-08-20')], undefined);
  const stats = calculateStatistics(state, {
    employeeId: employee.id,
    startDate: '2026-08-20',
    endDate: '2026-08-20',
  });
  assert.equal(stats.rows[0].pending, 1);
  assert.equal(stats.rows[0].personalPermission, 0);

  const normalized = normalizeState(clone(state), now);
  assert.equal(normalized.timeOffEntries[0].durationMinutes, 150);
  deleteTimeOffEntry(normalized, entry.id, now);
  assert.deepEqual(normalized.timeOffEntries, []);
});

test('кожен графік має власні правила, а копія переносить учасників і правила без призначень', () => {
  const now = localDate(2026, 7, 24, 9, 0);
  const state = defaultState(now);
  const employees = ['А', 'Б', 'В'].map((name) => createEmployee(state, `Працівник ${name}`, now));
  initializeDutyHistory(state, employees.map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })), null, now);
  const primaryId = state.activeDutyScheduleId;
  updateDutyScheduleRules(state, primaryId, {
    weekdayDutyCount: 1,
    weekendDutyCount: 2,
    minimumRestDays: 3,
    maximumDutiesPerWeek: 2,
    pairHistoryPeriod: 'quarter',
    preventConsecutiveDays: true,
    preventConsecutiveWeekends: false,
    compensateNextWeek: true,
    avoidRepeatedPairs: true,
  }, now);
  setDutyAssignment(state, { date: '2026-08-25', employeeIds: [employees[0].id] }, now);

  const copy = duplicateDutySchedule(state, primaryId, 'Копія правил', now);
  assert.deepEqual(copy.data.participantIds, employees.map((employee) => employee.id));
  assert.equal(copy.data.rules.weekdayDutyCount, 1);
  assert.equal(copy.data.rules.minimumRestDays, 3);
  assert.deepEqual(copy.data.assignments, {});

  updateDutyScheduleRules(state, copy.id, { ...copy.data.rules, minimumRestDays: 0 }, now);
  assert.equal(copy.data.rules.minimumRestDays, 0);
  assert.equal(state.dutySchedules.find((item) => item.id === primaryId).data.rules.minimumRestDays, 3);
});

test('кількість чергових за днями тижня змінює розрахунок і зберігається в копії', () => {
  const now = localDate(2026, 7, 24);
  const state = defaultState(now);
  const people = ['А', 'Б', 'В', 'Г'].map((name) => createEmployee(state, `Працівник ${name}`, now));
  initializeDutyHistory(state, people.map(({ id }) => ({ employeeId: id, total: 0, realized: 0 })), null, now);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 2, weekendDutyCount: 2,
    requiredByWeekday: { 1: 1, 3: 1, 6: 1, 9: 2 },
    planningPriority: 'pairs',
  }, now);
  const copy = duplicateDutySchedule(state, state.activeDutyScheduleId, 'Копія', now);
  assert.deepEqual(copy.data.rules.requiredByWeekday, { 1: 1, 3: 1, 6: 1 });
  assert.equal(copy.data.rules.planningPriority, 'pairs');
  const preview = previewDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-30' }, now);
  assert.deepEqual(preview.assignments.map((day) => day.requiredCount), [1, 2, 1, 2, 2, 1, 2]);
});

test('обов’язковий інтервал відпочинку лишає прогалини, а бажаний дозволяє їх заповнити', () => {
  const now = localDate(2026, 7, 24);
  const state = defaultState(now);
  const person = createEmployee(state, 'Один черговий', now);
  initializeDutyHistory(state, [{ employeeId: person.id, total: 0, realized: 0 }], null, now);
  const rules = {
    weekdayDutyCount: 1, weekendDutyCount: 1, preventConsecutiveDays: false,
    preventConsecutiveWeekends: false, minimumRestDays: 2, minimumRestMode: 'prefer',
  };
  updateDutyScheduleRules(state, state.activeDutyScheduleId, rules, now);
  const period = { startDate: '2026-08-24', endDate: '2026-08-26' };
  assert.equal(previewDutySchedule(state, period, now).shortages.length, 0);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, { ...rules, minimumRestMode: 'require' }, now);
  const preview = previewDutySchedule(state, period, now);
  assert.equal(preview.assignments.filter((day) => day.employeeIds.includes(person.id)).length, 1);
  assert.equal(preview.shortages.length, 2);
});

test('довгий діапазон дотримується тижневого максимуму', () => {
  const now = localDate(2026, 7, 24);
  const state = defaultState(now);
  const people = ['А', 'Б'].map((name) => createEmployee(state, `Працівник ${name}`, now));
  initializeDutyHistory(state, people.map(({ id }) => ({ employeeId: id, total: 0, realized: 0 })), null, now);
  updateDutyScheduleRules(state, state.activeDutyScheduleId, {
    weekdayDutyCount: 1, weekendDutyCount: 1, maximumDutiesPerWeek: 1,
    preventConsecutiveDays: false, preventConsecutiveWeekends: false,
    minimumRestDays: 0,
  }, now);
  const result = generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-09-06' }, now);
  assert.equal(result.shortages.length, 10);
  for (const start of ['2026-08-24', '2026-08-31']) {
    const counts = people.map(({ id }) => Array.from({ length: 7 }, (_, index) => (
      state.duties.assignments[addDays(start, index)]?.employeeIds.includes(id) ? 1 : 0
    )).reduce((sum, count) => sum + count, 0));
    assert.deepEqual(counts, [1, 1]);
  }
});

test('попередній перегляд графіка не змінює базу до підтвердження', () => {
  const now = localDate(2026, 7, 24, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 8 }, (_, index) => createEmployee(state, `Тест ${index + 1}`, now));
  initializeDutyHistory(state, employees.map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })), null, now);
  const before = clone(state.duties.assignments);

  const preview = previewDutySchedule(state, { startDate: '2026-08-31', endDate: '2026-09-06' }, now);
  assert.deepEqual(state.duties.assignments, before);
  assert.equal(preview.assignments.length, 7);
  assert.equal(preview.assignments.every((assignment) => assignment.explanation), true);

  generateDutySchedule(state, { startDate: '2026-08-31', endDate: '2026-09-06' }, now);
  assert.equal(Object.keys(state.duties.assignments).length, 7);
});

test('чернетка закріплень перераховує перегляд і зберігається лише разом із графіком', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = Array.from({ length: 6 }, (_, index) => (
    createEmployee(state, `Учасник ${index + 1}`, now)
  ));
  initializeDutyHistory(state, employees.map((employee) => ({
    employeeId: employee.id, total: 0, realized: 0,
  })), null, now);
  const filter = {
    startDate: '2026-08-24', endDate: '2026-08-30',
    pinnedAssignments: [
      { date: '2026-08-24', employeeIds: [employees[5].id] },
      { date: '2026-08-25', employeeIds: [employees[4].id] },
    ],
  };
  const preview = previewDutySchedule(state, filter, now);
  assert.deepEqual(state.duties.assignments, {});
  assert.ok(preview.assignments[0].employeeIds.includes(employees[5].id));
  assert.ok(preview.assignments[1].employeeIds.includes(employees[4].id));
  generateDutySchedule(state, filter, now);
  assert.ok(state.duties.assignments['2026-08-24'].manualEmployeeIds.includes(employees[5].id));
  assert.ok(state.duties.assignments['2026-08-25'].manualEmployeeIds.includes(employees[4].id));

  const invalid = {
    startDate: '2026-08-31', endDate: '2026-09-06',
    pinnedAssignments: [
      { date: '2026-08-31', employeeIds: [employees[0].id] },
      { date: '2026-09-01', employeeIds: [employees[0].id] },
    ],
  };
  assert.throws(() => generateDutySchedule(state, invalid, now), /два дні поспіль/);
  assert.equal(state.duties.assignments['2026-08-31'], undefined);
});

test('попередній перегляд пояснює, кого і чому не можна додати в дефіцитний день', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = ['Оксана', 'Віктор', 'Ганна']
    .map((name) => createEmployee(state, name, now));
  initializeDutyHistory(state, employees.map((employee) => ({
    employeeId: employee.id, total: 0, realized: 0,
  })), null, now);
  setDutyAssignment(state, {
    date: '2026-08-28', employeeIds: [employees[0].id, employees[1].id],
  }, now);
  const preview = previewDutySchedule(state, {
    startDate: '2026-08-29', endDate: '2026-08-30',
  }, now);
  const saturday = preview.shortageDetails.find((item) => item.date === '2026-08-29');
  assert.equal(saturday.missing, 1);
  assert.deepEqual(saturday.available, []);
  assert.equal(saturday.blocked.length, 2);
  assert.ok(saturday.blocked.every((item) => item.reasons.includes('чергував попереднього дня')));
  assert.equal(state.duties.assignments['2026-08-29'], undefined);
});

test('заблокований тиждень не можна випадково змінити або перегенерувати', () => {
  const now = localDate(2026, 7, 24, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Перший', now);
  const second = createEmployee(state, 'Другий', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })), null, now);
  setDutyAssignment(state, { date: '2026-08-31', employeeIds: [first.id, second.id] }, now);
  setDutyWeekLocked(state, '2026-09-02', true, now);

  assert.throws(() => removeDutyAssignment(state, first.id, '2026-08-31', now), /заблоковано/);
  assert.throws(() => generateDutySchedule(state, { startDate: '2026-08-31', endDate: '2026-09-06' }, now), /заблоковано/);

  setDutyWeekLocked(state, '2026-09-02', false, now);
  removeDutyAssignment(state, first.id, '2026-08-31', now);
  assert.deepEqual(state.duties.assignments['2026-08-31'].employeeIds, [second.id]);
});

test('очищення тижня прибирає лише призначення активного графіка й поважає блокування', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const [first, second] = ['Марія', 'Назар'].map((name) => createEmployee(state, name, now));
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id, total: 0, realized: 0,
  })), null, now);
  setDutyAssignment(state, { date: '2026-08-23', employeeIds: [first.id, second.id] }, now);
  setDutyAssignment(state, { date: '2026-08-24', employeeIds: [first.id, second.id] }, now);
  setDutyAssignment(state, { date: '2026-08-30', employeeIds: [first.id, second.id] }, now);
  setDutyRealized(state, '2026-08-24', first.id, true, now);
  setDutyRestriction(state, { employeeId: first.id, date: '2026-08-26', type: 'planning_block' }, now);
  const primaryId = state.activeDutyScheduleId;
  const other = createDutySchedule(state, 'Інший пост', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({
    employeeId: employee.id, total: 0, realized: 0,
  })), null, now);
  setDutyAssignment(state, { date: '2026-08-24', employeeIds: [first.id, second.id] }, now);
  switchDutySchedule(state, primaryId, now);

  setDutyWeekLocked(state, '2026-08-27', true, now);
  assert.throws(() => clearDutyWeek(state, '2026-08-27', now), /заблоковано/);
  assert.ok(state.duties.assignments['2026-08-24']);
  setDutyWeekLocked(state, '2026-08-27', false, now);
  const result = clearDutyWeek(state, '2026-08-27', now);
  assert.deepEqual(result, {
    weekStart: '2026-08-24', endDate: '2026-08-30',
    mode: 'all',
    removedDays: 2, removedDuties: 4, removedRealized: 1,
  });
  assert.equal(state.duties.assignments['2026-08-24'], undefined);
  assert.equal(state.duties.assignments['2026-08-30'], undefined);
  assert.ok(state.duties.assignments['2026-08-23']);
  assert.ok(state.duties.planningBlocks[recordKey(first.id, '2026-08-26')]);
  switchDutySchedule(state, other.id, now);
  assert.ok(state.duties.assignments['2026-08-24']);
});

test('очищення лише автоматичних призначень зберігає ручне закріплення і його реалізацію', () => {
  const now = localDate(2026, 7, 20, 9, 0);
  const state = defaultState(now);
  const employees = ['Анна', 'Богдан', 'Віра', 'Ганна']
    .map((name) => createEmployee(state, name, now));
  initializeDutyHistory(state, employees.map((employee) => ({
    employeeId: employee.id, total: 0, realized: 0,
  })), null, now);
  toggleDutyAssignment(state, employees[0].id, '2026-08-24', now);
  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-25' }, now);
  setDutyRealized(state, '2026-08-24', employees[0].id, true, now);
  const realizedAutoId = state.duties.assignments['2026-08-25'].employeeIds[0];
  setDutyRealized(state, '2026-08-25', realizedAutoId, true, now);
  const result = clearDutyWeek(state, '2026-08-24', now, 'generated');
  assert.equal(result.mode, 'generated');
  assert.equal(result.removedDays, 2);
  assert.equal(result.removedDuties, 2);
  assert.equal(result.removedRealized, 0);
  assert.deepEqual(state.duties.assignments['2026-08-24'].employeeIds, [employees[0].id]);
  assert.deepEqual(state.duties.assignments['2026-08-24'].realizedEmployeeIds, [employees[0].id]);
  assert.equal(state.duties.assignments['2026-08-24'].source, 'manual');
  assert.deepEqual(state.duties.assignments['2026-08-25'].employeeIds, [realizedAutoId]);
  assert.deepEqual(state.duties.assignments['2026-08-25'].realizedEmployeeIds, [realizedAutoId]);
  assert.equal(state.duties.assignments['2026-08-25'].source, 'manual');
  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-25' }, now);
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.includes(employees[0].id), true);
  assert.equal(state.duties.assignments['2026-08-25'].employeeIds.includes(realizedAutoId), true);
});

test('разовий виняток дозволяє порушити правило лише у вибраний день', () => {
  const now = localDate(2026, 7, 24, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Один', now);
  const second = createEmployee(state, 'Два', now);
  initializeDutyHistory(state, [first, second].map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })), null, now);
  setDutyAssignment(state, { date: '2026-08-24', employeeIds: [first.id, second.id] }, now);

  const withoutException = previewDutySchedule(state, { startDate: '2026-08-25', endDate: '2026-08-25' }, now);
  assert.equal(withoutException.assignments[0].employeeIds.length, 0);
  setDutyDayException(state, '2026-08-25', { allowConsecutiveDay: true, note: 'Разова потреба' }, now);
  const withException = previewDutySchedule(state, { startDate: '2026-08-25', endDate: '2026-08-25' }, now);
  assert.equal(withException.assignments[0].employeeIds.length, 2);
  assert.equal(state.duties.dayExceptions['2026-08-26'], undefined);
});

test('налаштування часу справді керують автоматичним закриттям дня', () => {
  const createdAt = localDate(2026, 7, 24, 9, 0);
  const state = defaultState(createdAt);
  const employee = createEmployee(state, 'Контроль часу', createdAt);
  updateSettings(state, { closeHour: 10, closeMinute: 30, automaticClose: false }, createdAt);
  assert.equal(ensureAutomaticMisses(state, localDate(2026, 7, 24, 11, 0)), 0);
  assert.equal(state.records[recordKey(employee.id, '2026-08-24')], undefined);

  updateSettings(state, { automaticClose: true }, localDate(2026, 7, 24, 11, 1));
  assert.equal(ensureAutomaticMisses(state, localDate(2026, 7, 24, 11, 1)), 1);
  assert.equal(state.records[recordKey(employee.id, '2026-08-24')].status, STATUS.MISSED);
});

test('вигляд ЛАД зберігається після повторного читання бази без зміни облікових даних', () => {
  const now = localDate(2026, 9, 2, 12, 0);
  const state = defaultState(now);
  const employee = createEmployee(state, 'Тестовий працівник', now);
  recordSubmission(state, { employeeId: employee.id, requestCount: 1, documentRef: 'ЛАД-1' }, now);
  const facts = clone({ employees: state.employees, records: state.records, receipts: state.receipts, dutySchedules: state.dutySchedules });
  updateSettings(state, { interfaceTheme: 'light', interfaceDensity: 'compact', interfaceTextSize: 'large' }, now);
  const restored = normalizeState(clone(state), now);
  assert.equal(restored.settings.interfaceTheme, 'light');
  assert.equal(restored.settings.interfaceDensity, 'compact');
  assert.equal(restored.settings.interfaceTextSize, 'large');
  assert.deepEqual({ employees: restored.employees, records: restored.records, receipts: restored.receipts, dutySchedules: restored.dutySchedules }, facts);
});

test('стара база та невідомі параметри вигляду отримують безпечний стандартний інтерфейс', () => {
  const now = localDate(2026, 9, 2, 12, 0);
  const legacy = defaultState(now);
  const employee = createEmployee(legacy, 'Зі старої бази', now);
  setManualStatus(legacy, { employeeId: employee.id, date: '2026-10-02', status: STATUS.OTHER_TASKS }, now);
  for (const key of ['interfaceTheme', 'interfaceDensity', 'interfaceTextSize']) delete legacy.settings[key];
  const restored = normalizeState(legacy, now);
  assert.equal(restored.settings.interfaceTheme, 'navy');
  assert.equal(restored.settings.interfaceDensity, 'comfortable');
  assert.equal(restored.settings.interfaceTextSize, 'standard');
  assert.deepEqual(restored.records, legacy.records);
  updateSettings(restored, { interfaceTheme: '<script>', interfaceDensity: null, interfaceTextSize: 'unknown' }, now);
  assert.equal(restored.settings.interfaceTheme, 'navy');
  assert.equal(restored.settings.interfaceDensity, 'comfortable');
  assert.equal(restored.settings.interfaceTextSize, 'standard');
});

test('аналітика справедливості показує навантаження, відпочинок і повтори пар', () => {
  const now = localDate(2026, 7, 24, 9, 0);
  const state = defaultState(now);
  const first = createEmployee(state, 'Анна', now);
  const second = createEmployee(state, 'Богдан', now);
  const third = createEmployee(state, 'Віра', now);
  initializeDutyHistory(state, [first, second, third].map((employee) => ({ employeeId: employee.id, total: 0, realized: 0 })), null, now);
  setDutyAssignment(state, { date: '2026-08-24', employeeIds: [first.id, second.id] }, now);
  setDutyAssignment(state, { date: '2026-08-27', employeeIds: [first.id, second.id] }, now);
  setDutyAssignment(state, { date: '2026-08-30', employeeIds: [first.id, third.id] }, now);

  const fairness = calculateDutyFairness(state, { startDate: '2026-08-24', endDate: '2026-08-30' });
  assert.equal(fairness.rows.find((row) => row.employeeId === first.id).total, 3);
  assert.equal(fairness.rows.find((row) => row.employeeId === first.id).averageRestDays, 2);
  assert.equal(fairness.pairs[0].count, 2);
  assert.equal(fairness.repeatedPairCount, 1);
});
