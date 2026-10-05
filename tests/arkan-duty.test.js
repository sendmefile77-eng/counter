const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../src/shared/domain'),p=require('../src/shared/presence'),changes=require('../src/shared/presence-changes');
const replacements=require('../src/shared/duty-replacements'),work=require('../src/shared/work'),tasks=require('../src/shared/tasks');
const staff=require('../src/shared/staff-changes');
const now=new Date('2026-10-05T09:00:00+03:00');
function fixture(){
  const state=d.defaultState(now);state.settings.automaticClose=false;
  const people=['Олена','Петро','Ірина','Дмитро'].map(name=>d.createEmployee(state,name,new Date('2026-09-01T09:00:00+03:00')));
  d.initializeDutyHistory(state,people.map(person=>({employeeId:person.id,total:0,realized:0})),people.map(person=>person.id),now);
  state.duties.rules.preventConsecutiveDays=false;state.duties.rules.preventConsecutiveWeekends=false;
  return {state,people};
}
test('presence Arkan and legacy A have identical day and eve restrictions across calendar boundaries',()=>{
  for(const date of ['2026-10-06','2026-11-01','2027-01-01']){
    const {state,people}=fixture(),id=people[0].id,legacy=d.clone(state);
    d.setDutyRestriction(legacy,{employeeId:id,date,type:'a'},now);
    changes.save(state,{employeeId:id,date,status:'arkan'},now);
    for(const offset of [-2,-1,0,1]){
      const day=d.addDays(date,offset);assert.equal(d.dutyRestriction(state,id,day),d.dutyRestriction(legacy,id,day));
    }
    assert.equal(d.dutyRestriction(state,id,d.addDays(date,-1)),'before_a');
    assert.equal(d.dutyRestriction(state,id,date),'a_day');
    assert.equal(p.dutyAMark(state,id,date).source,'presence');assert.equal(p.dutyAMark(legacy,id,date).source,'duty_a');
    const before=d.clone(state);
    for(const day of [d.addDays(date,-1),date]){
      assert.throws(()=>d.setDutyAssignment(state,{date:day,employeeIds:[id],singleApproved:true},now),/недоступний/);
      assert.throws(()=>d.toggleDutyAssignment(state,id,day,now));
    }
    assert.deepEqual(state,before);
  }
});
test('saving Arkan removes its eve and day in every schedule and preserves work and tasks',()=>{
  const {state,people}=fixture(),id=people[0].id,date='2026-11-01',eve='2026-10-31';
  const second=d.createDutySchedule(state,'Другий графік',now);
  d.initializeDutyHistory(state,people.map(person=>({employeeId:person.id,total:0,realized:0})),people.map(person=>person.id),now);
  for(const schedule of d.dutySchedules(state))for(const day of [eve,date])
    d.setDutyAssignment(replacements.scheduleView(state,schedule.id),{date:day,employeeIds:[id,people[1].id]},now);
  work.create(state,{employeeId:id,title:'Робота триває',projectCount:5,startDate:'2026-10-01',estimatedEndDate:'2026-11-03'},now);
  tasks.createTask(state,{title:'Завдання на Аркані',dueDate:date,assigneeIds:[id]},now);
  const earlierTask=tasks.createTask(state,{title:'Звичайна робота напередодні',dueDate:eve,assigneeIds:[id]},now);
  const before=d.clone(state),report=changes.save(state,{employeeId:id,date,status:'arkan'},now);
  assert.equal(report.duties.length,4);assert.deepEqual(state.workEntries,before.workEntries);assert.deepEqual(state.tasks,before.tasks);
  assert.ok(report.tasks.every(task=>task.id!==earlierTask.id));
  for(const schedule of d.dutySchedules(state)){
    const view=replacements.scheduleView(state,schedule.id);
    for(const day of [eve,date]){assert.deepEqual(view.duties.assignments[day].employeeIds,[people[1].id]);assert.match(view.duties.assignments[day].replacementNeeds[0].reason,/Аркан/);}
  }
  assert.equal(second.name,'Другий графік');
});
test('protected eve blocks the entire Arkan change, including other schedules',()=>{
  for(const kind of ['locked','realized','past']){
    const {state,people}=fixture(),id=people[0].id,eve=kind==='past'?'2026-10-04':'2026-10-11',date=d.addDays(eve,1);
    d.setDutyAssignment(state,{date:eve,employeeIds:[id],singleApproved:true},now);
    if(kind==='locked')d.setDutyWeekLocked(state,eve,true,now);
    if(kind==='realized')state.duties.assignments[eve].realizedEmployeeIds=[id];
    const before=d.clone(state),report=changes.preview(state,{employeeId:id,date,status:'arkan'},now);
    assert.equal(report.canApply,false);assert.throws(()=>changes.save(state,{employeeId:id,date,status:'arkan'},now));assert.deepEqual(state,before);
  }
});
test('generator, substitutions and swap destinations all exclude the Arkan eve and day',()=>{
  const {state,people}=fixture(),id=people[0].id,date='2026-10-13',eve='2026-10-12';
  changes.save(state,{employeeId:id,date,status:'arkan'},now);
  d.generateDutySchedule(state,{startDate:eve,endDate:'2026-10-18'},now);
  for(const day of [eve,date]){
    assert.ok(!state.duties.assignments[day].employeeIds.includes(id));
    const report=replacements.getReplacementOptions(state,{date:day,employeeId:state.duties.assignments[day].employeeIds[0]},now);
    assert.ok(report.plans.every(plan=>plan.changes.every(change=>!([eve,date].includes(change.date)&&change.after.includes(id)))));
  }
});
test('bulk Arkan survives backup restore; clearing presence removes both restrictions and preserves a separate legacy A',()=>{
  const {state,people}=fixture(),id=people[0].id;
  d.setDutyRestriction(state,{employeeId:id,date:'2026-10-16',type:'a'},now);
  changes.save(state,{employeeIds:[id,people[1].id],startDate:'2026-10-12',endDate:'2026-10-14',status:'arkan'},now);
  const reload=d.normalizeState(d.clone(state),now);
  for(const person of people.slice(0,2))for(const day of ['2026-10-11','2026-10-12','2026-10-13','2026-10-14'])assert.ok(['a_day','before_a'].includes(d.dutyRestriction(reload,person.id,day)));
  changes.save(reload,{employeeIds:[id,people[1].id],startDate:'2026-10-12',endDate:'2026-10-14',action:'clear'},now);
  assert.equal(d.dutyRestriction(reload,id,'2026-10-11'),null);assert.equal(d.dutyRestriction(reload,id,'2026-10-14'),null);
  assert.equal(d.dutyRestriction(reload,id,'2026-10-15'),'before_a');assert.equal(d.dutyRestriction(reload,id,'2026-10-16'),'a_day');
});
test('an old backup with a duty on the Arkan eve is reported without silently rewriting its history',()=>{
  const {state,people}=fixture(),id=people[0].id,eve='2026-10-11',date='2026-10-12';
  d.setDutyAssignment(state,{date:eve,employeeIds:[id,people[1].id]},now);
  p.write(state,{employeeId:id,date,status:'arkan'},now);
  const reload=d.normalizeState(d.clone(state),now),before=d.clone(reload);
  const issue=staff.getConsequences(reload,{},now).issues.find(item=>item.kind==='duty'&&item.employeeId===id&&item.date===eve);
  assert.ok(issue);assert.match(issue.reasons.join(' '),/напередодні/);assert.deepEqual(reload,before);
});
