const crypto = require('node:crypto');

const SCHEMA_VERSION = 5;

const STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  SUBMITTED_LATE: 'submitted_late',
  SUBMITTED_ADVANCE: 'submitted_advance',
  MISSED: 'missed',
  OTHER_TASKS: 'other_tasks',
  PERSONAL_PERMISSION: 'personal_permission',
  SICK: 'sick',
  VACATION: 'vacation',
  DAY_OFF: 'day_off',
  HOLIDAY: 'holiday',
});

const STATUS_LABELS = Object.freeze({
  [STATUS.SUBMITTED]: 'Подав вчасно',
  [STATUS.SUBMITTED_LATE]: 'Подав із запізненням',
  [STATUS.SUBMITTED_ADVANCE]: 'Зараховано наперед',
  [STATUS.MISSED]: 'Не подав',
  [STATUS.OTHER_TASKS]: 'Залучений до інших завдань',
  [STATUS.PERSONAL_PERMISSION]: 'Відпущений в особистих справах',
  [STATUS.SICK]: 'Лікарняний',
  [STATUS.VACATION]: 'Відпустка',
  [STATUS.DAY_OFF]: 'Відгул',
  [STATUS.HOLIDAY]: 'Вихідний або святковий день',
});

const MANUAL_STATUSES = new Set([
  STATUS.SUBMITTED,
  STATUS.MISSED,
  STATUS.OTHER_TASKS,
  STATUS.PERSONAL_PERMISSION,
  STATUS.SICK,
  STATUS.VACATION,
  STATUS.DAY_OFF,
  STATUS.HOLIDAY,
]);

const SUBMITTED_STATUSES = new Set([
  STATUS.SUBMITTED,
  STATUS.SUBMITTED_LATE,
  STATUS.SUBMITTED_ADVANCE,
]);

const DUTY_UNAVAILABLE_TYPES = new Set([
  'off',
  'vacation',
  'sick',
  'day_off',
  'personal',
  'other',
]);

const DUTY_BLOCKING_RECORD_STATUSES = new Set([
  STATUS.PERSONAL_PERMISSION,
  STATUS.SICK,
  STATUS.VACATION,
  STATUS.DAY_OFF,
  STATUS.HOLIDAY,
]);

function dateKeyFromDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assertDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error('Некоректна дата. Очікується формат РРРР-ММ-ДД.');
  }
}

