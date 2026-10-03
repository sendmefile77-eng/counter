const crypto = require('node:crypto');
const d = require('./domain');
const planner = require('./planner');
const replacements = require('./duty-replacements');
const ABSENCES = new Set(['sick','vacation','day_off','personal_permission','holiday']);
const RESTRICTIONS = new Set(['a','planning_block','off','vacation','sick','day_off','personal','other']);
function cleanInput(state,input,now) {
  const kind = input.kind || 'status', employeeId = String(input.employeeId || ''), person = d.getEmployee(state,employeeId);
  if (!person.active) throw new Error('Працівник уже в архіві.');
  if (!['status','restriction','archive'].includes(kind)) throw new Error('Невідомий тип зміни доступності.');
  const startDate = kind==='archive' ? planner.dateKey(now) : input.startDate || input.date;
  if(kind==='archive'&&input.startDate&&input.startDate!==startDate)throw new Error('Дата змінилася. Перевірте наслідки переведення до архіву ще раз.');
  const endDate = kind==='archive' ? d.addDays(startDate,365) : input.endDate || startDate;
  if (!planner.validDate(startDate) || !planner.validDate(endDate) || endDate<startDate || endDate>d.addDays(startDate,365)) throw new Error('Оберіть коректний період до 366 календарних днів.');
  const status = kind==='restriction' ? input.type : input.status;
  if(kind==='status'&&!ABSENCES.has(status) || kind==='restriction'&&!RESTRICTIONS.has(status))throw new Error('Оберіть допустиму причину недоступності.');
  const reason = String(input.reason ?? input.note ?? '').trim();
  if(!reason || reason.length>500)throw new Error('Вкажіть пояснення зміни від 1 до 500 символів.');
  const scheduleId = kind==='restriction' ? String(input.scheduleId || state.activeDutyScheduleId) : null;
  if(scheduleId)replacements.scheduleView(state,scheduleId);
  return {kind,employeeId,startDate,endDate,status:status || null,type:kind==='restriction'?status:null,reason,scheduleId,workdaysOnly:kind==='status'&&input.workdaysOnly===true};
}
function inspectStaffEffects(state,change,dates,now=new Date()) {
  const person=d.getEmployee(state,change.employeeId),today=planner.dateKey(now);
  const affectedDates=new Set(dates);
  const markedDates=new Set(dates);
  if(change.type==='a')dates.forEach(date=>affectedDates.add(d.addDays(date,-1)));
  const duties=d.dutySchedules(state).filter(schedule=>!change.scheduleId||schedule.id===change.scheduleId).flatMap(schedule=>{
    const view=replacements.scheduleView(state,schedule.id);
    return Object.values(view.duties.assignments).filter(assignment=>assignment.employeeIds.includes(person.id)
      && (change.kind==='archive'?assignment.date>=today:affectedDates.has(assignment.date))).map(assignment=>({
      scheduleId:schedule.id,scheduleName:schedule.name,date:assignment.date,employeeId:person.id,
      before:[...assignment.employeeIds],after:assignment.employeeIds.filter(id=>id!==person.id),
      locked:d.dutyDateLocked(view,assignment.date),realized:assignment.realizedEmployeeIds?.includes(person.id) || false,
      past:assignment.date<today }));
  });
  const tasks=(state.tasks || []).filter(task=>planner.active(task)&&task.assigneeIds.includes(person.id)
    && (change.kind==='archive'||change.kind==='status'&&affectedDates.has(task.dueDate)
      ||change.kind==='restriction'&&!['planning_block'].includes(change.type)&&markedDates.has(task.dueDate)))
    .map(task=>({id:task.id,title:task.title,dueDate:task.dueDate,dueTime:task.dueTime,priority:task.priority,status:task.status}));
  const blockers=[];
  for(const duty of duties) {
    if(duty.locked)blockers.push(`${duty.scheduleName}, ${duty.date}: тиждень заблоковано. Розблокуйте його перед зміною.`);
    if(duty.realized||duty.past)blockers.push(`${duty.scheduleName}, ${duty.date}: є виконане або минуле чергування. Перевірте фактичний облік окремо.`);
  }
  if(change.kind==='status')for(const date of dates)if(state.records[d.recordKey(person.id,date)]?.receiptId)blockers.push(`${date}: день пов’язаний із документом. Спочатку виправте його зарахування.`);
  if(change.kind==='restriction')for(const date of dates)if(d.dutyDateLocked(replacements.scheduleView(state,change.scheduleId),date))blockers.push(`${date}: тиждень графіка заблоковано.`);
  return {duties,tasks,blockers:[...new Set(blockers)]};
}
function previewStaffChange(state,input,now=new Date()) {
  const change = cleanInput(state,input,now), person = d.getEmployee(state,change.employeeId), today=planner.dateKey(now);
  const dates=[];
  if(change.kind!=='archive')for(let date=change.startDate;date<=change.endDate;date=d.addDays(date,1)) {
    if (!d.employeeExistsOnDate(person,date) || change.workdaysOnly&&!d.isEmployeeWorkday(state,person.id,date))continue;
    dates.push(date);
  }
  const {duties,tasks,blockers}=inspectStaffEffects(state,change,dates,now);
  if(change.kind!=='archive'&&!dates.length)blockers.push('У періоді немає доступних дат обліку цього працівника.');
  return {change,employeeName:person.name,dates,duties,tasks,blockers:[...new Set(blockers)],canApply:blockers.length===0,token:replacements.fingerprint(state)};
}
function removeAffectedDuties(draft,duties,employeeId,reason,now=new Date()) {
  for(const duty of duties) {
    const view=replacements.scheduleView(draft,duty.scheduleId), previous=view.duties.assignments[duty.date];
    const after=previous.employeeIds.filter(id=>id!==employeeId);
    view.duties.assignments[duty.date]={...previous,employeeIds:after,singleApproved:false,
      realizedEmployeeIds:(previous.realizedEmployeeIds || []).filter(id=>after.includes(id)),
      manualEmployeeIds:(previous.manualEmployeeIds || []).filter(id=>after.includes(id)),
      source:'availability_change',updatedAt:now.toISOString(),
      replacementNeeds:[...(previous.replacementNeeds || []).filter(item=>item.employeeId!==employeeId),
        {employeeId:employeeId,name:d.getEmployee(draft,employeeId).name,reason:reason,at:now.toISOString()}]};
  }
}
function applyStaffChange(state,input,now=new Date()) {
  if(!input.expectedToken || replacements.fingerprint(state)!==input.expectedToken)throw new Error('Дані змінилися. Перевірте наслідки ще раз перед збереженням.');
  const report=previewStaffChange(state,input.change,now);
  if(!report.canApply)throw new Error(report.blockers.join('\n'));
  const draft=d.clone(state), active=draft.dutySchedules.find(schedule=>schedule.id===draft.activeDutyScheduleId);
  if(active)active.data=draft.duties;
  const {change}=report;
  removeAffectedDuties(draft,report.duties,change.employeeId,change.reason,now);
  if(change.kind==='archive')d.archiveEmployee(draft,change.employeeId,now);
  else for(const date of report.dates) {
    if(change.kind==='status')d.setManualStatus(draft,{employeeId:change.employeeId,date,status:change.status,note:change.reason},now);
    else d.setDutyRestriction(replacements.scheduleView(draft,change.scheduleId),{employeeId:change.employeeId,date,type:change.type,note:change.reason},now);
  }
  for(const duty of report.duties) {
    const view=replacements.scheduleView(draft,duty.scheduleId), assignment=view.duties.assignments[duty.date];
    assignment.explanation=d.explainDutyAssignment(view,duty.date,assignment.employeeIds,{now,provenance:'manual'});
  }
  draft.audit.push({id:crypto.randomUUID(),at:now.toISOString(),action:'staff_change_applied',details:{...change,employeeName:report.employeeName,actor:state.settings.operatorName || 'Керівник',duties:report.duties,tasks:report.tasks}});
  if(draft.audit.length>5000)draft.audit=draft.audit.slice(-5000);
  Object.assign(state,draft);
  return {change,duties:report.duties,tasks:report.tasks,dates:report.dates};
}
function getConsequences(state,input={},now=new Date()) {
  const today=planner.dateKey(now), from=input.startDate || today, allFuture=!input.startDate&&!input.endDate;
  const futureDates=allFuture ? [...d.dutySchedules(state).flatMap(schedule=>Object.keys(replacements.scheduleView(state,schedule.id).duties.assignments)),...(state.tasks || []).filter(planner.active).map(task=>task.dueDate)].filter(planner.validDate) : [];
  const to=input.endDate || [...futureDates,d.addDays(from,365)].sort().at(-1);
  if(!planner.validDate(from)||!planner.validDate(to)||from>to||!allFuture&&to>d.addDays(from,365))throw new Error('Для наслідків оберіть період до 366 днів.');
  const issues=[], inRange=date=>date>=from&&date<=to;
  for(const schedule of d.dutySchedules(state)) {
    if(input.scheduleId&&schedule.id!==input.scheduleId)continue;
    const view=replacements.scheduleView(state,schedule.id), rules=d.normalizeDutyRules(view.duties.rules);
    for(const assignment of Object.values(view.duties.assignments).filter(item=>inRange(item.date))) {
      const count=assignment.employeeIds.length, missing=Math.max(0,d.dutyRequiredCount(view,assignment.date)-count), locked=d.dutyDateLocked(view,assignment.date);
      if(missing&&!(assignment.singleApproved&&count===1)) {
        const need=assignment.replacementNeeds?.[0];
        if(!input.employeeId||need?.employeeId===input.employeeId)issues.push({id:`gap:${schedule.id}:${assignment.date}`,kind:'vacancy',date:assignment.date,scheduleId:schedule.id,scheduleName:schedule.name,
          employeeId:need?.employeeId || '',employeeName:need?.name || '',title:`Не вистачає чергових: ${missing}`,reasons:[need?.reason || 'Склад дня не відповідає потрібній кількості.'],locked,missing,severity:'action'});
      }
      for(const id of assignment.employeeIds) {
        if(input.employeeId&&id!==input.employeeId)continue;
        const person=state.employees.find(person=>person.id===id);
        const reasons=person?.active ? d.dutyCandidateConflicts(view,assignment.date,id,rules) : ['Працівник у архіві або відсутній у базі.'];
        const other=d.dutySchedules(state).find(other=>other.id!==schedule.id&&replacements.scheduleView(state,other.id).duties.assignments[assignment.date]?.employeeIds.includes(id));
        if(other)reasons.push(`Також призначений у графіку «${other.name}» цього дня.`);
        if(reasons.length)issues.push({id:`duty:${schedule.id}:${assignment.date}:${id}`,kind:'duty',date:assignment.date,scheduleId:schedule.id,scheduleName:schedule.name,employeeId:id,employeeName:person?.name || 'Працівник з історії',title:'Чергування потребує перевірки',reasons,locked,realized:assignment.realizedEmployeeIds?.includes(id)||false,severity:'action'});
      }
    }
  }
  for(const task of (state.tasks || []).filter(planner.active))for(const id of task.assigneeIds) {
    if(input.employeeId&&id!==input.employeeId)continue;
    const person=state.employees.find(person=>person.id===id), archived=!person?.active;
    if(!inRange(task.dueDate)&&!archived&&!(allFuture&&task.dueDate<from))continue;
    const reasons=[];
    if(archived)reasons.push('Відповідальний у архіві; перевірте виконавця і строк.');
    const status=state.records[d.recordKey(id,task.dueDate)]?.status;
    if(ABSENCES.has(status))reasons.push(`На день строку в табелі: ${d.STATUS_LABELS[status]}.`);
    const marks=d.dutySchedules(state).flatMap(schedule=>{
      const view=replacements.scheduleView(state,schedule.id), mark=view.duties.unavailable[d.recordKey(id,task.dueDate)];
      if(mark)return [`У графіку «${schedule.name}» позначено: ${d.dutyRestrictionLabel(mark.type)}.`];
      return view.duties.aDays[d.recordKey(id,task.dueDate)]?[`У графіку «${schedule.name}» позначено «А»; перевірте сумісність із завданням.`]:[];
    });
    reasons.push(...marks);
    if(reasons.length)issues.push({id:`task:${task.id}:${id}`,kind:'task',taskId:task.id,date:task.dueDate,employeeId:id,employeeName:person?.name || 'Працівник з історії',title:task.title,reasons,severity:archived||ABSENCES.has(status)?'action':'review'});
    if(task.priority==='urgent'&&inRange(task.dueDate))for(const schedule of d.dutySchedules(state)) {
      if(input.scheduleId&&schedule.id!==input.scheduleId)continue;
      const view=replacements.scheduleView(state,schedule.id);
      if(view.duties.assignments[task.dueDate]?.employeeIds.includes(id))issues.push({id:`urgent:${task.id}:${id}:${schedule.id}`,kind:'urgent',taskId:task.id,date:task.dueDate,scheduleId:schedule.id,scheduleName:schedule.name,employeeId:id,employeeName:person?.name || '',title:'Термінове завдання і чергування в один день',reasons:[`«${task.title}», строк ${task.dueTime || 'до кінця дня'}. Тривалість роботи не задана; перевірте сумісність.`],severity:'review'});
    }
  }
  issues.sort((a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  return {startDate:from,endDate:to,generatedAt:now.toISOString(),total:issues.length,actionCount:issues.filter(issue=>issue.severity==='action').length,reviewCount:issues.filter(issue=>issue.severity==='review').length,issues};
}
module.exports={ABSENCES,inspectStaffEffects,removeAffectedDuties,previewStaffChange,applyStaffChange,getConsequences};
