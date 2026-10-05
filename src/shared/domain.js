const crypto = require('node:crypto');
const journal = require('./journal');
const work = require('./work');
const presence = require('./presence');

const SCHEMA_VERSION = 14;
const { normalizeTasks } = require('./tasks');
const { normalizeDraws } = require('./draws');

const DEFAULT_STATUS_COLORS = Object.freeze({
  onsite: '#36bf76',
  zkp: '#36a8b7',
  training_online:'#6887d8',training_academy:'#b383d9',business_trip:'#c28b54',
  working: '#36a8b7',
  planned_work: '#668ac9',
  pending: '#586b85',
  submitted: '#36bf76',
  submitted_late: '#82c967',
  submitted_advance: '#45b995',
  missed: '#df555d',
  other_tasks: '#36a8b7',
  personal_permission: '#dc76aa',
  sick: '#dd9340',
  vacation: '#9873d6',
  day_off: '#668ac9',
  holiday: '#60718a',
});

const DEFAULT_DUTY_RULES = Object.freeze({
  weekdayDutyCount: 2,
  weekendDutyCount: 2,
  requiredByWeekday: {},
  preventConsecutiveDays: true,
  preventConsecutiveWeekends: true,
  weekendRestWeeks: 1,
  minimumRestDays: 2,
  minimumRestMode: 'prefer',
  planningPriority: 'balanced',
  maximumDutiesPerWeek: 0,
  compensateNextWeek: true,
  compensationFrom: 1,
  compensationTarget: 2,
  avoidRepeatedPairs: true,
  pairHistoryPeriod: 'year',
  pairHistoryDays: 90,
  shortageBehavior: 'leave_empty',
});

const STATUS = Object.freeze({
  WORKING: 'working',
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
  BUSINESS_TRIP: 'business_trip',
});

const STATUS_LABELS = Object.freeze({...presence.labels,...Object.fromEntries(Object.values(STATUS).map(status=>[status,work.labels[status]])),planned_work:work.labels.planned_work});

const MANUAL_STATUSES = new Set([
  STATUS.WORKING,
  STATUS.SUBMITTED,
  STATUS.MISSED,
  STATUS.OTHER_TASKS,
  STATUS.PERSONAL_PERMISSION,
  STATUS.SICK,
  STATUS.VACATION,
  STATUS.DAY_OFF,
  STATUS.HOLIDAY,
  STATUS.BUSINESS_TRIP,
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
  STATUS.BUSINESS_TRIP,
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
  const [year, month, day] = value.split('-').map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== day) {
    throw new Error('Некоректна календарна дата.');
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

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizeHexColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function normalizeDutyRules(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const overrides = source.requiredByWeekday && typeof source.requiredByWeekday === 'object'
    ? source.requiredByWeekday : {};
  return {
    weekdayDutyCount: clampInteger(source.weekdayDutyCount, 0, 15, 2),
    weekendDutyCount: clampInteger(source.weekendDutyCount, 0, 15, 2),
    requiredByWeekday: Object.fromEntries(
      Object.entries(overrides)
        .filter(([weekday, count]) => /^[0-6]$/.test(weekday) && count !== '' && count != null)
        .map(([weekday, count]) => [weekday, Number(count)])
        .filter(([, count]) => Number.isInteger(count) && count >= 0 && count <= 15),
    ),
    preventConsecutiveDays: source.preventConsecutiveDays !== false,
    preventConsecutiveWeekends: source.preventConsecutiveWeekends !== false,
    weekendRestWeeks: clampInteger(source.weekendRestWeeks, 1, 8, 1),
    minimumRestDays: clampInteger(source.minimumRestDays, 0, 30, 2),
    minimumRestMode: source.minimumRestMode === 'require' ? 'require' : 'prefer',
    planningPriority: ['balanced', 'rest', 'rotation', 'pairs'].includes(source.planningPriority)
      ? source.planningPriority : 'balanced',
    maximumDutiesPerWeek: clampInteger(source.maximumDutiesPerWeek, 0, 7, 0),
    compensateNextWeek: source.compensateNextWeek !== false,
    compensationFrom: clampInteger(source.compensationFrom, 0, 6, 1),
    compensationTarget: clampInteger(source.compensationTarget, 1, 7, 2),
    avoidRepeatedPairs: source.avoidRepeatedPairs !== false,
    pairHistoryPeriod: ['month', 'quarter', 'year', 'rolling', 'all'].includes(source.pairHistoryPeriod)
      ? source.pairHistoryPeriod
      : 'year',
    pairHistoryDays: clampInteger(source.pairHistoryDays, 1, 366, 90),
    shortageBehavior: source.shortageBehavior === 'require_full_day' ? 'require_full_day' : 'leave_empty',
  };
}

function normalizeGlobalSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const workdays = Array.isArray(source.workdays)
    ? [...new Set(source.workdays.map(Number).filter((day) => day >= 0 && day <= 6))]
    : [1, 2, 3, 4, 5];
  const statusColors = Object.fromEntries(
    Object.entries(DEFAULT_STATUS_COLORS).map(([key, fallback]) => [
      key,
      normalizeHexColor(source.statusColors?.[key], fallback),
    ]),
  );
  return {
    closeHour: clampInteger(source.closeHour, 0, 23, 18),
    closeMinute: clampInteger(source.closeMinute, 0, 59, 0),
    automaticClose: source.automaticClose !== false,
    workdays: workdays.length ? workdays.sort((a, b) => a - b) : [1, 2, 3, 4, 5],
    alwaysOnTop: source.alwaysOnTop !== false,
    widgetSize: clampInteger(source.widgetSize, 260, 700, 380),
    widgetPosition: source.widgetPosition || null,
    widgetMode: ['team','duties','tasks'].includes(source.widgetMode) ? source.widgetMode : 'team',
    widgetShape: source.widgetShape === 'panel' ? 'panel' : 'circle',
    widgetList: source.widgetList === true,
    widgetLocked: source.widgetLocked === true,
    widgetSnap: source.widgetSnap !== false,
    widgetQuickMode: source.widgetQuickMode === true,
    widgetShortcutEnabled: source.widgetShortcutEnabled !== false,
    dutyNameWidth: clampInteger(source.dutyNameWidth, 130, 320, 180),
    dutyRowHeight: clampInteger(source.dutyRowHeight, 34, 72, 46),
    dutyLineStrength: clampInteger(source.dutyLineStrength, 1, 3, 2),
    confirmDestructiveActions: source.confirmDestructiveActions !== false,
    showArchivedEmployees: source.showArchivedEmployees !== false,
    dateStyle: ['long', 'short', 'numeric'].includes(source.dateStyle)
      ? source.dateStyle
      : 'long',
    backupRetention: clampInteger(source.backupRetention, 1, 30, 7),
    interfaceTheme: ['navy', 'light'].includes(source.interfaceTheme) ? source.interfaceTheme : 'navy',
    interfaceDensity: source.interfaceDensity === 'compact' ? 'compact' : 'comfortable',
    interfaceTextSize: source.interfaceTextSize === 'large' ? 'large' : 'standard',
    taskRemindersEnabled: source.taskRemindersEnabled !== false,
    taskAttentionDays: clampInteger(source.taskAttentionDays, 1, 14, 3),
    onboardingSeen: source.onboardingSeen === true,
    operatorName: String(source.operatorName || 'Керівник').trim().slice(0, 80) || 'Керівник',
    statusColors,
  };
}

function createDutyData(now = new Date()) {
  return {
    initialized: false,
    participantIds: [],
    baselineYear: String(now.getFullYear()),
    baselineThroughDate: endOfCalendarWeek(dateKeyFromDate(now)),
    baselines: {},
    assignments: {},
    aDays: {},
    unavailable: {},
    planningBlocks: {},
    rules: normalizeDutyRules(),
    lockedWeeks: {},
    dayExceptions: {},
  };
}

function normalizeDutyData(input, now = new Date(), defaultParticipantIds = []) {
  const source = input && typeof input === 'object' ? input : {};
  const currentYear = String(now.getFullYear());
  const baselineYear = /^\d{4}$/.test(source.baselineYear || '')
    ? source.baselineYear
    : currentYear;
  const baselineThroughDate = /^\d{4}-\d{2}-\d{2}$/.test(source.baselineThroughDate || '')
    && (source.baselineThroughDate.startsWith(`${baselineYear}-`)
      || source.baselineThroughDate === previousYearEnd(baselineYear))
    ? source.baselineThroughDate
    : (baselineYear === currentYear
      ? endOfCalendarWeek(dateKeyFromDate(now))
      : `${baselineYear}-12-31`);
  return {
    ...createDutyData(now),
    ...source,
    initialized: Boolean(source.initialized),
    participantIds: Array.isArray(source.participantIds)
      ? source.participantIds
      : defaultParticipantIds,
    baselineYear,
    baselineThroughDate,
    baselines: source.baselines && typeof source.baselines === 'object' ? source.baselines : {},
    assignments: source.assignments && typeof source.assignments === 'object' ? source.assignments : {},
    aDays: source.aDays && typeof source.aDays === 'object' ? source.aDays : {},
    unavailable: source.unavailable && typeof source.unavailable === 'object' ? source.unavailable : {},
    planningBlocks: source.planningBlocks && typeof source.planningBlocks === 'object'
      ? source.planningBlocks
      : {},
    rules: normalizeDutyRules(source.rules),
    lockedWeeks: source.lockedWeeks && typeof source.lockedWeeks === 'object'
      ? source.lockedWeeks
      : {},
    dayExceptions: source.dayExceptions && typeof source.dayExceptions === 'object'
      ? source.dayExceptions
      : {},
  };
}

function dutySchedules(state) {
  if (Array.isArray(state.dutySchedules) && state.dutySchedules.length) {
    return state.dutySchedules;
  }
  return [{ id: 'primary', name: 'Основний', data: state.duties }];
}

function cleanScheduleName(name) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2) throw new Error('Вкажіть назву графіка.');
  if (cleanName.length > 80) throw new Error('Назва графіка має містити не більше 80 символів.');
  return cleanName;
}

function cleanTime(value) {
  const result = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) {
    throw new Error('Час має бути у форматі ГГ:ХХ.');
  }
  return result;
}

function minutesFromTime(value) {
  const [hours, minutes] = cleanTime(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function defaultState(now = new Date()) {
  const duties = createDutyData(now);
  return {
    schemaVersion: SCHEMA_VERSION,
    employees: [],
    records: {},
    receipts: [],
    workEntries: [],
    presenceRecords: {},
    workdayOverrides: {},
    dutySchedules: [{
      id: 'primary',
      name: 'Основний',
      createdAt: now.toISOString(),
      data: duties,
    }],
    activeDutyScheduleId: 'primary',
    duties,
    tasks: [],
    draws: [],
    drawSequence: 0,
    timeOffEntries: [],
    settings: normalizeGlobalSettings(),
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
  const importedSchedules = Array.isArray(input.dutySchedules)
    ? input.dutySchedules
    : [];
  const scheduleIds = new Set();
  state.dutySchedules = importedSchedules.flatMap((schedule, index) => {
    if (!schedule || typeof schedule !== 'object') return [];
    const id = String(schedule.id || '').trim() || `schedule-${index + 1}`;
    if (scheduleIds.has(id)) return [];
    scheduleIds.add(id);
    const useRootDutyData = id === input.activeDutyScheduleId
      && input.duties && typeof input.duties === 'object';
    return [{
      id,
      name: String(schedule.name || '').trim().slice(0, 80) || `Графік ${index + 1}`,
      createdAt: schedule.createdAt || now.toISOString(),
      data: normalizeDutyData(
        useRootDutyData ? input.duties : schedule.data,
        now,
        state.employees.map((employee) => employee.id),
      ),
    }];
  });
  if (!state.dutySchedules.length) {
    const legacyDuties = normalizeDutyData(
      input.duties,
      now,
      state.employees.map((employee) => employee.id),
    );
    state.dutySchedules = [{
      id: 'primary',
      name: 'Основний',
      createdAt: now.toISOString(),
      data: legacyDuties,
    }];
  }
  const activeSchedule = state.dutySchedules.find((schedule) => (
    schedule.id === input.activeDutyScheduleId
  )) || state.dutySchedules[0];
  state.activeDutyScheduleId = activeSchedule.id;
  state.duties = activeSchedule.data;
  state.timeOffEntries = Array.isArray(input.timeOffEntries)
    ? input.timeOffEntries
    : [];
  state.audit = Array.isArray(input.audit) ? input.audit.slice(-5000) : [];
  state.settings = normalizeGlobalSettings(input.settings);

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
  for (const schedule of state.dutySchedules) {
    const inactiveParticipantIds = new Set(
      [...new Set(schedule.data.participantIds)]
        .filter((employeeId) => ids.has(employeeId))
        .filter((employeeId) => !state.employees.find((employee) => employee.id === employeeId)?.active),
    );
    schedule.data.participantIds = [...new Set(schedule.data.participantIds)]
      .filter((employeeId) => ids.has(employeeId) && !inactiveParticipantIds.has(employeeId));
    removeEmployeesFromDutyData(
      schedule.data,
      inactiveParticipantIds,
      dateKeyFromDate(now),
      now,
      'participant_archived',
    );
  }

  const timeOffIds = new Set();
  state.timeOffEntries = state.timeOffEntries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !ids.has(entry.employeeId)) return [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '')) return [];
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime || '')
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.endTime || '')) return [];
    const startMinutes = minutesFromTime(entry.startTime);
    const endMinutes = minutesFromTime(entry.endTime);
    if (endMinutes <= startMinutes) return [];
    const id = String(entry.id || '').trim() || crypto.randomUUID();
    if (timeOffIds.has(id)) return [];
    timeOffIds.add(id);
    return [{
      id,
      employeeId: entry.employeeId,
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      durationMinutes: endMinutes - startMinutes,
      destination: String(entry.destination || '').trim().slice(0, 200),
      note: String(entry.note || '').trim().slice(0, 500),
      createdAt: entry.createdAt || now.toISOString(),
      updatedAt: entry.updatedAt || entry.createdAt || now.toISOString(),
    }];
  });

  state.tasks = normalizeTasks(input.tasks, state, now);
  state.draws = normalizeDraws(input.draws);
  if (input.drawSequence != null && (!Number.isSafeInteger(input.drawSequence) || input.drawSequence < 0)) throw new Error('Некоректний лічильник протоколів.');
  state.drawSequence = state.draws.reduce((maximum, draw) => Math.max(maximum, draw.number), input.drawSequence || 0);
  state.workEntries = work.normalize(input.workEntries, state);
  state.presenceRecords = presence.normalize(input.presenceRecords, state);
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