function dateKeyToUtc(value) {
  assertDateKey(value);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcToDateKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(dateKey, amount) {
  const date = dateKeyToUtc(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcToDateKey(date);
}

function dayOfWeek(dateKey) {
  return dateKeyToUtc(dateKey).getUTCDay();
}

function endOfCalendarWeek(dateKey) {
  const day = dayOfWeek(dateKey);
  return addDays(dateKey, day === 0 ? 0 : 7 - day);
}

function previousYearEnd(year) {
  return `${Number(year) - 1}-12-31`;
}

function recordKey(employeeId, dateKey) {
  return `${employeeId}|${dateKey}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultState(now = new Date()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    employees: [],
    records: {},
    receipts: [],
    workdayOverrides: {},
    duties: {
      initialized: false,
      participantIds: [],
      baselineYear: String(now.getFullYear()),
      baselineThroughDate: endOfCalendarWeek(dateKeyFromDate(now)),
      baselines: {},
      assignments: {},
      aDays: {},
      unavailable: {},
      planningBlocks: {},
    },
    settings: {
      closeHour: 18,
      closeMinute: 0,
      workdays: [1, 2, 3, 4, 5],
      alwaysOnTop: true,
      widgetSize: 380,
      widgetPosition: null,
    },
    audit: [{
      id: crypto.randomUUID(),
      at: now.toISOString(),
      action: 'database_created',
      details: {},
    }],
  };
}

function normalizeState(input, now = new Date()) {
  if (!input || typeof input !== 'object') {
    throw new Error('Файл не містить коректної бази даних.');
  }

  const state = defaultState(now);
  state.schemaVersion = SCHEMA_VERSION;
  state.employees = Array.isArray(input.employees) ? input.employees : [];
  state.records = input.records && typeof input.records === 'object' ? input.records : {};
  state.receipts = Array.isArray(input.receipts) ? input.receipts : [];
  state.workdayOverrides = input.workdayOverrides && typeof input.workdayOverrides === 'object'
    ? input.workdayOverrides
    : {};
  const currentYear = String(now.getFullYear());
  const inputBaselineYear = /^\d{4}$/.test(input.duties?.baselineYear || '')
    ? input.duties.baselineYear
    : currentYear;
  const inputBaselineThroughDate = /^\d{4}-\d{2}-\d{2}$/.test(input.duties?.baselineThroughDate || '')
    && (input.duties.baselineThroughDate.startsWith(`${inputBaselineYear}-`)
      || input.duties.baselineThroughDate === previousYearEnd(inputBaselineYear))
    ? input.duties.baselineThroughDate
    : (inputBaselineYear === currentYear
      ? endOfCalendarWeek(dateKeyFromDate(now))
      : `${inputBaselineYear}-12-31`);
  state.duties = {
    ...state.duties,
    ...(input.duties && typeof input.duties === 'object' ? input.duties : {}),
    baselines: input.duties?.baselines && typeof input.duties.baselines === 'object'
      ? input.duties.baselines
      : {},
    assignments: input.duties?.assignments && typeof input.duties.assignments === 'object'
      ? input.duties.assignments
      : {},
    aDays: input.duties?.aDays && typeof input.duties.aDays === 'object'
      ? input.duties.aDays
      : {},
    unavailable: input.duties?.unavailable && typeof input.duties.unavailable === 'object'
      ? input.duties.unavailable
      : {},
    planningBlocks: input.duties?.planningBlocks && typeof input.duties.planningBlocks === 'object'
      ? input.duties.planningBlocks
      : {},
    participantIds: Array.isArray(input.duties?.participantIds)
      ? input.duties.participantIds
      : state.employees.map((employee) => employee.id),
    baselineYear: inputBaselineYear,
    baselineThroughDate: inputBaselineThroughDate,
  };
  state.audit = Array.isArray(input.audit) ? input.audit.slice(-5000) : [];
  state.settings = {
    ...state.settings,
    ...(input.settings && typeof input.settings === 'object' ? input.settings : {}),
    closeHour: 18,
    closeMinute: 0,
  };

  const ids = new Set();
  for (const employee of state.employees) {
    if (!employee.id || !employee.name || ids.has(employee.id)) {
      throw new Error('У файлі є працівник без імені або з дубльованим ідентифікатором.');
    }
    assertDateKey(employee.createdDate);
    if (!Array.isArray(employee.activePeriods) || employee.activePeriods.length === 0) {
      employee.activePeriods = [{ start: employee.createdDate, end: employee.archivedDate || null }];
    }
    ids.add(employee.id);
  }

  if (state.employees.filter((employee) => employee.active).length > 15) {
    throw new Error('Одночасно може бути не більше 15 активних працівників.');
  }
  const inactiveParticipantIds = new Set(
    [...new Set(state.duties.participantIds)]
      .filter((employeeId) => ids.has(employeeId))
      .filter((employeeId) => !state.employees.find((employee) => employee.id === employeeId)?.active),
  );
  state.duties.participantIds = [...new Set(state.duties.participantIds)]
    .filter((employeeId) => ids.has(employeeId) && !inactiveParticipantIds.has(employeeId));
  removeEmployeesFromFutureDutyAssignments(
    state,
    inactiveParticipantIds,
    dateKeyFromDate(now),
    now,
    'participant_archived',
  );

  return state;
}

function appendAudit(state, action, details, now = new Date()) {
  state.audit.push({
    id: crypto.randomUUID(),
    at: now.toISOString(),
    action,
    details: clone(details || {}),
  });
  if (state.audit.length > 5000) {
    state.audit = state.audit.slice(-5000);
  }
}

function createEmployee(state, name, now = new Date()) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2) {
    throw new Error('Вкажіть ім’я працівника.');
  }
  if (state.employees.filter((employee) => employee.active).length >= 15) {
    throw new Error('У віджеті вже є 15 активних працівників.');
  }
  if (state.employees.some((employee) => employee.active && employee.name.toLocaleLowerCase('uk-UA') === cleanName.toLocaleLowerCase('uk-UA'))) {
    throw new Error('Працівник із таким ім’ям уже є у списку.');
  }

  const employee = {
    id: crypto.randomUUID(),
    name: cleanName,
    active: true,
    createdDate: dateKeyFromDate(now),
    createdAt: now.toISOString(),
    archivedDate: null,
    archivedAt: null,
    activePeriods: [{ start: dateKeyFromDate(now), end: null }],
  };
  state.employees.push(employee);
  appendAudit(state, 'employee_created', { employeeId: employee.id, name: employee.name }, now);
  return employee;
}

function removeEmployeesFromFutureDutyAssignments(
  state,
  removedIds,
  fromDate,
  now,
  source,
) {
  if (!removedIds?.size) return [];
  const affectedDates = [];
  for (const [date, assignment] of Object.entries(state.duties.assignments)) {
    if (date < fromDate || !(assignment.employeeIds || []).some((id) => removedIds.has(id))) continue;
    const employeeIds = (assignment.employeeIds || []).filter((id) => !removedIds.has(id));
    state.duties.assignments[date] = {
      ...assignment,
      employeeIds,
      realizedEmployeeIds: (assignment.realizedEmployeeIds || [])
        .filter((id) => employeeIds.includes(id)),
      singleApproved: false,
      source,
      manualEmployeeIds: (assignment.manualEmployeeIds || [])
        .filter((id) => employeeIds.includes(id)),
      updatedAt: now.toISOString(),
    };
    affectedDates.push(date);
  }
  return affectedDates;
}

function archiveEmployee(state, employeeId, now = new Date()) {
  const employee = getEmployee(state, employeeId);
  employee.active = false;
  employee.archivedDate = dateKeyFromDate(now);
  employee.archivedAt = now.toISOString();
  const openPeriod = employee.activePeriods.findLast((period) => !period.end);
  if (openPeriod) openPeriod.end = employee.archivedDate;
  state.duties.participantIds = (state.duties.participantIds || [])
    .filter((id) => id !== employeeId);
  const affectedDutyDates = removeEmployeesFromFutureDutyAssignments(
    state,
    new Set([employeeId]),
    employee.archivedDate,
    now,
    'participant_archived',
  );
  appendAudit(state, 'employee_archived', { employeeId, affectedDutyDates }, now);
  return employee;
}

function restoreEmployee(state, employeeId, now = new Date()) {
  if (state.employees.filter((employee) => employee.active).length >= 15) {
    throw new Error('Спочатку приберіть одного з 15 активних працівників.');
  }
  const employee = getEmployee(state, employeeId);
  employee.active = true;
  employee.archivedDate = null;
  employee.archivedAt = null;
  employee.activePeriods.push({ start: dateKeyFromDate(now), end: null });
  appendAudit(state, 'employee_restored', { employeeId }, now);
  return employee;
}

function getEmployee(state, employeeId) {
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) {
    throw new Error('Працівника не знайдено.');
  }
  return employee;
}

function employeeExistsOnDate(employee, dateKey) {
  if (Array.isArray(employee.activePeriods) && employee.activePeriods.length) {
    return employee.activePeriods.some((period) => (
      dateKey >= period.start && (!period.end || dateKey < period.end)
    ));
  }
  if (dateKey < employee.createdDate) return false;
  return !employee.archivedDate || dateKey < employee.archivedDate;
}

function isWorkday(state, dateKey) {
  return state.settings.workdays.includes(dayOfWeek(dateKey));
}

function isEmployeeWorkday(state, employeeId, dateKey) {
  return isWorkday(state, dateKey) || Boolean(state.workdayOverrides[recordKey(employeeId, dateKey)]);
}

function setWorkdayOverride(state, employeeId, date, note = '', now = new Date()) {
  const employee = getEmployee(state, employeeId);
  assertDateKey(date);
  if (isWorkday(state, date)) {
    throw new Error('Ця дата вже є звичайним робочим днем.');
  }
  if (date >= employee.createdDate && !employeeExistsOnDate(employee, date)) {
    throw new Error('Дата не входить до періоду обліку цього працівника.');
  }
  const key = recordKey(employeeId, date);
  state.workdayOverrides[key] = {
    employeeId,
    date,
    note: String(note || '').trim(),
    createdAt: now.toISOString(),
  };
  appendAudit(state, 'weekend_made_workday', { employeeId, date }, now);
  return state.workdayOverrides[key];
}

function clearWorkdayOverride(state, employeeId, date, now = new Date()) {
  const key = recordKey(employeeId, date);
  if (!state.workdayOverrides[key]) return false;
  const record = state.records[key];
  if (record?.receiptId) {
    throw new Error('За цей день уже зараховано запит. Спочатку скасуйте зарахування.');
  }
  if (record) delete state.records[key];
  delete state.workdayOverrides[key];
  appendAudit(state, 'workday_returned_to_weekend', { employeeId, date }, now);
  return true;
}

function isPastCloseTime(state, now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= state.settings.closeHour * 60 + state.settings.closeMinute;
}

function ensureAutomaticMisses(state, now = new Date()) {
  const today = dateKeyFromDate(now);
  const closeThrough = isPastCloseTime(state, now) ? today : addDays(today, -1);
  let created = 0;

  for (const employee of state.employees) {
    let cursor = employee.createdDate;
    while (cursor <= closeThrough) {
      if (employeeExistsOnDate(employee, cursor) && isEmployeeWorkday(state, employee.id, cursor)) {
        const key = recordKey(employee.id, cursor);
        if (!state.records[key]) {
          state.records[key] = {
            employeeId: employee.id,
            date: cursor,
            status: STATUS.MISSED,
            source: 'automatic_close',
            recordedAt: now.toISOString(),
            note: '',
            receiptId: null,
          };
          created += 1;
        }
      }
      cursor = addDays(cursor, 1);
    }
  }

  if (created > 0) {
    appendAudit(state, 'automatic_close', { created, closeThrough }, now);
  }
  return created;
}

function isSubmitted(status) {
  return SUBMITTED_STATUSES.has(status);
}

function setManualStatus(state, { employeeId, date, status, note = '' }, now = new Date()) {
  getEmployee(state, employeeId);
  assertDateKey(date);
  if (!MANUAL_STATUSES.has(status)) {
    throw new Error('Цей статус не можна встановити вручну.');
  }
  if (status === STATUS.SUBMITTED && date > dateKeyFromDate(now)) {
    throw new Error('Не можна вручну позначити майбутній день як поданий.');
  }
  if (DUTY_BLOCKING_RECORD_STATUSES.has(status)
    && state.duties.assignments[date]?.employeeIds?.includes(employeeId)) {
    throw new Error('Працівник призначений черговим на цю дату. Спочатку змініть графік чергувань.');
  }
  const key = recordKey(employeeId, date);
  const previous = state.records[key];
  if (previous?.receiptId) {
    throw new Error('День уже пов’язаний із запитом. Спочатку скасуйте зарахування.');
  }
  state.records[key] = {
    employeeId,
    date,
    status,
    source: 'manual',
    recordedAt: now.toISOString(),
    note: String(note || '').trim(),
    receiptId: null,
  };
  appendAudit(state, 'status_set', { employeeId, date, status }, now);
  return state.records[key];
}

function clearManualRecord(state, employeeId, date, now = new Date()) {
  const key = recordKey(employeeId, date);
  const previous = state.records[key];
  if (!previous) return false;
  if (previous.receiptId) {
    throw new Error('Цей запис створений зарахуванням запиту і не може бути очищений окремо.');
  }
  delete state.records[key];
  appendAudit(state, 'status_cleared', { employeeId, date }, now);
  return true;
}

function recordSubmission(state, input, now = new Date()) {
  const employee = getEmployee(state, input.employeeId);
  if (!employee.active) {
    throw new Error('Працівник перебуває в архіві.');
  }
  const actualRequestCount = Number(input.requestCount);
  if (!Number.isInteger(actualRequestCount) || actualRequestCount < 1 || actualRequestCount > 100) {
    throw new Error('Кількість запитів має бути цілим числом від 1 до 100.');
  }

  ensureAutomaticMisses(state, now);
  const today = dateKeyFromDate(now);
  const complexityBonus = input.complexTwoDay ? 1 : 0;
  let remaining = actualRequestCount + complexityBonus;
  const receipt = {
    id: crypto.randomUUID(),
    employeeId: employee.id,
    receivedDate: today,
    receivedAt: now.toISOString(),
    actualRequestCount,
    creditUnits: remaining,
    complexTwoDay: Boolean(input.complexTwoDay),
    documentRef: String(input.documentRef || '').trim(),
    note: String(input.note || '').trim(),
    allocations: [],
    unallocatedCredit: remaining,
  };

  const allocate = (date, status, allocationType) => {
    const key = recordKey(employee.id, date);
    const previousRecord = state.records[key] ? clone(state.records[key]) : null;
    state.records[key] = {
      employeeId: employee.id,
      date,
      status,
      source: 'receipt',
      receiptId: receipt.id,
      receivedDate: today,
      recordedAt: now.toISOString(),
      note: receipt.note,
      documentRef: receipt.documentRef,
      complexTwoDay: receipt.complexTwoDay,
    };
    receipt.allocations.push({ date, allocationType, previousRecord });
    remaining -= 1;
  };

  if (isEmployeeWorkday(state, employee.id, today) && employeeExistsOnDate(employee, today)) {
    const current = state.records[recordKey(employee.id, today)];
    if (!current || current.status === STATUS.MISSED) {
      const late = current?.status === STATUS.MISSED || isPastCloseTime(state, now);
      allocate(today, late ? STATUS.SUBMITTED_LATE : STATUS.SUBMITTED, late ? 'late_current' : 'current');
    }
  }

  let cursor = addDays(today, -1);
  while (remaining > 0 && cursor >= employee.createdDate) {
    const previous = state.records[recordKey(employee.id, cursor)];
    if (previous?.status === STATUS.MISSED) {
      allocate(cursor, STATUS.SUBMITTED_LATE, 'nearest_previous_gap');
    }
    cursor = addDays(cursor, -1);
  }

  receipt.unallocatedCredit = remaining;
  state.receipts.push(receipt);
  appendAudit(state, 'receipt_recorded', {
    employeeId: employee.id,
    receiptId: receipt.id,
    actualRequestCount,
    complexityBonus,
    allocations: receipt.allocations.map((item) => item.date),
    unallocatedCredit: remaining,
  }, now);
  return receipt;
}

function allocateReceiptForward(state, receiptId, requestedUnits, now = new Date()) {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) throw new Error('Запис про документ не знайдено.');
  const employee = getEmployee(state, receipt.employeeId);
  const units = Number(requestedUnits);
  if (!Number.isInteger(units) || units < 1 || units > receipt.unallocatedCredit) {
    throw new Error('Некоректна кількість днів для зарахування наперед.');
  }

  const today = dateKeyFromDate(now);
  let cursor = addDays(today, 1);
  let remaining = units;
  let inspected = 0;
  while (remaining > 0 && inspected < 730) {
    const key = recordKey(employee.id, cursor);
    if (isEmployeeWorkday(state, employee.id, cursor) && !state.records[key]) {
      state.records[key] = {
        employeeId: employee.id,
        date: cursor,
        status: STATUS.SUBMITTED_ADVANCE,
        source: 'receipt',
        receiptId: receipt.id,
        receivedDate: receipt.receivedDate,
        recordedAt: now.toISOString(),
        note: receipt.note,
        documentRef: receipt.documentRef,
        complexTwoDay: receipt.complexTwoDay,
      };
      receipt.allocations.push({ date: cursor, allocationType: 'approved_future', previousRecord: null });
      receipt.unallocatedCredit -= 1;
      remaining -= 1;
    }
    cursor = addDays(cursor, 1);
    inspected += 1;
  }

  if (remaining > 0) {
    throw new Error('Не вдалося знайти достатньо вільних майбутніх робочих днів.');
  }
  appendAudit(state, 'future_allocation_approved', { receiptId, units }, now);
  return receipt;
}

function allocateReceiptBackward(state, receiptId, requestedUnits, now = new Date()) {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) throw new Error('Запис про документ не знайдено.');
  const employee = getEmployee(state, receipt.employeeId);
  const units = Number(requestedUnits);
  if (!Number.isInteger(units) || units < 1 || units > receipt.unallocatedCredit) {
    throw new Error('Некоректна кількість днів для зарахування назад.');
  }

  const today = dateKeyFromDate(now);
  let cursor = addDays(today, -1);
  let remaining = units;
  let inspected = 0;
  while (remaining > 0 && inspected < 3650) {
    const key = recordKey(employee.id, cursor);
    const existing = state.records[key];
    const beforeTrackingStarted = cursor < employee.createdDate;
    const validExistingPeriod = employeeExistsOnDate(employee, cursor);
    const available = !existing || existing.status === STATUS.MISSED;

    if (isEmployeeWorkday(state, employee.id, cursor) && available && (beforeTrackingStarted || validExistingPeriod)) {
      const previousRecord = existing ? clone(existing) : null;
      if (beforeTrackingStarted) {
        employee.createdDate = cursor;
        const earliestPeriod = [...employee.activePeriods].sort((a, b) => a.start.localeCompare(b.start))[0];
        if (earliestPeriod && cursor < earliestPeriod.start) earliestPeriod.start = cursor;
      }
      state.records[key] = {
        employeeId: employee.id,
        date: cursor,
        status: STATUS.SUBMITTED_LATE,
        source: 'receipt',
        receiptId: receipt.id,
        receivedDate: receipt.receivedDate,
        recordedAt: now.toISOString(),
        note: receipt.note,
        documentRef: receipt.documentRef,
        complexTwoDay: receipt.complexTwoDay,
      };
      receipt.allocations.push({ date: cursor, allocationType: 'approved_past', previousRecord });
      receipt.unallocatedCredit -= 1;
      remaining -= 1;
    }
    cursor = addDays(cursor, -1);
    inspected += 1;
  }

  if (remaining > 0) {
    throw new Error('Не вдалося знайти достатньо вільних минулих робочих днів.');
  }
  appendAudit(state, 'past_allocation_approved', { receiptId, units }, now);
  return receipt;
}

function dutyRestriction(state, employeeId, date) {
  const employee = getEmployee(state, employeeId);
  assertDateKey(date);
  if (!state.duties.participantIds.includes(employeeId)) return 'not_participant';
  if (date >= employee.createdDate && !employeeExistsOnDate(employee, date)) return 'outside_period';
  const key = recordKey(employeeId, date);
  if (state.duties.aDays[key]) return 'a_day';
  if (state.duties.aDays[recordKey(employeeId, addDays(date, 1))]) return 'before_a';
  if (state.duties.planningBlocks[key]) return 'planning_block';
  if (state.duties.unavailable[key]) return state.duties.unavailable[key].type;
  const record = state.records[key];
  if (record && DUTY_BLOCKING_RECORD_STATUSES.has(record.status)) return record.status;
  return null;
}

function initializeDutyHistory(state, entries, participantIds = null, now = new Date()) {
  if (!Array.isArray(entries)) throw new Error('Не передано початкові дані чергувань.');
  const selectedIds = [...new Set(
    (Array.isArray(participantIds) ? participantIds : entries.map((entry) => entry.employeeId)).filter(Boolean),
  )];
  if (selectedIds.length === 0) throw new Error('Оберіть хоча б одного учасника чергувань.');
  for (const employeeId of selectedIds) getEmployee(state, employeeId);
  const baselines = {};
  for (const entry of entries) {
    const employee = getEmployee(state, entry.employeeId);
    const total = Number(entry.total || 0);
    const realized = Number(entry.realized || 0);
    if (!Number.isInteger(total) || total < 0 || !Number.isInteger(realized) || realized < 0) {
      throw new Error(`Кількість чергувань для «${employee.name}» має бути цілим невід’ємним числом.`);
    }
    if (realized > total) {
      throw new Error(`Реалізованих чергувань у «${employee.name}» не може бути більше за загальну кількість.`);
    }
    baselines[employee.id] = { total, realized };
  }
  const removedIds = new Set(
    (state.duties.participantIds || []).filter((employeeId) => !selectedIds.includes(employeeId)),
  );
  const today = dateKeyFromDate(now);
  const affectedDutyDates = removeEmployeesFromFutureDutyAssignments(
    state,
    removedIds,
    today,
    now,
    'participant_removed',
  );
  const baselineYear = dateKeyFromDate(now).slice(0, 4);
  const changedYear = state.duties.initialized && state.duties.baselineYear !== baselineYear;
  const keepBaselineCutoff = state.duties.initialized
    && state.duties.baselineYear === baselineYear
    && /^\d{4}-\d{2}-\d{2}$/.test(state.duties.baselineThroughDate || '');
  state.duties.baselines = state.duties.baselineYear === baselineYear
    ? { ...state.duties.baselines, ...baselines }
    : baselines;
  state.duties.baselineYear = baselineYear;
  if (!keepBaselineCutoff) {
    state.duties.baselineThroughDate = changedYear
      ? previousYearEnd(baselineYear)
      : endOfCalendarWeek(dateKeyFromDate(now));
  }
  state.duties.participantIds = selectedIds;
  state.duties.initialized = true;
  appendAudit(state, 'duty_history_initialized', {
    employees: entries.length,
    participantIds: selectedIds,
    affectedDutyDates,
  }, now);
  return state.duties;
}

function setDutyRestriction(state, { employeeId, date, type, note = '' }, now = new Date()) {
  const employee = getEmployee(state, employeeId);
  assertDateKey(date);
  if (date >= employee.createdDate && !employeeExistsOnDate(employee, date)) {
    throw new Error('Дата не входить до періоду обліку цього працівника.');
  }
  const assignment = state.duties.assignments[date];
  if (assignment?.employeeIds?.includes(employeeId)) {
    throw new Error('Спочатку змініть склад чергових на цю дату.');
  }
  const key = recordKey(employeeId, date);
  if (type === 'a') {
    const previousAssignment = state.duties.assignments[addDays(date, -1)];
    if (previousAssignment?.employeeIds?.includes(employeeId)) {
      throw new Error('Після чергування не можна встановлювати «А» на наступний день.');
    }
    state.duties.aDays[key] = {
      employeeId,
      date,
      note: String(note || '').trim(),
      createdAt: now.toISOString(),
    };
    delete state.duties.unavailable[key];
    delete state.duties.planningBlocks[key];
  } else if (type === 'planning_block') {
    state.duties.planningBlocks[key] = {
      employeeId,
      date,
      note: String(note || '').trim(),
      createdAt: now.toISOString(),
    };
    delete state.duties.aDays[key];
    delete state.duties.unavailable[key];
  } else {
    if (!DUTY_UNAVAILABLE_TYPES.has(type)) throw new Error('Некоректний тип недоступності.');
    state.duties.unavailable[key] = {
      employeeId,
      date,
      type,
      note: String(note || '').trim(),
      createdAt: now.toISOString(),
    };
    delete state.duties.aDays[key];
    delete state.duties.planningBlocks[key];
  }
  appendAudit(state, 'duty_restriction_set', { employeeId, date, type }, now);
  if (type === 'a') return state.duties.aDays[key];
  if (type === 'planning_block') return state.duties.planningBlocks[key];
  return state.duties.unavailable[key];
}

function clearDutyRestriction(state, employeeId, date, now = new Date()) {
  getEmployee(state, employeeId);
  assertDateKey(date);
  const key = recordKey(employeeId, date);
  const changed = Boolean(
    state.duties.aDays[key]
    || state.duties.unavailable[key]
    || state.duties.planningBlocks[key],
  );
  delete state.duties.aDays[key];
  delete state.duties.unavailable[key];
  delete state.duties.planningBlocks[key];
  if (changed) appendAudit(state, 'duty_restriction_cleared', { employeeId, date }, now);
  return changed;
}

function setDutyAssignment(state, { date, employeeIds, singleApproved = false }, now = new Date()) {
  assertDateKey(date);
  if (!Array.isArray(employeeIds)) throw new Error('Не передано склад чергових.');
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (ids.length > 2) throw new Error('На один день можна призначити не більше двох чергових.');
  if (ids.length === 1 && !singleApproved) {
    throw new Error('Для чергування однієї людини потрібне окреме підтвердження.');
  }
  for (const employeeId of ids) {
    const restriction = dutyRestriction(state, employeeId, date);
    if (restriction) {
      const employee = getEmployee(state, employeeId);
      throw new Error(`«${employee.name}» недоступний для чергування на цю дату.`);
    }
  }
  const previous = state.duties.assignments[date];
  if (ids.length === 0) {
    delete state.duties.assignments[date];
  } else {
    state.duties.assignments[date] = {
      date,
      employeeIds: ids,
      realizedEmployeeIds: (previous?.realizedEmployeeIds || []).filter((id) => ids.includes(id)),
      singleApproved: ids.length === 1 && Boolean(singleApproved),
      source: 'manual',
      updatedAt: now.toISOString(),
    };
  }
  appendAudit(state, 'duty_assignment_set', { date, employeeIds: ids, singleApproved }, now);
  return state.duties.assignments[date] || { date, employeeIds: [], cleared: true };
}

function toggleDutyAssignment(state, employeeId, date, now = new Date()) {
  const employee = getEmployee(state, employeeId);
  assertDateKey(date);
  if (!state.duties.participantIds.includes(employeeId)) {
    throw new Error('Працівник не входить до складу учасників чергувань.');
  }
  const previous = state.duties.assignments[date];
  const ids = [...(previous?.employeeIds || [])];
  const existingIndex = ids.indexOf(employeeId);
  if (existingIndex >= 0) {
    const realizedIds = new Set(previous?.realizedEmployeeIds || []);
    if (!realizedIds.has(employeeId)) {
      realizedIds.add(employeeId);
      previous.realizedEmployeeIds = [...realizedIds];
      previous.updatedAt = now.toISOString();
      appendAudit(state, 'duty_assignment_cycled', {
        employeeId,
        date,
        state: 'realized',
      }, now);
      return previous;
    }
    return removeDutyAssignment(state, employeeId, date, now, 'duty_assignment_cycled');
  } else {
    const restriction = dutyRestriction(state, employeeId, date);
    if (restriction) throw new Error(`«${employee.name}» недоступний для чергування на цю дату.`);
    if (ids.length >= 2) throw new Error('На цей день уже призначено двох чергових. Спочатку зніміть одного з них.');
    ids.push(employeeId);
  }

  if (ids.length === 0) {
    delete state.duties.assignments[date];
  } else {
    state.duties.assignments[date] = {
      date,
      employeeIds: ids,
      realizedEmployeeIds: (previous?.realizedEmployeeIds || []).filter((id) => ids.includes(id)),
      singleApproved: ids.length === 1 && existingIndex < 0 && previous?.singleApproved === true,
      source: 'manual_quick',
      updatedAt: now.toISOString(),
    };
  }
  appendAudit(state, 'duty_assignment_cycled', {
    employeeId,
    date,
    state: 'assigned',
  }, now);
  return state.duties.assignments[date] || { date, employeeIds: [], cleared: true };
}

function removeDutyAssignment(
  state,
  employeeId,
  date,
  now = new Date(),
  auditAction = 'duty_assignment_removed',
) {
  getEmployee(state, employeeId);
  assertDateKey(date);
  const previous = state.duties.assignments[date];
  if (!previous?.employeeIds?.includes(employeeId)) return false;
  const ids = previous.employeeIds.filter((id) => id !== employeeId);
  if (ids.length === 0) {
    delete state.duties.assignments[date];
  } else {
    state.duties.assignments[date] = {
      ...previous,
      employeeIds: ids,
      realizedEmployeeIds: (previous.realizedEmployeeIds || []).filter((id) => ids.includes(id)),
      singleApproved: false,
      source: 'manual_quick',
      updatedAt: now.toISOString(),
    };
  }
  appendAudit(state, auditAction, {
    employeeId,
    date,
    state: 'empty',
  }, now);
  return state.duties.assignments[date] || { date, employeeIds: [], cleared: true };
}

function setDutyRealized(state, date, employeeId, realized, now = new Date()) {
  assertDateKey(date);
  getEmployee(state, employeeId);
  const assignment = state.duties.assignments[date];
  if (!assignment?.employeeIds?.includes(employeeId)) {
    throw new Error('Працівник не призначений черговим на цю дату.');
  }
  const ids = new Set(assignment.realizedEmployeeIds || []);
  if (realized) ids.add(employeeId); else ids.delete(employeeId);
  assignment.realizedEmployeeIds = [...ids];
  assignment.updatedAt = now.toISOString();
  appendAudit(state, 'duty_realized_changed', { date, employeeId, realized: Boolean(realized) }, now);
  return assignment;
}

function dutyTotals(state, year = dateKeyFromDate().slice(0, 4), beforeDate = null) {
  if (!/^\d{4}$/.test(year || '')) throw new Error('Некоректний рік чергувань.');
  const totals = {};
  for (const employee of state.employees) {
    const baseline = state.duties.baselineYear === year
      ? state.duties.baselines[employee.id] || {}
      : {};
    totals[employee.id] = {
      total: Number(baseline.total || 0),
      realized: Number(baseline.realized || 0),
    };
  }
  const baselineThroughDate = state.duties.baselineYear === year
    ? state.duties.baselineThroughDate || previousYearEnd(year)
    : null;
  const assignments = Object.values(state.duties.assignments)
    .filter((assignment) => (
      assignment.date.startsWith(`${year}-`)
      && (!baselineThroughDate || assignment.date > baselineThroughDate)
      && (!beforeDate || assignment.date < beforeDate)
    ));
  for (const assignment of assignments) {
    for (const employeeId of assignment.employeeIds || []) {
      if (!totals[employeeId]) totals[employeeId] = { total: 0, realized: 0 };
      totals[employeeId].total += 1;
      if (assignment.realizedEmployeeIds?.includes(employeeId)) totals[employeeId].realized += 1;
    }
  }
  return totals;
}

function dutyLastDates(state, beforeDate) {
  const year = beforeDate.slice(0, 4);
  const lastDates = {};
  for (const assignment of Object.values(state.duties.assignments)) {
    if (!assignment.date.startsWith(`${year}-`) || assignment.date >= beforeDate) continue;
    for (const employeeId of assignment.employeeIds || []) {
      if (!lastDates[employeeId] || assignment.date > lastDates[employeeId]) {
        lastDates[employeeId] = assignment.date;
      }
    }
  }
  return lastDates;
}

function buildDutyQueue(state, beforeDate) {
  const lastDates = dutyLastDates(state, beforeDate);
  const participantOrder = new Map(
    state.duties.participantIds.map((employeeId, index) => [employeeId, index]),
  );
  return [...state.duties.participantIds].sort((leftId, rightId) => {
    const leftLast = lastDates[leftId] || '';
    const rightLast = lastDates[rightId] || '';
    if (leftLast !== rightLast) {
      if (!leftLast) return -1;
      if (!rightLast) return 1;
      return leftLast.localeCompare(rightLast);
    }
    return (participantOrder.get(leftId) || 0) - (participantOrder.get(rightId) || 0);
  });
}

function moveDutyQueueToEnd(queue, employeeIds) {
  for (const employeeId of employeeIds) {
    const index = queue.indexOf(employeeId);
    if (index < 0) continue;
    queue.splice(index, 1);
    queue.push(employeeId);
  }
}

function dutyAssignmentOptions(state, date, dutyQueue, employeesById) {
  const existing = state.duties.assignments[date];
  const fixedIds = [...new Set(existing?.employeeIds || [])];
  if (fixedIds.length >= 2 || (fixedIds.length === 1 && existing?.singleApproved)) {
    return [{ employeeIds: fixedIds, addedIds: [], fixed: true, missing: 0 }];
  }

  const candidates = dutyQueue.filter((employeeId) => {
    const employee = employeesById.get(employeeId);
    return employee?.active
      && !fixedIds.includes(employeeId)
      && !dutyRestriction(state, employeeId, date);
  });
  const needed = 2 - fixedIds.length;
  const options = [{
    employeeIds: fixedIds,
    addedIds: [],
    fixed: false,
    missing: needed,
  }];
  for (const employeeId of candidates) {
    options.push({
      employeeIds: [...fixedIds, employeeId],
      addedIds: [employeeId],
      fixed: false,
      missing: needed - 1,
    });
  }
  if (needed >= 2) {
    for (let left = 0; left < candidates.length - 1; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        options.push({
          employeeIds: [...fixedIds, candidates[left], candidates[right]],
          addedIds: [candidates[left], candidates[right]],
          fixed: false,
          missing: needed - 2,
        });
      }
    }
  }
  return options;
}

function compareDutyScores(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function dutyPairKey(employeeIds) {
  if (employeeIds.length !== 2) return '';
  return [...employeeIds].sort().join('|');
}

function dutyBalanceMetrics(counts, employeeIds) {
  const values = employeeIds.map((employeeId) => counts[employeeId] || 0);
  if (values.length === 0) return { spread: 0, squares: 0 };
  return {
    spread: Math.max(...values) - Math.min(...values),
    squares: values.reduce((sum, value) => sum + value * value, 0),
  };
}

function dutyWeekStart(date) {
  const weekday = dayOfWeek(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

function dutyCountsBetween(state, startDate, endDate) {
  const counts = Object.fromEntries(
    state.duties.participantIds.map((employeeId) => [employeeId, 0]),
  );
  for (const assignment of Object.values(state.duties.assignments)) {
    if (assignment.date < startDate || assignment.date > endDate) continue;
    for (const employeeId of assignment.employeeIds || []) {
      counts[employeeId] = (counts[employeeId] || 0) + 1;
    }
  }
  return counts;
}

function dutyCompensationTargets(state, startDate, eligibleEmployeeIds) {
  const currentWeekStart = dutyWeekStart(startDate);
  const previousWeekStart = addDays(currentWeekStart, -7);
  const previousWeekEnd = addDays(currentWeekStart, -1);
  const previousWeekCounts = dutyCountsBetween(state, previousWeekStart, previousWeekEnd);
  const eligible = new Set(eligibleEmployeeIds);
  return new Map(
    state.duties.participantIds
      .filter((employeeId) => eligible.has(employeeId) && previousWeekCounts[employeeId] === 1)
      .map((employeeId) => [employeeId, 2]),
  );
}

function dutyCompensationDeficit(counts, compensationTargets) {
  let deficit = 0;
  for (const [employeeId, target] of compensationTargets) {
    deficit += Math.max(0, target - (counts[employeeId] || 0));
  }
  return deficit;
}

function exactDutyBlockPlan(
  state,
  dates,
  dutyQueue,
  employeesById,
  rangeCounts,
  balanceEmployeeIds,
  pairCounts,
  compensationTargets,
) {
  const optionsByDate = dates.map((date) => dutyAssignmentOptions(
    state,
    date,
    dutyQueue,
    employeesById,
  ));
  const weekendDate = dates.find((date) => {
    const weekday = dayOfWeek(date);
    return weekday === 6 || weekday === 0;
  });
  const previousWeekendIds = new Set();
  if (weekendDate) {
    const saturday = dayOfWeek(weekendDate) === 6 ? weekendDate : addDays(weekendDate, -1);
    for (const date of [addDays(saturday, -7), addDays(saturday, -6)]) {
      for (const employeeId of state.duties.assignments[date]?.employeeIds || []) {
        previousWeekendIds.add(employeeId);
      }
    }
  }

  const beamWidth = 1200;
  let beam = [{
    selectedOptions: new Map(),
    counts: { ...rangeCounts },
    pairCounts: new Map(pairCounts),
    queue: [...dutyQueue],
    missingSlots: 0,
    cooldownViolations: 0,
    weekendReservePenalty: 0,
    repeatedPairPenalty: 0,
    queueCost: 0,
    score: [0, 0, dutyCompensationDeficit(rangeCounts, compensationTargets), 0, 0, 0, 0, 0],
    signature: '',
  }];

  dates.forEach((date, dateIndex) => {
    const expanded = [];
    const weekday = dayOfWeek(date);
    for (const partial of beam) {
      const previousDayIds = new Set(
        partial.selectedOptions.get(addDays(date, -1))?.employeeIds
          || state.duties.assignments[addDays(date, -1)]?.employeeIds
          || [],
      );
      const previousTwoDayIds = new Set(
        partial.selectedOptions.get(addDays(date, -2))?.employeeIds
          || state.duties.assignments[addDays(date, -2)]?.employeeIds
          || [],
      );
      for (const option of optionsByDate[dateIndex]) {
        if (option.addedIds.some((employeeId) => previousDayIds.has(employeeId))) continue;
        if ((weekday === 6 || weekday === 0)
          && option.addedIds.some((employeeId) => previousWeekendIds.has(employeeId))) continue;

        const nextCounts = { ...partial.counts };
        let addedCooldownViolations = 0;
        let addedWeekendReservePenalty = 0;
        let addedQueueCost = 0;
        for (const employeeId of option.addedIds) {
          if (previousTwoDayIds.has(employeeId)) addedCooldownViolations += 1;
          if (weekendDate && weekday !== 6 && weekday !== 0
            && !previousWeekendIds.has(employeeId)) {
            addedWeekendReservePenalty += 1;
          }
          nextCounts[employeeId] = (nextCounts[employeeId] || 0) + 1;
          const queueIndex = partial.queue.indexOf(employeeId);
          addedQueueCost += queueIndex < 0 ? partial.queue.length : queueIndex;
        }
        const nextPairCounts = new Map(partial.pairCounts);
        let addedPairPenalty = 0;
        if (!option.fixed && option.employeeIds.length === 2) {
          const pairKey = dutyPairKey(option.employeeIds);
          addedPairPenalty = nextPairCounts.get(pairKey) || 0;
          nextPairCounts.set(pairKey, addedPairPenalty + 1);
        }
        const nextQueue = [...partial.queue];
        moveDutyQueueToEnd(nextQueue, option.employeeIds);
        const nextSelectedOptions = new Map(partial.selectedOptions);
        nextSelectedOptions.set(date, option);
        const missingSlots = partial.missingSlots + (option.missing || 0);
        const cooldownViolations = partial.cooldownViolations + addedCooldownViolations;
        const weekendReservePenalty = partial.weekendReservePenalty + addedWeekendReservePenalty;
        const repeatedPairPenalty = partial.repeatedPairPenalty + addedPairPenalty;
        const queueCost = partial.queueCost + addedQueueCost;
        const balance = dutyBalanceMetrics(nextCounts, balanceEmployeeIds);
        const compensationDeficit = dutyCompensationDeficit(nextCounts, compensationTargets);
        const score = [
          missingSlots,
          balance.spread,
          compensationDeficit,
          cooldownViolations,
          weekendReservePenalty,
          repeatedPairPenalty,
          balance.squares,
          queueCost,
        ];
        expanded.push({
          selectedOptions: nextSelectedOptions,
          counts: nextCounts,
          pairCounts: nextPairCounts,
          queue: nextQueue,
          missingSlots,
          cooldownViolations,
          weekendReservePenalty,
          repeatedPairPenalty,
          queueCost,
          score,
          signature: `${partial.signature}|${option.employeeIds.join(',')}`,
        });
      }
    }
    expanded.sort((left, right) => (
      compareDutyScores(left.score, right.score)
        || left.signature.localeCompare(right.signature)
    ));
    beam = expanded.slice(0, beamWidth);
  });

  const best = beam[0];
  return {
    score: best.score,
    signature: best.signature,
    selectedByDate: new Map([...best.selectedOptions].map(([date, option]) => [date, [...option.employeeIds]])),
    addedByDate: new Map([...best.selectedOptions].map(([date, option]) => [date, [...option.addedIds]])),
    shortages: dates
      .map((date) => ({ date, missing: best.selectedOptions.get(date)?.missing || 0 }))
      .filter((item) => item.missing > 0),
  };
}

function writeGeneratedDutyAssignment(state, date, employeeIds, now, shortage = false) {
  const existing = state.duties.assignments[date];
  const existingIds = [...new Set(existing?.employeeIds || [])];
  const existingComplete = existingIds.length >= 2
    || (existingIds.length === 1 && existing?.singleApproved);
  if (existingComplete) return false;
  if (existing && existingIds.length === employeeIds.length
    && existingIds.every((employeeId, index) => employeeId === employeeIds[index])) {
    return false;
  }
  state.duties.assignments[date] = {
    date,
    employeeIds: [...employeeIds],
    realizedEmployeeIds: [...(existing?.realizedEmployeeIds || [])]
      .filter((employeeId) => employeeIds.includes(employeeId)),
    singleApproved: false,
    source: shortage
      ? 'generated_shortage'
      : existingIds.length ? 'generated_completion' : 'generated',
    manualEmployeeIds: existingIds,
    updatedAt: now.toISOString(),
  };
  return true;
}

function generateDutySchedule(state, { startDate, endDate }, now = new Date()) {
  assertDateKey(startDate);
  assertDateKey(endDate);
  if (startDate > endDate) throw new Error('Початкова дата не може бути пізнішою за кінцеву.');
  let cursorCheck = startDate;
  let span = 0;
  while (cursorCheck <= endDate && span <= 367) {
    span += 1;
    cursorCheck = addDays(cursorCheck, 1);
  }
  if (span > 366) throw new Error('За один раз можна сформувати графік не більше ніж на 366 днів.');

  let cycleYear = startDate.slice(0, 4);
  let dutyQueue = buildDutyQueue(state, startDate);
  const employeesById = new Map(state.employees.map((employee) => [employee.id, employee]));
  const rangeCounts = Object.fromEntries(
    state.duties.participantIds.map((employeeId) => [employeeId, 0]),
  );
  const pairCounts = new Map();
  for (const assignment of Object.values(state.duties.assignments)) {
    if (assignment.date >= startDate && assignment.date <= endDate) {
      for (const employeeId of assignment.employeeIds || []) {
        rangeCounts[employeeId] = (rangeCounts[employeeId] || 0) + 1;
      }
    }
    if (assignment.date.startsWith(`${cycleYear}-`) && assignment.date <= endDate) {
      const pairKey = dutyPairKey(assignment.employeeIds || []);
      if (pairKey) pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
    }
  }
  const balanceEmployeeIds = state.duties.participantIds.filter((employeeId) => {
    const employee = employeesById.get(employeeId);
    if (!employee?.active) return false;
    let date = startDate;
    while (date <= endDate) {
      if (!dutyRestriction(state, employeeId, date)) return true;
      date = addDays(date, 1);
    }
    return false;
  });
  const compensationTargets = dutyCompensationTargets(
    state,
    startDate,
    balanceEmployeeIds,
  );
  const shortages = [];
  const weekendConflicts = [];
  let generated = 0;
  let cursor = startDate;

  if (span <= 7) {
    const planningDates = [];
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      planningDates.push(date);
    }
    const plan = exactDutyBlockPlan(
      state,
      planningDates,
      dutyQueue,
      employeesById,
      rangeCounts,
      balanceEmployeeIds,
      pairCounts,
      compensationTargets,
    );
    shortages.push(...plan.shortages);
    for (const date of planningDates) {
      const selected = plan.selectedByDate.get(date) || [];
      const addedIds = plan.addedByDate.get(date) || [];
      const changed = writeGeneratedDutyAssignment(
        state,
        date,
        selected,
        now,
        selected.length < 2,
      );
      if (changed) generated += 1;
      moveDutyQueueToEnd(dutyQueue, addedIds);
    }
    if (generated > 0) {
      appendAudit(state, 'duty_schedule_generated', {
        startDate,
        endDate,
        generated,
        shortages,
        weekendConflicts,
      }, now);
    }
    return {
      startDate,
      endDate,
      generated,
      shortages,
      weekendConflicts,
    };
  }

  while (cursor <= endDate) {
    if (cursor.slice(0, 4) !== cycleYear) {
      cycleYear = cursor.slice(0, 4);
      dutyQueue = buildDutyQueue(state, cursor);
    }
    const weekday = dayOfWeek(cursor);
    if ((weekday === 5 && addDays(cursor, 2) <= endDate)
      || weekday === 6
      || weekday === 0) {
      const blockDates = weekday === 5
        ? [cursor, addDays(cursor, 1), addDays(cursor, 2)]
        : weekday === 6 && addDays(cursor, 1) <= endDate
          ? [cursor, addDays(cursor, 1)]
          : [cursor];
      const plan = exactDutyBlockPlan(
        state,
        blockDates,
        dutyQueue,
        employeesById,
        rangeCounts,
        balanceEmployeeIds,
        pairCounts,
        compensationTargets,
      );
      shortages.push(...plan.shortages);
      for (const date of blockDates) {
        const selected = plan.selectedByDate.get(date);
        const addedIds = plan.addedByDate.get(date);
        const shortage = selected.length < 2;
        const changed = writeGeneratedDutyAssignment(state, date, selected, now, shortage);
        if (changed) {
          generated += 1;
          for (const employeeId of addedIds) {
            rangeCounts[employeeId] = (rangeCounts[employeeId] || 0) + 1;
          }
          const pairKey = dutyPairKey(selected);
          if (pairKey) pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
        }
        moveDutyQueueToEnd(dutyQueue, selected);
      }
      cursor = addDays(cursor, blockDates.length);
      continue;
    }

    const existing = state.duties.assignments[cursor];
    const existingIds = [...(existing?.employeeIds || [])];
    const existingComplete = existingIds.length >= 2
      || (existingIds.length === 1 && existing.singleApproved);
    if (existingComplete) {
      moveDutyQueueToEnd(dutyQueue, existing.employeeIds);
      cursor = addDays(cursor, 1);
      continue;
    }

    moveDutyQueueToEnd(dutyQueue, existingIds);

    const previousDayIds = new Set(
      state.duties.assignments[addDays(cursor, -1)]?.employeeIds || [],
    );
    const previousTwoDayIds = new Set(
      state.duties.assignments[addDays(cursor, -2)]?.employeeIds || [],
    );
    const options = dutyAssignmentOptions(state, cursor, dutyQueue, employeesById)
      .filter((option) => (
        option.addedIds.every((employeeId) => !previousDayIds.has(employeeId))
      ));
    let best = null;
    for (const option of options) {
      const nextDate = addDays(cursor, 1);
      let nextDayMissing = 0;
      if (nextDate <= endDate) {
        const nextExisting = state.duties.assignments[nextDate];
        const nextFixedIds = [...new Set(nextExisting?.employeeIds || [])];
        const nextComplete = nextFixedIds.length >= 2
          || (nextFixedIds.length === 1 && nextExisting?.singleApproved);
        if (!nextComplete) {
          const selectedToday = new Set(option.employeeIds);
          const nextCandidates = dutyQueue.filter((employeeId) => {
            const employee = employeesById.get(employeeId);
            return employee?.active
              && !nextFixedIds.includes(employeeId)
              && !selectedToday.has(employeeId)
              && !dutyRestriction(state, employeeId, nextDate);
          });
          nextDayMissing = Math.max(0, 2 - nextFixedIds.length - nextCandidates.length);
        }
      }
      const simulatedCounts = { ...rangeCounts };
      let cooldownViolations = 0;
      let queueCost = 0;
      for (const employeeId of option.addedIds) {
        if (previousTwoDayIds.has(employeeId)) cooldownViolations += 1;
        simulatedCounts[employeeId] = (simulatedCounts[employeeId] || 0) + 1;
        const queueIndex = dutyQueue.indexOf(employeeId);
        queueCost += queueIndex < 0 ? dutyQueue.length : queueIndex;
      }
      const balance = dutyBalanceMetrics(simulatedCounts, balanceEmployeeIds);
      const compensationDeficit = dutyCompensationDeficit(
        simulatedCounts,
        compensationTargets,
      );
      const pairKey = dutyPairKey(option.employeeIds);
      const repeatedPairPenalty = pairKey ? pairCounts.get(pairKey) || 0 : 0;
      const score = [
        option.missing,
        nextDayMissing,
        cooldownViolations,
        balance.spread,
        compensationDeficit,
        repeatedPairPenalty,
        balance.squares,
        queueCost,
      ];
      const signature = option.employeeIds.join(',');
      if (!best
        || compareDutyScores(score, best.score) < 0
        || (compareDutyScores(score, best.score) === 0 && signature < best.signature)) {
        best = { option, score, signature };
      }
    }

    const selected = best.option.employeeIds;
    const addedIds = best.option.addedIds;
    const missing = Math.max(0, 2 - selected.length);
    if (missing > 0) shortages.push({ date: cursor, missing });
    const changed = writeGeneratedDutyAssignment(state, cursor, selected, now, missing > 0);
    if (changed) {
      for (const employeeId of addedIds) {
        rangeCounts[employeeId] = (rangeCounts[employeeId] || 0) + 1;
      }
      const pairKey = dutyPairKey(selected);
      if (pairKey) pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
    }
    moveDutyQueueToEnd(dutyQueue, addedIds);
    if (changed) generated += 1;
    cursor = addDays(cursor, 1);
  }

  if (generated > 0) {
    appendAudit(state, 'duty_schedule_generated', {
      startDate,
      endDate,
      generated,
      shortages,
      weekendConflicts,
    }, now);
  }
  return {
    startDate,
    endDate,
    generated,
    shortages,
    weekendConflicts,
  };
}

function calculateDutyStatistics(state, year = dateKeyFromDate().slice(0, 4)) {
  const totals = dutyTotals(state, year);
  return state.employees.map((employee) => ({
    employeeId: employee.id,
    name: employee.name,
    total: totals[employee.id]?.total || 0,
    realized: totals[employee.id]?.realized || 0,
  }));
}

function calculateStatistics(state, { employeeId = null, startDate, endDate }) {
  assertDateKey(startDate);
  assertDateKey(endDate);
  if (startDate > endDate) throw new Error('Початкова дата не може бути пізнішою за кінцеву.');
  const employees = employeeId
    ? [getEmployee(state, employeeId)]
    : state.employees;

  const rows = employees.map((employee) => {
    const metrics = {
      employeeId: employee.id,
      name: employee.name,
      calendarWorkdays: 0,
      workedDays: 0,
      requestDays: 0,
      submittedOnTime: 0,
      submittedLate: 0,
      submittedAdvance: 0,
      missed: 0,
      pending: 0,
      otherTasks: 0,
      personalPermission: 0,
      sick: 0,
      vacation: 0,
      dayOff: 0,
      holiday: 0,
      documentsReceived: 0,
      actualRequestsReceived: 0,
      complexRequests: 0,
      unallocatedCredit: 0,
    };

    let cursor = startDate;
    while (cursor <= endDate) {
      const record = state.records[recordKey(employee.id, cursor)];
      const hasHistoricalEntry = Boolean(record || state.workdayOverrides[recordKey(employee.id, cursor)]);
      if ((employeeExistsOnDate(employee, cursor) || hasHistoricalEntry)
        && isEmployeeWorkday(state, employee.id, cursor)) {
        metrics.calendarWorkdays += 1;
        if (!record) {
          metrics.pending += 1;
        } else {
          if (record.status === STATUS.SUBMITTED) metrics.submittedOnTime += 1;
          if (record.status === STATUS.SUBMITTED_LATE) metrics.submittedLate += 1;
          if (record.status === STATUS.SUBMITTED_ADVANCE) metrics.submittedAdvance += 1;
          if (record.status === STATUS.MISSED) metrics.missed += 1;
          if (record.status === STATUS.OTHER_TASKS) metrics.otherTasks += 1;
          if (record.status === STATUS.PERSONAL_PERMISSION) metrics.personalPermission += 1;
          if (record.status === STATUS.SICK) metrics.sick += 1;
          if (record.status === STATUS.VACATION) metrics.vacation += 1;
          if (record.status === STATUS.DAY_OFF) metrics.dayOff += 1;
          if (record.status === STATUS.HOLIDAY) metrics.holiday += 1;
          if (isSubmitted(record.status)) metrics.requestDays += 1;
          if (isSubmitted(record.status) || record.status === STATUS.OTHER_TASKS) metrics.workedDays += 1;
        }
      }
      cursor = addDays(cursor, 1);
    }

    const receipts = state.receipts.filter((receipt) => (
      receipt.employeeId === employee.id
      && receipt.receivedDate >= startDate
      && receipt.receivedDate <= endDate
    ));
    metrics.documentsReceived = receipts.length;
    metrics.actualRequestsReceived = receipts.reduce((sum, receipt) => sum + receipt.actualRequestCount, 0);
    metrics.complexRequests = receipts.filter((receipt) => receipt.complexTwoDay).length;
    metrics.unallocatedCredit = receipts.reduce((sum, receipt) => sum + receipt.unallocatedCredit, 0);
    metrics.requestRequiredDays = Math.max(0, metrics.calendarWorkdays
      - metrics.otherTasks
      - metrics.personalPermission
      - metrics.sick
      - metrics.vacation
      - metrics.dayOff
      - metrics.holiday);
    metrics.completionPercent = metrics.requestRequiredDays === 0
      ? 100
      : Math.round((metrics.requestDays / metrics.requestRequiredDays) * 1000) / 10;
    return metrics;
  });

  const total = rows.reduce((acc, row) => {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number' && key !== 'completionPercent') {
        acc[key] = (acc[key] || 0) + value;
      }
    }
    return acc;
  }, {});
  total.completionPercent = total.requestRequiredDays
    ? Math.round((total.requestDays / total.requestRequiredDays) * 1000) / 10
    : 100;

  return { startDate, endDate, employeeId, rows, total };
}

module.exports = {
  SCHEMA_VERSION,
  STATUS,
  STATUS_LABELS,
  SUBMITTED_STATUSES,
  addDays,
  allocateReceiptBackward,
  allocateReceiptForward,
  archiveEmployee,
  calculateDutyStatistics,
  calculateStatistics,
  clearDutyRestriction,
  clearWorkdayOverride,
  clearManualRecord,
  clone,
  createEmployee,
  dateKeyFromDate,
  dayOfWeek,
  defaultState,
  ensureAutomaticMisses,
  generateDutySchedule,
  getEmployee,
  isSubmitted,
  isEmployeeWorkday,
  isWorkday,
  initializeDutyHistory,
  normalizeState,
  removeDutyAssignment,
  recordKey,
  recordSubmission,
  restoreEmployee,
  setDutyAssignment,
  setDutyRealized,
  setDutyRestriction,
  toggleDutyAssignment,
  setManualStatus,
  setWorkdayOverride,
};
