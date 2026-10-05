const crypto = require('node:crypto');
const d = require('./domain');
const tasks = require('./tasks');
const planner = require('./planner');
const replacements = require('./duty-replacements');
const fingerprint = state => crypto.createHash('sha256').update(JSON.stringify(state, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest('hex');

function preview(state, employeeId) {
  const person = d.getEmployee(state, employeeId);
  if (person.active) throw new Error('Видаляти можна лише працівників з архіву.');
  const owns = ([key, value]) => key.startsWith(employeeId + '|') || value?.employeeId === employeeId;
  const duties = d.dutySchedules(state).flatMap(schedule => Object.entries(replacements.scheduleView(state, schedule.id).duties.assignments)
    .filter(([, assignment]) => assignment.employeeIds?.includes(employeeId))
    .map(([date, assignment]) => ({ scheduleId:schedule.id, scheduleName:schedule.name, date, realized:assignment.realizedEmployeeIds?.includes(employeeId) || false })));
  return { employeeId, name:person.name, token:fingerprint(state),
    records:Object.entries(state.records || {}).filter(owns).length,
    presence:Object.entries(state.presenceRecords || {}).filter(owns).length,
    work:(state.workEntries || []).filter(item => item.employeeId === employeeId).length,
    receipts:(state.receipts || []).filter(item => item.employeeId === employeeId).length,
    timeOff:(state.timeOffEntries || []).filter(item => item.employeeId === employeeId).length,
    duties, tasks:(state.tasks || []).filter(task => task.assigneeIds.includes(employeeId)).map(task => ({ id:task.id, title:task.title, active:planner.active(task), needsAssignee:planner.active(task) && task.assigneeIds.length === 1 })),
    protocols:(state.draws || []).filter(draw => draw.participants.some(person => person.id === employeeId)).length };
}
function apply(state, input, now = new Date()) {
  if (!input?.expectedToken || fingerprint(state) !== input.expectedToken) throw new Error('Дані змінилися. Перевірте видалення ще раз.');
  const report = preview(state, input.employeeId), draft = d.clone(state);
  const active = draft.dutySchedules.find(schedule => schedule.id === draft.activeDutyScheduleId);
  if (active) active.data = draft.duties;
  const id = report.employeeId;
  for (const field of ['records', 'presenceRecords', 'workdayOverrides']) {
    for (const [key, value] of Object.entries(draft[field] || {})) if (key.startsWith(id + '|') || value?.employeeId === id) delete draft[field][key];
  }
  for (const field of ['receipts', 'workEntries', 'timeOffEntries']) draft[field] = (draft[field] || []).filter(item => item.employeeId !== id);
  for (const schedule of d.dutySchedules(draft)) {
    const data = replacements.scheduleView(draft, schedule.id).duties;
    data.participantIds = data.participantIds.filter(value => value !== id);
    delete data.baselines[id];
    for (const field of ['aDays', 'unavailable', 'planningBlocks']) for (const key of Object.keys(data[field] || {})) if (key.startsWith(id + '|')) delete data[field][key];
    for (const assignment of Object.values(data.assignments)) {
      if (!assignment.employeeIds?.includes(id)) continue;
      assignment.employeeIds = assignment.employeeIds.filter(value => value !== id);
      assignment.realizedEmployeeIds = (assignment.realizedEmployeeIds || []).filter(value => value !== id);
      assignment.manualEmployeeIds = (assignment.manualEmployeeIds || []).filter(value => value !== id);
      assignment.singleApproved = false;
      assignment.updatedAt = now.toISOString();
      assignment.replacementNeeds = [...(assignment.replacementNeeds || []).filter(item => item.employeeId !== id),
        { employeeId:id, name:report.name, reason:'Працівника видалено з архіву.', at:now.toISOString() }];
      delete assignment.explanation;
    }
  }
  tasks.removeEmployee(draft, id, report.name, now);
  draft.employees = draft.employees.filter(person => person.id !== id);
  draft.audit.push({ id:crypto.randomUUID(), at:now.toISOString(), action:'employee_deleted', details:{ ...report, token:undefined, actor:state.settings.operatorName || 'Керівник' } });
  draft.audit = draft.audit.slice(-5000);
  Object.assign(state, draft);
  return report;
}
module.exports = { preview, apply };
