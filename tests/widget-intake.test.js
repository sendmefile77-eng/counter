const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const d=require('../src/shared/domain'),work=require('../src/shared/work'),presence=require('../src/shared/presence'),journal=require('../src/shared/journal'),deletion=require('../src/shared/employee-deletion');
const now=new Date(2026,9,5,12),today='2026-10-05';
function fixture(start='2026-09-28') {const state=d.defaultState(now);state.settings.automaticClose=false;const person=d.createEmployee(state,'Олена Коваль',new Date(start+'T09:00:00'));return {state,person};}
function receive(state,person,count=1,at=now,extra={}) {return work.receiveObjects(state,{id:crypto.randomUUID(),employeeId:person.id,date:work.dateKey(at),objectCount:count,...extra},at);}
test('three objects close today and the nearest two open days even without automatic misses or with active work',()=>{
 const {state,person}=fixture();work.create(state,{employeeId:person.id,title:'Активна робота',projectCount:5,startDate:'2026-09-28',estimatedEndDate:'2026-10-09'},now);
 presence.write(state,{employeeId:person.id,date:today,status:'onsite'},now);
 assert.equal(work.intakeSummary(state,person.id,today).objectCount,0);
 const entries=[receive(state,person),receive(state,person),receive(state,person)];
 assert.deepEqual(entries.flatMap(item=>item.dates),['2026-10-05','2026-10-02','2026-10-01']);
 assert.equal(work.intakeSummary(state,person.id,today).objectCount,3);
 const report=journal.report(state,{startDate:'2026-10-01',endDate:today},today);
 assert.equal(report.totals.submitted,3);assert.equal(state.workEntries[0].completedProjects,0);
 assert.equal(state.records[person.id+'|2026-10-02'].source,'widget');
});
test('allocation skips confirmed days, absences, training, Arkan, weekends and employment gaps',()=>{
 const {state,person}=fixture('2026-09-01');
 person.activePeriods=[{start:'2026-09-01',end:'2026-09-10'},{start:'2026-09-14',end:null}];
 for(const [date,status] of Object.entries({'2026-10-02':'vacation','2026-10-01':'sick','2026-09-30':'training_online','2026-09-29':'training_academy','2026-09-28':'arkan','2026-09-25':'weekend'}))presence.write(state,{employeeId:person.id,date,status},now);
 d.setManualStatus(state,{employeeId:person.id,date:'2026-09-24',status:'submitted'},now);
 const before=d.clone(state),result=receive(state,person,12);
 assert.deepEqual(result.dates,['2026-10-05','2026-09-23','2026-09-22','2026-09-21','2026-09-18','2026-09-17','2026-09-16','2026-09-15','2026-09-14','2026-09-09','2026-09-08','2026-09-07']);
 assert.deepEqual(state.presenceRecords,before.presenceRecords);assert.deepEqual(state.employees,before.employees);
 for(const key of Object.keys(before.records))assert.deepEqual(state.records[key],before.records[key]);
});
test('working weekends count, explicit presence overrides a legacy absence, surplus never goes forward or extends employment',()=>{
 const {state,person}=fixture('2026-10-02');
 presence.write(state,{employeeId:person.id,date:'2026-10-03',status:'onsite'},now);
 state.records[person.id+'|2026-10-03']={employeeId:person.id,date:'2026-10-03',status:'sick'};
 const original=d.clone(person),result=receive(state,person,5);
 assert.deepEqual(result.dates,['2026-10-05','2026-10-03','2026-10-02']);assert.equal(result.unallocatedCount,2);
 assert.deepEqual(person,original);assert.equal(state.records[person.id+'|2026-10-06'],undefined);
 assert.equal(work.intakeSummary(state,person.id,today).objectCount,5);
 assert.equal(work.intakeSummary(state,person.id,'2026-10-06').objectCount,0);
 assert.equal(d.normalizeState(d.clone(state),now).workIntakes[0].unallocatedCount,2);
});
test('ZKP is accepted only after returning onsite on a later day and today absences reject atomically',()=>{
 const {state,person}=fixture();
 for(const date of ['2026-10-01','2026-10-02'])presence.write(state,{employeeId:person.id,date,status:'zkp'},now);
 const first=receive(state,person,2);assert.deepEqual(first.dates,[today,'2026-09-30']);
 assert.equal(work.statusForDay(state,person.id,'2026-10-02',today),'zkp');
 presence.write(state,{employeeId:person.id,date:today,status:'onsite'},now);
 const second=receive(state,person,2);assert.deepEqual(second.dates,['2026-10-02','2026-10-01']);
 assert.equal(work.statusForDay(state,person.id,'2026-10-02',today),'submitted_late');
 assert.match(state.records[person.id+'|2026-10-02'].note,/Отримано роботу/);
 for(const status of [...presence.noSubmission,'zkp']){
  presence.write(state,{employeeId:person.id,date:today,status},now);const before=d.clone(state);
  assert.throws(()=>receive(state,person));assert.deepEqual(state,before);
 }
});
test('automatic closing and old receipt-backed confirmations do not change object quantities or overwrite dates',()=>{
 const {state,person}=fixture();state.settings.automaticClose=true;d.ensureAutomaticMisses(state,now);
 const old=d.recordSubmission(state,{employeeId:person.id,requestCount:2},now),protectedRecords=d.clone(state.records);
 assert.equal(work.intakeSummary(state,person.id,today).objectCount,0);
 const result=receive(state,person,2);assert.deepEqual(result.dates,['2026-10-01','2026-09-30']);
 for(const allocation of old.allocations)assert.deepEqual(state.records[person.id+'|'+allocation.date],protectedRecords[person.id+'|'+allocation.date]);
 assert.equal(work.intakeSummary(state,person.id,today).objectCount,2);
});
test('intake survives reload, legacy copies start empty, and malformed or duplicate records cannot be imported',()=>{
 const {state,person}=fixture(),entry=receive(state,person,3);
 assert.deepEqual(d.normalizeState(d.clone(state),now).workIntakes,state.workIntakes);
 const legacy=d.clone(state);delete legacy.workIntakes;assert.deepEqual(d.normalizeState(legacy,now).workIntakes,[]);
 for(const patch of [{id:''},{employeeId:'unknown'},{objectCount:0},{objectCount:1.5},{objectCount:1001},{dates:['2026-10-06']},{dates:[today,today]},{receivedDate:'2026-02-30'},{receivedAt:'broken'},{actor:null},{unallocatedCount:2},{dates:null}])assert.throws(()=>d.normalizeState({...d.clone(state),workIntakes:[{...entry,...patch}]},now),/об’єктів/);
 assert.throws(()=>d.normalizeState({...d.clone(state),workIntakes:[entry,entry]},now),/об’єктів/);
 assert.throws(()=>d.normalizeState({...d.clone(state),workIntakes:{}},now),/об’єктів/);
});
test('retry IDs are idempotent; invalid dates, count and employee leave all data unchanged',()=>{
 const {state,person}=fixture(),entry=receive(state,person),before=d.clone(state);
 assert.deepEqual(work.receiveObjects(state,{id:entry.id,employeeId:person.id,date:today,objectCount:1},now),entry);assert.deepEqual(state,before);
 for(const patch of [{date:'2026-10-04'},{objectCount:'1'},{objectCount:0},{objectCount:1001},{id:entry.id,objectCount:2},{employeeId:'unknown'}]){assert.throws(()=>receive(state,person,1,now,patch));assert.deepEqual(state,before);}
});
test('quantity belongs to the receipt day, closed days to their dates; statistics, CSV and deletion retain that distinction',()=>{
 const {state,person}=fixture();receive(state,person,3);
 const current=work.report(state,{startDate:today,endDate:today,compare:true},now);
 assert.equal(current.total.objectsReceived,3);assert.equal(current.total.confirmedDays,1);assert.equal(current.trend[0].objectsReceived,3);assert.equal(current.intakes.length,1);
 assert.equal(current.comparison.total.objectsReceived,0);
 const earlier=work.report(state,{startDate:'2026-10-01',endDate:'2026-10-02'},now);assert.equal(earlier.total.objectsReceived,0);assert.equal(earlier.total.confirmedDays,2);
 assert.match(work.csv(current),/Отримано об’єктів/);
 d.archiveEmployee(state,person.id,new Date(2026,9,6,9));const report=deletion.preview(state,person.id);assert.equal(report.objects,3);
 deletion.apply(state,{employeeId:person.id,expectedToken:report.token},new Date(2026,9,6,9));assert.deepEqual(state.workIntakes,[]);assert.doesNotThrow(()=>d.normalizeState(state));
});
