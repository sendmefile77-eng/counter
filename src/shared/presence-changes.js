const crypto=require('node:crypto');
const d=require('./domain');
const presence=require('./presence');
const staff=require('./staff-changes');
const replacements=require('./duty-replacements');

function preview(state,input,now=new Date()) {
  if(!input||input.employeeIds!=null&&!Array.isArray(input.employeeIds))throw Error('Оберіть працівників списком.');
  const ids=[...new Set(input.employeeIds||[input.employeeId])],startDate=input.startDate||input.date,endDate=input.endDate||startDate;
  if(!ids.length||ids.some(id=>!state.employees.some(person=>person.id===id)))throw Error('Оберіть працівників.');
  if(!presence.validDate(startDate)||!presence.validDate(endDate)||endDate<startDate||endDate>d.addDays(startDate,365))throw Error('Оберіть період до 366 календарних днів.');
  const status=input.status||null,action=input.action||'set',reason=String(input.reason||'').trim();
  if(!['set','clear'].includes(action)||action==='set'&&!Object.hasOwn(presence.labels,status))throw Error('Оберіть статус наявності.');
  if(reason.length>500)throw Error('Пояснення має містити не більше 500 символів.');
  const change={employeeIds:ids,startDate,endDate,status,action,reason},cells=[],skipped=[],duties=[],tasks=new Map(),blockers=[];
  for(const id of ids) {
    const person=d.getEmployee(state,id),dates=[];
    for(let date=startDate;date<=endDate;date=d.addDays(date,1)) {
      if(!d.employeeExistsOnDate(person,date)&&date>=person.createdDate){skipped.push({employeeId:id,date});continue;}
      const before=presence.get(state,id,date);
      if(action==='clear'&&(!before||before.source==='calendar_presence'))continue;
      if(action==='clear'&&state.records[d.recordKey(id,date)]?.receiptId&&presence.absent.has(state.records[d.recordKey(id,date)].status)) {
        blockers.push(`${person.name}, ${date}: захищена історична відсутність. Змініть статус у «Наявності».`);continue;
      }
      cells.push({employeeId:id,name:person.name,date,before,after:action==='clear'?null:status});dates.push(date);
    }
    if(action==='set'&&presence.dutyBlocked.has(status)) {
      const effects=staff.inspectStaffEffects(state,{kind:'presence',employeeId:id,status,reason},dates,now);
      duties.push(...effects.duties);effects.tasks.forEach(task=>tasks.set(task.id,task));blockers.push(...effects.blockers);
    }
  }
  for(const duty of duties)duty.after=duty.before.filter(id=>!duties.some(other=>other.scheduleId===duty.scheduleId&&other.date===duty.date&&other.employeeId===id));
  if(!cells.length)blockers.push(action==='clear'?'У періоді немає позначок наявності.':'Немає дат у періоді роботи вибраних працівників.');
  const token=crypto.createHash('sha256').update(JSON.stringify({state:replacements.fingerprint(state),change,today:d.dateKeyFromDate(now)})).digest('hex');
  return {change,cells,count:cells.length,skipped,duties,tasks:[...tasks.values()],blockers:[...new Set(blockers)],canApply:cells.length>0&&!blockers.length,token};
}
function apply(state,input,now=new Date()) {
  const report=preview(state,input.change,now);
  if(!input.expectedToken||report.token!==input.expectedToken)throw Error('Дані або дата змінилися. Перевірте наслідки ще раз.');
  if(!report.canApply)throw Error(report.blockers.join('\n'));
  const draft=d.clone(state),active=draft.dutySchedules.find(schedule=>schedule.id===draft.activeDutyScheduleId);
  if(active)active.data=draft.duties;
  const dutyReason=report.change.reason||`Наявність: ${presence.labels[report.change.status]||'позначку очищено'}.`;
  for(const id of report.change.employeeIds)staff.removeAffectedDuties(draft,report.duties.filter(duty=>duty.employeeId===id),id,dutyReason,now);
  for(const cell of report.cells) {
    if(report.change.action==='clear')presence.clear(draft,cell.employeeId,cell.date);
    else presence.write(draft,{employeeId:cell.employeeId,date:cell.date,status:report.change.status,note:report.change.reason},now);
  }
  for(const duty of report.duties) {
    const view=replacements.scheduleView(draft,duty.scheduleId),assignment=view.duties.assignments[duty.date];
    assignment.explanation=d.explainDutyAssignment(view,duty.date,assignment.employeeIds,{now,provenance:'manual'});
  }
  draft.audit.push({id:crypto.randomUUID(),at:now.toISOString(),action:'presence_changed',details:{...report.change,actor:state.settings.operatorName||'Керівник',cells:report.cells,duties:report.duties,tasks:report.tasks}});
  draft.audit=draft.audit.slice(-5000);Object.assign(state,draft);return report;
}
function save(state,input,now=new Date()) {
  const report=preview(state,input,now);
  return apply(state,{change:report.change,expectedToken:report.token},now);
}
module.exports={preview,apply,save};