function renameEmployee(state, employeeId, name, now = new Date()) {
  const employee = getEmployee(state, employeeId);
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 80) {
    throw new Error('Ім’я працівника має містити від 2 до 80 символів.');
  }
  if (state.employees.some((other) => other.id !== employeeId && other.active
    && other.name.toLocaleLowerCase('uk-UA') === cleanName.toLocaleLowerCase('uk-UA'))) {
    throw new Error('Працівник із таким ім’ям уже є у списку.');
  }
  const previousName = employee.name;
  employee.name = cleanName;
  appendAudit(state, 'employee_renamed', { employeeId, previousName, name: cleanName }, now);
  return employee;
}

function moveEmployee(state, employeeId, direction, now = new Date()) {
  const index = state.employees.findIndex((employee) => employee.id === employeeId && employee.active);
  if (index < 0 || ![-1, 1].includes(direction)) throw new Error('Некоректне переміщення працівника.');
  const activeIndices = state.employees.flatMap((employee, offset) => employee.active ? [offset] : []);
  const position = activeIndices.indexOf(index);
  const targetIndex = activeIndices[position + direction];
  if (targetIndex === undefined) return false;
  [state.employees[index], state.employees[targetIndex]] = [state.employees[targetIndex], state.employees[index]];
  appendAudit(state, 'employee_moved', { employeeId, direction }, now);
  return true;
}

