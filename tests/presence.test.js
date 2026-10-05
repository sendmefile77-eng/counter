const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../src/shared/domain'),p=require('../src/shared/presence'),changes=require('../src/shared/presence-changes');
const work=require('../src/shared/work'),journal=require('../src/shared/journal'),staff=require('../src/shared/staff-changes');
const replacements=require('../src/shared/duty-replacements'),availability=require('../src/shared/availability'),tasks=require('../src/shared/tasks');
const draws=require('../src/shared/draws');
const now=new Date(2026,9,5,12),date='2026-10-08';
function fixture(){const state=d.defaultState(now);state.settings.automaticClose=false;const people=['Олена','Петро','Ірина','Олег'].map(name=>d.createEmployee(state,name,new Date(2026,8,28,8)));d.initializeDutyHistory(state,people.map(person=>({employeeId:person.id,total:0,realized:0})),people.map(person=>person.id),now);state.duties.rules.preventConsecutiveDays=false;state.duties.rules.preventConsecutiveWeekends=false;return {state,people};}
function apply(state,person,status,extra={},at=now){const report=changes.preview(state,{employeeIds:[person.id],startDate:date,status,reason:'Позначка керівника',...extra},at);changes.apply(state,{change:report.change,expectedToken:report.token},at);return report;}
test('presence absence overrides active work, manual facts and automatic misses without changing projects',()=>{
 for(const status of p.absent){const {state,people}=fixture(),person=people[0];const entry=work.create(state,{employeeId:person.id,title:'П’ять проєктів',projectCount:5,startDate:'2026-09-28',estimatedEndDate:'2026-10-02'},now);
 d.setManualStatus(state,{employeeId:person.id,date:'2026-10-01',status:'submitted'},now);state.records[p.key(person.id,'2026-10-02')]={employeeId:person.id,date:'2026-10-02',status:'missed',source:'automatic_close'};
 const original=d.clone(entry);apply(state,person,status,{startDate:'2026-10-01',endDate:'2026-10-02'});state.settings.automaticClose=true;d.ensureAutomaticMisses(state,now);
 assert.equal(work.statusForDay(state,person.id,'2026-10-01'),status);assert.equal(work.statusForDay(state,person.id,'2026-10-02'),status);assert.deepEqual(entry,original);
 const report=work.report(state,{startDate:'2026-10-01',endDate:'2026-10-02',employeeIds:[person.id]},now);assert.equal(report.total.absent,2);assert.equal(report.total.workedDays,0);assert.equal(report.total.missed,0);
 assert.throws(()=>d.setManualStatus(state,{employeeId:person.id,date:'2026-10-01',status:'working'},now),/Наявності/);
 assert.throws(()=>work.create(state,{employeeId:person.id,title:'Нова робота',projectCount:1,startDate:'2026-10-01',estimatedEndDate:'2026-10-09'},now),/відсутній/);
 }
});
test('onsite counts as a presence workday but ZKP awaits acceptance and remains eligible for duty',()=>{
 const {state,people}=fixture(),person=people[0];apply(state,person,'onsite',{startDate:'2026-10-01'});apply(state,person,'zkp',{startDate:'2026-10-02'});
 apply(state,person,'zkp');assert.equal(d.dutyRestriction(state,person.id,date),null);
 d.setDutyAssignment(state,{date,employeeIds:[person.id],singleApproved:true},now);assert.ok(state.duties.assignments[date].employeeIds.includes(person.id));
 const report=work.report(state,{startDate:'2026-10-01',endDate:date,employeeIds:[person.id]},now);assert.equal(report.total.workedDays,1);assert.equal(report.total.onsiteDays,1);assert.equal(report.total.zkpDays,1);assert.equal(report.total.absent,0);
 const tab=journal.report(state,{startDate:'2026-10-01',endDate:'2026-10-02',employeeIds:[person.id]},'2026-10-05');assert.equal(tab.totals.worked,0);assert.equal(tab.totals.notSubmitted,2);assert.deepEqual(tab.rows[0].cells.map(cell=>cell.symbol),['×','×']);assert.match(work.csv(report),/Дні на ЗКП/);
 apply(state,person,'zkp',{startDate:'2026-10-12'});const generated=d.generateDutySchedule(state,{startDate:'2026-10-12',endDate:'2026-10-12'},now);assert.ok(generated);
});
test('all absence statuses block generator, manual assignment, toggle and replacement candidates, including weekends',()=>{
 for(const status of p.absent){const {state,people}=fixture(),person=people[0];apply(state,person,status,{endDate:'2026-10-11'});
 assert.equal(d.dutyRestriction(state,person.id,'2026-10-10'),status);assert.throws(()=>d.setDutyAssignment(state,{date,employeeIds:[person.id],singleApproved:true},now));assert.throws(()=>d.toggleDutyAssignment(state,person.id,date,now));
 d.generateDutySchedule(state,{startDate:date,endDate:'2026-10-11'},now);assert.ok(Object.values(state.duties.assignments).every(item=>!item.employeeIds.includes(person.id)));
 const report=replacements.getReplacementOptions(state,{date,employeeId:''},now);assert.ok(report.plans.every(plan=>plan.candidateId!==person.id));
 }
});
test('one presence batch removes only planned duties across all schedules, preserves tasks and records a reason',()=>{
 const {state,people}=fixture();d.setDutyAssignment(state,{date,employeeIds:[people[0].id,people[1].id]},now);
 const primary=state.activeDutyScheduleId,second=d.createDutySchedule(state,'Другий офіс',now),view=replacements.scheduleView(state,second.id);d.initializeDutyHistory(view,people.map(person=>({employeeId:person.id,total:0,realized:0})),people.map(person=>person.id),now);d.setDutyAssignment(view,{date:'2026-10-09',employeeIds:[people[0].id],singleApproved:true},now);
 const task=tasks.createTask(state,{title:'Підготувати звіт',dueDate:date,assigneeIds:[people[0].id]},now),before=d.clone(state);
 const report=changes.preview(state,{employeeIds:[people[0].id,people[1].id],startDate:date,endDate:'2026-10-09',status:'sick',reason:'Повідомлення працівників'},now);
 assert.deepEqual(state,before);assert.equal(report.duties.length,3);assert.deepEqual(report.duties[0].after,[]);assert.equal(report.tasks.length,1);
 changes.apply(state,{change:report.change,expectedToken:report.token},now);assert.deepEqual(replacements.scheduleView(state,primary).duties.assignments[date].employeeIds,[]);assert.deepEqual(replacements.scheduleView(state,second.id).duties.assignments['2026-10-09'].employeeIds,[]);assert.deepEqual(state.tasks[0],task);
 assert.equal(replacements.scheduleView(state,primary).duties.assignments[date].replacementNeeds.length,2);assert.ok(staff.getConsequences(state,{},now).issues.some(issue=>issue.kind==='task'));assert.equal(state.audit.at(-1).details.cells.length,4);
});
test('locked, realized and past duties stop the entire change without altering any presence record',()=>{
 for(const kind of ['locked','realized','past']){const {state,people}=fixture(),day=kind==='past'?'2026-10-02':date;
 d.setDutyAssignment(state,{date:day,employeeIds:[people[0].id],singleApproved:true},now);if(kind==='locked')d.setDutyWeekLocked(state,day,true,now);if(kind==='realized')state.duties.assignments[day].realizedEmployeeIds=[people[0].id];
 const original=d.clone(state),report=changes.preview(state,{employeeIds:[people[0].id],startDate:day,status:'vacation',reason:'Відпустка'},now);assert.equal(report.canApply,false);assert.throws(()=>changes.apply(state,{change:report.change,expectedToken:report.token},now));assert.deepEqual(state,original);
 assert.throws(()=>changes.save(state,{employeeId:people[0].id,date:day,status:'vacation'},now));assert.deepEqual(state,original);
 }
});
test('stale state, changed input and a changed day invalidate the preview token',()=>{
 const {state,people}=fixture(),report=changes.preview(state,{employeeId:people[0].id,startDate:date,status:'zkp',reason:'Інший офіс'},now),original=d.clone(state);
 assert.throws(()=>changes.apply(state,{change:{...report.change,status:'onsite'},expectedToken:report.token},now),/змінилися/);assert.deepEqual(state,original);
 assert.throws(()=>changes.apply(state,{change:report.change,expectedToken:report.token},new Date(2026,9,6,12)),/змінилися/);assert.deepEqual(state,original);
 tasks.createTask(state,{title:'Нове завдання',dueDate:date},now);const changed=d.clone(state);assert.throws(()=>changes.apply(state,{change:report.change,expectedToken:report.token},now),/змінилися/);assert.deepEqual(state,changed);
});
test('old absence records are visible without rewriting them and an explicit ZKP corrects their availability',()=>{
 const {state,people}=fixture(),person=people[0];d.setManualStatus(state,{employeeId:person.id,date,status:'sick'},now);const old=d.clone(state.records);
 assert.equal(p.get(state,person.id,date).source,'legacy_presence');apply(state,person,'zkp');assert.deepEqual(state.records,old);assert.equal(work.statusForDay(state,person.id,date),'zkp');assert.equal(d.dutyRestriction(state,person.id,date),null);
 const normalized=d.normalizeState(d.clone(state),now);assert.deepEqual(normalized.presenceRecords,state.presenceRecords);assert.deepEqual(normalized.records,old);
});
test('clearing presence intentionally restores work accounting and clears a legacy absence without leaving a hidden block',()=>{
 const {state,people}=fixture(),person=people[0];d.setManualStatus(state,{employeeId:person.id,date,status:'sick'},now);apply(state,person,'zkp');
 apply(state,person,null,{action:'clear'});assert.equal(p.get(state,person.id,date),null);assert.equal(d.dutyRestriction(state,person.id,date),null);
 state.settings.automaticClose=true;d.ensureAutomaticMisses(state,new Date(2026,9,9,20));assert.equal(work.statusForDay(state,person.id,date),'missed');
 assert.ok(state.audit.some(item=>item.action==='presence_changed'&&item.details.action==='clear'));
});
test('old batch absence edits update authoritative presence but tab clearing cannot erase it',()=>{
 const {state,people}=fixture(),person=people[0];apply(state,person,'zkp');const input={cells:[{employeeId:person.id,date}],action:'status',status:'sick',note:'Повідомлення',replaceExisting:true};
 const report=availability.previewBatch(state,input,now);availability.applyBatch(state,{...input,expectedToken:report.token},now);assert.equal(p.get(state,person.id,date).status,'sick');
 const clear=d.previewJournalBatch(state,{cells:input.cells,action:'clear'},now);assert.equal(clear.canApply,false);assert.match(clear.blocked[0].reason,/Наявність/);
});
test('new match draws exclude absent workers, accept ZKP and leave existing protocols unchanged',()=>{
 const {state,people}=fixture();apply(state,people[0],'zkp',{startDate:'2026-10-05'});
 const draw=draws.createDraw(state,{title:'Підготувати приміщення',participantIds:[people[0].id,people[1].id],count:2},now),original=d.clone(draw);
 apply(state,people[1],'sick',{startDate:'2026-10-05'});assert.deepEqual(state.draws[0],original);
 const before=d.clone(state);assert.throws(()=>draws.createDraw(state,{title:'Інша робота',participantIds:[people[0].id,people[1].id],count:1},now),/Наявності/);assert.deepEqual(state,before);
 const next=draws.createDraw(state,{title:'Інша робота',participantIds:[people[0].id],count:1},now);assert.deepEqual(next.selectedIds,[people[0].id]);
});
test('presence validation rejects malformed backups and input, and records only employment dates in a period',()=>{
 const {state,people}=fixture();apply(state,people[0],'zkp');const broken=d.clone(state);broken.presenceRecords[p.key(people[0].id,date)].status='unknown';assert.throws(()=>d.normalizeState(broken,now),/Наявність/);
 assert.throws(()=>changes.preview(state,{employeeIds:'bad'},now));assert.throws(()=>changes.preview(state,{employeeId:people[0].id,startDate:'2026-02-30',status:'zkp',reason:'офіс'},now));
 assert.equal(changes.preview(state,{employeeId:people[0].id,startDate:date,status:'zkp'},now).canApply,true);
 assert.throws(()=>changes.preview(state,{employeeId:people[0].id,startDate:date,status:'zkp',reason:'а'.repeat(501)},now),/500/);
 d.archiveEmployee(state,people[0].id,now);assert.equal(work.statusForDay(state,people[0].id,date),'outside');const report=changes.preview(state,{employeeId:people[0].id,startDate:'2026-10-02',endDate:date,status:'vacation',reason:'Історична позначка'},now);assert.equal(report.count,3);assert.equal(report.skipped.length,4);
});

