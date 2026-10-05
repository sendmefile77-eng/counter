const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const domain = require('../src/shared/domain');
const tasks = require('../src/shared/tasks');
const planner = require('../src/shared/planner');
const management = require('../src/shared/management');
const { DataStore } = require('../src/main/store');
const { createReminderService } = require('../src/main/task-reminders');
const now = new Date(2026, 9, 2, 13, 0);
function fixture() {
  const state = domain.defaultState(now);
  state.settings.automaticClose = false;
  const people = ['Олена Коваль', 'Андрій Бондар'].map(name => domain.createEmployee(state, name, new Date(2026, 8, 1)));
  return { state, people };
}
function input(extra = {}) { return { title: 'Підготувати звіт', dueDate: '2026-10-02', dueTime: '14:00', priority: 'normal', assigneeIds: [], recurrence: 'none', reminderMinutes: 60, ...extra }; }

test('legacy databases gain an empty task collection without altering facts or existing settings', () => {
  const { state } = fixture(); delete state.tasks;
  const normalized = domain.normalizeState(domain.clone(state), now);
  assert.deepEqual(normalized.tasks, []); assert.deepEqual(normalized.records, state.records);
  assert.deepEqual(normalized.employees, state.employees); assert.equal(normalized.settings.taskRemindersEnabled, true);
  assert.equal(normalized.schemaVersion, domain.SCHEMA_VERSION);
});
test('task history records actor, reasons, changed values and survives reload and backup', () => {
  const { state, people } = fixture(); state.settings.operatorName = 'Начальник';
  const task = tasks.createTask(state, input({ assigneeIds: people.map(person => person.id) }), now);
  tasks.updateTask(state, task.id, { ...task, dueDate: '2026-10-05', reason: 'Очікуємо документ', expectedRevision: task.revision }, now);
  assert.equal(task.history.at(-1).actor, 'Начальник');
  assert.equal(task.history.at(-1).details.reason, 'Очікуємо документ');
  assert.equal(task.history.at(-1).details.changes.dueDate.before, '2026-10-02');
  const normalized = domain.normalizeState(domain.clone(state), now); assert.deepEqual(normalized.tasks, state.tasks);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-tasks-'));
  try { const store = new DataStore(dir); store.load(); store.replace(state); store.save();
    const loaded = new DataStore(dir); loaded.load(); assert.deepEqual(loaded.state.tasks, state.tasks);
    assert.equal(loaded.listBackups()[0].tasks, 1); loaded.reset(now); assert.deepEqual(loaded.state.tasks, []);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
test('invalid tasks and deadline moves without a reason do not change stored data', () => {
  const { state } = fixture(), task = tasks.createTask(state, input(), now), before = domain.clone(state);
  for (const change of [{dueDate:'2026-02-30',reason:'Перенесення'},{dueDate:'2026-10-03'}, {dueTime:'25:00'}, {dueTime:'12:001'}, {assigneeIds:['unknown']}, {priority:'crazy'}, {reminderMinutes:-1}, {dutyDate:'2026-10-02'}, {receiptIds:['missing']}]) {
    assert.throws(() => tasks.updateTask(state,task.id,{...task,...change},now)); assert.deepEqual(state,before);
  }
  assert.throws(() => domain.normalizeState({...state,tasks:{wrong:true}},now));
  assert.throws(() => domain.normalizeState({...state,tasks:[task,task]},now));
});
test('stale task editor revisions are rejected without overwriting newer changes', () => {
  const { state } = fixture(), task = tasks.createTask(state, input(), now), old = domain.clone(task);
  tasks.updateTask(state,task.id,{...task,title:'Новий звіт'},now);
  assert.throws(() => tasks.updateTask(state,task.id,{...old,title:'Старий редактор',expectedRevision:old.revision},now),/вже змінено/);
  assert.equal(task.title,'Новий звіт');
});
test('status changes require a reason for blocking and cancellation and preserve completion time', () => {
  const { state } = fixture(), task = tasks.createTask(state, input(), now);
  assert.throws(() => tasks.setTaskStatus(state,task.id,{status:'blocked'},now),/пояснення|причину/);
  tasks.setTaskStatus(state,task.id,{status:'blocked',reason:'Погодити перелік'},now);
  assert.equal(task.history.at(-1).details.reason,'Погодити перелік');
  tasks.setTaskStatus(state,task.id,{status:'done'},now); assert.equal(task.completedAt,now.toISOString());
  tasks.setTaskStatus(state,task.id,{status:'open'},now); assert.equal(task.completedAt,null);
  assert.throws(() => tasks.archiveTask(state,task.id,true,now));
  tasks.setTaskStatus(state,task.id,{status:'cancelled',reason:'Скасовано доручення'},now);
  tasks.archiveTask(state,task.id,true,now); assert.equal(planner.selectTasks(state).length,0);
  assert.equal(planner.selectTasks(state,{includeArchived:true}).length,1);
  assert.throws(() => tasks.setTaskStatus(state,task.id,{status:'open'},now),/архіву/);
  tasks.archiveTask(state,task.id,false,now); assert.equal(task.archived,false);
});
test('daily and weekly repeats retain scheduled cadence and never create duplicate successors', () => {
  for (const [recurrence,date] of [['daily','2026-10-03'],['weekly','2026-10-09']]) {
    const { state } = fixture(), task = tasks.createTask(state,input({recurrence}),now);
    const result = tasks.setTaskStatus(state,task.id,{status:'done'},new Date(2026,9,20));
    assert.equal(result.nextTask.dueDate,date); assert.equal(result.nextTask.previousTaskId,task.id);
    assert.equal(state.tasks.length,2);
    tasks.setTaskStatus(state,task.id,{status:'done'},now); assert.equal(state.tasks.length,2);
    tasks.setTaskStatus(state,task.id,{status:'open'},now); tasks.setTaskStatus(state,task.id,{status:'done'},now);
    assert.equal(state.tasks.length,2);
  }
});
test('monthly recurrence preserves the original day through short months and leap years', () => {
  const { state } = fixture(), task = tasks.createTask(state,input({dueDate:'2028-01-31',recurrence:'monthly'}),now);
  const feb = tasks.setTaskStatus(state,task.id,{status:'done'},now).nextTask;
  assert.equal(feb.dueDate,'2028-02-29'); assert.equal(feb.recurrenceDay,31);
  const reloaded = domain.normalizeState(domain.clone(state),now);
  const mar = tasks.setTaskStatus(reloaded,feb.id,{status:'done'},now).nextTask;
  assert.equal(mar.dueDate,'2028-03-31');
});
test('archiving an employee retains tasks and flags future repeats for reassignment', () => {
  const { state, people } = fixture(), task = tasks.createTask(state,input({assigneeIds:[people[0].id],recurrence:'weekly'}),now);
  domain.archiveEmployee(state,people[0].id,now); assert.deepEqual(task.assigneeIds,[people[0].id]);
  assert.equal(planner.attention(state,now).tasks.length,1);
  const next = tasks.setTaskStatus(state,task.id,{status:'done'},now).nextTask;
  assert.equal(next.status,'blocked'); assert.deepEqual(next.assigneeIds,[people[0].id]);
  assert.throws(() => tasks.createTask(state,input({assigneeIds:[people[0].id]}),now),/активним/);
});
test('linked receipts and schedules remain separate from attendance and duty assignments', () => {
  const { state,people } = fixture(); const receipt = domain.recordSubmission(state,{employeeId:people[0].id,requestCount:1},now);
  const before = domain.clone({records:state.records,receipts:state.receipts,duties:state.duties});
  const task = tasks.createTask(state,input({receiptIds:[receipt.id],documentRef:'Довідка',dutyScheduleId:'primary',dutyDate:'2026-10-02'}),now);
  tasks.setTaskStatus(state,task.id,{status:'done'},now);
  assert.deepEqual({records:state.records,receipts:state.receipts,duties:state.duties},before);
});
test('local-day deadlines and urgency respect exact times and all-day tasks', () => {
  const task = input({status:'open',archived:false});
  assert.equal(planner.urgency(task,new Date(2026,9,2,13,59)).key,'today');
  assert.equal(planner.urgency(task,new Date(2026,9,2,14,1)).key,'overdue');
  task.dueTime=''; assert.equal(planner.urgency(task,new Date(2026,9,2,18)).key,'today');
  assert.equal(planner.urgency(task,new Date(2026,9,3,0)).key,'overdue');
  task.status='done'; assert.equal(planner.urgency(task,now).key,'done');
});
test('calendar covers complete Monday-first weeks and filtering separates personal/shared/archived tasks', () => {
  const month = planner.calendarDays('2026-10-02','month'); assert.equal(month.days[0],'2026-09-28'); assert.equal(month.days.at(-1),'2026-11-01');
  const { state,people } = fixture(); tasks.createTask(state,input(),now);
  tasks.createTask(state,input({title:'Перевірити =дані',assigneeIds:[people[0].id,people[1].id]}),now);
  assert.equal(planner.selectTasks(state,{employeeId:'self'},now).length,1);
  assert.equal(planner.selectTasks(state,{employeeId:people[0].id,query:'ДАНІ'},now).length,1);
  assert.equal(planner.selectTasks(state,{status:'done'},now).length,0);
});
test('reminders are deduplicated across reload, with a separate overdue phase and no reminders for closed tasks', () => {
  const { state } = fixture(), task = tasks.createTask(state,input(),now);
  const first = planner.notificationCandidate(task,now); assert.equal(first.kind,'reminder'); task.notificationKeys.push(first.key);
  assert.equal(planner.notificationCandidate(task,now),null);
  const reload = domain.normalizeState(domain.clone(state),now).tasks[0]; assert.equal(planner.notificationCandidate(reload,now),null);
  assert.equal(planner.notificationCandidate(reload,new Date(2026,9,2,14,1)).kind,'overdue');
  reload.status='done'; assert.equal(planner.notificationCandidate(reload,new Date(2026,9,2,14,1)),null);
});
test('snooze suppresses reminders while preserving deadline and survives restart', () => {
  const { state } = fixture(), task = tasks.createTask(state,input(),now);
  tasks.snoozeTask(state,task.id,60,now); assert.equal(task.dueDate,'2026-10-02'); assert.equal(task.dueTime,'14:00');
  assert.equal(planner.notificationCandidate(task,now),null);
  const reload = domain.normalizeState(domain.clone(state),now).tasks[0];
  assert.equal(planner.notificationCandidate(reload,new Date(2026,9,2,14)).key,`snooze:${task.snoozedUntil}`);
  assert.throws(() => tasks.snoozeTask(state,task.id,0,now));
});
function serviceFixture() {
  const { state } = fixture(); let clock = now, saveCount=0, broadcasts=0, opened=[];
  class Notice extends EventEmitter { static notices=[]; static isSupported(){return true} constructor(options){super();this.options=options;Notice.notices.push(this)} show(){this.shown=true} close(){this.closed=true} }
  const store = {state,save:()=>{saveCount++}};
  const service = createReminderService({Notification:Notice,store,broadcast:()=>{broadcasts++},openTask:id=>opened.push(id),now:()=>clock,
    act:(id,action)=>action==='done'?tasks.setTaskStatus(state,id,{status:'done'},clock):tasks.snoozeTask(state,id,60,clock)});
  return {state,store,service,Notice,setClock:value=>{clock=value},opened};
}
test('native reminder actions complete or snooze a current task and stale notifications only open the task', () => {
  const f = serviceFixture(), task = tasks.createTask(f.state,input(),now); f.service.check(); f.service.check();
  assert.equal(f.Notice.notices.length,1); const notice = f.Notice.notices[0];
  notice.emit('action',{actionIndex:1}); assert.equal(task.snoozedUntil,new Date(2026,9,2,14).toISOString());
  tasks.updateTask(f.state,task.id,{...task,dueDate:'2026-10-03',reason:'Очікування'},now);
  notice.emit('action',{actionIndex:0}); assert.equal(task.status,'open'); assert.deepEqual(f.opened,[task.id]);
  f.service.reconcile(); assert.equal(notice.closed,true);
  f.setClock(new Date(2026,9,3,13)); f.service.check(); f.Notice.notices.at(-1).emit('action',{actionIndex:0}); assert.equal(task.status,'done');
});
test('reminder service catches up after restart and emits one reminder after an expired snooze', () => {
  const f = serviceFixture(), task = tasks.createTask(f.state,input(),now);
  tasks.snoozeTask(f.state,task.id,15,now); f.setClock(new Date(2026,9,2,13,16)); f.service.check(); f.service.check();
  assert.equal(f.Notice.notices.length,1); assert.equal(task.snoozedUntil,null);
  f.setClock(new Date(2026,9,2,14,1)); f.service.check(); assert.equal(f.Notice.notices.length,2);
  f.service.check(); assert.equal(f.Notice.notices.length,2);
});
test('notification persistence failures do not consume reminders or snoozes and disabled reminders do not send', () => {
  const f = serviceFixture(), task = tasks.createTask(f.state,input(),now);
  tasks.snoozeTask(f.state,task.id,15,now); const until=task.snoozedUntil;
  f.setClock(new Date(2026,9,2,13,16)); f.store.save=()=>{throw Error('disk')}; f.service.check();
  assert.equal(f.Notice.notices.length,0); assert.equal(task.snoozedUntil,until); assert.deepEqual(task.notificationKeys,[]);
  f.store.save=()=>{}; f.state.settings.taskRemindersEnabled=false; f.service.check(); assert.equal(f.Notice.notices.length,0);
});
test('weekly totals count shared tasks once, employee rows show responsibility, and future attendance is excluded', () => {
  const { state,people } = fixture(); domain.recordSubmission(state,{employeeId:people[0].id,requestCount:1},now);
  const task=tasks.createTask(state,input({assigneeIds:people.map(p=>p.id)}),now); tasks.setTaskStatus(state,task.id,{status:'done'},now);
  tasks.createTask(state,input({dueDate:'2026-10-01',assigneeIds:[people[1].id]}),now);
  tasks.createTask(state,input({dueDate:'2026-10-06',title:'Наступний тиждень'}),now);
  const report=management.weeklySummary(state,'2026-10-02',now);
  assert.equal(report.startDate,'2026-09-28'); assert.equal(report.endDate,'2026-10-04'); assert.equal(report.actualThrough,'2026-10-02');
  assert.equal(report.completedTasks.length,1); assert.equal(report.people[0].tasksCompleted,1); assert.equal(report.people[1].tasksCompleted,1);
  assert.equal(report.overdueTasks.length,1); assert.equal(report.upcomingTasks.length,1); assert.equal(report.analytics.confirmedDays,1);
  const future=management.weeklySummary(state,'2026-10-12',now); assert.equal(future.actualThrough,null); assert.equal(future.analytics.calendarWorkdays,0);
});
test('employee profile combines all schedules, work days, absences and tasks without counting baseline as dates', () => {
  const { state,people } = fixture(); domain.initializeDutyHistory(state,people.map(p=>({employeeId:p.id,total:5,realized:2})),null,new Date(2026,8,1));
  domain.setDutyAssignment(state,{date:'2026-10-01',employeeIds:[people[0].id],singleApproved:true,note:'Ручне призначення'},now);
  const alternate=domain.createDutySchedule(state,'Резервний',now); domain.initializeDutyHistory(state,people.map(p=>({employeeId:p.id,total:0,realized:0})),null,new Date(2026,8,1));
  domain.setDutyAssignment(state,{date:'2026-10-02',employeeIds:[people[0].id],singleApproved:true,note:'Резервний'},now);
  tasks.createTask(state,input({assigneeIds:[people[0].id],dueDate:'2026-12-01'}),now);
  const before=domain.clone(state), profile=management.employeeOverview(state,{employeeId:people[0].id,startDate:'2026-10-01',endDate:'2026-10-31'},now);
  assert.equal(profile.duties.length,2); assert.equal(profile.tasks.length,1); assert.equal(profile.workload.openTasks,1); assert.equal(profile.days.length,2);
  assert.deepEqual(state,before); assert.throws(()=>management.employeeOverview(state,{employeeId:'bad'},now));
});
test('weekly exports escape markup, preserve multiline text and neutralize CSV formulas', () => {
  const { state }=fixture(); tasks.createTask(state,input({title:'=SUM(1)',description:'<script>alert(1)</script>\nДругий рядок'}),now);
  const report=management.weeklySummary(state,'2026-10-02',new Date(2026,9,3));
  const csv=management.buildWeeklyCsv(report), html=management.buildWeeklyHtml(report);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"\'=SUM(1)"'));
  assert.ok(!html.includes('<script>alert')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('default-src \'none\''));
});

test('corrupt task history fails import rather than crashing a dialog or silently losing facts', () => {
  const { state }=fixture(), task=tasks.createTask(state,input(),now);
  task.history.push({at:'bad',type:'updated',details:{}});
  assert.throws(()=>domain.normalizeState(domain.clone(state),now),/історії/);
});
test('deleted document/schedule links remain traceable across reload and unrelated edits', () => {
  const {state,people}=fixture();
  const receipt=domain.recordSubmission(state,{employeeId:people[0].id,requestCount:1},now);
  const task=tasks.createTask(state,input({receiptIds:[receipt.id],dutyScheduleId:'primary',dutyDate:'2026-10-02'}),now);
  state.receipts=[];state.dutySchedules[0].id='replacement';state.activeDutyScheduleId='replacement';
  const reloaded=domain.normalizeState(domain.clone(state),now), next=reloaded.tasks[0];
  tasks.updateTask(reloaded,next.id,{...next,title:'Зберегти посилання'},now);
  assert.deepEqual(next.receiptIds,[receipt.id]);assert.equal(next.dutyScheduleId,'primary');
});
test('reminder batching never loses the fourth task and all-day urgency remains valid through the last minute', () => {
  const f=serviceFixture();for(let i=0;i<4;i++)tasks.createTask(f.state,input({title:`Завдання ${i}`}),now);
  f.service.check();assert.equal(f.Notice.notices.length,3);f.service.check();assert.equal(f.Notice.notices.length,4);
  const task=input({status:'open',dueTime:''});assert.equal(planner.urgency(task,new Date(2026,9,2,23,59,30)).key,'today');
});

test('task colors and tags persist, remain searchable and follow monthly recurrence',()=>{
  const d=require('../src/shared/domain'),p=require('../src/shared/planner'),t=require('../src/shared/tasks'),now=new Date('2026-10-05T12:00:00Z'),state=d.defaultState(now);
  const task=t.createTask(state,{title:'Підготувати матеріали',dueDate:'2026-10-31',color:'purple',tags:['Перевірка','Звіт'],recurrence:'monthly'},now);
  assert.equal(p.selectTasks(state,{query:'перевірка'}).length,1);
  t.updateTask(state,task.id,{title:'Уточнити матеріали',dueDate:task.dueDate,recurrence:task.recurrence},now);assert.equal(task.color,'purple');assert.deepEqual(task.tags,['Перевірка','Звіт']);
  const {nextTask}=t.setTaskStatus(state,task.id,{status:'done'},now);assert.equal(nextTask.dueDate,'2026-11-30');assert.equal(nextTask.color,'purple');assert.deepEqual(nextTask.tags,task.tags);
  const loaded=d.normalizeState(JSON.parse(JSON.stringify(state)),now);assert.deepEqual(loaded.tasks.map(item=>[item.color,item.tags]),state.tasks.map(item=>[item.color,item.tags]));
  for(const patch of [{color:'invalid'},{tags:'Звіт'},{tags:['a'.repeat(25)]},{tags:['1','2','3','4','5','6']}]){const before=d.clone(state);assert.throws(()=>t.createTask(state,{title:'Нове завдання',dueDate:'2026-10-06',...patch},now));assert.deepEqual(state,before);}
});

test('presence calendar quarter boundaries cover leap day and year end',()=>{
  const p=require('../src/shared/planner');
  assert.deepEqual(p.range('2024-02-29','quarter'),{startDate:'2024-01-01',endDate:'2024-03-31'});
  assert.deepEqual(p.range('2026-12-31','quarter'),{startDate:'2026-10-01',endDate:'2026-12-31'});
  assert.deepEqual(p.range('2027-01-01','quarter'),{startDate:'2027-01-01',endDate:'2027-03-31'});
});