function removeEmployeesFromDutyData(
  duties,
  removedIds,
  fromDate,
  now,
  source,
) {
  if (!removedIds?.size) return [];
  const affectedDates = [];
  for (const [date, assignment] of Object.entries(duties.assignments)) {
    if (date < fromDate || !(assignment.employeeIds || []).some((id) => removedIds.has(id))) continue;
    const employeeIds = (assignment.employeeIds || []).filter((id) => !removedIds.has(id));
    duties.assignments[date] = {
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

function removeEmployeesFromFutureDutyAssignments(
  state,
  removedIds,
  fromDate,
  now,
  source,
) {
  return removeEmployeesFromDutyData(state.duties, removedIds, fromDate, now, source);
}

function archiveEmployee(state, employeeId, now = new Date()) {
  const employee = getEmployee(state, employeeId);
  employee.active = false;
  employee.archivedDate = dateKeyFromDate(now);
  employee.archivedAt = now.toISOString();
  const openPeriod = employee.activePeriods.findLast((period) => !period.end);
  if (openPeriod) openPeriod.end = employee.archivedDate;
  const affectedDutyDates = {};
  for (const schedule of dutySchedules(state)) {
    schedule.data.participantIds = (schedule.data.participantIds || [])
      .filter((id) => id !== employeeId);
    affectedDutyDates[schedule.id] = removeEmployeesFromDutyData(
      schedule.data,
      new Set([employeeId]),
      employee.archivedDate,
      now,
      'participant_archived',
    );
  }
  appendAudit(state, 'employee_archived', { employeeId, affectedDutyDates }, now);
  return employee;
}

function createDutySchedule(state, name, now = new Date()) {
  const cleanName = cleanScheduleName(name);
  if (dutySchedules(state).some((schedule) => (
    schedule.name.toLocaleLowerCase('uk-UA') === cleanName.toLocaleLowerCase('uk-UA')
  ))) {
    throw new Error('Графік із такою назвою вже існує.');
  }
  const data = createDutyData(now);
  const schedule = {
    id: crypto.randomUUID(),
    name: cleanName,
    createdAt: now.toISOString(),
    data,
  };
  state.dutySchedules.push(schedule);
  state.activeDutyScheduleId = schedule.id;
  state.duties = data;
  appendAudit(state, 'duty_schedule_created', { scheduleId: schedule.id, name: schedule.name }, now);
  return schedule;
}

function renameDutySchedule(state, scheduleId, name, now = new Date()) {
  const schedule = dutySchedules(state).find((item) => item.id === scheduleId);
  if (!schedule) throw new Error('Графік не знайдено.');
  const cleanName = cleanScheduleName(name);
  if (state.dutySchedules.some((item) => (
    item.id !== schedule.id
    && item.name.toLocaleLowerCase('uk-UA') === cleanName.toLocaleLowerCase('uk-UA')
  ))) {
    throw new Error('Графік із такою назвою вже існує.');
  }
  const previousName = schedule.name;
  schedule.name = cleanName;
  appendAudit(state, 'duty_schedule_renamed', {
    scheduleId: schedule.id,
    previousName,
    name: schedule.name,
  }, now);
  return schedule;
}

function switchDutySchedule(state, scheduleId, now = new Date()) {
  const schedule = dutySchedules(state).find((item) => item.id === scheduleId);
  if (!schedule) throw new Error('Графік не знайдено.');
  state.activeDutyScheduleId = schedule.id;
  state.duties = schedule.data;
  appendAudit(state, 'duty_schedule_switched', { scheduleId: schedule.id }, now);
  return schedule;
}

function deleteDutySchedule(state, scheduleId, now = new Date()) {
  if (!Array.isArray(state.dutySchedules) || state.dutySchedules.length <= 1) {
    throw new Error('Не можна видалити єдиний графік.');
  }
  const index = state.dutySchedules.findIndex((item) => item.id === scheduleId);
  if (index < 0) throw new Error('Графік не знайдено.');
  const [removed] = state.dutySchedules.splice(index, 1);
  if (state.activeDutyScheduleId === scheduleId) {
    const next = state.dutySchedules[Math.min(index, state.dutySchedules.length - 1)];
    state.activeDutyScheduleId = next.id;
    state.duties = next.data;
  }
  appendAudit(state, 'duty_schedule_deleted', {
    scheduleId: removed.id,
    name: removed.name,
  }, now);
  return removed;
}

function duplicateDutySchedule(state, scheduleId, name, now = new Date()) {
  const source = dutySchedules(state).find((item) => item.id === scheduleId);
  if (!source) throw new Error('Графік для копіювання не знайдено.');
  const copy = createDutySchedule(state, name, now);
  copy.data.initialized = source.data.initialized;
  copy.data.participantIds = [...(source.data.participantIds || [])];
  copy.data.rules = normalizeDutyRules(source.data.rules);
  copy.data.baselineYear = String(now.getFullYear());
  copy.data.baselineThroughDate = previousYearEnd(copy.data.baselineYear);
  copy.data.baselines = Object.fromEntries(
    copy.data.participantIds.map((employeeId) => [employeeId, { total: 0, realized: 0 }]),
  );
  appendAudit(state, 'duty_schedule_duplicated', {
    sourceScheduleId: source.id,
    scheduleId: copy.id,
    name: copy.name,
  }, now);
  return copy;
}

function updateDutyScheduleRules(state, scheduleId, rules, now = new Date()) {
  const schedule = dutySchedules(state).find((item) => item.id === scheduleId);
  if (!schedule) throw new Error('Графік не знайдено.');
  schedule.data.rules = normalizeDutyRules(rules);
  appendAudit(state, 'duty_schedule_rules_updated', {
    scheduleId: schedule.id,
    rules: schedule.data.rules,
  }, now);
  return schedule.data.rules;
}

function updateSettings(state, input, now = new Date()) {
  const previous = state.settings;
  state.settings = normalizeGlobalSettings({ ...previous, ...(input || {}) });
  appendAudit(state, 'settings_updated', { settings: state.settings }, now);
  return state.settings;
}

function dutyDateLocked(state, date) {
  assertDateKey(date);
  return Boolean(state.duties.lockedWeeks?.[dutyWeekStart(date)]);
}

function assertDutyDateUnlocked(state, date) {
  if (dutyDateLocked(state, date)) {
    throw new Error('Цей тиждень заблоковано. Спочатку розблокуйте його.');
  }
}

function setDutyWeekLocked(state, date, locked, now = new Date()) {
  assertDateKey(date);
  const weekStart = dutyWeekStart(date);
  if (!state.duties.lockedWeeks || typeof state.duties.lockedWeeks !== 'object') {
    state.duties.lockedWeeks = {};
  }
  if (locked) {
    state.duties.lockedWeeks[weekStart] = {
      weekStart,
      lockedAt: now.toISOString(),
    };
  } else {
    delete state.duties.lockedWeeks[weekStart];
  }
  appendAudit(state, locked ? 'duty_week_locked' : 'duty_week_unlocked', { weekStart }, now);
  return { weekStart, locked: Boolean(locked) };
}

function clearDutyWeek(state, date, now = new Date(), mode = 'all') {
  assertDateKey(date);
  if (!['all', 'generated'].includes(mode)) throw new Error('Некоректний режим очищення тижня.');
  const weekStart = dutyWeekStart(date);
  assertDutyDateUnlocked(state, weekStart);
  let removedDays = 0;
  let removedDuties = 0;
  let removedRealized = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addDays(weekStart, offset);
    const assignment = state.duties.assignments[day];
    if (!assignment) continue;
    if (mode === 'generated') {
      if (!String(assignment.source || '').startsWith('generated')) continue;
      const preservedIds = [...new Set([
        ...(assignment.manualEmployeeIds || []),
        ...(assignment.realizedEmployeeIds || []),
      ])]
        .filter((id) => assignment.employeeIds?.includes(id));
      const removedIds = (assignment.employeeIds || []).filter((id) => !preservedIds.includes(id));
      if (!removedIds.length && preservedIds.length) continue;
      removedDays += 1;
      removedDuties += removedIds.length;
      removedRealized += (assignment.realizedEmployeeIds || [])
        .filter((id) => removedIds.includes(id)).length;
      if (preservedIds.length) {
        state.duties.assignments[day] = {
          date: day,
          employeeIds: preservedIds,
          realizedEmployeeIds: (assignment.realizedEmployeeIds || [])
            .filter((id) => preservedIds.includes(id)),
          singleApproved: false,
          source: 'manual',
          updatedAt: now.toISOString(),
        };
      } else {
        delete state.duties.assignments[day];
      }
      continue;
    }
    removedDays += 1;
    removedDuties += assignment.employeeIds?.length || 0;
    removedRealized += assignment.realizedEmployeeIds?.length || 0;
    delete state.duties.assignments[day];
  }
  if (removedDays) {
    appendAudit(state, 'duty_week_cleared', {
      scheduleId: state.activeDutyScheduleId,
      weekStart,
      mode,
      removedDays,
      removedDuties,
      removedRealized,
    }, now);
  }
  return { weekStart, endDate: addDays(weekStart, 6), mode, removedDays, removedDuties, removedRealized };
}

function setDutyDayException(state, date, input = {}, now = new Date()) {
  assertDateKey(date);
  assertDutyDateUnlocked(state, date);
  const exception = {
    date,
    allowConsecutiveDay: Boolean(input.allowConsecutiveDay),
    allowConsecutiveWeekend: Boolean(input.allowConsecutiveWeekend),
    allowRestGap: Boolean(input.allowRestGap),
    allowWeeklyLimit: Boolean(input.allowWeeklyLimit),
    note: String(input.note || '').trim().slice(0, 500),
    createdAt: now.toISOString(),
  };
  if (!Object.values(exception).some((value) => value === true) && !exception.note) {
    delete state.duties.dayExceptions[date];
    appendAudit(state, 'duty_day_exception_cleared', { date }, now);
    return null;
  }
  state.duties.dayExceptions[date] = exception;
  appendAudit(state, 'duty_day_exception_set', { ...exception }, now);
  return exception;
}

function createTimeOffEntry(state, input, now = new Date()) {
  return saveTimeOffEntry(state, input, null, now);
}

function updateTimeOffEntry(state, entryId, input, now = new Date()) {
  if (!state.timeOffEntries.some((entry) => entry.id === entryId)) {
    throw new Error('Запис «Відпросився» не знайдено.');
  }
  return saveTimeOffEntry(state, input, entryId, now);
}

function saveTimeOffEntry(state, input, entryId, now) {
  const employee = getEmployee(state, input.employeeId);
  assertDateKey(input.date);
  const startTime = cleanTime(input.startTime);
  const endTime = cleanTime(input.endTime);
  const durationMinutes = minutesFromTime(endTime) - minutesFromTime(startTime);
  if (durationMinutes <= 0) {
    throw new Error('Час повернення має бути пізнішим за час, коли працівник відпросився.');
  }
  const destination = String(input.destination || '').trim().replace(/\s+/g, ' ');
  if (!destination) throw new Error('Вкажіть, куди або з якої причини відпросився працівник.');
  if (destination.length > 200) throw new Error('Поле «Куди / причина» має містити не більше 200 символів.');
  const note = String(input.note || '').trim();
  if (note.length > 500) throw new Error('Примітка має містити не більше 500 символів.');
  if (state.timeOffEntries.some((entry) => entry.id !== entryId
    && entry.employeeId === employee.id && entry.date === input.date
    && startTime < entry.endTime && endTime > entry.startTime)) {
    throw new Error('У працівника вже є відлучення, що перетинається з цим часом.');
  }
  const previous = entryId ? state.timeOffEntries.find((item) => item.id === entryId) : null;
  const entry = {
    id: entryId || crypto.randomUUID(),
    employeeId: employee.id,
    date: input.date,
    startTime,
    endTime,
    durationMinutes,
    destination,
    note,
    createdAt: previous?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  if (previous) Object.assign(previous, entry);
  else state.timeOffEntries.push(entry);
  appendAudit(state, entryId ? 'time_off_updated' : 'time_off_created', { ...entry }, now);
  return entry;
}

function deleteTimeOffEntry(state, entryId, now = new Date()) {
  const index = state.timeOffEntries.findIndex((entry) => entry.id === entryId);
  if (index < 0) throw new Error('Запис «Відпросився» не знайдено.');
  const [entry] = state.timeOffEntries.splice(index, 1);
  appendAudit(state, 'time_off_deleted', { entryId, employeeId: entry.employeeId }, now);
  return entry;
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
  if (state.settings.automaticClose === false) return 0;
  const today = dateKeyFromDate(now);
  const closeThrough = isPastCloseTime(state, now) ? today : addDays(today, -1);
  let created = 0;

  for (const employee of state.employees) {
    let cursor = employee.createdDate;
    while (cursor <= closeThrough) {
      if (employeeExistsOnDate(employee, cursor) && isEmployeeWorkday(state, employee.id, cursor)) {
        const key = recordKey(employee.id, cursor);
        if (!state.records[key] && !presence.get(state,employee.id,cursor) && !work.workForDay(state,employee.id,cursor,today).length) {
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
  if ([STATUS.SUBMITTED,STATUS.WORKING].includes(status) && date > dateKeyFromDate(now)) {
    throw new Error('Не можна вручну позначити майбутній день як поданий або відпрацьований. Заплануйте роботу з датою початку.');
  }
  const blockingSchedule = DUTY_BLOCKING_RECORD_STATUSES.has(status)
    ? dutySchedules(state).find((schedule) => (
      schedule.data.assignments[date]?.employeeIds?.includes(employeeId)
    ))
    : null;
  if (blockingSchedule) {
    throw new Error(`Працівник призначений черговим на цю дату у графіку «${blockingSchedule.name}». Спочатку змініть графік чергувань.`);
  }
  const key = recordKey(employeeId, date);
  const previous = state.records[key];
  const explicit = state.presenceRecords?.[key];
  if(explicit?.status==='zkp'&&status===STATUS.SUBMITTED){
    if(date>=dateKeyFromDate(now)||presence.get(state,employeeId,dateKeyFromDate(now))?.status!=='onsite')
      throw new Error('Роботу за ЗКП зараховують після повернення в офіс у наступний день. Позначте «На роботі» на дату повернення.');
    if(!String(note).trim())throw new Error('Вкажіть пояснення: за які дні ЗКП отримано роботу.');
  }
  if (explicit && (presence.absent.has(explicit.status)||presence.learning.has(explicit.status)) && !presence.absent.has(status)) {
    throw new Error('Працівник відсутній за даними «Наявності». Спочатку змініть наявність.');
  }
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
  if (explicit && presence.absent.has(status)) presence.write(state,{employeeId,date,status,note},now);
  appendAudit(state, 'status_set', { employeeId, date, status, note:String(note||'').trim(), actor:state.settings.operatorName||'Керівник' }, now);
  return state.records[key];
}

function setManualStatuses(state, { employeeId, startDate, endDate, status, note = '' }, now = new Date()) {
  getEmployee(state, employeeId);
  assertDateKey(startDate);
  assertDateKey(endDate);
  if (startDate > endDate || addDays(startDate, 365) < endDate) {
    throw new Error('Оберіть період не довший за 366 днів.');
  }
  const draft = clone(state);
  const dates = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    if (!employeeExistsOnDate(getEmployee(draft, employeeId), date)
      || !isEmployeeWorkday(draft, employeeId, date)) continue;
    setManualStatus(draft, { employeeId, date, status, note }, now);
    dates.push(date);
  }
  if (!dates.length) throw new Error('У вибраному періоді немає робочих днів.');
  state.records = draft.records;
  state.presenceRecords = draft.presenceRecords;
  state.audit = draft.audit;
  appendAudit(state, 'status_period_set', { employeeId, startDate, endDate, status, count: dates.length }, now);
  return { count: dates.length, dates };
}

function previewManualStatuses(state, input, now = new Date()) {
  return setManualStatuses(clone(state), input, now);
}

function clearManualRecord(state, employeeId, date, now = new Date()) {
  const mark=state.presenceRecords?.[recordKey(employeeId,date)];
  if (mark&&!presence.working.has(mark.status)) throw new Error('Цим днем керує «Наявність». Змініть або очистіть позначку в цьому розділі.');
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

function journalBatchTargets(state, input) {
  let cells;
  if (Array.isArray(input.cells)) cells = input.cells;
  else {
    if (!Array.isArray(input.employeeIds) || !input.employeeIds.length) throw new Error('Оберіть працівників.');
    const dates = journal.datesBetween(input.startDate, input.endDate);
    const weekdays = Array.isArray(input.weekdays) ? new Set(input.weekdays.map(Number)) : null;
    cells = input.employeeIds.flatMap((employeeId) => dates
      .filter((date) => !weekdays || weekdays.has(dayOfWeek(date))).map((date) => ({ employeeId, date })));
  }
  if (!cells.length || cells.length > 5490) throw new Error('Оберіть від 1 до 5490 клітинок.');
  const unique = new Map();
  for (const item of cells) {
    getEmployee(state, item?.employeeId);
    assertDateKey(item?.date);
    unique.set(recordKey(item.employeeId, item.date), { employeeId: item.employeeId, date: item.date });
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));
}

function journalBatchPlan(state, input, now = new Date()) {
  const action = input.action || 'status';
  if (!['status', 'clear', 'make_workday', 'restore_weekend'].includes(action)) throw new Error('Невідома дія табеля.');
  if (action === 'status' && !MANUAL_STATUSES.has(input.status)) throw new Error('Оберіть допустимий статус.');
  const cells = journalBatchTargets(state, input);
  const note = String(input.note || '').trim().slice(0, 500);
  const draft = clone(state);
  draft.audit = [];
  const changes = [];
  const blocked = [];
  const skipped = [];
  for (const { employeeId, date } of cells) {
    const employee = getEmployee(state, employeeId);
    const key = recordKey(employeeId, date);
    const previous = state.records[key];
    const item = { employeeId, name: employee.name, date,
      from: work.statusForDay(state,employeeId,date,dateKeyFromDate(now)) };
    if (date >= employee.createdDate && !employeeExistsOnDate(employee, date)) {
      skipped.push({ ...item, reason: 'Поза періодом роботи працівника.' });
      continue;
    }
    if (action === 'status' && !isEmployeeWorkday(state, employeeId, date) && !input.includeWeekends) {
      skipped.push({ ...item, reason: 'Вихідний — включення вихідних вимкнене.' });
      continue;
    }
    if (action === 'status' && input.replaceExisting === false && ((state.presenceRecords?.[key]&&!presence.working.has(state.presenceRecords[key].status)) || previous && previous.status !== 'pending')) {
      skipped.push({ ...item, reason: 'Уже має статус; заміну наявних позначок вимкнено.' });
      continue;
    }
    if (action === 'clear' && !state.presenceRecords?.[key] && (!previous || previous.source === 'automatic_close')) {
      skipped.push({ ...item, reason: previous ? 'Автоматичний пропуск: змініть статус, щоб виправити його.' : 'Ручної позначки немає.' });
      continue;
    }
    if (action === 'make_workday' && isEmployeeWorkday(state, employeeId, date)) {
      skipped.push({ ...item, reason: 'Уже робочий день.' });
      continue;
    }
    if (action === 'restore_weekend' && !state.workdayOverrides[key]) {
      skipped.push({ ...item, reason: 'Окремого робочого вихідного немає.' });
      continue;
    }
    if (action === 'restore_weekend' && isWorkday(state, date)) {
      skipped.push({ ...item, reason: 'Дата є загальним робочим днем за поточними налаштуваннями календаря.' });
      continue;
    }
    if (previous?.receiptId) {
      blocked.push({ ...item, reason: 'Захищений запис попереднього обліку. Спочатку виправте статус дня з поясненням.' });
      continue;
    }
    // setManualStatus validates first. A blocked status must not leave a
    // workday override behind when the user skips blocked cells.
    try {
      if (action === 'status') {
        setManualStatus(draft, { employeeId, date, status: input.status, note }, now);
        if (!isEmployeeWorkday(draft, employeeId, date)) setWorkdayOverride(draft, employeeId, date, note, now);
      } else if (action === 'clear') clearManualRecord(draft, employeeId, date, now);
      else if (action === 'make_workday') setWorkdayOverride(draft, employeeId, date, note, now);
      else clearWorkdayOverride(draft, employeeId, date, now);
      draft.audit = [];
      let to = action === 'status' ? input.status : action === 'make_workday' ? 'workday' : action === 'restore_weekend' ? 'weekend' : work.statusForDay(draft,employeeId,date,dateKeyFromDate(now));
      if (action === 'clear' && !work.workForDay(draft,employeeId,date).length && state.settings.automaticClose !== false && employeeExistsOnDate(employee, date)
        && isEmployeeWorkday(state, employeeId, date)
        && (date < dateKeyFromDate(now) || (date === dateKeyFromDate(now) && isPastCloseTime(state, now)))) to = 'missed';
      changes.push({ ...item, to,
        madeWorkday: action === 'status' && !isEmployeeWorkday(state, employeeId, date) });
    } catch (error) {
      blocked.push({ ...item, reason: error.message });
    }
  }
  const token = crypto.createHash('sha256').update(JSON.stringify({ input: { ...input, expectedToken: undefined },
    cells: cells.map(({ employeeId, date }) => ({ employeeId, date,
      employee: getEmployee(state, employeeId), record: state.records[recordKey(employeeId, date)] || null,
      override: state.workdayOverrides[recordKey(employeeId, date)] || null,
      presence: state.presenceRecords?.[recordKey(employeeId,date)] || null,
      duties: dutySchedules(state).map((schedule) => ({ id: schedule.id, ids: schedule.data.assignments[date]?.employeeIds || [] })),
    })), workEntries:(state.workEntries||[]).map(entry=>[entry.id,entry.revision]), workdays: state.settings.workdays,
    closeSettings: action === 'clear' ? { automaticClose: state.settings.automaticClose,
      closeHour: state.settings.closeHour, closeMinute: state.settings.closeMinute, due: isPastCloseTime(state, now) } : null,
    today: dateKeyFromDate(now) })).digest('hex');
  return { draft, action, note, cells, result: { token, count: changes.length, changes, blocked, skipped,
    canApply: changes.length > 0 && (input.skipBlocked === true || blocked.length === 0) } };
}

function previewJournalBatch(state, input, now = new Date()) {
  return journalBatchPlan(state, input, now).result;
}

function applyJournalBatch(state, input, now = new Date()) {
  const plan = journalBatchPlan(state, input, now);
  if (input.expectedToken && input.expectedToken !== plan.result.token) throw new Error('Дані змінилися після перевірки. Перевірте клітинки ще раз.');
  if (!plan.result.canApply) {
    if (plan.result.blocked.length) throw new Error(`Дію заблоковано: ${plan.result.blocked[0].reason} Нічого не змінено.`);
    throw new Error('Немає клітинок, які можна змінити.');
  }
  state.records = plan.draft.records;
  state.presenceRecords = plan.draft.presenceRecords;
  state.workdayOverrides = plan.draft.workdayOverrides;
  appendAudit(state, 'journal_batch_applied', { action: plan.action, status: input.status || null, note: plan.note,
    actor:state.settings.operatorName||'Керівник', count: plan.result.count, cells: plan.result.changes.map(({ employeeId, date }) => ({ employeeId, date })),
    blocked: plan.result.blocked.length, skipped: plan.result.skipped.length }, now);
  return plan.result;
}

function calculateJournalReport(state, filter, now = new Date()) {
  if (filter.employeeIds && (!Array.isArray(filter.employeeIds) || filter.employeeIds.some((id) => !state.employees.some((employee) => employee.id === id)))) {
    throw new Error('Некоректний список працівників.');
  }
  return journal.report(state, filter, dateKeyFromDate(now));
}

function recordSubmission(state, input, now = new Date(), { allowArchived = false } = {}) {
  const employee = getEmployee(state, input.employeeId);
  if (!employee.active && !allowArchived) {
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

function previewSubmission(state, input, now = new Date()) {
  const draft = clone(state);
  const receipt = recordSubmission(draft, input, now);
  return {
    dates: receipt.allocations.map((item) => item.date),
    unallocatedCredit: receipt.unallocatedCredit,
    creditUnits: receipt.creditUnits,
  };
}

function correctReceipt(state, receiptId, input, now = new Date()) {
  const previous = state.receipts.find((item) => item.id === receiptId);
  if (!previous) throw new Error('Документ не знайдено.');
  if (previous.allocations.some(({ date }) => (
    state.records[recordKey(previous.employeeId, date)]?.receiptId !== receiptId
  ))) throw new Error('Один із днів документа вже змінено. Виправлення потребує ручної перевірки.');
  const draft = clone(state);
  const old = draft.receipts.find((item) => item.id === receiptId);
  for (const allocation of [...old.allocations].reverse()) {
    const key = recordKey(old.employeeId, allocation.date);
    if (allocation.previousRecord) draft.records[key] = allocation.previousRecord;
    else delete draft.records[key];
  }
  draft.receipts = draft.receipts.filter((item) => item.id !== receiptId);
  const corrected = recordSubmission(draft, {
    ...input,
    employeeId: old.employeeId,
  }, new Date(old.receivedAt), { allowArchived: true });
  const temporaryReceiptId = corrected.id;
  draft.audit = draft.audit.filter((item) => (
    item.action !== 'receipt_recorded' || item.details?.receiptId !== temporaryReceiptId
  ));
  corrected.id = receiptId;
  corrected.receivedAt = old.receivedAt;
  corrected.receivedDate = old.receivedDate;
  for (const allocation of corrected.allocations) {
    draft.records[recordKey(old.employeeId, allocation.date)].receiptId = receiptId;
  }
  draft.receipts.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  state.records = draft.records;
  state.receipts = draft.receipts;
  state.audit = draft.audit;
  appendAudit(state, 'receipt_corrected', { receiptId,
    oldDates: old.allocations.map((item) => item.date),
    newDates: corrected.allocations.map((item) => item.date) }, now);
  return corrected;
}

function previewReceiptCorrection(state, receiptId, input, now = new Date()) {
  const draft = clone(state);
  const receipt = correctReceipt(draft, receiptId, input, now);
  return {
    dates: receipt.allocations.map((item) => item.date),
    unallocatedCredit: receipt.unallocatedCredit,
    creditUnits: receipt.creditUnits,
  };
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
  const mark = presence.get(state,employeeId,date);
  if (mark && presence.absent.has(mark.status)) return mark.status;
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
  const lockedAffectedDate = Object.values(state.duties.assignments).find((assignment) => (
    assignment.date >= today
    && assignment.employeeIds?.some((employeeId) => removedIds.has(employeeId))
    && dutyDateLocked(state, assignment.date)
  ))?.date;
  if (lockedAffectedDate) {
    throw new Error(`Не можна вилучити учасника: тиждень із датою ${lockedAffectedDate} заблоковано.`);
  }
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
  assertDutyDateUnlocked(state, date);
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
  assertDutyDateUnlocked(state, date);
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

function setDutyAssignment(state, { date, employeeIds, singleApproved = false, note = '' }, now = new Date()) {
  assertDateKey(date);
  assertDutyDateUnlocked(state, date);
  if (!Array.isArray(employeeIds)) throw new Error('Не передано склад чергових.');
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (ids.length > dutyRequiredCount(state, date)) {
    throw new Error(`За правилами на цей день потрібно ${dutyRequiredCount(state, date)} чергових. Спочатку змініть кількість у правилах.`);
  }
  if (ids.length === 1 && dutyRequiredCount(state, date) > 1 && !singleApproved) {
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
      singleApproved: ids.length === 1
        && (Boolean(singleApproved) || dutyRequiredCount(state, date) === 1),
      source: 'manual',
      note: String(note || '').trim().slice(0, 500),
      updatedAt: now.toISOString(),
    };
    state.duties.assignments[date].explanation = explainDutyAssignment(state, date, ids, { now, provenance: 'manual' });
  }
  appendAudit(state, 'duty_assignment_set', { date, employeeIds: ids, singleApproved }, now);
  return state.duties.assignments[date] || { date, employeeIds: [], cleared: true };
}

function toggleDutyAssignment(state, employeeId, date, now = new Date()) {
  const employee = getEmployee(state, employeeId);
  assertDateKey(date);
  assertDutyDateUnlocked(state, date);
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
    if (ids.length >= dutyRequiredCount(state, date)) {
      throw new Error('Склад цього дня вже заповнено за правилами. Змініть кількість або зніміть одного з чергових.');
    }
    ids.push(employeeId);
  }

  if (ids.length === 0) {
    delete state.duties.assignments[date];
  } else {
    state.duties.assignments[date] = {
      date,
      employeeIds: ids,
      realizedEmployeeIds: (previous?.realizedEmployeeIds || []).filter((id) => ids.includes(id)),
      singleApproved: ids.length === 1 && (
        dutyRequiredCount(state, date) === 1
        || (existingIndex < 0 && previous?.singleApproved === true)
      ),
      source: 'manual_quick',
      note: previous?.note || '',
      updatedAt: now.toISOString(),
    };
    state.duties.assignments[date].explanation = explainDutyAssignment(state, date, ids, { now, provenance: 'manual' });
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
  assertDutyDateUnlocked(state, date);
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
    state.duties.assignments[date].explanation = explainDutyAssignment(state, date, ids, { now, provenance: 'manual' });
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
  assertDutyDateUnlocked(state, date);
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

function dutyFixedEmployeeIds(assignment) {
  const ids = [...new Set(assignment?.employeeIds || [])];
  if (assignment?.source !== 'generated_shortage') return ids;
  // An incomplete automatic choice is provisional. Only the people whom the
  // user originally entered by hand must survive a later completion attempt.
  return ids.filter((id) => assignment.manualEmployeeIds?.includes(id)
    || assignment.realizedEmployeeIds?.includes(id));
}

function applyDutyPins(state, pinnedAssignments, startDate, endDate, now) {
  if (!Array.isArray(pinnedAssignments)) throw new Error('Некоректний список закріплень.');
  const proposed = new Map();
  const rules = normalizeDutyRules(state.duties.rules);
  for (const entry of pinnedAssignments) {
    const date = entry?.date;
    assertDateKey(date);
    if (date < startDate || date > endDate || proposed.has(date)) {
      throw new Error('Закріплення має бути в межах вибраного тижня без повторення дати.');
    }
    if (!Array.isArray(entry.employeeIds) || entry.employeeIds.length < 1
      || entry.employeeIds.length > 15 || new Set(entry.employeeIds).size !== entry.employeeIds.length) {
      throw new Error('Для закріплення оберіть від 1 до 15 різних працівників.');
    }
    const existing = state.duties.assignments[date];
    const fixedIds = dutyFixedEmployeeIds(existing);
    if (fixedIds.length >= dutyRequiredCount(state, date) || existing?.singleApproved) {
      throw new Error(`Склад на ${date} уже готовий. Спочатку очистіть або змініть його вручну.`);
    }
    const ids = [...new Set([...fixedIds, ...entry.employeeIds])];
    if (ids.length > dutyRequiredCount(state, date)) {
      throw new Error(`На ${date} закріплено більше людей, ніж потрібно за правилами графіка.`);
    }
    for (const employeeId of entry.employeeIds) {
      const employee = getEmployee(state, employeeId);
      if (!employee.active || dutyRestriction(state, employeeId, date)) {
        throw new Error(`«${employee.name}» недоступний для чергування ${date}.`);
      }
    }
    proposed.set(date, { ids, newIds: entry.employeeIds.filter((id) => !fixedIds.includes(id)) });
  }
  const fixedOn = (date) => proposed.get(date)?.ids
    || dutyFixedEmployeeIds(state.duties.assignments[date]);
  for (const [date, { newIds }] of proposed) {
    const exception = state.duties.dayExceptions?.[date] || {};
    const nextDate = addDays(date, 1);
    const nextException = state.duties.dayExceptions?.[nextDate] || {};
    if (rules.preventConsecutiveDays && newIds.some((id) => (
      (!exception.allowConsecutiveDay && fixedOn(addDays(date, -1)).includes(id))
      || (!nextException.allowConsecutiveDay && fixedOn(nextDate).includes(id))
    ))) {
      throw new Error(`Закріплення на ${date} створює чергування два дні поспіль. Змініть склад або задайте разовий виняток.`);
    }
    if (rules.minimumRestMode === 'require'
      && newIds.some((id) => {
        for (let offset = 1; offset <= rules.minimumRestDays; offset += 1) {
          const previous = addDays(date, -offset);
          const next = addDays(date, offset);
          if ((!exception.allowRestGap && fixedOn(previous).includes(id))
            || (!state.duties.dayExceptions?.[next]?.allowRestGap && fixedOn(next).includes(id))) return true;
        }
        return false;
      })) {
      throw new Error(`Закріплення на ${date} порушує обов’язковий інтервал відпочинку.`);
    }
    if (rules.preventConsecutiveWeekends
      && [0, 6].includes(dayOfWeek(date))) {
      if (newIds.some((id) => dutyWeekendConflict(state, date, id, rules, fixedOn))) {
        throw new Error(`Закріплення на ${date} порушує інтервал між уікендами.`);
      }
    }
    if (rules.maximumDutiesPerWeek > 0 && !exception.allowWeeklyLimit) {
      const weekStart = dutyWeekStart(date);
      if (newIds.some((id) => Array.from({ length: 7 }, (_, offset) => (
        fixedOn(addDays(weekStart, offset)).includes(id) ? 1 : 0
      )).reduce((sum, count) => sum + count, 0) > rules.maximumDutiesPerWeek)) {
        throw new Error(`Закріплення на ${date} перевищує тижневий ліміт чергувань.`);
      }
    }
  }
  for (const [date, { ids }] of proposed) {
    const previous = state.duties.assignments[date];
    state.duties.assignments[date] = {
      date,
      employeeIds: ids,
      realizedEmployeeIds: (previous?.realizedEmployeeIds || []).filter((id) => ids.includes(id)),
      singleApproved: false,
      source: 'manual_quick',
      note: previous?.note || '',
      updatedAt: now.toISOString(),
    };
  }
  for (const date of proposed.keys()) {
    const assignment = state.duties.assignments[date];
    assignment.explanation = explainDutyAssignment(state, date, assignment.employeeIds, { now, provenance: 'manual' });
  }
  if (proposed.size) appendAudit(state, 'duty_pins_applied', {
    scheduleId: state.activeDutyScheduleId,
    dates: [...proposed.keys()],
  }, now);
}

function dutyAssignmentOptions(state, date, dutyQueue, employeesById) {
  const existing = state.duties.assignments[date];
  const fixedIds = dutyFixedEmployeeIds(existing);
  const requiredCount = dutyRequiredCount(state, date);
  if (fixedIds.length >= requiredCount || (fixedIds.length === 1 && existing?.singleApproved)) {
    return [{ employeeIds: fixedIds, addedIds: [], fixed: true, missing: 0 }];
  }

  const rules = normalizeDutyRules(state.duties.rules);
  const nextDate = addDays(date, 1);
  const nextDayFixedIds = dutyFixedEmployeeIds(state.duties.assignments[nextDate]);
  const nextDayException = state.duties.dayExceptions?.[nextDate] || {};
  const candidates = dutyQueue.filter((employeeId) => {
    const employee = employeesById.get(employeeId);
    return employee?.active
      && !fixedIds.includes(employeeId)
      && !dutyRestriction(state, employeeId, date)
      && (!rules.preventConsecutiveDays || nextDayException.allowConsecutiveDay
        || !nextDayFixedIds.includes(employeeId));
  });
  const needed = requiredCount - fixedIds.length;
  const options = [{
    employeeIds: fixedIds,
    addedIds: [],
    fixed: false,
    missing: needed,
  }];
  const chosen = [];
  const combinations = (from, size) => {
    if (chosen.length === size) {
      options.push({ employeeIds: [...fixedIds, ...chosen], addedIds: [...chosen],
        fixed: false, missing: needed - size });
      return;
    }
    for (let index = from; index <= candidates.length - (size - chosen.length); index += 1) {
      chosen.push(candidates[index]);
      combinations(index + 1, size);
      chosen.pop();
    }
  };
  for (let size = 1; size <= Math.min(needed, candidates.length); size += 1) {
    if (rules.shortageBehavior !== 'require_full_day' || size === needed) combinations(0, size);
  }
  return options;
}

function dutyRequiredCount(state, date) {
  const rules = normalizeDutyRules(state.duties.rules);
  const weekday = dayOfWeek(date);
  if (Object.hasOwn(rules.requiredByWeekday, weekday)) return rules.requiredByWeekday[weekday];
  return weekday === 0 || weekday === 6
    ? rules.weekendDutyCount
    : rules.weekdayDutyCount;
}

function compareDutyScores(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function dutyPreferenceScore(rules, metrics) {
  const { spread, compensationDeficit, cooldownViolations, weekendReservePenalty,
    repeatedPairPenalty, squares, queueCost } = metrics;
  if (rules.planningPriority === 'rest') return [cooldownViolations, spread, compensationDeficit, weekendReservePenalty, repeatedPairPenalty, squares, queueCost];
  if (rules.planningPriority === 'rotation') return [queueCost, spread, compensationDeficit, cooldownViolations, weekendReservePenalty, repeatedPairPenalty, squares];
  if (rules.planningPriority === 'pairs') return [repeatedPairPenalty, spread, compensationDeficit, cooldownViolations, weekendReservePenalty, squares, queueCost];
  return [spread, compensationDeficit, cooldownViolations, weekendReservePenalty, repeatedPairPenalty, squares, queueCost];
}

function dutyRestConflict(state, date, employeeId, rules, selectedOptions) {
  if (rules.minimumRestDays < 1) return false;
  for (let offset = 1; offset <= rules.minimumRestDays; offset += 1) {
    const previous = addDays(date, -offset);
    const next = addDays(date, offset);
    if (!state.duties.dayExceptions?.[date]?.allowRestGap && (selectedOptions?.get(previous)?.employeeIds
      || state.duties.assignments[previous]?.employeeIds || []).includes(employeeId)) return true;
    if (!state.duties.dayExceptions?.[next]?.allowRestGap && (selectedOptions?.get(next)?.employeeIds
      || dutyFixedEmployeeIds(state.duties.assignments[next])).includes(employeeId)) return true;
  }
  return false;
}

function dutyPairKey(employeeIds) {
  if (employeeIds.length !== 2) return '';
  return [...employeeIds].sort().join('|');
}

function dutyPairKeys(employeeIds) {
  const ids = [...new Set(employeeIds)];
  const keys = [];
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      keys.push(dutyPairKey([ids[left], ids[right]]));
    }
  }
  return keys;
}

function dutyWeekendConflict(state, date, employeeId, rules, idsOnDate) {
  if (!rules.preventConsecutiveWeekends || ![0, 6].includes(dayOfWeek(date))) return false;
  const saturday = dayOfWeek(date) === 6 ? date : addDays(date, -1);
  const idsOn = idsOnDate || ((day) => day < date
    ? state.duties.assignments[day]?.employeeIds || []
    : dutyFixedEmployeeIds(state.duties.assignments[day]));
  const exception = state.duties.dayExceptions || {};
  for (let week = 1; week <= rules.weekendRestWeeks; week += 1) {
    for (const offset of [0, 1]) {
      const previous = addDays(saturday, -7 * week + offset);
      const next = addDays(saturday, 7 * week + offset);
      if (!exception[date]?.allowConsecutiveWeekend && idsOn(previous).includes(employeeId)) return true;
      if (!exception[next]?.allowConsecutiveWeekend && idsOn(next).includes(employeeId)) return true;
    }
  }
  return false;
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
  const rules = normalizeDutyRules(state.duties.rules);
  const currentWeekStart = dutyWeekStart(startDate);
  const previousWeekStart = addDays(currentWeekStart, -7);
  const previousWeekEnd = addDays(currentWeekStart, -1);
  const previousWeekCounts = dutyCountsBetween(state, previousWeekStart, previousWeekEnd);
  const eligible = new Set(eligibleEmployeeIds);
  return new Map(
    state.duties.participantIds
      .filter((employeeId) => eligible.has(employeeId) && previousWeekCounts[employeeId] === rules.compensationFrom)
      .map((employeeId) => [employeeId, rules.compensationTarget]),
  );
}

function dutyCompensationDeficit(counts, compensationTargets) {
  let deficit = 0;
  for (const [employeeId, target] of compensationTargets) {
    deficit += Math.max(0, target - (counts[employeeId] || 0));
  }
  return deficit;
}

function dutyPairHistoryStart(rules, date) {
  if (rules.pairHistoryPeriod === 'all') return '0001-01-01';
  if (rules.pairHistoryPeriod === 'rolling') return addDays(date, -rules.pairHistoryDays);
  const [year, month] = date.split('-').map(Number);
  if (rules.pairHistoryPeriod === 'month') {
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }
  if (rules.pairHistoryPeriod === 'quarter') {
    const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return `${year}-${String(quarterMonth).padStart(2, '0')}-01`;
  }
  return `${year}-01-01`;
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
  const rules = normalizeDutyRules(state.duties.rules);
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

  // Larger teams have many more combinations. Bound memory without changing
  // the established search width for the original one/two-person schedules.
  const largestOptionCount = Math.max(...optionsByDate.map((options) => options.length));
  const beamWidth = largestOptionCount > 200
    ? Math.max(1, Math.min(1200, Math.floor(100000 / largestOptionCount))) : 1200;
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
    score: [0, ...dutyPreferenceScore(rules, {
      spread: 0, compensationDeficit: dutyCompensationDeficit(rangeCounts, compensationTargets),
      cooldownViolations: 0, weekendReservePenalty: 0, repeatedPairPenalty: 0,
      squares: 0, queueCost: 0,
    })],
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
      for (const option of optionsByDate[dateIndex]) {
        const exception = state.duties.dayExceptions?.[date] || {};
        if (rules.preventConsecutiveDays && !exception.allowConsecutiveDay
          && option.addedIds.some((employeeId) => previousDayIds.has(employeeId))) continue;
        if (option.addedIds.some((id) => dutyWeekendConflict(state, date, id, rules,
          (day) => partial.selectedOptions.get(day)?.employeeIds
            || (day < dates[0] ? state.duties.assignments[day]?.employeeIds || []
              : dutyFixedEmployeeIds(state.duties.assignments[day]))))) continue;
        if (rules.maximumDutiesPerWeek > 0 && !exception.allowWeeklyLimit
          && option.addedIds.some((employeeId) => (
            (partial.counts[employeeId] || 0) >= rules.maximumDutiesPerWeek
          ))) continue;
        if (rules.minimumRestMode === 'require'
          && option.addedIds.some((id) => dutyRestConflict(state, date, id, rules, partial.selectedOptions))) continue;

        const nextCounts = { ...partial.counts };
        let addedCooldownViolations = 0;
        let addedWeekendReservePenalty = 0;
        let addedQueueCost = 0;
        for (const employeeId of option.addedIds) {
          if (!exception.allowRestGap && rules.minimumRestDays > 0) {
            for (let offset = 1; offset <= rules.minimumRestDays; offset += 1) {
              const priorIds = new Set(
                partial.selectedOptions.get(addDays(date, -offset))?.employeeIds
                  || state.duties.assignments[addDays(date, -offset)]?.employeeIds
                  || [],
              );
              if (priorIds.has(employeeId)) addedCooldownViolations += 1;
            }
          }
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
        if (!option.fixed) {
          for (const pairKey of dutyPairKeys(option.employeeIds)) {
            const repeats = nextPairCounts.get(pairKey) || 0;
            addedPairPenalty += rules.avoidRepeatedPairs ? repeats : 0;
            nextPairCounts.set(pairKey, repeats + 1);
          }
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
        const compensationDeficit = rules.compensateNextWeek
          ? dutyCompensationDeficit(nextCounts, compensationTargets)
          : 0;
        const score = [missingSlots, ...dutyPreferenceScore(rules, {
          spread: balance.spread, compensationDeficit, cooldownViolations,
          weekendReservePenalty, repeatedPairPenalty, squares: balance.squares, queueCost,
        })];
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
  let searchLimited = false;
  // The beam ranks partial weeks for fairness, but pruning can discard the
  // only combination that fills a later constrained day. Verify shortages
  // against the hard rules before presenting one to the user.
  if (best.missingSlots > 0 && optionsByDate.every((options) => options.some((option) => !option.missing))) {
    const visited = new Set();
    let inspected = 0;
    const selected = new Map();
    const futureAvailability = dates.map((_, index) => {
      const availability = new Map();
      for (const options of optionsByDate.slice(index + 1)) {
        const availableIds = new Set(options.flatMap((option) => option.addedIds));
        for (const id of availableIds) availability.set(id, (availability.get(id) || 0) + 1);
      }
      return availability;
    });
    const search = (index, counts) => {
      if (index === dates.length) return true;
      if (++inspected > 200000) {
        searchLimited = true;
        return false;
      }
      const date = dates[index];
      const previousIds = selected.get(addDays(date, -1))?.employeeIds
        || state.duties.assignments[addDays(date, -1)]?.employeeIds || [];
      const restHistory = rules.minimumRestMode === 'require'
        ? Array.from({ length: Math.max(0, rules.minimumRestDays - 1) }, (_, i) => (
          selected.get(addDays(date, -i - 2))?.employeeIds
          || state.duties.assignments[addDays(date, -i - 2)]?.employeeIds || []
        ).join(',')).join(';') : '';
      const key = `${index}|${[...previousIds].sort().join(',')}|${restHistory}|${rules.maximumDutiesPerWeek
        ? balanceEmployeeIds.map((id) => counts[id] || 0).join(',') : ''}`;
      if (visited.has(key)) return false;
      const exception = state.duties.dayExceptions?.[date] || {};
      const weekday = dayOfWeek(date);
      const remainingAvailability = futureAvailability[index];
      const options = optionsByDate[index].filter((option) => !option.missing)
        .sort((left, right) => (
          left.addedIds.reduce((sum, id) => sum + (remainingAvailability.get(id) || 0), 0)
          - right.addedIds.reduce((sum, id) => sum + (remainingAvailability.get(id) || 0), 0)
          || left.addedIds.reduce((sum, id) => sum + (counts[id] || 0), 0)
            - right.addedIds.reduce((sum, id) => sum + (counts[id] || 0), 0)
          || left.employeeIds.join(',').localeCompare(right.employeeIds.join(','))
        ));
      for (const option of options) {
        if (rules.preventConsecutiveDays && !exception.allowConsecutiveDay
          && option.addedIds.some((id) => previousIds.includes(id))) continue;
        if (option.addedIds.some((id) => dutyWeekendConflict(state, date, id, rules,
          (day) => selected.get(day)?.employeeIds
            || (day < dates[0] ? state.duties.assignments[day]?.employeeIds || []
              : dutyFixedEmployeeIds(state.duties.assignments[day]))))) continue;
        if (rules.maximumDutiesPerWeek > 0 && !exception.allowWeeklyLimit
          && option.addedIds.some((id) => (counts[id] || 0) >= rules.maximumDutiesPerWeek)) continue;
        if (rules.minimumRestMode === 'require'
          && option.addedIds.some((id) => dutyRestConflict(state, date, id, rules, selected))) continue;
        const nextCounts = { ...counts };
        for (const id of option.addedIds) nextCounts[id] = (nextCounts[id] || 0) + 1;
        selected.set(date, option);
        if (search(index + 1, nextCounts)) return true;
        selected.delete(date);
      }
      visited.add(key);
      return false;
    };
    if (search(0, rangeCounts)) {
      return {
        selectedByDate: new Map([...selected].map(([date, option]) => [date, [...option.employeeIds]])),
        addedByDate: new Map([...selected].map(([date, option]) => [date, [...option.addedIds]])),
        shortages: [],
        searchLimited: false,
      };
    }
  }
  return {
    score: best.score,
    signature: best.signature,
    selectedByDate: new Map([...best.selectedOptions].map(([date, option]) => [date, [...option.employeeIds]])),
    addedByDate: new Map([...best.selectedOptions].map(([date, option]) => [date, [...option.addedIds]])),
    shortages: dates
      .map((date) => ({ date, missing: best.selectedOptions.get(date)?.missing || 0 }))
      .filter((item) => item.missing > 0),
    searchLimited,
  };
}

function dutyDecisionBasis(state, dates, queue, counts, balanceIds, pairs, targets) {
  return {
    dates, queue: [...queue], counts: { ...counts }, balanceIds: [...balanceIds],
    pairs: [...pairs], targets: [...targets],
    fixed: Object.fromEntries(dates.map((date) => [date, dutyFixedEmployeeIds(state.duties.assignments[date])])),
    approvedSingles: dates.filter((date) => state.duties.assignments[date]?.singleApproved),
    exceptions: clone(state.duties.dayExceptions || {}), rules: normalizeDutyRules(state.duties.rules),
    required: Object.fromEntries(dates.map((date) => [date, dutyRequiredCount(state, date)])),
    outside: Object.fromEntries(Object.entries(state.duties.assignments)
      .filter(([date]) => !dates.includes(date)).map(([date, assignment]) => [date, [...(assignment.employeeIds || [])]])),
  };
}

function dutyDecisionMetrics(basis, plan) {
  const rules = basis.rules;
  const counts = { ...basis.counts };
  const queue = [...basis.queue];
  const pairCounts = new Map(basis.pairs);
  const idsOn = (date) => plan.get(date) || basis.outside[date] || [];
  const weekendDate = basis.dates.find((date) => [0, 6].includes(dayOfWeek(date)));
  const saturday = weekendDate && (dayOfWeek(weekendDate) === 6 ? weekendDate : addDays(weekendDate, -1));
  const previousWeekend = new Set(saturday
    ? [addDays(saturday, -7), addDays(saturday, -6)].flatMap(idsOn) : []);
  let missing = 0;
  let cooldownViolations = 0;
  let weekendReservePenalty = 0;
  let repeatedPairPenalty = 0;
  let queueCost = 0;
  for (const date of basis.dates) {
    const ids = idsOn(date);
    const fixed = basis.fixed[date];
    const added = ids.filter((id) => !fixed.includes(id));
    const complete = fixed.length >= basis.required[date] || basis.approvedSingles.includes(date);
    missing += basis.approvedSingles.includes(date) ? 0 : Math.max(0, basis.required[date] - ids.length);
    for (const id of added) {
      counts[id] = (counts[id] || 0) + 1;
      queueCost += Math.max(0, queue.indexOf(id));
      if (!basis.exceptions[date]?.allowRestGap) {
        for (let offset = 1; offset <= rules.minimumRestDays; offset += 1) {
          if (idsOn(addDays(date, -offset)).includes(id)) cooldownViolations += 1;
        }
      }
      if (weekendDate && ![0, 6].includes(dayOfWeek(date)) && !previousWeekend.has(id)) weekendReservePenalty += 1;
    }
    if (!complete) {
      for (const key of dutyPairKeys(ids)) {
        const repeats = pairCounts.get(key) || 0;
        repeatedPairPenalty += rules.avoidRepeatedPairs ? repeats : 0;
        pairCounts.set(key, repeats + 1);
      }
    }
    moveDutyQueueToEnd(queue, ids);
  }
  const balance = dutyBalanceMetrics(counts, basis.balanceIds);
  const metrics = { spread: balance.spread, squares: balance.squares, cooldownViolations,
    weekendReservePenalty, repeatedPairPenalty, queueCost,
    compensationDeficit: rules.compensateNextWeek ? dutyCompensationDeficit(counts, new Map(basis.targets)) : 0 };
  return { ...metrics, missing, score: [missing, ...dutyPreferenceScore(rules, metrics)] };
}

function dutyScoreLabels(rules) {
  const common = ['Різниця навантаження', 'Невиконана компенсація', 'Скорочення бажаного відпочинку',
    'Резерв людей на вихідні', 'Повтори пар', 'Сума квадратів навантаження', 'Відхилення від черги'];
  const order = rules.planningPriority === 'rest' ? [2, 0, 1, 3, 4, 5, 6]
    : rules.planningPriority === 'rotation' ? [6, 0, 1, 2, 3, 4, 5]
      : rules.planningPriority === 'pairs' ? [4, 0, 1, 2, 3, 5, 6] : [0, 1, 2, 3, 4, 5, 6];
  return ['Порожні місця', ...order.map((index) => common[index])];
}

function writeGeneratedDutyAssignment(state, date, employeeIds, now, shortage = false) {
  const existing = state.duties.assignments[date];
  const existingIds = [...new Set(existing?.employeeIds || [])];
  const manualIds = dutyFixedEmployeeIds(existing);
  const existingComplete = existingIds.length >= dutyRequiredCount(state, date)
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
      : manualIds.length ? 'generated_completion' : 'generated',
    manualEmployeeIds: manualIds,
    explanation: explainDutyAssignment(state, date, employeeIds),
    updatedAt: now.toISOString(),
  };
  return true;
}

function generateDutySchedule(state, { startDate, endDate, pinnedAssignments = [] }, now = new Date()) {
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
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    assertDutyDateUnlocked(state, date);
  }
  applyDutyPins(state, pinnedAssignments, startDate, endDate, now);

  let cycleYear = startDate.slice(0, 4);
  const rules = normalizeDutyRules(state.duties.rules);
  const pairHistoryStart = dutyPairHistoryStart(rules, startDate);
  let dutyQueue = buildDutyQueue(state, startDate);
  const employeesById = new Map(state.employees.map((employee) => [employee.id, employee]));
  const rangeCounts = Object.fromEntries(
    state.duties.participantIds.map((employeeId) => [employeeId, 0]),
  );
  const pairCounts = new Map();
  for (const assignment of Object.values(state.duties.assignments)) {
    if (assignment.date >= startDate && assignment.date <= endDate) {
      for (const employeeId of dutyFixedEmployeeIds(assignment)) {
        rangeCounts[employeeId] = (rangeCounts[employeeId] || 0) + 1;
      }
    }
    if (assignment.date >= pairHistoryStart && assignment.date <= endDate) {
      for (const pairKey of dutyPairKeys(assignment.employeeIds || [])) {
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
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
  const uncertainDates = [];
  const weekendConflicts = [];
  const changedDates = new Set();
  let generated = 0;
  let cursor = startDate;

  if (span <= 7) {
    const planningDates = [];
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      planningDates.push(date);
    }
    const basis = dutyDecisionBasis(state, planningDates, dutyQueue, rangeCounts, balanceEmployeeIds, pairCounts, compensationTargets);
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
    improveDutyPlan(state, basis, plan);
    shortages.push(...plan.shortages);
    if (plan.searchLimited) uncertainDates.push(...plan.shortages.map((item) => item.date));
    for (const date of planningDates) {
      const selected = plan.selectedByDate.get(date) || [];
      const addedIds = plan.addedByDate.get(date) || [];
      const changed = writeGeneratedDutyAssignment(
        state,
        date,
        selected,
        now,
        selected.length < dutyRequiredCount(state, date),
      );
      if (changed) { generated += 1; changedDates.add(date); }
      moveDutyQueueToEnd(dutyQueue, addedIds);
    }
    for (const date of new Set([...changedDates, ...pinnedAssignments.map((entry) => entry.date)])) {
      const assignment = state.duties.assignments[date];
      assignment.explanation = explainDutyAssignment(state, date, assignment.employeeIds, {
        now, provenance: assignment.source.startsWith('manual') ? 'manual' : 'generated', basis,
      });
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
      uncertainDates,
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
      uncertainDates.push(...plan.shortages.map((item) => item.date));
      for (const date of blockDates) {
        const selected = plan.selectedByDate.get(date);
        const addedIds = plan.addedByDate.get(date);
        const shortage = selected.length < dutyRequiredCount(state, date);
        const changed = writeGeneratedDutyAssignment(state, date, selected, now, shortage);
        if (changed) {
          generated += 1;
          changedDates.add(date);
          for (const employeeId of addedIds) {
            rangeCounts[employeeId] = (rangeCounts[employeeId] || 0) + 1;
          }
          for (const pairKey of dutyPairKeys(selected)) {
            pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
          }
        }
        moveDutyQueueToEnd(dutyQueue, selected);
      }
      cursor = addDays(cursor, blockDates.length);
      continue;
    }

    const existing = state.duties.assignments[cursor];
    const existingIds = dutyFixedEmployeeIds(existing);
    const existingComplete = existingIds.length >= dutyRequiredCount(state, cursor)
      || (existingIds.length === 1 && existing.singleApproved);
    if (existingComplete) {
      moveDutyQueueToEnd(dutyQueue, existing?.employeeIds || []);
      cursor = addDays(cursor, 1);
      continue;
    }

    moveDutyQueueToEnd(dutyQueue, existingIds);

    const previousDayIds = new Set(
      state.duties.assignments[addDays(cursor, -1)]?.employeeIds || [],
    );
    const exception = state.duties.dayExceptions?.[cursor] || {};
    const weekCounts = rules.maximumDutiesPerWeek > 0
      ? dutyCountsBetween(state, dutyWeekStart(cursor), addDays(dutyWeekStart(cursor), 6)) : {};
    const saturday = dayOfWeek(cursor) === 6 ? cursor : addDays(cursor, -1);
    const previousWeekendIds = new Set([addDays(saturday, -7), addDays(saturday, -6)]
      .flatMap((date) => state.duties.assignments[date]?.employeeIds || []));
    const options = dutyAssignmentOptions(state, cursor, dutyQueue, employeesById)
      .filter((option) => (
        !rules.preventConsecutiveDays
        || exception.allowConsecutiveDay
        || option.addedIds.every((employeeId) => !previousDayIds.has(employeeId))
      )).filter((option) => rules.minimumRestMode !== 'require'
        || option.addedIds.every((id) => !dutyRestConflict(state, cursor, id, rules)))
      .filter((option) => rules.maximumDutiesPerWeek === 0 || exception.allowWeeklyLimit
        || option.addedIds.every((id) => (weekCounts[id] || 0) < rules.maximumDutiesPerWeek))
      .filter((option) => option.addedIds.every((id) => !dutyWeekendConflict(state, cursor, id, rules)));
    let best = null;
    for (const option of options) {
      const nextDate = addDays(cursor, 1);
      let nextDayMissing = 0;
      if (nextDate <= endDate) {
        const nextExisting = state.duties.assignments[nextDate];
        const nextFixedIds = [...new Set(nextExisting?.employeeIds || [])];
          const nextComplete = nextFixedIds.length >= dutyRequiredCount(state, nextDate)
            || (nextFixedIds.length === 1 && nextExisting?.singleApproved);
        if (!nextComplete) {
          const selectedToday = new Set(option.employeeIds);
          const nextCandidates = dutyQueue.filter((employeeId) => {
            const employee = employeesById.get(employeeId);
            return employee?.active
              && !nextFixedIds.includes(employeeId)
              && (!rules.preventConsecutiveDays || state.duties.dayExceptions?.[nextDate]?.allowConsecutiveDay
                || !selectedToday.has(employeeId))
              && !dutyRestriction(state, employeeId, nextDate);
          });
          nextDayMissing = Math.max(
            0,
            dutyRequiredCount(state, nextDate) - nextFixedIds.length - nextCandidates.length,
          );
        }
      }
      const simulatedCounts = { ...rangeCounts };
      let cooldownViolations = 0;
      let queueCost = 0;
      for (const employeeId of option.addedIds) {
        if (!exception.allowRestGap && rules.minimumRestDays > 0) {
          for (let offset = 1; offset <= rules.minimumRestDays; offset += 1) {
            if (state.duties.assignments[addDays(cursor, -offset)]?.employeeIds?.includes(employeeId)) {
              cooldownViolations += 1;
            }
          }
        }
        simulatedCounts[employeeId] = (simulatedCounts[employeeId] || 0) + 1;
        const queueIndex = dutyQueue.indexOf(employeeId);
        queueCost += queueIndex < 0 ? dutyQueue.length : queueIndex;
      }
      const balance = dutyBalanceMetrics(simulatedCounts, balanceEmployeeIds);
      const compensationDeficit = rules.compensateNextWeek
        ? dutyCompensationDeficit(simulatedCounts, compensationTargets)
        : 0;
      const repeatedPairPenalty = rules.avoidRepeatedPairs
        ? dutyPairKeys(option.employeeIds).reduce((sum, key) => sum + (pairCounts.get(key) || 0), 0) : 0;
      const score = [option.missing, nextDayMissing, ...dutyPreferenceScore(rules, {
        spread: balance.spread, compensationDeficit, cooldownViolations,
        weekendReservePenalty: 0, repeatedPairPenalty, squares: balance.squares, queueCost,
      })];
      const signature = option.employeeIds.join(',');
      if (!best
        || compareDutyScores(score, best.score) < 0
        || (compareDutyScores(score, best.score) === 0 && signature < best.signature)) {
        best = { option, score, signature };
      }
    }

    const selected = best.option.employeeIds;
    const addedIds = best.option.addedIds;
    const missing = Math.max(0, dutyRequiredCount(state, cursor) - selected.length);
    if (missing > 0) shortages.push({ date: cursor, missing });
    if (missing > 0) uncertainDates.push(cursor);
    const changed = writeGeneratedDutyAssignment(state, cursor, selected, now, missing > 0);
    if (changed) {
      for (const employeeId of addedIds) {
        rangeCounts[employeeId] = (rangeCounts[employeeId] || 0) + 1;
      }
      for (const pairKey of dutyPairKeys(selected)) {
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
    }
    moveDutyQueueToEnd(dutyQueue, addedIds);
    if (changed) { generated += 1; changedDates.add(cursor); }
    cursor = addDays(cursor, 1);
  }

  for (const date of new Set([...changedDates, ...pinnedAssignments.map((entry) => entry.date)])) {
    const assignment = state.duties.assignments[date];
    assignment.explanation = explainDutyAssignment(state, date, assignment.employeeIds, {
      now, provenance: assignment.source.startsWith('manual') ? 'manual' : 'generated',
    });
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
    uncertainDates,
    weekendConflicts,
  };
}

function dutyRestrictionLabel(code) {
  const labels = {
    not_participant: 'не входить до цього графіка',
    outside_period: 'поза періодом роботи',
    a_day: 'цього дня позначено «А»',
    before_a: 'наступного дня позначено «А»',
    planning_block: 'встановлено «Не планувати»',
    off: 'вихідний',
    vacation: 'відпустка',
    sick: 'лікарняний',
    day_off: 'відгул',
    personal: 'особисті справи',
    other: 'інша недоступність',
    personal_permission: 'особисті справи в табелі',
    holiday: 'вихідний або свято в табелі',
  };
  return labels[code] || code;
}

function dutyCandidateConflicts(state, date, employeeId, rules, idsOnDate) {
  const idsOn = idsOnDate || ((day) => state.duties.assignments[day]?.employeeIds || []);
  const reasons = [];
  const restriction = dutyRestriction(state, employeeId, date);
  if (restriction) return [dutyRestrictionLabel(restriction)];
  const exception = state.duties.dayExceptions?.[date] || {};
  const nextDate = addDays(date, 1);
  if (rules.preventConsecutiveDays && !exception.allowConsecutiveDay && idsOn(addDays(date, -1)).includes(employeeId)) {
    reasons.push(`чергування попереднього дня ${addDays(date, -1)}`);
  }
  if (rules.preventConsecutiveDays && !state.duties.dayExceptions?.[nextDate]?.allowConsecutiveDay
    && idsOn(nextDate).includes(employeeId)) reasons.push(`чергування наступного дня ${nextDate}`);
  if (dutyWeekendConflict(state, date, employeeId, rules, idsOn)) {
    reasons.push(`потрібно пропустити ${rules.weekendRestWeeks} уікенд(и)`);
  }
  if (rules.minimumRestMode === 'require') {
    for (let offset = 1; offset <= rules.minimumRestDays; offset += 1) {
      const previous = addDays(date, -offset);
      const next = addDays(date, offset);
      if ((!exception.allowRestGap && idsOn(previous).includes(employeeId))
        || (!state.duties.dayExceptions?.[next]?.allowRestGap && idsOn(next).includes(employeeId))) {
        reasons.push(`обов’язковий відпочинок ${rules.minimumRestDays} днів; близьке чергування ${idsOn(previous).includes(employeeId) ? previous : next}`);
        break;
      }
    }
  }
  const weekStart = dutyWeekStart(date);
  const count = Array.from({ length: 7 }, (_, offset) => idsOn(addDays(weekStart, offset)).includes(employeeId) ? 1 : 0)
    .reduce((sum, value) => sum + value, 0);
  const proposedCount = count + (idsOn(date).includes(employeeId) ? 0 : 1);
  if (rules.maximumDutiesPerWeek > 0 && !exception.allowWeeklyLimit && proposedCount > rules.maximumDutiesPerWeek) {
    reasons.push(`тижневий ліміт ${rules.maximumDutiesPerWeek}: після призначення було б ${proposedCount}`);
  }
  return reasons;
}

function improveDutyPlan(state, basis, plan) {
  // Check actual one-person replacements with the same ordered score as the
  // weekly search. Never move a manual/finalized assignment to improve a score.
  const selected = plan.selectedByDate;
  let current = dutyDecisionMetrics(basis, selected);
  for (let pass = 0; pass < 40; pass += 1) {
    let improvement = null;
    for (const date of basis.dates) {
      const ids = selected.get(date) || [];
      if (basis.fixed[date].length >= basis.required[date] || state.duties.assignments[date]?.singleApproved) continue;
      const removable = ids.filter((id) => !basis.fixed[date].includes(id));
      if (ids.length < basis.required[date] && basis.rules.shortageBehavior !== 'require_full_day') removable.push(null);
      for (const replaced of removable) {
        for (const candidate of basis.balanceIds) {
          if (ids.includes(candidate)) continue;
          const alternative = new Map(selected);
          const nextIds = ids.filter((id) => id !== replaced);
          nextIds.push(candidate);
          alternative.set(date, nextIds);
          const idsOn = (day) => alternative.get(day) || state.duties.assignments[day]?.employeeIds || [];
          if (dutyCandidateConflicts(state, date, candidate, basis.rules, idsOn).length) continue;
          const metrics = dutyDecisionMetrics(basis, alternative);
          if (compareDutyScores(metrics.score, current.score) < 0
            && (!improvement || compareDutyScores(metrics.score, improvement.metrics.score) < 0)) {
            improvement = { date, nextIds, metrics };
          }
        }
      }
    }
    if (!improvement) break;
    selected.set(improvement.date, improvement.nextIds);
    current = improvement.metrics;
  }
  plan.score = current.score;
  plan.addedByDate = new Map(basis.dates.map((date) => [date,
    (selected.get(date) || []).filter((id) => !basis.fixed[date].includes(id))]));
  plan.shortages = basis.dates.map((date) => ({ date, missing: Math.max(0, basis.required[date] - (selected.get(date)?.length || 0)) }))
    .filter(({ date, missing }) => missing > 0 && !state.duties.assignments[date]?.singleApproved);
}

function explainDutyAssignment(state, date, employeeIds, options = {}) {
  const selectedIds = [...new Set(employeeIds || [])];
  const assignment = state.duties.assignments[date];
  const rules = normalizeDutyRules(options.basis?.rules || state.duties.rules);
  const weekStart = dutyWeekStart(date);
  const weekEnd = addDays(weekStart, 6);
  const weekCounts = dutyCountsBetween(state, weekStart, weekEnd);
  const previousCounts = dutyCountsBetween(state, addDays(weekStart, -7), addDays(weekStart, -1));
  const assignmentsBefore = Object.values(state.duties.assignments)
    .filter((item) => item.date < date).sort((a, b) => b.date.localeCompare(a.date));
  const queue = buildDutyQueue(state, date);
  const totals = dutyTotals(state, date.slice(0, 4), date);
  const pairHistoryStart = dutyPairHistoryStart(rules, date);
  const basis = options.basis;
  const plan = basis && new Map(basis.dates.map((day) => [day, [...(state.duties.assignments[day]?.employeeIds || [])]]));
  const decision = basis && dutyDecisionMetrics(basis, plan);
  const scoreLabels = dutyScoreLabels(rules);
  const provenance = options.provenance || (assignment?.source?.startsWith('generated') ? 'generated' : 'manual');
  const selected = selectedIds.map((employeeId) => {
    const employee = getEmployee(state, employeeId);
    const manual = provenance === 'manual' || assignment?.manualEmployeeIds?.includes(employeeId)
      || (options.reconstructed && assignment?.source?.startsWith('manual'));
    const lastDuty = assignmentsBefore.find((item) => item.employeeIds?.includes(employeeId))?.date || null;
    const restDays = lastDuty ? Math.round((dateKeyToUtc(date) - dateKeyToUtc(lastDuty)) / 86400000) - 1 : null;
    const reasons = [options.reconstructed ? 'Первісне обґрунтування не збережено; нижче наведено перевірні факти поточного стану.'
      : manual ? 'Призначено або закріплено вручну.' : 'Обрано автоматично під час спільного розрахунку періоду.'];
    if (manual && assignment?.note) reasons.push(`Причина ручного призначення: ${assignment.note}`);
    if (manual && !assignment?.note) reasons.push('Окрему причину ручного вибору не вказано.');
    if (assignment?.singleApproved && dutyRequiredCount(state, date) > 1) reasons.push('Одиночне чергування окремо підтверджено вручну.');
    const conflicts = dutyCandidateConflicts(state, date, employeeId, rules);
    reasons.push(conflicts.length ? `Обмеження не виконані: ${conflicts.join('; ')}.` : 'Доступний для цієї дати; обов’язкові обмеження виконані або є збережений разовий виняток.');
    reasons.push(`За тиждень ${weekStart} — ${weekEnd}: ${weekCounts[employeeId] || 0} чергувань; минулого тижня: ${previousCounts[employeeId] || 0}.`);
    reasons.push(lastDuty ? `Попереднє чергування ${lastDuty}; повних днів відпочинку: ${restDays}.` : 'До цієї дати в збереженій історії немає чергувань.');
    reasons.push(`Місце в черзі перед цим днем: ${queue.indexOf(employeeId) + 1} із ${queue.length}; річний підсумок до дати: ${totals[employeeId]?.total || 0}.`);
    if (rules.compensateNextWeek && previousCounts[employeeId] === rules.compensationFrom) {
      reasons.push(`Минулого тижня було ${rules.compensationFrom} чергувань — пріоритет до ${rules.compensationTarget} цього тижня.`);
    }
    const partners = selectedIds.filter((id) => id !== employeeId).map((partnerId) => {
      const dates = assignmentsBefore.filter((item) => item.date >= pairHistoryStart
        && item.employeeIds?.includes(employeeId) && item.employeeIds?.includes(partnerId)).map((item) => item.date);
      return { employeeId: partnerId, name: getEmployee(state, partnerId).name, repeats: dates.length, dates };
    });
    for (const partner of partners) reasons.push(`З ${partner.name}: ${partner.repeats} попередніх спільних чергувань за обраний період${partner.dates.length ? ` (${partner.dates.slice(0, 5).join(', ')}${partner.dates.length > 5 ? ', …' : ''})` : ''}.`);
    const alternatives = (state.duties.participantIds || []).filter((id) => !selectedIds.includes(id)).map((candidateId) => {
      const candidateName = getEmployee(state, candidateId).name;
      const blocked = dutyCandidateConflicts(state, date, candidateId, rules);
      if (blocked.length) return { employeeId: candidateId, name: candidateName, outcome: 'blocked', reasons: blocked };
      if (manual) return { employeeId: candidateId, name: candidateName, outcome: 'manual', reasons: ['Доступний, але цей працівник обраний вручну.'] };
      if (!basis || basis.fixed[date]?.includes(employeeId)) return { employeeId: candidateId, name: candidateName, outcome: 'available', reasons: ['Допустима альтернатива. Повну оцінку початкового пошуку не збережено.'] };
      const replacement = new Map(plan);
      replacement.set(date, selectedIds.map((id) => id === employeeId ? candidateId : id));
      const metrics = dutyDecisionMetrics(basis, replacement);
      const index = decision.score.findIndex((value, i) => value !== metrics.score[i]);
      if (index < 0) return { employeeId: candidateId, name: candidateName, outcome: 'equal', reasons: ['Рівноцінна заміна за всіма критеріями розрахунку; застосовано стабільний порядок вибору.'], score: metrics.score };
      const worse = metrics.score[index] > decision.score[index];
      return { employeeId: candidateId, name: candidateName, outcome: worse ? 'worse' : 'better', score: metrics.score,
        reasons: [worse ? `Заміна погіршує «${scoreLabels[index]}»: ${decision.score[index]} → ${metrics.score[index]}.`
          : `Допустима заміна має кращу оцінку «${scoreLabels[index]}»: ${decision.score[index]} → ${metrics.score[index]}. Пошук мав обмеження; не можна стверджувати, що початковий варіант єдиний найкращий.`] };
    });
    return { employeeId, name: employee.name, reasons, alternatives,
      evidence: { weekTotal: weekCounts[employeeId] || 0, previousWeekTotal: previousCounts[employeeId] || 0,
        lastDuty, restDays, queuePosition: queue.indexOf(employeeId) + 1, yearTotal: totals[employeeId]?.total || 0, partners, conflicts } };
  });
  const notSelected = (state.duties.participantIds || []).filter((id) => !selectedIds.includes(id)).map((employeeId) => ({
    employeeId, name: getEmployee(state, employeeId).name,
    reasons: dutyCandidateConflicts(state, date, employeeId, rules),
  })).map((item) => ({ ...item, reasons: item.reasons.length ? item.reasons : ['Доступний; порівняння заміни наведено для кожного обраного чергового.'] }));
  return {
    version: 2, date, scheduleId: state.activeDutyScheduleId, scheduleName: dutySchedules(state).find((item) => item.id === state.activeDutyScheduleId)?.name || '',
    provenance, createdAt: (options.now || new Date()).toISOString(), reconstructed: Boolean(options.reconstructed),
    source: assignment?.source || 'empty', note: assignment?.note || '', requiredCount: dutyRequiredCount(state, date),
    selected, notSelected, weekStart, weekEnd,
    weekLoad: (state.duties.participantIds || []).map((employeeId) => ({ employeeId, name: getEmployee(state, employeeId).name, total: weekCounts[employeeId] || 0 })),
    decision: decision ? { startDate: basis.dates[0], endDate: basis.dates.at(-1), score: decision.score, labels: scoreLabels,
      scope: 'Заміна однієї людини в цьому дні; решта розрахованого періоду незмінна.' } : null,
    exception: clone(state.duties.dayExceptions?.[date] || null), rules: clone(rules),
  };
}

function getDutyExplanation(state, date, now = new Date()) {
  assertDateKey(date);
  const assignment = state.duties.assignments[date];
  const saved = assignment?.explanation;
  if (saved?.version === 2 && saved.date === date && Array.isArray(saved.selected)
    && saved.selected.every((item) => item && typeof item.employeeId === 'string')
    && JSON.stringify(saved.selected.map(({ employeeId }) => employeeId)) === JSON.stringify(assignment.employeeIds)) return clone(saved);
  return explainDutyAssignment(state, date, assignment?.employeeIds || [], { now, reconstructed: true, provenance: 'reconstructed' });
}

function calculateDutyFairness(state, { startDate, endDate }) {
  assertDateKey(startDate);
  assertDateKey(endDate);
  if (startDate > endDate) throw new Error('Початкова дата не може бути пізнішою за кінцеву.');
  const participantIds = [...(state.duties.participantIds || [])];
  const assignments = Object.values(state.duties.assignments)
    .filter((assignment) => assignment.date >= startDate && assignment.date <= endDate)
    .sort((left, right) => left.date.localeCompare(right.date));
  const rows = participantIds.map((employeeId) => {
    const employeeAssignments = assignments.filter((assignment) => (
      assignment.employeeIds?.includes(employeeId)
    ));
    const gaps = employeeAssignments.slice(1).map((assignment, index) => (
      Math.round((dateKeyToUtc(assignment.date) - dateKeyToUtc(employeeAssignments[index].date)) / 86400000) - 1
    ));
    return {
      employeeId,
      total: employeeAssignments.length,
      realized: employeeAssignments.filter((assignment) => (
        assignment.realizedEmployeeIds?.includes(employeeId)
      )).length,
      weekends: employeeAssignments.filter((assignment) => [0, 6].includes(dayOfWeek(assignment.date))).length,
      lastDuty: employeeAssignments.at(-1)?.date || null,
      averageRestDays: gaps.length
        ? Math.round((gaps.reduce((sum, value) => sum + value, 0) / gaps.length) * 10) / 10
        : null,
    };
  });
  const pairCounts = new Map();
  for (const assignment of assignments) {
    for (const key of dutyPairKeys(assignment.employeeIds || [])) {
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
  }
  const pairs = [...pairCounts.entries()]
    .map(([key, count]) => ({ employeeIds: key.split('|'), count }))
    .sort((left, right) => right.count - left.count || left.employeeIds.join('|').localeCompare(right.employeeIds.join('|')));
  const totals = rows.map((row) => row.total);
  return {
    startDate,
    endDate,
    rows,
    pairs,
    spread: totals.length ? Math.max(...totals) - Math.min(...totals) : 0,
    repeatedPairCount: pairs.filter((pair) => pair.count > 1).length,
  };
}

function explainDutyShortage(state, date) {
  const assigned = new Set(state.duties.assignments[date]?.employeeIds || []);
  const rules = normalizeDutyRules(state.duties.rules);
  const exception = state.duties.dayExceptions?.[date] || {};
  const nextDate = addDays(date, 1);
  const weekCounts = dutyCountsBetween(state, dutyWeekStart(date), addDays(dutyWeekStart(date), 6));
  const saturday = dayOfWeek(date) === 6 ? date : addDays(date, -1);
  const candidates = state.duties.participantIds
    .filter((id) => !assigned.has(id))
    .map((employeeId) => {
      const reasons = [];
      const restriction = dutyRestriction(state, employeeId, date);
      if (restriction) reasons.push(dutyRestrictionLabel(restriction));
      if (!restriction && rules.preventConsecutiveDays && !exception.allowConsecutiveDay
        && state.duties.assignments[addDays(date, -1)]?.employeeIds?.includes(employeeId)) {
        reasons.push('чергував попереднього дня');
      }
      if (!restriction && rules.preventConsecutiveDays
        && !state.duties.dayExceptions?.[nextDate]?.allowConsecutiveDay
        && dutyFixedEmployeeIds(state.duties.assignments[nextDate]).includes(employeeId)) {
        reasons.push('уже призначений на наступний день');
      }
      if (!restriction && dutyWeekendConflict(state, date, employeeId, rules)) {
        reasons.push(`інтервал між уікендами: ${rules.weekendRestWeeks} тижн.`);
      }
      if (!restriction && rules.maximumDutiesPerWeek > 0 && !exception.allowWeeklyLimit
        && (weekCounts[employeeId] || 0) >= rules.maximumDutiesPerWeek) {
        reasons.push('досяг тижневого ліміту');
      }
      if (!restriction && rules.minimumRestMode === 'require'
        && dutyRestConflict(state, date, employeeId, rules)) {
        reasons.push('обов’язковий інтервал відпочинку');
      }
      return { employeeId, reasons };
    });
  return {
    date,
    missing: Math.max(0, dutyRequiredCount(state, date) - assigned.size),
    blocked: candidates.filter((item) => item.reasons.length),
    available: candidates.filter((item) => !item.reasons.length).map((item) => item.employeeId),
  };
}

function previewDutySchedule(state, filter, now = new Date()) {
  const draft = normalizeState(clone(state), now);
  const result = generateDutySchedule(draft, filter, now);
  const assignments = [];
  for (let date = filter.startDate; date <= filter.endDate; date = addDays(date, 1)) {
    const assignment = draft.duties.assignments[date];
    assignments.push({
      date,
      requiredCount: dutyRequiredCount(draft, date),
      employeeIds: [...(assignment?.employeeIds || [])],
      singleApproved: Boolean(assignment?.singleApproved),
      source: assignment?.source || 'empty',
      explanation: getDutyExplanation(draft, date, now),
    });
  }
  return {
    ...result,
    assignments,
    shortageDetails: result.shortages.map(({ date }) => ({
      ...explainDutyShortage(draft, date),
      searchLimited: result.uncertainDates.includes(date),
    })),
    fairness: calculateDutyFairness(draft, filter),
    rules: clone(draft.duties.rules),
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

function calculateAnalyticsTrend(state, { employeeId = null, startDate, endDate }) {
  assertDateKey(startDate);
  assertDateKey(endDate);
  if (startDate > endDate) throw new Error('Некоректний період аналітики.');
  const firstMonth = startDate.slice(0, 7);
  const lastMonth = endDate.slice(0, 7);
  const months = [];
  let month = firstMonth;
  while (month <= lastMonth) {
    if (months.length >= 36) throw new Error('Для графіка оберіть період не довший за 36 місяців.');
    const [year, number] = month.split('-').map(Number);
    const nextMonth = `${year + (number === 12 ? 1 : 0)}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`;
    const from = month === firstMonth ? startDate : `${month}-01`;
    const to = month === lastMonth ? endDate : addDays(`${nextMonth}-01`, -1);
    const { total } = calculateStatistics(state, { employeeId, startDate: from, endDate: to });
    months.push({ month, from, to, workedDays: total.workedDays || 0,
      requestDays: total.requestDays || 0, missed: total.missed || 0,
      completionPercent: total.completionPercent || 0 });
    month = nextMonth;
  }
  return months;
}

module.exports = {
  SCHEMA_VERSION,
  STATUS,
  STATUS_LABELS,
  SUBMITTED_STATUSES,
  addDays,
  allocateReceiptBackward,
  allocateReceiptForward,
  applyJournalBatch,
  archiveEmployee,
  calculateDutyFairness,
  calculateDutyStatistics,
  dutyCandidateConflicts,
  dutyDateLocked,
  dutyRequiredCount,
  dutyPairHistoryStart,
  dutyRestriction,
  dutyRestrictionLabel,
  dutySchedules,
  dutyWeekStart,
  employeeExistsOnDate,
  explainDutyAssignment,
  normalizeDutyRules,
  journalBatchTargets,
  calculateJournalReport,
  calculateStatistics,
  calculateAnalyticsTrend,
  clearDutyWeek,
  clearDutyRestriction,
  clearWorkdayOverride,
  clearManualRecord,
  clone,
  correctReceipt,
  createDutySchedule,
  createEmployee,
  createTimeOffEntry,
  dateKeyFromDate,
  dayOfWeek,
  defaultState,
  deleteDutySchedule,
  deleteTimeOffEntry,
  duplicateDutySchedule,
  ensureAutomaticMisses,
  generateDutySchedule,
  getDutyExplanation,
  getEmployee,
  isSubmitted,
  isEmployeeWorkday,
  isWorkday,
  initializeDutyHistory,
  normalizeState,
  moveEmployee,
  previewReceiptCorrection,
  previewManualStatuses,
  previewJournalBatch,
  previewSubmission,
  previewDutySchedule,
  removeDutyAssignment,
  recordKey,
  recordSubmission,
  renameEmployee,
  renameDutySchedule,
  restoreEmployee,
  setDutyAssignment,
  setDutyDayException,
  setDutyRealized,
  setDutyRestriction,
  setDutyWeekLocked,
  toggleDutyAssignment,
  setManualStatus,
  setManualStatuses,
  setWorkdayOverride,
  switchDutySchedule,
  updateDutyScheduleRules,
  updateSettings,
  updateTimeOffEntry,
};
