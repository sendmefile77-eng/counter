const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  allocateReceiptBackward,
  allocateReceiptForward,
  calculateDutyStatistics,
  calculateStatistics,
  clearDutyRestriction,
  clone,
  createEmployee,
  defaultState,
  ensureAutomaticMisses,
  generateDutySchedule,
  initializeDutyHistory,
  normalizeState,
  archiveEmployee,
  recordKey,
  recordSubmission,
  removeDutyAssignment,
  restoreEmployee,
  setDutyAssignment,
  setDutyRealized,
  setDutyRestriction,
  setManualStatus,
  setWorkdayOverride,
  toggleDutyAssignment,
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

test('після «А» чергування дозволене, але «А» після чергування заборонена', () => {
  const state = defaultState(localDate(2026, 7, 20, 9, 0));
  const first = createEmployee(state, 'Данило', localDate(2026, 7, 20, 9, 0));
  const second = createEmployee(state, 'Євген', localDate(2026, 7, 20, 9, 0));
  const third = createEmployee(state, 'Жанна', localDate(2026, 7, 20, 9, 0));
  initializeDutyHistory(state, [first, second, third].map((employee) => ({
    employeeId: employee.id,
    total: 0,
    realized: 0,
  })));
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
  delete oldState.workdayOverrides;
  oldState.schemaVersion = 1;

  const normalized = normalizeState(oldState, localDate(2026, 7, 20, 9, 0));
  assert.equal(normalized.schemaVersion, 5);
  assert.equal(normalized.employees[0].id, employee.id);
  assert.deepEqual(normalized.workdayOverrides, {});
  assert.equal(normalized.duties.initialized, false);
  assert.deepEqual(normalized.duties.assignments, {});
  assert.deepEqual(normalized.duties.planningBlocks, {});
  assert.deepEqual(normalized.duties.participantIds, [employee.id]);
  assert.equal(normalized.duties.baselineYear, '2026');
  assert.equal(normalized.duties.baselineThroughDate, '2026-08-23');
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

test('точна модель не ставить працівника у два сусідні календарні вікенди', () => {
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

  const result = generateDutySchedule(state, {
    startDate: '2026-08-24',
    endDate: '2026-08-30',
  }, now);
  const previousWeekend = new Set(employees.slice(0, 4).map((employee) => employee.id));
  const saturday = new Set(state.duties.assignments['2026-08-29'].employeeIds);
  const sunday = new Set(state.duties.assignments['2026-08-30'].employeeIds);

  assert.equal([...saturday, ...sunday].some((employeeId) => previousWeekend.has(employeeId)), false);
  assert.equal([...saturday].some((employeeId) => sunday.has(employeeId)), false);
  assert.deepEqual(result.weekendConflicts, []);

  const followingResult = generateDutySchedule(state, {
    startDate: '2026-08-31',
    endDate: '2026-09-06',
  }, now);
  const currentWeekend = new Set([...saturday, ...sunday]);
  const followingWeekend = [
    ...state.duties.assignments['2026-09-05'].employeeIds,
    ...state.duties.assignments['2026-09-06'].employeeIds,
  ];
  assert.equal(followingWeekend.some((employeeId) => currentWeekend.has(employeeId)), false);
  assert.deepEqual(followingResult.weekendConflicts, []);
});

test('якщо правила вихідних математично несумісні, генератор зберігає добову ротацію і повідомляє конфлікт', () => {
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
  const saturday = new Set(state.duties.assignments['2026-08-29'].employeeIds);
  const sunday = new Set(state.duties.assignments['2026-08-30'].employeeIds);
  assert.equal([...saturday].some((employeeId) => sunday.has(employeeId)), false);
  assert.equal(result.weekendConflicts.filter((item) => item.type === 'consecutive_weekends').length, 4);
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
  assert.equal(state.duties.assignments['2026-08-24'], undefined);
});
