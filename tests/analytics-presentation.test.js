const test = require('node:test');
const assert = require('node:assert/strict');
const visual = require('../src/shared/analytics-presentation');
const p = require('../src/shared/productivity');
const d = require('../src/shared/domain');
const now = new Date('2026-11-17T12:00:00Z');
test('period comparison uses elapsed calendar days and exactly the selected people', () => {
  const state = d.defaultState(now);
  const a = d.createEmployee(state, 'Олена', new Date('2026-10-01T09:00:00Z'));
  const b = d.createEmployee(state, 'Віктор', new Date('2026-10-01T09:00:00Z'));
  p.setObjects(state, { employeeId: b.id, date: '2026-10-30', count: 99, expectedCount: 0, reason: 'Звіт' }, now);
  const value = p.report(state, { startDate: '2026-11-01', endDate: '2026-11-30', employeeIds: [a.id], compare: true }, now);
  assert.equal(value.previous.startDate, '2026-10-15');
  assert.equal(value.previous.endDate, '2026-10-31');
  assert.deepEqual(value.previous.rows.map(row => row.employeeId), [a.id]);
  assert.equal(value.previous.total.objectsReceived, 0);
  assert.equal(p.report(state, { startDate: '2027-01-01', endDate: '2027-01-31', compare: true }, now).previous, undefined);
});
test('changes distinguish percentage points from percent, and withhold unknown history', () => {
  const before = { workedDays: 10, objectsReceived: 4, kpi: 60 }, current = { workedDays: 12, objectsReceived: 8, kpi: 100 };
  assert.deepEqual(visual.change(current, before, 'kpi'), { value: 40, unit: 'points' });
  assert.deepEqual(visual.change(current, before, 'objectsReceived'), { value: 100, unit: 'percent' });
  assert.equal(visual.change(current, { ...before, objectsReceived: 0 }, 'objectsReceived'), null);
  assert.equal(visual.change({ ...current, legacyUnknownDays: 1 }, before, 'kpi'), null);
  assert.equal(visual.change(current, { ...before, workedDays: 0 }, 'kpi'), null);
});
test('graph aggregates actual facts, computes weighted KPI and preserves unknown gaps', () => {
  const facts = [
    { date: '2026-11-16', worked: true, objects: 1 },
    { date: '2026-11-16', worked: false, objects: 2 },
    { date: '2026-11-17', worked: true, objects: 0, legacyResultUnknown: true },
    { date: '2026-11-18', worked: true, objects: 3 },
    { date: '2026-12-01', worked: false, objects: 999, future: true }
  ];
  const rows = visual.series(facts);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kpi, 450); assert.equal(rows[1].kpi, null);
  const plot = visual.chart(rows, 'kpi');
  assert.equal(plot.points.length, 2); assert.equal((plot.path.match(/M/g) || []).length, 2);
  assert.equal(plot.path.includes('L'), false);
  const aggregate = visual.series(facts.filter(f => !f.legacyResultUnknown), 1.5, 1)[0];
  assert.equal(aggregate.objectsReceived, 6); assert.equal(aggregate.workedDays, 2); assert.equal(aggregate.kpi, 450);
  assert.deepEqual(visual.chart([{kpi:null}], 'kpi'), {path:'',points:[]});
});
