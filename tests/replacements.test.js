const test=require('node:test');
const assert=require('node:assert/strict');
const d=require('../src/shared/domain');
const r=require('../src/shared/duty-replacements');
const staff=require('../src/shared/staff-changes');
const tasks=require('../src/shared/tasks');
const now=new Date('2026-10-03T08:00:00Z');
function fixture(count=1) {
  const state=d.defaultState(now);state.settings.automaticClose=false;
  const people=['Олена Коваль','Петро Бондар','Ірина Шевченко','Дмитро Мельник'].map(name=>d.createEmployee(state,name,new Date('2026-01-01T08:00:00Z')));
  d.initializeDutyHistory(state,people.map(person=>({employeeId:person.id,total:0,realized:0})),people.map(person=>person.id),now);
  state.duties.baselineThroughDate='2025-12-31';
  d.updateDutyScheduleRules(state,state.activeDutyScheduleId,{weekdayDutyCount:count,weekendDutyCount:count,minimumRestDays:0,preventConsecutiveWeekends:false,preventConsecutiveDays:true},now);
  const put=(date,ids,realized=[])=>{d.setDutyAssignment(state,{date,employeeIds:ids,singleApproved:ids.length===1,note:'Початковий склад'},now);state.duties.assignments[date].realizedEmployeeIds=[...realized];};
  return {state,people,put,query:{scheduleId:state.activeDutyScheduleId,date:'2026-10-08',employeeId:people[0].id}};
}
function apply(state,report,plan,extra={}) {return r.applyReplacement(state,{query:report.query,proposalId:plan.id,expectedToken:report.token,reason:'Погоджена підміна',...extra},now);}
test('direct replacement previews without mutation and preserves everyone else and their realization',()=>{
  const {state,people,put,query}=fixture(2);put(query.date,[people[0].id,people[1].id],[people[1].id]);
  const before=d.clone(state), report=r.getReplacementOptions(state,query,now);assert.deepEqual(state,before);
  const plan=report.plans.find(plan=>plan.kind==='direct'&&plan.candidateId===people[2].id);assert.ok(plan);apply(state,report,plan);
  const assignment=state.duties.assignments[query.date];assert.deepEqual(assignment.employeeIds,[people[2].id,people[1].id]);assert.deepEqual(assignment.realizedEmployeeIds,[people[1].id]);
  assert.equal(assignment.source,'manual_replacement');assert.equal(assignment.explanation.replacement.reason,'Погоджена підміна');
  assert.equal(state.audit.at(-1).action,'duty_replacement_applied');assert.deepEqual(d.normalizeState(d.clone(state),now).duties.assignments[query.date].explanation.replacement,assignment.explanation.replacement);
});
test('an exchange removes both original duties before validating the two new dates',()=>{
  const {state,people,put,query}=fixture();put(query.date,[people[0].id]);put('2026-10-09',[people[1].id]);
  state.duties.rules.maximumDutiesPerWeek=1;state.duties.rules.minimumRestMode='require';state.duties.rules.minimumRestDays=2;
  const report=r.getReplacementOptions(state,query,now);
  assert.ok(!report.plans.some(plan=>plan.kind==='direct'&&plan.candidateId===people[1].id));
  const plan=report.plans.find(plan=>plan.kind==='swap'&&plan.candidateId===people[1].id);assert.ok(plan);apply(state,report,plan);
  assert.deepEqual(state.duties.assignments['2026-10-08'].employeeIds,[people[1].id]);assert.deepEqual(state.duties.assignments['2026-10-09'].employeeIds,[people[0].id]);
  for(const date of ['2026-10-08','2026-10-09'])assert.equal(state.duties.assignments[date].explanation.replacement.changes.length,2);
});
test('an exchange can use an earlier future date and never uses a past date',()=>{
  const {state,people,put,query}=fixture();query.date='2026-10-10';put(query.date,[people[0].id]);put('2026-10-08',[people[1].id]);put('2026-10-02',[people[1].id]);
  const report=r.getReplacementOptions(state,query,now), swap=report.plans.find(plan=>plan.kind==='swap'&&plan.changes[1].date==='2026-10-08');assert.ok(swap);
  assert.ok(!swap.reasons.some(reason=>reason.startsWith('Попереднє чергування')&&reason.includes('2026-10-08')));
  assert.ok(!report.plans.some(plan=>plan.changes.some(change=>change.date==='2026-10-02')));
});
test('both adjacent dates, rest gaps and weekly limits are checked on the complete exchange',()=>{
  const {state,people,put,query}=fixture();put(query.date,[people[0].id]);put('2026-10-09',[people[1].id]);put('2026-10-07',[people[1].id]);
  let report=r.getReplacementOptions(state,query,now);assert.ok(!report.plans.some(plan=>plan.candidateId===people[1].id));
  delete state.duties.assignments['2026-10-07'];put('2026-10-11',[people[0].id]);state.duties.rules.minimumRestMode='require';state.duties.rules.minimumRestDays=2;
  report=r.getReplacementOptions(state,query,now);assert.ok(!report.plans.some(plan=>plan.kind==='swap'&&plan.candidateId===people[1].id));
});
test('locked or performed source duties cannot be replaced and performed exchange duties remain intact',()=>{
  const {state,people,put,query}=fixture();put(query.date,[people[0].id]);put('2026-10-09',[people[1].id]);
  d.setDutyWeekLocked(state,query.date,true,now);let report=r.getReplacementOptions(state,query,now);assert.equal(report.plans.length,0);assert.ok(report.blocked.length);
  d.setDutyWeekLocked(state,query.date,false,now);state.duties.assignments[query.date].realizedEmployeeIds=[people[0].id];report=r.getReplacementOptions(state,query,now);assert.equal(report.plans.length,0);
  state.duties.assignments[query.date].realizedEmployeeIds=[];state.duties.assignments['2026-10-09'].realizedEmployeeIds=[people[1].id];report=r.getReplacementOptions(state,query,now);assert.ok(!report.plans.some(plan=>plan.kind==='swap'&&plan.candidateId===people[1].id));
});
test('absence, A on the next day, participants and another schedule prevent a recommendation',()=>{
  const {state,people,put,query}=fixture();put(query.date,[people[0].id]);
  d.setDutyRestriction(state,{employeeId:people[1].id,date:'2026-10-09',type:'a'},now);
  d.setManualStatus(state,{employeeId:people[2].id,date:query.date,status:'sick'},now);
  const second=d.createDutySchedule(state,'Другий',now);second.data.initialized=true;second.data.participantIds=people.map(person=>person.id);second.data.rules.weekdayDutyCount=1;
  d.setDutyAssignment(r.scheduleView(state,second.id),{date:query.date,employeeIds:[people[3].id]},now);
  const report=r.getReplacementOptions(state,query,now);assert.equal(report.plans.length,0);assert.equal(report.rejected.length,3);
  assert.ok(report.rejected.some(person=>person.reasons.some(reason=>reason.includes('Другий'))));
});
test('deadline and partial time-off warnings require acknowledgement without inventing a hard conflict',()=>{
  const {state,people,put,query}=fixture();put(query.date,[people[0].id]);
  tasks.createTask(state,{title:'Терміновий звіт',dueDate:query.date,priority:'urgent',assigneeIds:[people[1].id]},now);
  d.createTimeOffEntry(state,{employeeId:people[1].id,date:query.date,startTime:'13:00',endTime:'14:00',destination:'Прийом'},now);
  const report=r.getReplacementOptions(state,query,now), plan=report.plans.find(plan=>plan.kind==='direct'&&plan.candidateId===people[1].id);assert.ok(plan);assert.equal(plan.warnings.length,2);
  const before=d.clone(state);assert.throws(()=>apply(state,report,plan),/попередження/);assert.deepEqual(state,before);apply(state,report,plan,{acknowledgeWarnings:true});
});
test('a former participant needing a substitute cannot be returned to the graph through an exchange',()=>{
  const {state,people,put,query}=fixture();put(query.date,[people[0].id]);put('2026-10-09',[people[1].id]);
  const preview=staff.previewStaffChange(state,{employeeId:people[0].id,startDate:query.date,status:'sick',reason:'Лікарняний'},now);
  staff.applyStaffChange(state,{change:preview.change,expectedToken:preview.token},now);
  state.duties.participantIds=state.duties.participantIds.filter(id=>id!==people[0].id);
  const report=r.getReplacementOptions(state,query,now);assert.ok(report.plans.some(plan=>plan.kind==='direct'));
  assert.ok(!report.plans.some(plan=>plan.kind==='swap'));assert.ok(report.rejected.some(person=>person.swapRejections.some(item=>item.reasons.some(reason=>reason.includes('не бере участі')))));
});
test('permissions on a subsequent duty are shown when they make the new placement possible',()=>{
  for(const weekend of [false,true]) {
    const {state,people,put,query}=fixture();query.date=weekend?'2026-10-10':'2026-10-08';
    const next=weekend?'2026-10-17':'2026-10-09';put(query.date,[people[0].id]);put(next,[people[1].id]);
    if(weekend)state.duties.rules.preventConsecutiveWeekends=true;
    let report=r.getReplacementOptions(state,query,now);assert.ok(!report.plans.some(plan=>plan.kind==='direct'&&plan.candidateId===people[1].id));
    state.duties.dayExceptions[next]={[weekend?'allowConsecutiveWeekend':'allowConsecutiveDay']:true,note:'Попередньо погоджений дозвіл'};
    report=r.getReplacementOptions(state,query,now);const plan=report.plans.find(plan=>plan.kind==='direct'&&plan.candidateId===people[1].id);assert.ok(plan);
    assert.ok(plan.warnings.some(warning=>warning.includes(next)&&warning.includes('Попередньо погоджений дозвіл')));
  }
});
test('stale data, forged proposals and missing reasons cannot apply any part of an exchange',()=>{
  const {state,people,put,query}=fixture();put(query.date,[people[0].id]);put('2026-10-09',[people[1].id]);
  const report=r.getReplacementOptions(state,query,now), plan=report.plans.find(plan=>plan.kind==='swap');const before=d.clone(state);
  assert.throws(()=>apply(state,report,plan,{reason:''}),/причину/);assert.deepEqual(state,before);
  assert.throws(()=>apply(state,report,plan,{proposalId:'forged'}),/доступний/);assert.deepEqual(state,before);
  state.settings.operatorName='Зміна даних';const changed=d.clone(state);assert.throws(()=>apply(state,report,plan),/Дані змінилися/);assert.deepEqual(state,changed);
});
test('absence preview identifies every schedule and task, then saves vacancies without changing tasks or documents',()=>{
  const {state,people,put}=fixture();const primary=state.activeDutyScheduleId;put('2026-10-08',[people[0].id]);put('2026-10-10',[people[0].id]);
  const second=d.createDutySchedule(state,'Другий',now);second.data.initialized=true;second.data.participantIds=people.map(person=>person.id);second.data.rules.weekdayDutyCount=1;
  d.setDutyAssignment(r.scheduleView(state,second.id),{date:'2026-10-09',employeeIds:[people[0].id]},now);
  const task=tasks.createTask(state,{title:'Звіт',dueDate:'2026-10-09',assigneeIds:[people[0].id]},now), taskBefore=d.clone(task);
  const before=d.clone(state), report=staff.previewStaffChange(state,{employeeId:people[0].id,startDate:'2026-10-08',endDate:'2026-10-10',status:'sick',reason:'Лікарняний'},now);
  assert.deepEqual(state,before);assert.equal(report.duties.length,3);assert.equal(report.tasks.length,1);assert.equal(report.dates.length,3);
  staff.applyStaffChange(state,{change:report.change,expectedToken:report.token},now);
  assert.deepEqual(state.tasks[0],taskBefore);assert.deepEqual(state.receipts,before.receipts);assert.equal(state.records[d.recordKey(people[0].id,'2026-10-10')].status,'sick');
  const issues=staff.getConsequences(state,{},now);assert.equal(issues.issues.filter(issue=>issue.kind==='vacancy').length,3);assert.equal(issues.issues.filter(issue=>issue.kind==='task').length,1);
  const vacancy=r.getReplacementOptions(state,{date:'2026-10-08',employeeId:people[0].id,scheduleId:primary},now);assert.ok(vacancy.plans.length);apply(state,vacancy,vacancy.plans[0],{acknowledgeWarnings:true});
  assert.equal(staff.getConsequences(state,{},now).issues.filter(issue=>issue.kind==='vacancy').length,2);
});
test('locked, performed and linked-document dates block the whole availability change',()=>{
  for(const blocker of ['locked','realized','receipt']) {
    const {state,people,put}=fixture();put('2026-10-08',[people[0].id]);
    if(blocker==='locked')d.setDutyWeekLocked(state,'2026-10-08',true,now);
    if(blocker==='realized')state.duties.assignments['2026-10-08'].realizedEmployeeIds=[people[0].id];
    if(blocker==='receipt')state.records[d.recordKey(people[0].id,'2026-10-09')]={employeeId:people[0].id,date:'2026-10-09',status:'submitted_advance',receiptId:'protected-document'};
    const report=staff.previewStaffChange(state,{employeeId:people[0].id,startDate:'2026-10-08',endDate:'2026-10-09',status:'vacation',reason:'Відпустка'},now);assert.equal(report.canApply,false);
    const before=d.clone(state);assert.throws(()=>staff.applyStaffChange(state,{change:report.change,expectedToken:report.token},now));assert.deepEqual(state,before);
  }
});
test('archiving previews all future duties and active tasks, preserving historical assignments',()=>{
  const {state,people,put}=fixture();put('2026-10-01',[people[0].id],[people[0].id]);put('2027-12-01',[people[0].id]);
  tasks.createTask(state,{title:'Старе завдання',dueDate:'2026-10-01',assigneeIds:[people[0].id]},now);
  const report=staff.previewStaffChange(state,{kind:'archive',employeeId:people[0].id,reason:'Вибув з команди'},now);assert.equal(report.duties.length,1);assert.equal(report.tasks.length,1);
  staff.applyStaffChange(state,{change:report.change,expectedToken:report.token},now);assert.equal(state.employees[0].active,false);assert.deepEqual(state.duties.assignments['2026-10-01'].realizedEmployeeIds,[people[0].id]);
  assert.equal(state.duties.assignments['2027-12-01'].replacementNeeds[0].employeeId,people[0].id);assert.ok(staff.getConsequences(state,{},now).issues.some(issue=>issue.kind==='task'));
  assert.ok(staff.getConsequences(state,{},now).issues.some(issue=>issue.kind==='vacancy'&&issue.date==='2027-12-01'));
});
test('scoped restrictions affect only that schedule and A identifies the previous duty',()=>{
  const {state,people,put}=fixture();put('2026-10-08',[people[0].id]);
  tasks.createTask(state,{title:'Попереднє завдання',dueDate:'2026-10-08',assigneeIds:[people[0].id]},now);
  const affectedTask=tasks.createTask(state,{title:'Завдання у день А',dueDate:'2026-10-09',assigneeIds:[people[0].id]},now);
  const report=staff.previewStaffChange(state,{kind:'restriction',employeeId:people[0].id,startDate:'2026-10-09',endDate:'2026-10-09',type:'a',scheduleId:state.activeDutyScheduleId,reason:'Залучення'},now);assert.equal(report.duties[0].date,'2026-10-08');
  assert.deepEqual(report.tasks.map(task=>task.id),[affectedTask.id]);
  staff.applyStaffChange(state,{change:report.change,expectedToken:report.token},now);assert.ok(state.duties.aDays[d.recordKey(people[0].id,'2026-10-09')]);assert.deepEqual(state.records,{});
  const taskIssues=staff.getConsequences(state,{},now).issues.filter(issue=>issue.kind==='task');assert.equal(taskIssues.length,1);assert.equal(taskIssues[0].taskId,affectedTask.id);assert.equal(taskIssues[0].severity,'review');
});
test('urgent task overlap is a review and resolves when the task is finished',()=>{
  const {state,people,put}=fixture();put('2026-10-08',[people[0].id]);
  const task=tasks.createTask(state,{title:'Терміновий звіт',dueDate:'2026-10-08',priority:'urgent',assigneeIds:[people[0].id]},now);
  let issues=staff.getConsequences(state,{},now);assert.equal(issues.reviewCount,1);assert.equal(issues.actionCount,0);
  tasks.setTaskStatus(state,task.id,{status:'done'},now);issues=staff.getConsequences(state,{},now);assert.equal(issues.total,0);
});
test('an unresolved task whose deadline fell during absence remains visible after the deadline',()=>{
  const {state,people}=fixture();d.setManualStatus(state,{employeeId:people[0].id,date:'2026-10-02',status:'sick'},now);
  const task=tasks.createTask(state,{title:'Прострочений звіт',dueDate:'2026-10-02',assigneeIds:[people[0].id]},now);
  assert.ok(staff.getConsequences(state,{},now).issues.some(issue=>issue.taskId===task.id&&issue.severity==='action'));
  tasks.updateTask(state,task.id,{...task,dueDate:'2026-10-06',reason:'Строк перенесено через лікарняний',expectedRevision:task.revision},now);
  assert.ok(!staff.getConsequences(state,{},now).issues.some(issue=>issue.taskId===task.id));
});
