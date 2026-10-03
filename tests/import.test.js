const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const domain = require('../src/shared/domain');
const tasks = require('../src/shared/tasks');

async function fixture(t, { secondBeforeReady = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-import-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), calls = [];
  const app = new EventEmitter();
  Object.assign(app, { whenReady: () => Promise.resolve(), getPath: () => directory,
    getAppPath: () => directory, getVersion: () => '0.13.0', isPackaged: false, quit() {} });
  class Window extends EventEmitter {
    constructor() { super(); Window.instances.push(this); this.events=[]; this.minimized=false; this.webContents = { send() {}, on() {} }; }
    loadFile() {} setAlwaysOnTop() {} isDestroyed() { return false; } center() { this.events.push('center'); }
    isMinimized() { return this.minimized; } restore() { this.minimized=false; this.events.push('restore'); }
    show() { this.events.push('show'); } focus() { this.events.push('focus'); }
    getBounds() { return { x:0, y:0, width:380, height:380 }; }
    static getAllWindows() { return []; }
  }
  Window.instances=[];
  const dialog = {
    openResult: { canceled:false, filePaths:[] }, answer: { response:0 }, saveResult:{canceled:true},
    async showSaveDialog(owner, options) { calls.push({ type:'save', owner, options }); return this.saveResult; },
    async showOpenDialog(owner, options) { calls.push({ type:'open', owner, options }); return this.openResult; },
    async showMessageBox(owner, options) { calls.push({ type:'confirm', owner, options }); return this.answer; },
  };
  const mainPath = path.resolve(__dirname, '../src/main/main.js'), localRequire = createRequire(mainPath);
  const electron = { app, BrowserWindow:Window, dialog, ipcMain:{ handle:(name,fn) => handlers.set(name,fn) },
    Menu:{ setApplicationMenu() {} }, screen:{}, Notification:{ isSupported:() => false }, shell:{} };
  const context = vm.createContext({ require:name => name === 'electron' ? electron : localRequire(name),
    __dirname:path.dirname(mainPath), process:{ ...process, platform:'win32', env:{ ...process.env,
      PORTABLE_EXECUTABLE_DIR:directory, PORTABLE_EXECUTABLE_FILE:'' } },
    console, Buffer, Date, setTimeout, clearTimeout, setInterval:() => 1, clearInterval() {} });
  vm.runInContext(fs.readFileSync(mainPath,'utf8'), context);
  if (secondBeforeReady) app.emit('second-instance');
  await new Promise(resolve => setImmediate(resolve));
  const call = (name, input) => handlers.get(name)({}, input);
  await call('settings:update', { automaticClose:false });
  await call('employee:add', { name:'Поточна команда' });
  const filePath = path.join(directory,'copy.json'), database = path.join(directory,'Counter-data','counter-data.json');
  const incoming = domain.defaultState(new Date(2026,8,1,9));
  incoming.settings.automaticClose = false;
  const person = domain.createEmployee(incoming,'Команда з резервної копії',new Date(2026,8,1,9));
  domain.recordSubmission(incoming,{ employeeId:person.id, requestCount:2, documentRef:'ДЕМО' },new Date(2026,9,2,15));
  tasks.createTask(incoming,{ title:'Завдання з копії', dueDate:'2026-10-06', assigneeIds:[person.id] },new Date(2026,9,2,15));
  fs.writeFileSync(filePath,JSON.stringify(incoming));
  dialog.openResult.filePaths = [filePath];
  return { call, dialog, calls, database, filePath, incoming, directory, app, windows:Window.instances };
}

test('import opens the picker first, confirms the selected contents, persists and supports undo', async t => {
  const f = await fixture(t), before = fs.readFileSync(f.database,'utf8');
  const result = await f.call('data:import');
  assert.equal(result.canceled,false);
  assert.deepEqual(f.calls.map(c => c.type),['open','confirm']);
  assert.ok(f.calls[0].owner === f.calls[1].owner);
  assert.equal(f.calls[0].options.buttonLabel,'Вибрати копію');
  assert.equal(f.calls[1].options.defaultId,1);
  assert.equal(f.calls[1].options.cancelId,1);
  assert.match(f.calls[1].options.detail,/Працівників: 1; документів: 1; завдань: 1; графіків: 1/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.database)),domain.normalizeState(f.incoming));
  assert.equal(fs.readFileSync(path.join(f.directory,'Counter-data','counter-data.backup.json'),'utf8'),before);
  await f.call('history:undo');
  assert.equal(fs.readFileSync(f.database,'utf8'),before);
});

