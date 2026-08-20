const crypto = require('node:crypto');

const SCHEMA_VERSION = 3;

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
      baselines: {},
      assignments: {},
      aDays: {},
      unavailable: {},
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
    participantIds: Array.isArray(input.duties?.participantIds)
      ? input.duties.participantIds
      : state.employees.map((employee) => employee.id),
    baselineYear: /^\d{4}$/.test(input.duties?.baselineYear || '')
      ? input.duties.baselineYear
      : String(now.getFullYear()),
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
  state.duties.participantIds = [...new Set(state.duties.participantIds)]
    .filter((employeeId) => ids.has(employeeId));

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

function archiveEmployee(state, employeeId, now = new Date()) {
  const employee = getEmployee(state, employeeId);
  employee.active = false;
  employee.archivedDate = dateKeyFromDate(now);
  employee.archivedAt = now.toISOString();
  const openPeriod = employee.activePeriods.findLast((period) => !period.end);
  if (openPeriod) openPeriod.end = employee.archivedDate;
  appendAudit(state, 'employee_archived', { employeeId }, now);
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
  if (!employeeExistsOnDate(employee, date)) {
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
  if (state.duties.aDays[recordKey(employeeId, addDays(date, -1))]) return 'after_a';
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
  for (const [date, assignment] of Object.entries(state.duties.assignments)) {
    if (date < today || removedIds.size === 0) continue;
    assignment.employeeIds = (assignment.employeeIds || []).filter((employeeId) => !removedIds.has(employeeId));
    assignment.realizedEmployeeIds = (assignment.realizedEmployeeIds || [])
      .filter((employeeId) => assignment.employeeIds.includes(employeeId));
    if (assignment.employeeIds.length === 0) {
      delete state.duties.assignments[date];
    } else if (assignment.employeeIds.length === 1) {
      assignment.singleApproved = false;
      assignment.source = 'participant_removed';
      assignment.updatedAt = now.toISOString();
    }
  }
  const baselineYear = dateKeyFromDate(now).slice(0, 4);
  state.duties.baselines = state.duties.baselineYear === baselineYear
    ? { ...state.duties.baselines, ...baselines }
    : baselines;
  state.duties.baselineYear = baselineYear;
  state.duties.participantIds = selectedIds;
  state.duties.initialized = true;
  appendAudit(state, 'duty_history_initialized', { employees: entries.length, participantIds: selectedIds }, now);
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
    state.duties.aDays[key] = {
      employeeId,
      date,
      note: String(note || '').trim(),
      createdAt: now.toISOString(),
    };
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
  }
  appendAudit(state, 'duty_restriction_set', { employeeId, date, type }, now);
  return type === 'a' ? state.duties.aDays[key] : state.duties.unavailable[key];
}

function clearDutyRestriction(state, employeeId, date, now = new Date()) {
  getEmployee(state, employeeId);
  assertDateKey(date);
  const key = recordKey(employeeId, date);
  const changed = Boolean(state.duties.aDays[key] || state.duties.unavailable[key]);
  delete state.duties.aDays[key];
  delete state.duties.unavailable[key];
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
    ids.splice(existingIndex, 1);
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
  appendAudit(state, 'duty_assignment_toggled', { employeeId, date, assigned: existingIndex < 0 }, now);
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
  const assignments = Object.values(state.duties.assignments)
    .filter((assignment) => (
      assignment.date.startsWith(`${year}-`)
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
  const shortages = [];
  let generated = 0;
  let cursor = startDate;

  while (cursor <= endDate) {
    if (cursor.slice(0, 4) !== cycleYear) {
      cycleYear = cursor.slice(0, 4);
      dutyQueue = buildDutyQueue(state, cursor);
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

    const recentIds = new Set([
      ...(state.duties.assignments[addDays(cursor, -1)]?.employeeIds || []),
      ...(state.duties.assignments[addDays(cursor, -2)]?.employeeIds || []),
    ]);
    const candidates = dutyQueue.filter((employeeId) => {
      const employee = employeesById.get(employeeId);
      return employee?.active
        && !existingIds.includes(employeeId)
        && !dutyRestriction(state, employeeId, cursor);
    });

    const needed = 2 - existingIds.length;
    if (candidates.length < needed) {
      shortages.push(cursor);
      cursor = addDays(cursor, 1);
      continue;
    }

    const preferred = candidates.filter((employeeId) => !recentIds.has(employeeId));
    const addedIds = (preferred.length >= needed
      ? preferred
      : [...preferred, ...candidates.filter((employeeId) => recentIds.has(employeeId))]
    ).slice(0, needed);
    const selected = [...existingIds, ...addedIds];
    state.duties.assignments[cursor] = {
      date: cursor,
      employeeIds: selected,
      realizedEmployeeIds: [...(existing?.realizedEmployeeIds || [])],
      singleApproved: false,
      source: existingIds.length ? 'generated_completion' : 'generated',
      updatedAt: now.toISOString(),
    };
    moveDutyQueueToEnd(dutyQueue, addedIds);
    generated += 1;
    cursor = addDays(cursor, 1);
  }

  appendAudit(state, 'duty_schedule_generated', { startDate, endDate, generated, shortages }, now);
  return { startDate, endDate, generated, shortages };
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
      if (employeeExistsOnDate(employee, cursor) && isEmployeeWorkday(state, employee.id, cursor)) {
        metrics.calendarWorkdays += 1;
        const record = state.records[recordKey(employee.id, cursor)];
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
