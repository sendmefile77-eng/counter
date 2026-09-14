(function installDutyPlanningRange(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (!root || !root.document) return;

  root.CounterDutyPlanningRange = api;

  // app.js calls the global nextWeekRange() from the duty toolbar. Replace the
  // calendar-relative implementation with a schedule-relative continuation so
  // a gap is never skipped just because the current date moved forward.
  root.nextWeekRange = function nextWeekRangeFromSchedule(now = new Date()) {
    let currentSnapshot = null;
    try {
      currentSnapshot = snapshot;
    } catch (_error) {
      currentSnapshot = null;
    }
    return api.nextDutyPlanningRange(currentSnapshot, now);
  };
}(typeof globalThis !== 'undefined' ? globalThis : this, function dutyPlanningRangeFactory() {
  const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function dateFromKey(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  function shiftDate(value, delta) {
    const date = dateFromKey(value);
    date.setDate(date.getDate() + delta);
    return localDateKey(date);
  }

  function weekStart(value) {
    const date = dateFromKey(value);
    const day = date.getDay();
    date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
    return localDateKey(date);
  }

  function nextCalendarWeek(now = new Date()) {
    const today = localDateKey(now);
    const startDate = shiftDate(weekStart(today), 7);
    return { startDate, endDate: shiftDate(startDate, 6) };
  }

  function validDateKey(value) {
    return DATE_KEY_RE.test(String(value || ''));
  }

  function assignmentDates(assignments) {
    return Object.keys(assignments || {}).filter(validDateKey).sort();
  }

  function generatedAssignmentDates(assignments) {
    return Object.entries(assignments || {})
      .filter(([date, assignment]) => (
        validDateKey(date)
        && String(assignment?.source || '').startsWith('generated')
      ))
      .map(([date]) => date)
      .sort();
  }

  function weekHasPlanningRecord(assignments, startDate) {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = shiftDate(startDate, offset);
      if (!Object.prototype.hasOwnProperty.call(assignments, date)) return false;
    }
    return true;
  }

  function nextDutyPlanningRange(currentSnapshot, now = new Date()) {
    const duties = currentSnapshot?.duties;
    if (!duties || typeof duties !== 'object') return nextCalendarWeek(now);

    const assignments = duties.assignments && typeof duties.assignments === 'object'
      ? duties.assignments
      : {};
    const lockedWeeks = duties.lockedWeeks && typeof duties.lockedWeeks === 'object'
      ? duties.lockedWeeks
      : {};

    const generatedDates = generatedAssignmentDates(assignments);
    const allAssignmentDates = assignmentDates(assignments);
    let startDate = null;

    // Generated entries are the strongest signal for where automatic planning
    // actually started. Walking forward from there finds the first real gap,
    // even when the system date has advanced by several weeks.
    if (generatedDates.length) {
      startDate = weekStart(generatedDates[0]);
    } else if (validDateKey(duties.baselineThroughDate)) {
      startDate = shiftDate(weekStart(duties.baselineThroughDate), 7);
    } else if (allAssignmentDates.length) {
      startDate = weekStart(allAssignmentDates[0]);
    } else {
      return nextCalendarWeek(now);
    }

    // A generous guard prevents malformed imported data from causing an
    // endless scan. Locked weeks are treated as intentionally frozen.
    for (let index = 0; index < 5200; index += 1) {
      const locked = Boolean(lockedWeeks[startDate]);
      const fullyPlanned = weekHasPlanningRecord(assignments, startDate);
      if (!locked && !fullyPlanned) {
        return { startDate, endDate: shiftDate(startDate, 6) };
      }
      startDate = shiftDate(startDate, 7);
    }

    return nextCalendarWeek(now);
  }

  return {
    nextDutyPlanningRange,
    nextCalendarWeek,
    weekStart,
    shiftDate,
  };
}));