test('native confirmation owns and restores the existing window, defaults to cancellation, and respects answers',async t=>{
  const f=await fixture(t), window=f.windows[0]; window.events=[]; window.minimized=true;
  f.dialog.answer={response:1}; assert.equal(await f.call('dialog:confirm','Видалити запис?'),false);
  assert.deepEqual(window.events,['restore','show','focus']);
  const dialog=f.calls.at(-1); assert.equal(dialog.owner,window); assert.equal(dialog.options.defaultId,1); assert.equal(dialog.options.cancelId,1);
  f.dialog.answer={response:0}; assert.equal(await f.call('dialog:confirm','Продовжити?'),true);
  await assert.rejects(f.call('dialog:confirm',''),/підтвердження/);
});

test('a second launch restores and focuses the existing window without creating another database or window',async t=>{
  const f=await fixture(t), window=f.windows[0], before=fs.readFileSync(f.database,'utf8');
  window.events=[]; window.minimized=true; f.app.emit('second-instance');
  assert.deepEqual(window.events,['restore','show','focus']); assert.equal(f.windows.length,1);
  assert.equal(fs.readFileSync(f.database,'utf8'),before);
  window.events=[]; f.app.emit('second-instance'); assert.deepEqual(window.events,['show','focus']);
});

test('a second launch during startup focuses the first window once it is ready',async t=>{
  const f=await fixture(t,{secondBeforeReady:true}), window=f.windows[0];
  window.emit('ready-to-show'); assert.deepEqual(window.events,['center','show','focus']); assert.equal(f.windows.length,1);
});

test('a saved draw is an undo checkpoint; undoing its linked task keeps the protocol and allows recreation',async t=>{
  const f=await fixture(t), state=JSON.parse(fs.readFileSync(f.database));
  const draw=await f.call('draws:create',{title:'Підготувати звіт',count:1,participantIds:state.employees.map(person=>person.id)});
  assert.throws(()=>f.call('history:undo'),/Немає дії/);
  const task=await f.call('draws:create-task',{id:draw.id,input:{dueDate:'2026-10-05'}});
  const again=await f.call('draws:create-task',{id:draw.id,input:{dueDate:'2026-10-06'}}); assert.equal(again.id,task.id);
  await f.call('history:undo'); const undone=JSON.parse(fs.readFileSync(f.database));
  assert.equal(undone.draws.length,1); assert.equal(undone.draws[0].taskId,null); assert.equal(undone.tasks.length,0);
  assert.throws(()=>f.call('history:undo'),/Немає дії/);
  await f.call('draws:create-task',{id:draw.id,input:{dueDate:'2026-10-05'}});
  const saved=JSON.parse(fs.readFileSync(f.database)); assert.equal(saved.tasks.length,1); assert.equal(saved.draws[0].taskId,saved.tasks[0].id);
});

test('invalid draw does not consume previous undo or change the database; valid repeat preserves both protocols',async t=>{
  const f=await fixture(t), before=fs.readFileSync(f.database), state=JSON.parse(before);
  assert.throws(()=>f.call('draws:create',{title:'Робота',count:2,participantIds:state.employees.map(person=>person.id)}));
  assert.deepEqual(fs.readFileSync(f.database),before);
  const input={title:'Робота',count:1,participantIds:state.employees.map(person=>person.id)};
  const first=await f.call('draws:create',input);
  assert.throws(()=>f.call('draws:create',{...input,previousDrawId:first.id}),/причину/);
  const second=await f.call('draws:create',{...input,previousDrawId:first.id,rerollReason:'Змінився строк'});
  const saved=JSON.parse(fs.readFileSync(f.database)); assert.equal(saved.draws.length,2); assert.deepEqual(saved.draws[0],first); assert.equal(second.previousDrawId,first.id);
});

test('draw protocols are included in JSON export, safe CSV, import validation and local backup counts',async t=>{
  const f=await fixture(t), state=JSON.parse(fs.readFileSync(f.database));
  const first=await f.call('draws:create',{title:'=Службова робота',count:1,participantIds:state.employees.map(person=>person.id)});
  const second=await f.call('draws:create',{title:'Повторна робота',count:1,participantIds:state.employees.map(person=>person.id),previousDrawId:first.id,rerollReason:'Новий строк'});
  const csv=path.join(f.directory,'export.csv'); f.dialog.saveResult={canceled:false,filePath:csv}; await f.call('data:export',{format:'csv'});
  const text=fs.readFileSync(csv,'utf8'); assert.ok(text.includes('Жеребкування №1')); assert.ok(text.includes('Короткий сірник · обрано')); assert.ok(text.includes(first.id)); assert.ok(text.includes("\"'=Службова робота\""));
  f.dialog.saveResult.filePath=f.filePath; await f.call('data:export',{format:'json'});
  assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath)).draws,[first,second]);
  assert.ok((await f.call('data:backups')).some(backup=>backup.draws===1));
  await f.call('data:import'); assert.match(f.calls.findLast(call=>call.type==='confirm').options.detail,/жеребкувань: 2/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.database)).draws,[first,second]);
});