test('ZKP requires separate acceptance on a later office day, survives reload and clears independently of presence',()=>{
 const {state,people}=fixture(),person=people[0],days=['2026-10-01','2026-10-02'];
 const entry=work.create(state,{employeeId:person.id,title:'Робота на ЗКП',projectCount:2,startDate:days[0],estimatedEndDate:date},now);
 for(const day of days)apply(state,person,'zkp',{startDate:day});
 work.finish(state,entry.id,{status:'done',finishedDate:'2026-10-05',expectedRevision:entry.revision},now);
 let report=work.report(state,{startDate:days[0],endDate:days[1],employeeIds:[person.id]},now);
 assert.equal(report.total.workedDays,0);assert.equal(report.total.confirmedDays,0);assert.equal(report.total.zkpPendingDays,2);
 const before=d.clone(state);
 assert.throws(()=>d.setManualStatus(state,{employeeId:person.id,date:days[0],status:'submitted',note:'Отримано роботу'},new Date(2026,9,1,15)),/повернення/);assert.deepEqual(state,before);
 assert.throws(()=>d.setManualStatus(state,{employeeId:person.id,date:days[0],status:'submitted',note:'Отримано роботу'},now),/повернення/);assert.deepEqual(state,before);
 apply(state,person,'onsite',{startDate:'2026-10-05'});
 assert.throws(()=>d.setManualStatus(state,{employeeId:person.id,date:days[0],status:'submitted'},now),/пояснення/);
 const input={cells:[{employeeId:person.id,date:days[0]},{employeeId:person.id,date:'2026-10-05'}],action:'status',status:'submitted',note:'Повернувся й приніс роботу за 1 та 5 жовтня',replaceExisting:true};
 const preview=d.previewJournalBatch(state,input,now);assert.equal(preview.canApply,true);assert.equal(preview.changes.length,2);
 d.applyJournalBatch(state,{...input,expectedToken:preview.token},now);
 report=work.report(state,{startDate:days[0],endDate:'2026-10-05',employeeIds:[person.id]},now);
 assert.equal(report.total.confirmedDays,2);assert.equal(report.total.zkpDays,2);assert.equal(report.total.zkpPendingDays,1);assert.equal(report.total.workedDays,2);
 assert.equal(p.get(state,person.id,days[0]).status,'zkp');assert.equal(work.statusForDay(state,person.id,days[0]),'submitted');
 assert.equal(journal.report(state,{startDate:days[0],endDate:days[1],employeeIds:[person.id]},'2026-10-05').rows[0].cells[0].symbol,'✓');
 assert.match(work.csv(report,'days'),/ЗКП · роботу зараховано/);assert.equal(state.audit.at(-1).details.actor,'Керівник');
 const reload=d.normalizeState(d.clone(state),now);assert.deepEqual(work.report(reload,report.filter,now).total,report.total);
 d.clearManualRecord(reload,person.id,days[0],now);assert.equal(p.get(reload,person.id,days[0]).status,'zkp');assert.equal(work.statusForDay(reload,person.id,days[0]),'zkp');
 report=work.report(reload,{startDate:days[0],endDate:days[1],employeeIds:[person.id]},now);assert.equal(report.total.workedDays,0);assert.equal(report.total.zkpPendingDays,2);
});

