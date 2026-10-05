const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../src/shared/domain'),work=require('../src/shared/work'),journal=require('../src/shared/journal'),management=require('../src/shared/management');
const now=new Date(2026,9,9,12);
function fixture(){const state=domain.defaultState(new Date(2026,8,1));state.settings.automaticClose=false;const employee=domain.createEmployee(state,'Олена Коваль',new Date(2026,8,1));return {state,employee};}
function input(employee,extra={}){return {employeeId:employee.id,title:'Робота над проєктами',projectCount:5,startDate:'2026-09-28',estimatedEndDate:'2026-10-02',note:'Складні проєкти',...extra};}
test('five projects may span seven working days and continue beyond the estimate without automatic misses',()=>{
 const {state,employee}=fixture(),entry=work.create(state,input(employee),now);state.settings.automaticClose=true;
 domain.setManualStatus(state,{employeeId:employee.id,date:'2026-09-30',status:'sick'},now);
 domain.ensureAutomaticMisses(state,now);
 const report=work.report(state,{startDate:'2026-09-28',endDate:'2026-10-12'},new Date(2026,9,7,12));
 assert.equal(report.total.workedDays,7);assert.equal(report.total.workingDays,7);assert.equal(report.total.absent,1);assert.equal(report.total.missed,0);
 assert.equal(report.total.projectsCompleted,0);assert.equal(report.rows[0].openProjects,5);assert.equal(report.rows[0].dueForReview,1);
 assert.equal(work.statusForDay(state,employee.id,'2026-10-08','2026-10-07'),'planned_work');
 assert.equal(work.statusForDay(state,employee.id,'2026-10-03'),'weekend');
 assert.equal(work.estimatedEnd(state,employee.id,'2026-09-28',5),'2026-10-05');
 assert.equal(state.records[employee.id+'|2026-10-06'],undefined);assert.equal(entry.status,'active');
});
test('overlapping work counts a day once and explicit absence/manual facts have priority',()=>{
 const {state,employee}=fixture();work.create(state,input(employee),now);work.create(state,input(employee,{title:'Паралельна робота',projectCount:2}),now);
 domain.setManualStatus(state,{employeeId:employee.id,date:'2026-09-29',status:'vacation'},now);
 domain.setManualStatus(state,{employeeId:employee.id,date:'2026-09-30',status:'other_tasks'},now);
 const report=work.report(state,{startDate:'2026-09-28',endDate:'2026-10-02'},now);
 assert.equal(report.total.calendarWorkdays,5);assert.equal(report.total.workedDays,4);assert.equal(report.total.workingDays,3);assert.equal(report.total.coveragePercent,100);assert.equal(report.total.projectsStarted,7);
 const attendance=journal.report(state,{startDate:'2026-09-28',endDate:'2026-10-02'},'2026-10-09');assert.equal(attendance.totals.worked,0);assert.equal(attendance.totals.notSubmitted,4);assert.equal(attendance.totals.working,3);
});
test('progress is cumulative, does not finish work, and correction and extension preserve reasons',()=>{
 const {state,employee}=fixture(),entry=work.create(state,input(employee),now);
 work.progress(state,entry.id,{completedProjects:5,expectedRevision:entry.revision},now);assert.equal(entry.status,'active');
 const before=domain.clone(state);
 assert.throws(()=>work.progress(state,entry.id,{completedProjects:2,expectedRevision:entry.revision},now),/Поясніть/);assert.deepEqual(state,before);
 assert.throws(()=>work.update(state,entry.id,{...entry,estimatedEndDate:'2026-10-07',expectedRevision:entry.revision},now),/Поясніть/);
 work.progress(state,entry.id,{completedProjects:2,reason:'Виправлення результату перевірки',expectedRevision:entry.revision},now);
 work.update(state,entry.id,{...entry,estimatedEndDate:'2026-10-12',reason:'Проєкти складніші',expectedRevision:entry.revision},now);
 assert.equal(entry.history.at(-1).details.reason,'Проєкти складніші');assert.equal(entry.history.at(-1).details.changes.estimatedEndDate.before,'2026-10-02');
 assert.throws(()=>work.progress(state,entry.id,{completedProjects:3,expectedRevision:1},now),/вже змінено/);
 assert.deepEqual(domain.normalizeState(domain.clone(state),now).workEntries,state.workEntries);
});
test('actual completion stops future allocation, counts projects on completion date, and cancellation preserves days without claiming full volume',()=>{
 const {state,employee}=fixture(),entry=work.create(state,input(employee),now);
 work.finish(state,entry.id,{status:'done',finishedDate:'2026-10-01',expectedRevision:entry.revision},now);
 assert.equal(work.recordForDay(state,employee.id,'2026-10-02'),null);assert.equal(entry.completedProjects,5);
 const report=work.report(state,{startDate:'2026-09-28',endDate:'2026-10-12',compare:true},now);
 assert.equal(report.total.confirmedDays,4);assert.equal(report.total.projectsCompleted,5);assert.equal(report.total.pending,6);
 assert.equal(report.trend.reduce((sum,row)=>sum+row.projectsCompleted,0),5);
 const earlier=work.report(state,{startDate:'2026-09-28',endDate:'2026-09-30'},now);assert.equal(earlier.total.projectsCompleted,0);
 const future=work.report(state,{startDate:'2026-10-12',endDate:'2026-10-20'},now);assert.equal(future.total.workedDays,0);assert.equal(future.total.projectsCompleted,0);
 const second=work.create(state,input(employee,{startDate:'2026-10-02',estimatedEndDate:'2026-10-09'}),now);
 assert.throws(()=>work.finish(state,second.id,{status:'cancelled',expectedRevision:second.revision},now),/Поясніть/);
 work.progress(state,second.id,{completedProjects:2,expectedRevision:second.revision},now);
 work.finish(state,second.id,{status:'cancelled',finishedDate:'2026-10-06',reason:'Змінили пріоритет',expectedRevision:second.revision},now);
 assert.equal(second.completedProjects,2);assert.equal(work.recordForDay(state,employee.id,'2026-10-07'),null);
 assert.equal(work.report(state,{startDate:'2026-10-02',endDate:'2026-10-09'},now).total.projectsCompleted,0);
});
test('weekly summary, future planning and CSV use the same work facts',()=>{
 const {state,employee}=fixture();work.create(state,input(employee),now);
 const report=management.weeklySummary(state,'2026-10-02',now);assert.equal(report.analytics.workedDays,5);assert.equal(report.people[0].workingDays,5);
 assert.ok(management.buildWeeklyCsv(report).includes('Дні роботи'));assert.ok(!management.buildWeeklyHtml(report).includes('undefined'));
 const csv=work.csv(work.report(state,{startDate:'2026-09-28',endDate:'2026-10-02'},now),'days');assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('У роботі'));
 state.employees[0].name='=SUM(1)';assert.ok(work.csv(work.report(state,{startDate:'2026-09-28',endDate:'2026-10-02'},now)).includes("'="));
});
test('malformed work backups fail instead of losing history, and legacy receipts are retained',()=>{
 const {state,employee}=fixture(),entry=work.create(state,input(employee),now);
 for(const patch of [{completedProjects:6},{status:'done'},{finishedDate:'bad'},{projectCount:0},{history:[{}]},{history:[{...entry.history[0],type:'updated',details:{changes:{title:null}}}]},{history:null},{createdAt:null},{employeeId:'unknown'}])assert.throws(()=>domain.normalizeState({...domain.clone(state),workEntries:[{...entry,...patch}]},now));
 assert.throws(()=>domain.normalizeState({...domain.clone(state),workEntries:[entry,entry]},now));
 const old=domain.clone(state);delete old.workEntries;domain.recordSubmission(old,{employeeId:employee.id,requestCount:1},now);
 const migrated=domain.normalizeState(old,now);assert.deepEqual(migrated.workEntries,[]);assert.deepEqual(migrated.receipts,old.receipts);assert.deepEqual(migrated.records,old.records);
});
test('invalid dates, future completion and invalid revision leave work unchanged',()=>{
 const {state,employee}=fixture();
 for(const patch of [{projectCount:0},{projectCount:1.5},{startDate:'2026-02-30'},{estimatedEndDate:'2026-09-01'}])assert.throws(()=>work.create(state,input(employee,patch),now));
 const entry=work.create(state,input(employee),now),before=domain.clone(state);
 assert.throws(()=>work.finish(state,entry.id,{status:'done',finishedDate:'2026-10-10',expectedRevision:entry.revision},now));
 assert.throws(()=>work.progress(state,entry.id,{completedProjects:3},now));assert.deepEqual(state,before);
});