test('replacement IPC commits an exchange atomically, preserves its saved reasons and undoes both dates',async t=>{
  const f=await fixture(t);await f.call('employee:add',{name:'Другий працівник'});
  const state=JSON.parse(fs.readFileSync(f.database)), [first,second]=state.employees, scheduleId=state.activeDutyScheduleId;
  await f.call('duties:initialize',{entries:state.employees.map(person=>({employeeId:person.id,total:0,realized:0})),participantIds:state.employees.map(person=>person.id)});
  await f.call('duties:schedule-rules',{scheduleId,rules:{weekdayDutyCount:1,weekendDutyCount:1,minimumRestMode:'require',minimumRestDays:2,maximumDutiesPerWeek:1,preventConsecutiveWeekends:false}});
  await f.call('duties:set-assignment',{date:'2026-10-06',employeeIds:[first.id]});await f.call('duties:set-assignment',{date:'2026-10-07',employeeIds:[second.id]});
  const before=fs.readFileSync(f.database,'utf8'), report=await f.call('duties:replacements',{scheduleId,date:'2026-10-06',employeeId:first.id}), plan=report.plans.find(plan=>plan.kind==='swap');assert.ok(plan);
  assert.equal(fs.readFileSync(f.database,'utf8'),before);
  await f.call('duties:apply-replacement',{query:report.query,expectedToken:report.token,proposalId:plan.id,reason:'Обмін погоджено обома працівниками',acknowledgeWarnings:true});
  const saved=JSON.parse(fs.readFileSync(f.database));assert.deepEqual(saved.duties.assignments['2026-10-06'].employeeIds,[second.id]);assert.deepEqual(saved.duties.assignments['2026-10-07'].employeeIds,[first.id]);
  assert.equal(saved.duties.assignments['2026-10-06'].explanation.replacement.reason,'Обмін погоджено обома працівниками');
  const {DataStore}=require('../src/main/store'), reloaded=new DataStore(path.dirname(f.database));reloaded.load();assert.deepEqual(reloaded.state.duties.assignments,saved.duties.assignments);
  await f.call('history:undo');assert.equal(fs.readFileSync(f.database,'utf8'),before);
});

test('staff change IPC preserves task deadlines, publishes vacancies in snapshots, and supports complete undo',async t=>{
  const f=await fixture(t), state=JSON.parse(fs.readFileSync(f.database)), person=state.employees[0];
  await f.call('duties:initialize',{entries:[{employeeId:person.id,total:0,realized:0}],participantIds:[person.id]});
  await f.call('duties:set-assignment',{date:'2026-10-06',employeeIds:[person.id],singleApproved:true});
  const task=await f.call('tasks:create',{title:'Скласти звіт',dueDate:'2026-10-06',assigneeIds:[person.id]});
  const before=fs.readFileSync(f.database,'utf8'), report=await f.call('staff:preview-change',{employeeId:person.id,startDate:'2026-10-06',endDate:'2026-10-07',status:'sick',reason:'Повідомив про лікарняний'});
  assert.equal(fs.readFileSync(f.database,'utf8'),before);assert.equal(report.tasks[0].id,task.id);assert.equal(report.duties.length,1);
  await f.call('staff:apply-change',{change:report.change,expectedToken:report.token});
  const snapshot=await f.call('snapshot:get');assert.ok(snapshot.consequences.issues.some(issue=>issue.kind==='vacancy'));assert.ok(snapshot.consequences.issues.some(issue=>issue.taskId===task.id));assert.equal(snapshot.tasks[0].dueDate,task.dueDate);
  await f.call('history:undo');assert.deepEqual(JSON.parse(fs.readFileSync(f.database,'utf8')),JSON.parse(before));
});

