const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../src/shared/domain'),a=require('../src/shared/availability'),staff=require('../src/shared/staff-changes'),tasks=require('../src/shared/tasks');
const now=new Date('2026-10-03T08:00:00Z');
function fixture(){const state=d.defaultState(now);state.settings.automaticClose=false;const people=['Олена','Петро','Ірина'].map(name=>d.createEmployee(state,name,new Date('2026-01-01T08:00:00Z')));d.initializeDutyHistory(state,people.map(p=>({employeeId:p.id,total:0,realized:0})),people.map(p=>p.id),now);return {state,people,input:{cells:[{employeeId:people[0].id,date:'2026-10-08'},{employeeId:people[1].id,date:'2026-10-08'}],action:'status',status:'sick',note:'Повідомлення про лікарняний',includeWeekends:true,replaceExisting:true}};}
test('batch absence and individual absence use the same protected effects, remove both absent people, and preserve tasks',()=>{
 const {state,people,input}=fixture();d.setDutyAssignment(state,{date:'2026-10-08',employeeIds:[people[0].id,people[1].id]},now);const task=tasks.createTask(state,{title:'Звіт',dueDate:'2026-10-08',assigneeIds:[people[0].id,people[1].id]},now),before=d.clone(state);
 const report=a.previewBatch(state,input,now),single=staff.previewStaffChange(state,{employeeId:people[0].id,startDate:'2026-10-08',status:'sick',reason:input.note},now);assert.equal(report.duties.length,2);assert.deepEqual(report.duties[0].after,[]);assert.equal(single.duties[0].date,report.duties[0].date);assert.equal(report.tasks.length,1);assert.deepEqual(state,before);
 a.applyBatch(state,{...input,expectedToken:report.token},now);assert.deepEqual(state.duties.assignments['2026-10-08'].employeeIds,[]);assert.equal(state.duties.assignments['2026-10-08'].replacementNeeds.length,2);assert.deepEqual(state.tasks[0],task);assert.equal(state.records[d.recordKey(people[1].id,'2026-10-08')].status,'sick');
});
test('locked, performed and historical duties stop the whole operation and explicit skipping removes only allowed appointments',()=>{
 for(const kind of ['locked','performed','past']){
  const {state,people,input}=fixture();input.cells[0].date=kind==='past'?'2026-10-01':'2026-10-07';d.setDutyAssignment(state,{date:input.cells[0].date,employeeIds:[people[0].id],singleApproved:true},now);d.setDutyAssignment(state,{date:'2026-10-08',employeeIds:[people[1].id],singleApproved:true},now);
  if(kind==='locked')d.setDutyWeekLocked(state,input.cells[0].date,true,now);if(kind==='performed')state.duties.assignments[input.cells[0].date].realizedEmployeeIds=[people[0].id];
  const before=d.clone(state),report=a.previewBatch(state,input,now);assert.equal(report.canApply,false);assert.throws(()=>a.applyBatch(state,{...input,expectedToken:report.token},now));assert.deepEqual(state,before);
  if(kind==='locked')assert.equal(report.count,0);else {const partial={...input,skipBlocked:true},preview=a.previewBatch(state,partial,now);assert.equal(preview.canApply,true);a.applyBatch(state,{...partial,expectedToken:preview.token},now);assert.deepEqual(state.duties.assignments[input.cells[0].date],before.duties.assignments[input.cells[0].date]);assert.deepEqual(state.duties.assignments['2026-10-08'].employeeIds,[]);}
 }
});
test('a lock or task change after preview rejects every write; a changed selection cannot reuse a token',()=>{
 const {state,people,input}=fixture();d.setDutyAssignment(state,{date:'2026-10-08',employeeIds:[people[0].id],singleApproved:true},now);const report=a.previewBatch(state,input,now),before=d.clone(state);
 assert.throws(()=>a.applyBatch(state,{...input,cells:[input.cells[0]],expectedToken:report.token},now),/змінилися/);assert.deepEqual(state,before);
 tasks.createTask(state,{title:'Нове завдання',dueDate:'2026-10-08',assigneeIds:[people[0].id]},now);const changed=d.clone(state);assert.throws(()=>a.applyBatch(state,{...input,expectedToken:report.token},now),/змінилися/);assert.deepEqual(state,changed);
});
test('calendar, explicit cell selection, existing-record protection and linked documents remain respected',()=>{
 const {state,people,input}=fixture();input.cells=[{employeeId:people[0].id,date:'2026-10-10'},{employeeId:people[0].id,date:'2026-10-08'}];input.includeWeekends=false;
 state.records[d.recordKey(people[0].id,'2026-10-08')]={employeeId:people[0].id,date:'2026-10-08',status:'submitted',receiptId:'document'};
 const report=a.previewBatch(state,input,now);assert.equal(report.skipped.length,1);assert.equal(report.blocked.length,1);assert.equal(report.duties.length,0);assert.equal(report.canApply,false);
 delete state.records[d.recordKey(people[0].id,'2026-10-08')];input.includeWeekends=true;const next=a.previewBatch(state,input,now);a.applyBatch(state,{...input,expectedToken:next.token},now);assert.equal(state.records[d.recordKey(people[0].id,'2026-10-10')].status,'sick');assert.ok(!state.records[d.recordKey(people[0].id,'2026-10-09')]);
});
test('period absence requires a preview token and explanation; non-absence edits keep their existing behavior',()=>{
 const {state,people}=fixture(),input={employeeId:people[0].id,startDate:'2026-10-08',endDate:'2026-10-09',status:'vacation',note:'Погоджена відпустка'};
 const report=a.previewPeriod(state,input,now);assert.equal(report.count,2);assert.throws(()=>a.applyPeriod(state,input,now),/Перевірити/);a.applyPeriod(state,{...input,expectedToken:report.token},now);
 assert.throws(()=>a.previewPeriod(state,{...input,note:''},now),/причину/);const result=a.applyBatch(state,{cells:[{employeeId:people[1].id,date:'2026-10-08'}],action:'status',status:'other_tasks'},now);assert.equal(result.count,1);
});
