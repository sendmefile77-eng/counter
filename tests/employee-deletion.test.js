const test=require('node:test');
const assert=require('node:assert/strict');
const d=require('../src/shared/domain');
const deletion=require('../src/shared/employee-deletion');
const tasks=require('../src/shared/tasks');
const work=require('../src/shared/work');
const presence=require('../src/shared/presence');
const draws=require('../src/shared/draws');
const replacements=require('../src/shared/duty-replacements');
const now=new Date('2026-10-05T12:00:00Z');
function fixture(){
  const state=d.defaultState(now);state.settings.automaticClose=false;
  const people=['Архівний працівник','Інший працівник','Ще один працівник'].map(name=>d.createEmployee(state,name,new Date('2026-09-01T12:00:00Z')));
  d.initializeDutyHistory(state,people.map(person=>({employeeId:person.id,total:2,realized:1})),people.map(person=>person.id),now);
  state.duties.baselineThroughDate='2026-09-30';
  d.setDutyAssignment(state,{date:'2026-10-03',employeeIds:[people[0].id,people[1].id]},now);
  d.setDutyRealized(state,'2026-10-03',people[0].id,true,now);
  const second=d.duplicateDutySchedule(state,'primary','Другий',now);
  d.setDutyAssignment(replacements.scheduleView(state,second.id),{date:'2026-10-03',employeeIds:[people[0].id,people[1].id]},now);
  d.setManualStatus(state,{employeeId:people[0].id,date:'2026-10-01',status:'other_tasks'},now);
  d.setManualStatus(state,{employeeId:people[1].id,date:'2026-10-01',status:'other_tasks'},now);
  presence.write(state,{employeeId:people[0].id,date:'2026-10-02',status:'onsite',note:'Працює'},now);
  d.setWorkdayOverride(state,people[0].id,'2026-10-03','Працює в суботу',now);
  const entry=work.create(state,{employeeId:people[0].id,title:'Поточна робота',projectCount:5,startDate:'2026-10-01',estimatedEndDate:'2026-10-10'},now);
  const shared=tasks.createTask(state,{title:'Спільне завдання',dueDate:'2026-10-08',assigneeIds:people.slice(0,2).map(person=>person.id)},now);
  const solo=tasks.createTask(state,{title:'Особисте доручення',dueDate:'2026-10-08',assigneeIds:[people[0].id],color:'rose',tags:['Звіт']},now);
  const draw=draws.createDraw(state,{title:'Збережений результат',count:3,participantIds:people.map(person=>person.id)},now);
  d.archiveEmployee(state,people[0].id,now);
  return {state,people,second,entry,shared,solo,draw};
}
test('archive deletion removes only employee accounting across all schedules, retaining tasks and saved names',()=>{
  const f=fixture(),id=f.people[0].id,other=d.clone(f.state.records[d.recordKey(f.people[1].id,'2026-10-01')]),protocol=d.clone(f.draw);
  const report=deletion.preview(f.state,id);assert.equal(report.records,1);assert.equal(report.presence,1);assert.equal(report.work,1);assert.equal(report.duties.length,2);assert.equal(report.tasks.filter(task=>task.needsAssignee).length,1);
  deletion.apply(f.state,{employeeId:id,expectedToken:report.token},now);
  assert.equal(f.state.employees.some(person=>person.id===id),false);assert.equal(f.state.workEntries.length,0);
  for(const field of ['records','presenceRecords','workdayOverrides'])assert.ok(!Object.keys(f.state[field]).some(key=>key.startsWith(id+'|')));
  for(const schedule of d.dutySchedules(f.state)){const data=replacements.scheduleView(f.state,schedule.id).duties;assert.equal(data.baselines[id],undefined);assert.deepEqual(data.assignments['2026-10-03'].employeeIds,[f.people[1].id]);assert.deepEqual(data.assignments['2026-10-03'].realizedEmployeeIds,[]);assert.equal(data.assignments['2026-10-03'].explanation,undefined);}
  assert.deepEqual(f.state.records[d.recordKey(f.people[1].id,'2026-10-01')],other);
  const shared=f.state.tasks.find(task=>task.id===f.shared.id),solo=f.state.tasks.find(task=>task.id===f.solo.id);
  assert.deepEqual(shared.assigneeIds,[f.people[1].id]);assert.equal(shared.status,'open');assert.deepEqual(solo.assigneeIds,[]);assert.equal(solo.status,'blocked');assert.equal(solo.color,'rose');assert.deepEqual(solo.tags,['Звіт']);assert.ok(solo.history.at(-1).details.reason.includes('Потрібен новий'));
  assert.deepEqual(f.state.draws[0],protocol);assert.equal(f.state.audit.at(-1).action,'employee_deleted');
  const restored=d.normalizeState(JSON.parse(JSON.stringify(f.state)),now);assert.equal(restored.employees.length,2);assert.equal(restored.tasks.length,2);assert.deepEqual(restored.draws,f.state.draws);
});
test('deletion rejects active employees, missing people and stale previews without changes',()=>{
  const {state,people}=fixture();const before=d.clone(state);
  assert.throws(()=>deletion.preview(state,people[1].id),/лише/);assert.throws(()=>deletion.preview(state,'missing'));assert.deepEqual(state,before);
  const report=deletion.preview(state,people[0].id);tasks.createTask(state,{title:'Нове доручення',dueDate:'2026-10-08'},now);const changed=d.clone(state);
  assert.throws(()=>deletion.apply(state,{employeeId:people[0].id,expectedToken:report.token},now),/змінилися/);assert.deepEqual(state,changed);
});