test('a stale replacement proposal cannot partially write the database or consume the previous undo action',async t=>{
  const f=await fixture(t);await f.call('employee:add',{name:'Другий працівник'});const state=JSON.parse(fs.readFileSync(f.database));
  await f.call('duties:initialize',{entries:state.employees.map(person=>({employeeId:person.id,total:0,realized:0})),participantIds:state.employees.map(person=>person.id)});
  await f.call('duties:set-assignment',{date:'2026-10-06',employeeIds:[state.employees[0].id],singleApproved:true});
  const report=await f.call('duties:replacements',{date:'2026-10-06',employeeId:state.employees[0].id}), plan=report.plans[0];assert.ok(plan);
  const beforeSettings=fs.readFileSync(f.database,'utf8');await f.call('settings:update',{operatorName:'Новий автор'});const changed=fs.readFileSync(f.database,'utf8');
  assert.throws(()=>f.call('duties:apply-replacement',{query:report.query,expectedToken:report.token,proposalId:plan.id,reason:'Підміна'}),/Дані змінилися/);assert.equal(fs.readFileSync(f.database,'utf8'),changed);
  await f.call('history:undo');assert.equal(fs.readFileSync(f.database,'utf8'),beforeSettings);
});

test('cancelling the picker or the confirmation leaves the working database unchanged', async t => {
  const f = await fixture(t), before = fs.readFileSync(f.database,'utf8');
  f.dialog.openResult = { canceled:true, filePaths:[] };
  assert.equal((await f.call('data:import')).canceled,true);
  assert.deepEqual(f.calls.map(c => c.type),['open']);
  assert.equal(fs.readFileSync(f.database,'utf8'),before);
  f.dialog.openResult = { canceled:false, filePaths:[f.filePath] };
  f.dialog.answer = { response:1 };
  assert.equal((await f.call('data:import')).canceled,true);
  assert.equal(fs.readFileSync(f.database,'utf8'),before);
});

test('invalid or unrelated JSON fails before confirmation and never replaces the database', async t => {
  const f = await fixture(t), before = fs.readFileSync(f.database,'utf8');
  for (const content of ['{broken','{}','null','[]','{"employees":[],"records":[]}']) {
    fs.writeFileSync(f.filePath,content);
    await assert.rejects(f.call('data:import'));
    assert.equal(fs.readFileSync(f.database,'utf8'),before);
  }
  assert.ok(f.calls.every(c => c.type === 'open'));
});

test('UTF-8 backups with a BOM are imported without losing linked records and tasks', async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.filePath,'\uFEFF'+JSON.stringify(f.incoming));
  assert.equal((await f.call('data:import')).canceled,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.database)),domain.normalizeState(f.incoming));
});

test('a pending picker prevents a second import and releases the guard after cancellation', async t => {
  const f = await fixture(t);
  let finish;
  f.dialog.openResult = new Promise(resolve => { finish=resolve; });
  const first = f.call('data:import');
  const second = await f.call('data:import');
  assert.equal(second.busy,true); assert.equal(f.calls.length,1);
  finish({ canceled:true, filePaths:[] });
  assert.equal((await first).canceled,true);
  f.dialog.openResult = { canceled:true, filePaths:[] };
  assert.equal((await f.call('data:import')).busy,undefined);
  assert.equal(f.calls.length,2);
});

test('a dialog failure is reported and does not block the next import attempt', async t => {
  const f = await fixture(t), before = fs.readFileSync(f.database,'utf8');
  f.dialog.showOpenDialog = async () => { throw new Error('Не вдалося відкрити вибір файла'); };
  await assert.rejects(f.call('data:import'),/вибір файла/);
  assert.equal(fs.readFileSync(f.database,'utf8'),before);
  f.dialog.showOpenDialog = async () => ({ canceled:true, filePaths:[] });
  assert.equal((await f.call('data:import')).canceled,true);
});

test('disabling destructive confirmations still opens the picker and imports the selected copy', async t => {
  const f = await fixture(t);
  await f.call('settings:update',{ confirmDestructiveActions:false });
  assert.equal((await f.call('data:import')).canceled,false);
  assert.deepEqual(f.calls.map(c => c.type),['open']);
});

if (process.env.LAD_TEST_BACKUP) test('the complete supplied demonstration backup passes the actual main import handler', async t => {
  const f = await fixture(t), filename = process.env.LAD_TEST_BACKUP;
  f.dialog.openResult.filePaths = [filename];
  const expected = domain.normalizeState(JSON.parse(fs.readFileSync(filename,'utf8')));
  const imported = await f.call('data:import');
  assert.equal(imported.canceled,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.database)),expected);
  assert.equal(expected.receipts.length,2254);
  assert.equal(expected.tasks.length,127);
});
