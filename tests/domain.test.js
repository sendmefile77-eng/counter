const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  allocateReceiptBackward,
  allocateReceiptForward,
  calculateDutyStatistics,
  calculateStatistics,
  createEmployee,
  defaultState,
  ensureAutomaticMisses,
  generateDutySchedule,
  initializeDutyHistory,
  normalizeState,
  archiveEmployee,
  recordKey,
  recordSubmission,
  restoreEmployee,
  setDutyAssignment,
  setDutyRealized,
  setDutyRestriction,
  setManualStatus,
  setWorkdayOverride,
} = require('../src/shared/domain');

function localDate(year, monthIndex, day, hour = 9, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

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

test('«А» блокує чергування в цей і наступний день, а один черговий потребує дозволу', () => {
  const state = defaultState(localDate(2026, 7, 20, 9, 0));
  const first = createEmployee(state, 'Данило', localDate(2026, 7, 20, 9, 0));
  const second = createEmployee(state, 'Євген', localDate(2026, 7, 20, 9, 0));
  const third = createEmployee(state, 'Жанна', localDate(2026, 7, 20, 9, 0));
  setDutyRestriction(state, { employeeId: first.id, date: '2026-08-24', type: 'a' });

  generateDutySchedule(state, { startDate: '2026-08-24', endDate: '2026-08-25' });
  assert.equal(state.duties.assignments['2026-08-24'].employeeIds.includes(first.id), false);
  assert.equal(state.duties.assignments['2026-08-25'].employeeIds.includes(first.id), false);
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

  setDutyRealized(state, '2026-08-26', second.id, true);
  const stats = calculateDutyStatistics(state);
  assert.equal(stats.find((row) => row.employeeId === second.id).realized, 1);
  assert.ok(third.id);
});

test('база попередньої версії автоматично отримує нові поля без втрати записів', () => {
  const oldState = defaultState(localDate(2026, 7, 20, 9, 0));
  const employee = createEmployee(oldState, 'Зоряна', localDate(2026, 7, 20, 9, 0));
  delete oldState.duties;
  delete oldState.workdayOverrides;
  oldState.schemaVersion = 1;

  const normalized = normalizeState(oldState);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.employees[0].id, employee.id);
  assert.deepEqual(normalized.workdayOverrides, {});
  assert.equal(normalized.duties.initialized, false);
  assert.deepEqual(normalized.duties.assignments, {});
});
