const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;

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
    settings: {
      closeHour: 18,
      closeMinute: 0,
      workdays: [1, 2, 3, 4, 5],
      alwaysOnTop: true,
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
      if (employeeExistsOnDate(employee, cursor) && isWorkday(state, cursor)) {
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

  if (isWorkday(state, today) && employeeExistsOnDate(employee, today)) {
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
    if (isWorkday(state, cursor) && !state.records[key]) {
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
      if (employeeExistsOnDate(employee, cursor) && isWorkday(state, cursor)) {
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
  allocateReceiptForward,
  archiveEmployee,
  calculateStatistics,
  clearManualRecord,
  clone,
  createEmployee,
  dateKeyFromDate,
  dayOfWeek,
  defaultState,
  ensureAutomaticMisses,
  getEmployee,
  isSubmitted,
  isWorkday,
  normalizeState,
  recordKey,
  recordSubmission,
  restoreEmployee,
  setManualStatus,
};