test('both training statuses are distinct from accepted work, permit duty and draws and never become misses',()=>{
 const {state,people}=fixture(),person=people[0];
 for(const [i,status] of [...p.learning].entries()){
  const day='2026-10-0'+(i+1);apply(state,person,status,{startDate:day});
  assert.equal(d.dutyRestriction(state,person.id,day),null);assert.equal(work.statusForDay(state,person.id,day),status);
  apply(state,person,status);d.setDutyAssignment(state,{date,employeeIds:[person.id],singleApproved:true},now);
  apply(state,person,status,{startDate:'2026-10-05'});assert.ok(draws.createDraw(state,{title:'Навчання не заважає чергуванню',participantIds:[person.id],count:1},now));
 }
 state.settings.automaticClose=true;d.ensureAutomaticMisses(state,new Date(2026,9,5,20));
 const report=work.report(state,{startDate:'2026-10-01',endDate:'2026-10-02',employeeIds:[person.id]},now);
 assert.equal(report.total.trainingDays,2);assert.equal(report.total.workedDays,0);assert.equal(report.total.confirmedDays,0);assert.equal(report.total.missed,0);assert.equal(report.total.coveragePercent,null);
 const tab=journal.report(state,{startDate:'2026-10-01',endDate:'2026-10-02',employeeIds:[person.id]},'2026-10-05');assert.deepEqual(tab.rows[0].cells.map(cell=>cell.symbol),['НО','НА']);
 const reload=d.normalizeState(d.clone(state),now);assert.deepEqual(reload.presenceRecords,state.presenceRecords);assert.equal(work.report(reload,report.filter,now).total.trainingDays,2);
});

