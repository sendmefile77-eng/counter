(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LadPlanner = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STATUS_LABELS = Object.freeze({ open: 'Заплановано', in_progress: 'У роботі', blocked: 'Потрібне рішення', done: 'Виконано', cancelled: 'Скасовано' });
  const PRIORITY_LABELS = Object.freeze({ normal: 'Звичайний', high: 'Високий', urgent: 'Терміновий' });
  const RECURRENCE_LABELS = Object.freeze({ none: 'Без повторення', daily: 'Щодня', weekly: 'Щотижня', monthly: 'Щомісяця' });
  const TASK_COLORS = Object.freeze({ blue:'Блакитний', teal:'Бірюзовий', green:'Зелений', gold:'Золотий', purple:'Фіолетовий', rose:'Рожевий' });
  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const [y, m, d] = value.split('-').map(Number), date = new Date(Date.UTC(y, m - 1, d));
    return y >= 1000 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }
  function addDays(value, count) {
    if (!validDate(value)) throw new Error('Некоректна календарна дата.');
    const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }
  function weekStart(value) { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return addDays(value, -(day || 7) + 1); }
  function range(anchor, view = 'month') {
    if (!validDate(anchor)) throw new Error('Некоректна дата календаря.');
    let start = anchor, end = anchor;
    if (view === 'week') { start = weekStart(anchor); end = addDays(start, 6); }
    if (view === 'month') {
      start = `${anchor.slice(0, 7)}-01`;
      const [y, m] = anchor.split('-').map(Number);
      end = `${anchor.slice(0, 7)}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`;
    }
    if (view === 'quarter') {
      const [y, m] = anchor.split('-').map(Number), first = Math.floor((m - 1) / 3) * 3;
      start = `${y}-${String(first + 1).padStart(2, '0')}-01`;
      end = dateKey(new Date(y, first + 3, 0, 12));
    }
    return { startDate: start, endDate: end };
  }
  function deadline(task) {
    // Tasks without a time are due at the end of that local calendar day.
    return new Date(task.dueTime ? `${task.dueDate}T${task.dueTime}:00` : `${task.dueDate}T23:59:59.999`).getTime();
  }
  function active(task) { return !task.archived && !['done', 'cancelled'].includes(task.status); }
  function urgency(task, now = new Date(), horizon = 3) {
    if (!active(task)) return { key: task.status, label: STATUS_LABELS[task.status], rank: 5 };
    if (deadline(task) < now.getTime()) return { key: 'overdue', label: 'Прострочено', rank: 0 };
    if (task.dueDate === dateKey(now)) return { key: 'today', label: 'Сьогодні', rank: 1 };
    if (task.dueDate <= addDays(dateKey(now), horizon)) return { key: 'soon', label: 'Наближається строк', rank: 2 };
    return { key: 'planned', label: 'Заплановано', rank: 3 };
  }
  function sortTasks(tasks, now = new Date()) {
    const priority = { urgent: 0, high: 1, normal: 2 };
    return [...tasks].sort((a, b) => urgency(a, now).rank - urgency(b, now).rank
      || deadline(a) - deadline(b) || priority[a.priority] - priority[b.priority] || a.title.localeCompare(b.title, 'uk'));
  }
  function taskMatches(task, filter, now) {
    if (task.archived && !filter.includeArchived) return false;
    if (filter.employeeId && !task.assigneeIds.includes(filter.employeeId)) return false;
    if (filter.employeeId === 'self' && task.assigneeIds.length) return false;
    if (filter.startDate && task.dueDate < filter.startDate || filter.endDate && task.dueDate > filter.endDate) return false;
    if (filter.status === 'active' && !active(task)) return false;
    if (filter.status && !['all', 'active'].includes(filter.status) && task.status !== filter.status) return false;
    if (filter.priority && task.priority !== filter.priority) return false;
    if (filter.urgency && urgency(task, now).key !== filter.urgency) return false;
    return !filter.query || `${task.title} ${task.description} ${task.documentRef} ${(task.tags || []).join(' ')}`.toLocaleLowerCase('uk-UA').includes(filter.query.toLocaleLowerCase('uk-UA'));
  }
  function selectTasks(state, filter = {}, now = new Date()) {
    // "self" represents the leader's personal tasks, without assigned employees.
    return sortTasks((state.tasks || []).filter(task => taskMatches(task, { ...filter, employeeId: filter.employeeId === 'self' ? '' : filter.employeeId }, now)
      && (filter.employeeId !== 'self' || !task.assigneeIds.length)), now);
  }
  function attention(state, now = new Date()) {
    const horizon = state.settings?.taskAttentionDays || 3;
    const tasks = sortTasks((state.tasks || []).filter(task => active(task)
      && (urgency(task, now, horizon).rank <= 2 || task.status === 'blocked'
        || task.assigneeIds.some(id => !state.employees.find(person => person.id === id)?.active))), now);
    return { tasks, overdue: tasks.filter(task => urgency(task, now).key === 'overdue').length,
      today: tasks.filter(task => urgency(task, now).key === 'today').length, blocked: tasks.filter(task => task.status === 'blocked').length };
  }
  function nextDueDate(task) {
    if (task.recurrence === 'daily') return addDays(task.dueDate, 1);
    if (task.recurrence === 'weekly') return addDays(task.dueDate, 7);
    if (task.recurrence === 'monthly') {
      const [y, m, d] = task.dueDate.split('-').map(Number), month = new Date(Date.UTC(y, m, 1));
      const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
      return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(task.recurrenceDay || d, end)).padStart(2, '0')}`;
    }
    return null;
  }
  function notificationCandidate(task, now = new Date()) {
    if (!active(task) || task.reminderMinutes == null) return null;
    const stamp = now.getTime(), due = deadline(task);
    const base = `${task.dueDate}:${task.dueTime}:${task.reminderMinutes}`;
    if (task.snoozedUntil) {
      if (Date.parse(task.snoozedUntil) > stamp) return null;
      const key = `snooze:${task.snoozedUntil}`;
      if (task.notificationKeys?.includes(key)) return null;
      return { taskId: task.id, key, kind: due < stamp ? 'overdue' : 'reminder' };
    }
    const kind = stamp > due ? 'overdue' : stamp >= due - task.reminderMinutes * 60000 ? 'reminder' : null;
    if (!kind) return null;
    const key = `${kind}:${base}`;
    return task.notificationKeys?.includes(key) ? null : { taskId: task.id, key, kind };
  }
  function calendarDays(anchor, view) {
    const r = range(anchor, view); let first = r.startDate, last = r.endDate;
    if (view === 'month') { first = weekStart(first); last = addDays(weekStart(last), 6); }
    const days = []; for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
    return { ...r, days };
  }
  return { STATUS_LABELS, PRIORITY_LABELS, RECURRENCE_LABELS, TASK_COLORS, dateKey, validDate, addDays, weekStart, range,
    deadline, active, urgency, sortTasks, selectTasks, attention, nextDueDate, notificationCandidate, calendarDays };
}));
