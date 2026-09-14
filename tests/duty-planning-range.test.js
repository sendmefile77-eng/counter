const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nextDutyPlanningRange,
} = require('../src/renderer/duty-planning-range');

function assignmentsForRange(startDate, endDate, source = 'generated') {
  const result = {};
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const cursor = new Date(startYear, startMonth - 1, startDay, 12);
  const end = new Date(endYear, endMonth - 1, endDay, 12);
  while (cursor <= end) {
    const date = [
      cursor.getFullYear(),
      String(cursor.getMonth() + 1).padStart(2, '0'),
      String(cursor.getDate()).padStart(2, '0'),
    ].join('-');
    result[date] = { date, employeeIds: ['a', 'b'], source };
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

test('continues from the first unfilled week instead of jumping to the calendar next week', () => {
  const snapshot = {
    duties: {
      baselineThroughDate: '2026-08-23',
      assignments: assignmentsForRange('2026-08-24', '2026-09-06'),
      lockedWeeks: {},
    },
  };

  assert.deepEqual(
    nextDutyPlanningRange(snapshot, new Date(2026, 8, 14, 12)),
    { startDate: '2026-09-07', endDate: '2026-09-13' },
  );
});

test('continues with the current week when the previous week is already planned', () => {
  const snapshot = {
    duties: {
      baselineThroughDate: '2026-08-23',
      assignments: assignmentsForRange('2026-08-24', '2026-09-13'),
      lockedWeeks: {},
    },
  };

  assert.deepEqual(
    nextDutyPlanningRange(snapshot, new Date(2026, 8, 14, 12)),
    { startDate: '2026-09-14', endDate: '2026-09-20' },
  );
});

test('fills a partially planned week without overwriting its existing days', () => {
  const assignments = assignmentsForRange('2026-08-24', '2026-09-06');
  Object.assign(assignments, assignmentsForRange('2026-09-07', '2026-09-09', 'manual'));
  const snapshot = {
    duties: {
      baselineThroughDate: '2026-08-23',
      assignments,
      lockedWeeks: {},
    },
  };

  assert.deepEqual(
    nextDutyPlanningRange(snapshot, new Date(2026, 8, 14, 12)),
    { startDate: '2026-09-07', endDate: '2026-09-13' },
  );
});

test('skips an intentionally locked incomplete week', () => {
  const snapshot = {
    duties: {
      baselineThroughDate: '2026-08-30',
      assignments: assignmentsForRange('2026-08-31', '2026-09-06'),
      lockedWeeks: { '2026-09-07': true },
    },
  };

  assert.deepEqual(
    nextDutyPlanningRange(snapshot, new Date(2026, 8, 14, 12)),
    { startDate: '2026-09-14', endDate: '2026-09-20' },
  );
});

test('falls back to the next calendar week when no schedule state is available', () => {
  assert.deepEqual(
    nextDutyPlanningRange(null, new Date(2026, 8, 14, 12)),
    { startDate: '2026-09-21', endDate: '2026-09-27' },
  );
});