test('direct presence save needs no reason or external preview and preserves duty consequences, tasks and history',()=>{
 const {state,people}=fixture(),person=people[0];state.settings.operatorName='Начальник';
 d.setDutyAssignment(state,{date,employeeIds:[person.id,people[1].id]},now);
 const primary=state.activeDutyScheduleId,secondary=d.createDutySchedule(state,'Резервний',now),view=replacements.scheduleView(state,secondary.id);
 d.initializeDutyHistory(view,people.map(person=>({employeeId:person.id,total:0,realized:0})),people.map(person=>person.id),now);
 d.setDutyAssignment(view,{date,employeeIds:[person.id],singleApproved:true},now);
 const task=tasks.createTask(state,{title:'Звіт після повернення',dueDate:date,assigneeIds:[person.id]},now),originalTask=d.clone(task);
 const report=changes.save(state,{employeeId:person.id,date,status:'business_trip'},now);
 assert.equal(report.count,1);assert.equal(report.change.reason,'');assert.equal(p.get(state,person.id,date).status,'business_trip');assert.equal(p.get(state,person.id,date).note,'');assert.equal(p.get(state,person.id,date).actor,'Начальник');
 assert.equal(p.get(state,people[1].id,date),null);assert.deepEqual(state.tasks[0],originalTask);
 assert.deepEqual(replacements.scheduleView(state,primary).duties.assignments[date].employeeIds,[people[1].id]);
 assert.deepEqual(replacements.scheduleView(state,secondary.id).duties.assignments[date].employeeIds,[]);
 for(const id of [primary,secondary.id])assert.match(replacements.scheduleView(state,id).duties.assignments[date].replacementNeeds[0].reason,/Відрядження/);
 assert.equal(state.audit.at(-1).details.reason,'');assert.equal(state.audit.at(-1).details.actor,'Начальник');assert.deepEqual(d.normalizeState(d.clone(state),now).presenceRecords,state.presenceRecords);
 changes.save(state,{employeeId:person.id,date,action:'clear'},now);assert.equal(p.get(state,person.id,date),null);assert.equal(d.dutyRestriction(state,person.id,date),null);
 assert.deepEqual(replacements.scheduleView(state,primary).duties.assignments[date].employeeIds,[people[1].id]);assert.equal(state.audit.at(-1).details.action,'clear');
});

