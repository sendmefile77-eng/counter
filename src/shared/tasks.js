const crypto = require('node:crypto');
const planner = require('./planner');
const clone = value => JSON.parse(JSON.stringify(value));
const actorFor = state => String(state.settings?.operatorName || 'Керівник').trim().slice(0, 80);
const stamp = now => now.toISOString();
const text = (value, max) => String(value || '').trim().slice(0, max);
function cleanInput(state, input, previous = null) {
  const title = text(input.title, 160);
  if (title.length < 2) throw new Error('Назва завдання має містити від 2 до 160 символів.');
  if (!planner.validDate(input.dueDate)) throw new Error('Вкажіть коректну дату строку.');
  const dueTime = String(input.dueTime || '').trim();
  if (dueTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) throw new Error('Час має бути у форматі ГГ:ХХ.');
  if (!Object.hasOwn(planner.PRIORITY_LABELS, input.priority || 'normal')) throw new Error('Невідомий пріоритет завдання.');
  if (!Object.hasOwn(planner.RECURRENCE_LABELS, input.recurrence || 'none')) throw new Error('Невідомий режим повторення.');
  if (input.assigneeIds != null && !Array.isArray(input.assigneeIds)) throw new Error('Некоректний список відповідальних.');
  const assigneeIds = [...new Set(input.assigneeIds || [])];
  if (assigneeIds.some(id => !state.employees.some(person => person.id === id))) throw new Error('Відповідального не знайдено.');
  if (assigneeIds.some(id => !state.employees.find(person => person.id === id).active && !previous?.assigneeIds.includes(id))) {
    throw new Error('Нові завдання можна призначати лише активним працівникам.');
  }
  const receiptIds = [...new Set(Array.isArray(input.receiptIds) ? input.receiptIds : [])];
  if (receiptIds.some(id => !state.receipts.some(receipt => receipt.id === id) && !previous?.receiptIds.includes(id))) throw new Error('Пов’язаний документ не знайдено.');
  const dutyScheduleId = text(input.dutyScheduleId, 100), dutyDate = text(input.dutyDate, 10);
  if (Boolean(dutyScheduleId) !== Boolean(dutyDate) || dutyDate && !planner.validDate(dutyDate)) throw new Error('Для зв’язку з чергуванням оберіть графік і дату.');
  if (dutyScheduleId && !state.dutySchedules.some(schedule => schedule.id === dutyScheduleId) && dutyScheduleId !== previous?.dutyScheduleId) throw new Error('Пов’язаний графік не знайдено.');
  const reminderMinutes = input.reminderMinutes === null || input.reminderMinutes === '' ? null : Number(input.reminderMinutes ?? 60);
  if (reminderMinutes !== null && (!Number.isInteger(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 43200)) throw new Error('Нагадування: від 0 до 43200 хвилин до строку.');
  const color = input.color ?? previous?.color ?? 'blue', rawTags = input.tags ?? previous?.tags ?? [];
  if (!Object.hasOwn(planner.TASK_COLORS, color)) throw new Error('Оберіть колір завдання зі списку.');
  if (!Array.isArray(rawTags) || rawTags.length > 5 || rawTags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 24)) {
    throw new Error('До 5 міток, кожна від 1 до 24 символів.');
  }
  const tags = [...new Map(rawTags.map(tag => [tag.trim().toLocaleLowerCase('uk-UA'), tag.trim()])).values()];
  return { title, description: text(input.description, 3000), dueDate: input.dueDate, dueTime, assigneeIds,
    priority: input.priority || 'normal', recurrence: input.recurrence || 'none', reminderMinutes, receiptIds,
    documentRef: text(input.documentRef, 200), dutyScheduleId, dutyDate, color, tags,
    recurrenceDay: previous && previous.dueDate === input.dueDate ? previous.recurrenceDay : Number(input.dueDate.slice(-2)) };
}
function getTask(state, id) {
  const task = (state.tasks || []).find(item => item.id === id);
  if (!task) throw new Error('Завдання не знайдено. Оновіть список.');
  return task;
}
function event(state, task, type, details, now) {
  const entry = { id: crypto.randomUUID(), at: stamp(now), actor: actorFor(state), type, details: clone(details || {}) };
  task.history.push(entry); task.updatedAt = stamp(now); task.revision = (task.revision || 0) + 1;
  state.audit.push({ id: entry.id, at: entry.at, action: `task_${type}`, details: { taskId: task.id, actor: entry.actor, ...entry.details } });
  if (state.audit.length > 5000) state.audit = state.audit.slice(-5000);
}
function assertRevision(task, input) {
  if (input.expectedRevision != null && Number(input.expectedRevision) !== task.revision) throw new Error('Завдання вже змінено. Відкрийте його ще раз перед збереженням.');
}
function createTask(state, input, now = new Date(), previous = null) {
  const data = cleanInput(state, input, previous);
  const task = { ...data, id: crypto.randomUUID(), status: 'open', archived: false, createdAt: stamp(now), updatedAt: stamp(now),
    createdBy: actorFor(state), completedAt: null, cancelledAt: null, revision: 0, history: [], notificationKeys: [], snoozedUntil: null,
    seriesId: null, previousTaskId: null, nextTaskId: null };
  task.seriesId = task.id;
  state.tasks ||= []; state.tasks.push(task);
  event(state, task, 'created', { title: task.title, dueDate: task.dueDate, dueTime: task.dueTime, assigneeIds: task.assigneeIds }, now);
  return task;
}
function updateTask(state, id, input, now = new Date()) {
  const task = getTask(state, id); assertRevision(task, input);
  if (task.archived) throw new Error('Спочатку поверніть завдання з архіву.');
  const next = cleanInput(state, input, task), moved = task.dueDate !== next.dueDate || task.dueTime !== next.dueTime;
  const reason = text(input.reason, 500);
  if (moved && !reason) throw new Error('Вкажіть причину перенесення строку.');
  const changes = Object.fromEntries(Object.keys(next).filter(key => JSON.stringify(task[key]) !== JSON.stringify(next[key]))
    .map(key => [key, { before: clone(task[key] ?? null), after: clone(next[key]) }]));
  if (!Object.keys(changes).length) return task;
  if (moved || task.reminderMinutes !== next.reminderMinutes) { task.snoozedUntil = null; task.notificationKeys = []; }
  Object.assign(task, next);
  event(state, task, moved ? 'rescheduled' : 'updated', { changes, reason }, now);
  return task;
}
function setTaskStatus(state, id, input, now = new Date()) {
  const task = getTask(state, id); assertRevision(task, input);
  if (!Object.hasOwn(planner.STATUS_LABELS, input.status)) throw new Error('Невідомий статус завдання.');
  if (task.archived) throw new Error('Спочатку поверніть завдання з архіву.');
  if (task.status === input.status) return { task, nextTask: null };
  const reason = text(input.reason, 500);
  if (['blocked', 'cancelled'].includes(input.status) && !reason) throw new Error('Вкажіть причину або потрібне рішення.');
  const before = task.status;
  task.status = input.status; task.completedAt = input.status === 'done' ? stamp(now) : null;
  task.cancelledAt = input.status === 'cancelled' ? stamp(now) : null; task.snoozedUntil = null;
  if (['done', 'cancelled'].includes(before)) task.notificationKeys = [];
  event(state, task, 'status', { before, status: task.status, reason }, now);
  let nextTask = null;
  if (input.status === 'done' && task.recurrence !== 'none' && !task.nextTaskId) {
    nextTask = createTask(state, { ...task, dueDate: planner.nextDueDate(task) }, now, task);
    nextTask.recurrenceDay = task.recurrenceDay; nextTask.seriesId = task.seriesId; nextTask.previousTaskId = task.id;
    if (nextTask.assigneeIds.some(id => !state.employees.find(person => person.id === id)?.active)) {
      nextTask.status = 'blocked';
      event(state, nextTask, 'status', { before:'open', status:'blocked', reason:'Відповідального архівовано. Потрібно переназначити завдання.' }, now);
    }
    task.nextTaskId = nextTask.id;
    event(state, task, 'repeated', { nextTaskId: nextTask.id, dueDate: nextTask.dueDate }, now);
  }
  return { task, nextTask };
}
function archiveTask(state, id, archived, now = new Date()) {
  const task = getTask(state, id);
  if (archived && planner.active(task)) throw new Error('Спочатку виконайте або скасуйте завдання.');
  if (task.archived !== Boolean(archived)) { task.archived = Boolean(archived); event(state, task, archived ? 'archived' : 'restored', {}, now); }
  return task;
}
function snoozeTask(state, id, minutes, now = new Date()) {
  const task = getTask(state, id);
  if (!planner.active(task)) throw new Error('Нагадування можна відкласти лише для відкритого завдання.');
  if (![15, 60, 240].includes(Number(minutes))) throw new Error('Виберіть 15 хвилин, 1 годину або 4 години.');
  if (task.reminderMinutes == null) throw new Error('Спочатку увімкніть нагадування в завданні.');
  task.snoozedUntil = new Date(now.getTime() + Number(minutes) * 60000).toISOString();
  event(state, task, 'snoozed', { until: task.snoozedUntil }, now);
  return task;
}
function removeEmployee(state, employeeId, name, now = new Date()) {
  for (const task of state.tasks || []) {
    if (!task.assigneeIds.includes(employeeId)) continue;
    task.assigneeIds = task.assigneeIds.filter(id => id !== employeeId);
    const reason = `Працівника «${name}» видалено з архіву.`, before = task.status;
    event(state, task, 'employee_removed', { employeeId, name, reason }, now);
    if (planner.active(task) && !task.assigneeIds.length) {
      task.status = 'blocked'; task.snoozedUntil = null; task.notificationKeys = [];
      event(state, task, 'status', { before, status:'blocked', reason:reason + ' Потрібен новий відповідальний.' }, now);
    }
  }
}
function normalizeTasks(input, state, now = new Date()) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error('Розділ завдань має бути списком.');
  const ids = new Set();
  return input.map(raw => {
    if (!raw || !raw.id || ids.has(raw.id)) throw new Error('У базі є завдання без ідентифікатора або з дубльованим ідентифікатором.');
    ids.add(raw.id);
    const next = cleanInput(state, raw, raw);
    const history = Array.isArray(raw.history) ? raw.history.map(entry => {
      if (!entry || typeof entry !== 'object' || !Number.isFinite(Date.parse(entry.at)) || typeof entry.type !== 'string'
        || entry.details != null && (typeof entry.details !== 'object' || Array.isArray(entry.details))) {
        throw new Error('У базі є пошкоджений запис історії завдання.');
      }
      return { ...entry, actor: text(entry.actor,80) || 'Керівник', details: entry.details || {} };
    }) : [];
    for (const field of ['createdAt','updatedAt','completedAt','cancelledAt']) if (raw[field] && !Number.isFinite(Date.parse(raw[field]))) {
      throw new Error('У базі є завдання з некоректним часом події.');
    }
    if (!Object.hasOwn(planner.STATUS_LABELS, raw.status)) throw new Error('У базі є завдання з невідомим статусом.');
    return { ...next, id: raw.id, status: raw.status, archived: Boolean(raw.archived), createdAt: raw.createdAt || stamp(now),
      createdBy: text(raw.createdBy, 80) || 'Керівник', updatedAt: raw.updatedAt || raw.createdAt || stamp(now),
      completedAt: raw.completedAt || null, cancelledAt: raw.cancelledAt || null,
      revision: Math.max(1, Number(raw.revision) || 1), history,
      notificationKeys: Array.isArray(raw.notificationKeys) ? raw.notificationKeys.filter(key => typeof key === 'string').slice(-100) : [],
      snoozedUntil: Number.isFinite(Date.parse(raw.snoozedUntil)) ? raw.snoozedUntil : null,
      recurrenceDay: Number.isInteger(raw.recurrenceDay) && raw.recurrenceDay >= 1 && raw.recurrenceDay <= 31 ? raw.recurrenceDay : next.recurrenceDay,
      seriesId: raw.seriesId || raw.id, previousTaskId: raw.previousTaskId || null, nextTaskId: raw.nextTaskId || null };
  });
}
module.exports = { createTask, updateTask, setTaskStatus, archiveTask, snoozeTask, normalizeTasks, getTask, removeEmployee };