test('historical work can be entered before the first app record, but archived gaps are excluded',()=>{
 const state=domain.defaultState(new Date(2026,9,9)),employee=domain.createEmployee(state,'Ірина',new Date(2026,9,9));state.settings.automaticClose=false;
 const entry=work.create(state,input(employee),now);assert.equal(work.statusForDay(state,employee.id,'2026-09-28','2026-10-09'),'working');
 assert.equal(work.report(state,{startDate:'2026-09-28',endDate:'2026-10-02'},now).total.workedDays,5);
 domain.archiveEmployee(state,employee.id,new Date(2026,9,12));domain.restoreEmployee(state,employee.id,new Date(2026,9,16));
 assert.equal(work.statusForDay(state,employee.id,'2026-10-13','2026-10-16'),'outside');
 assert.throws(()=>work.create(state,input(employee,{startDate:'2026-10-13',estimatedEndDate:'2026-10-19'}),new Date(2026,9,16)),/періоду роботи/);
 assert.equal(work.statusForDay(state,employee.id,'2026-10-16','2026-10-16'),'working');assert.equal(entry.status,'active');
});

test('future planned absence and legacy advance credit remain visible without being counted as facts',()=>{
 const {state,employee}=fixture();domain.setManualStatus(state,{employeeId:employee.id,date:'2026-10-12',status:'vacation'},now);
 state.records[employee.id+'|2026-10-13']={employeeId:employee.id,date:'2026-10-13',status:'submitted_advance',source:'legacy'};
 const report=journal.report(state,{startDate:'2026-10-12',endDate:'2026-10-13'},'2026-10-09');
 assert.equal(report.rows[0].cells[0].status,'vacation');assert.equal(report.rows[0].cells[1].status,'submitted_advance');assert.equal(report.totals.worked,0);assert.equal(report.totals.submitted,0);assert.equal(report.totals.absent,0);
 assert.throws(()=>domain.setManualStatus(state,{employeeId:employee.id,date:'2026-10-12',status:'working'},now),/майбутній/);
});

test('batch previews show effective work status, restore it after clearing, and reject changed work history',()=>{
 const {state,employee}=fixture(),entry=work.create(state,input(employee),now);state.settings.automaticClose=true;
 const day='2026-10-02';domain.setManualStatus(state,{employeeId:employee.id,date:day,status:'submitted'},now);
 const clear={cells:[{employeeId:employee.id,date:day}],action:'clear'};
 const plan=domain.previewJournalBatch(state,clear,now);assert.equal(plan.changes[0].from,'submitted');assert.equal(plan.changes[0].to,'working');
 domain.applyJournalBatch(state,{...clear,expectedToken:plan.token},now);assert.equal(work.statusForDay(state,employee.id,day),'working');
 const change={cells:[{employeeId:employee.id,date:day}],action:'status',status:'other_tasks'},preview=domain.previewJournalBatch(state,change,now);assert.equal(preview.changes[0].from,'working');
 work.progress(state,entry.id,{completedProjects:2,expectedRevision:entry.revision},now);
 const before=domain.clone(state);assert.throws(()=>domain.applyJournalBatch(state,{...change,expectedToken:preview.token},now),/змінилися/);assert.deepEqual(state,before);
});