test('calendar weekends appear automatically, manual work replaces them and clearing restores the default without writing generated records',()=>{
 const {state,people}=fixture(),person=people[0],saturday='2026-10-03',sunday='2026-10-04',before=d.clone(state.presenceRecords);
 for(const day of [saturday,sunday]){assert.equal(p.get(state,person.id,day).status,'weekend');assert.equal(p.get(state,person.id,day).source,'calendar_presence');assert.equal(d.dutyRestriction(state,person.id,day),null);}
 assert.deepEqual(state.presenceRecords,before);assert.equal(changes.preview(state,{employeeId:person.id,date:saturday,action:'clear'},now).canApply,false);
 changes.save(state,{employeeId:person.id,date:saturday,status:'onsite'},now);assert.equal(work.isWorkday(state,person.id,saturday),true);assert.equal(journal.cell(state,person,saturday,'2026-10-05').symbol,'×');
 changes.save(state,{employeeId:person.id,date:saturday,action:'clear'},now);assert.equal(p.get(state,person.id,saturday).source,'calendar_presence');assert.equal(work.isWorkday(state,person.id,saturday),false);
 changes.save(state,{employeeId:person.id,date:saturday,status:'onsite'},now);d.setManualStatus(state,{employeeId:person.id,date:saturday,status:'submitted'},now);assert.equal(journal.cell(state,person,saturday,'2026-10-05').symbol,'✓');
 assert.equal(p.get(state,people[1].id,saturday).status,'weekend');assert.equal(d.normalizeState(d.clone(state),now).presenceRecords[p.key(person.id,saturday)].status,'onsite');
});
test('Arkan is a working day without document submission, duty eligibility or an automatic miss',()=>{
 const {state,people}=fixture(),person=people[0],day='2026-10-01';
 work.create(state,{employeeId:person.id,title:'Поточна робота',projectCount:5,startDate:day,estimatedEndDate:date},now);
 changes.save(state,{employeeId:person.id,date:day,status:'arkan'},now);state.settings.automaticClose=true;d.ensureAutomaticMisses(state,now);
 const report=work.report(state,{startDate:day,endDate:day,employeeIds:[person.id]},now);assert.equal(report.total.workedDays,1);assert.equal(report.total.arkanDays,1);assert.equal(report.total.confirmedDays,0);assert.equal(report.total.absent,0);assert.equal(report.total.missed,0);assert.equal(report.total.pending,0);
 const tab=journal.report(state,{startDate:day,endDate:day,employeeIds:[person.id]},'2026-10-05');assert.equal(tab.rows[0].cells[0].symbol,'АРК');assert.equal(tab.totals.notSubmitted,0);
 assert.equal(d.dutyRestriction(state,person.id,day),'arkan');assert.throws(()=>d.setDutyAssignment(state,{date:day,employeeIds:[person.id],singleApproved:true},now));
 const original=d.clone(state);assert.throws(()=>d.setManualStatus(state,{employeeId:person.id,date:day,status:'submitted'},now),/здача документів не потрібна/);assert.deepEqual(state,original);
 changes.save(state,{employeeId:person.id,date:'2026-10-05',status:'arkan'},now);assert.ok(draws.createDraw(state,{title:'Завдання без чергування',participantIds:[person.id],count:1},now));
});
test('Arkan removes a future duty while preserving work and tasks, and locked duties still reject the change atomically',()=>{
 const {state,people}=fixture(),person=people[0];d.setDutyAssignment(state,{date,employeeIds:[person.id,people[1].id]},now);
 const task=tasks.createTask(state,{title:'Робота на Аркані',dueDate:date,assigneeIds:[person.id]},now),originalTask=d.clone(task);
 d.setDutyWeekLocked(state,date,true,now);const before=d.clone(state);assert.throws(()=>changes.save(state,{employeeId:person.id,date,status:'arkan'},now),/заблоковано/);assert.deepEqual(state,before);
 d.setDutyWeekLocked(state,date,false,now);changes.save(state,{employeeId:person.id,date,status:'arkan'},now);assert.deepEqual(state.duties.assignments[date].employeeIds,[people[1].id]);assert.deepEqual(state.tasks[0],originalTask);
 assert.ok(!staff.getConsequences(state,{},now).issues.some(issue=>issue.kind==='task'&&issue.taskId===task.id));
});
test('a manually selected weekday weekend needs no work submission but still permits weekend duty',()=>{
 const {state,people}=fixture(),person=people[0],day='2026-10-01';changes.save(state,{employeeId:person.id,date:day,status:'weekend'},now);
 assert.equal(work.isWorkday(state,person.id,day),false);assert.equal(journal.cell(state,person,day,'2026-10-05').symbol,'ВХ');
 assert.equal(work.report(state,{startDate:day,endDate:day,employeeIds:[person.id]},now).total.calendarWorkdays,0);
 assert.equal(d.dutyRestriction(state,person.id,day),null);d.setDutyAssignment(state,{date:day,employeeIds:[person.id],singleApproved:true},now);
});
test('calendar defaults respect configured working weekends and a manual weekend stays authoritative over an old workday override',()=>{
 const {state,people}=fixture(),person=people[0],saturday='2026-10-03';
 state.settings.workdays.push(6);assert.equal(p.get(state,person.id,saturday),null);assert.equal(work.isWorkday(state,person.id,saturday),true);
 state.settings.workdays=state.settings.workdays.filter(day=>day!==6);
 d.setWorkdayOverride(state,person.id,saturday,'Робоча субота',now);assert.equal(p.get(state,person.id,saturday),null);
 changes.save(state,{employeeId:person.id,date:saturday,status:'weekend'},now);
 assert.equal(work.isWorkday(state,person.id,saturday),false);assert.equal(journal.cell(state,person,saturday,'2026-10-05').symbol,'ВХ');
 const before=d.clone(state);assert.throws(()=>d.setWorkdayOverride(state,person.id,saturday,'',now),/Наявності/);assert.deepEqual(state,before);
});
