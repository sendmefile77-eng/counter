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

async function fixture(t, { secondBeforeReady = false, shortcutAvailable = true, trayAvailable = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-import-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), calls = [],trays=[],shortcuts=new Map();
  const app = new EventEmitter();
  Object.assign(app, { whenReady: () => Promise.resolve(), getPath: () => directory,
    getAppPath: () => directory, getVersion: () => '0.17.0', isPackaged: false, quit() {calls.push({type:'quit'});} });
  class Window extends EventEmitter {
    constructor(options) { super(); this.bounds={x:0,y:0,width:options.width,height:options.height};this.visible=false;this.full=false; Window.instances.push(this); this.events=[]; this.topChanges=[]; this.onTop=true; this.minimized=false; this.sent=[];this.webContents = { send:(...args)=>this.sent.push(args), on() {} }; }
    loadFile() {} setAlwaysOnTop(value) { this.onTop=value; this.topChanges.push(value); } isAlwaysOnTop() { return this.onTop; } isDestroyed() { return false; } center() { this.events.push('center'); }
    isMinimized() { return this.minimized; } restore() { this.minimized=false; this.events.push('restore'); }
    hide() {this.visible=false;} setBounds(bounds){this.bounds={...bounds};} setPosition(x,y){Object.assign(this.bounds,{x,y});} setShape(value){this.shape=value;} setResizable(){} setSkipTaskbar(){} setFullScreen(v){this.full=v;} isFullScreen(){return this.full;} minimize(){this.minimized=true;}
    show() {this.visible=true; this.events.push('show'); } focus() { this.events.push('focus'); }
    getBounds() { return {...this.bounds}; }
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
    Menu:{ setApplicationMenu() {},buildFromTemplate:value=>value }, screen:{getAllDisplays:()=>[{workArea:{x:0,y:0,width:1920,height:1080}}],getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1080}})},
    Tray:class extends EventEmitter{constructor(){super();if(!trayAvailable)throw Error('No tray');trays.push(this);}setToolTip(){} setContextMenu(menu){this.menu=menu;} destroy(){this.destroyed=true;}},nativeImage:{createFromBuffer:value=>value},globalShortcut:{unregister:key=>shortcuts.delete(key),unregisterAll:()=>shortcuts.clear(),register:(key,callback)=>{if(shortcutAvailable)shortcuts.set(key,callback);return shortcutAvailable;}}, Notification:{ isSupported:() => false }, shell:{} };
  const context = vm.createContext({ require:name => name === 'electron' ? electron : localRequire(name),
    __dirname:path.dirname(mainPath), process:{ ...process, platform:'win32', env:{ ...process.env,
      PORTABLE_EXECUTABLE_DIR:directory, PORTABLE_EXECUTABLE_FILE:'' } },
    module:{exports:{}}, console, Buffer, Date, setTimeout, clearTimeout, setInterval:() => 1, clearInterval() {} });
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
  return { call, dialog, calls, database, filePath, incoming, directory, app, windows:Window.instances,trays,shortcuts };
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
  assert.match(f.calls[1].options.detail,/Працівників: 1; робіт: 0; записів попереднього обліку: 1; завдань: 1; графіків: 1/);
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
  window.emit('ready-to-show'); assert.deepEqual(window.events,['show','focus']); assert.equal(f.windows.length,1);
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
test('training sessions preserve real data and undo history and cannot import over the working team',async t=>{
 const f=await fixture(t),before=fs.readFileSync(f.database,'utf8');await f.call('training:enter');const demo=await f.call('snapshot:get');assert.equal(demo.training.active,true);assert.equal(demo.employees.length,6);
 await f.call('employee:add',{name:'Лише навчання'});assert.equal(fs.readFileSync(f.database,'utf8'),before);await assert.rejects(f.call('data:import'),/Вийдіть із навчання/);
 await f.call('training:exit');assert.equal(fs.readFileSync(f.database,'utf8'),before);assert.equal((await f.call('snapshot:get')).training.active,false);await f.call('history:undo');assert.equal(JSON.parse(fs.readFileSync(f.database)).employees.length,0);
});
test('legacy direct absence and archive IPC cannot bypass consequence review',async t=>{
 const f=await fixture(t),state=JSON.parse(fs.readFileSync(f.database)),before=fs.readFileSync(f.database,'utf8');
 assert.throws(()=>f.call('record:set-status',{employeeId:state.employees[0].id,date:'2026-10-06',status:'sick'}),/Зміну доступності/);
 assert.throws(()=>f.call('employee:archive',{employeeId:state.employees[0].id}),/перевірте наслідки/);assert.equal(fs.readFileSync(f.database,'utf8'),before);
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
  await f.call('history:undo');
  assert.equal((await f.call('data:import',{name:path.basename(filename),content:fs.readFileSync(filename,'utf8')})).canceled,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.database)),expected);
});

test('production mass availability IPC removes both selected crew members, retains the task and undoes the operation atomically',async t=>{
 const f=await fixture(t);await f.call('employee:add',{name:'Другий працівник'});const state=JSON.parse(fs.readFileSync(f.database)),ids=state.employees.map(person=>person.id),date='2026-10-07';
 await f.call('duties:initialize',{entries:ids.map(employeeId=>({employeeId,total:0,realized:0})),participantIds:ids});await f.call('duties:schedule-rules',{scheduleId:state.activeDutyScheduleId,rules:{weekdayDutyCount:2,weekendDutyCount:2}});await f.call('duties:set-assignment',{date,employeeIds:ids});const task=await f.call('tasks:create',{title:'Спільний звіт',dueDate:date,assigneeIds:ids});
 const input={cells:ids.map(employeeId=>({employeeId,date})),action:'status',status:'sick',note:'Обидва повідомили про лікарняний',replaceExisting:true},before=fs.readFileSync(f.database,'utf8'),report=await f.call('journal:preview-batch',input);
 assert.equal(fs.readFileSync(f.database,'utf8'),before);assert.equal(report.tasks.length,1);assert.ok(report.duties.every(item=>item.after.length===0));await f.call('journal:apply-batch',{...input,expectedToken:report.token});const snapshot=await f.call('snapshot:get');assert.deepEqual(snapshot.duties.assignments[date].employeeIds,[]);assert.deepEqual(snapshot.tasks[0],task);assert.equal(snapshot.records[ids[0]+'|'+date].status,'sick');assert.equal(snapshot.records[ids[1]+'|'+date].status,'sick');
 await f.call('history:undo');assert.deepEqual(JSON.parse(fs.readFileSync(f.database,'utf8')),JSON.parse(before));
});

test('presence IPC persists a previewed ZKP, allows duty, blocks absent work and restores the whole batch with undo and import',async t=>{
 const f=await fixture(t);await f.call('settings:update',{workdays:[0,1,2,3,4,5,6]});const state=await f.call('snapshot:get'),id=state.employees[0].id,date=domain.dateKeyFromDate();
 const input={employeeIds:[id],startDate:date,status:'zkp',reason:'Працює в іншому офісі'},before=fs.readFileSync(f.database,'utf8');
 const report=await f.call('presence:preview',input);assert.equal(fs.readFileSync(f.database,'utf8'),before);
 await assert.rejects(async()=>f.call('presence:apply',{change:report.change,expectedToken:'bad'}),/змінилися/);assert.equal(fs.readFileSync(f.database,'utf8'),before);
 await f.call('presence:apply',{change:report.change,expectedToken:report.token});const saved=fs.readFileSync(f.database,'utf8');assert.equal(JSON.parse(saved).presenceRecords[id+'|'+date].status,'zkp');
 const stats=await f.call('analytics:report',{startDate:date,endDate:date});assert.equal(stats.total.zkpDays,1);assert.equal(stats.total.workedDays,0);
 await f.call('duties:initialize',{entries:[{employeeId:id,total:0,realized:0}],participantIds:[id]});await f.call('duties:set-assignment',{date,employeeIds:[id],singleApproved:true});
 const sick=await f.call('presence:preview',{...input,status:'sick',reason:'Повідомлення про лікарняний'});assert.equal(sick.duties.length,1);await f.call('presence:apply',{change:sick.change,expectedToken:sick.token});
 assert.deepEqual((await f.call('snapshot:get')).duties.assignments[date].employeeIds,[]);
 await assert.rejects(async()=>f.call('work:mark-day',{employeeId:id,date,status:'submitted'}),/відсутності/);
 await assert.rejects(async()=>f.call('duties:set-assignment',{date,employeeIds:[id],singleApproved:true}));
 await f.call('history:undo');assert.equal((await f.call('snapshot:get')).presenceRecords[id+'|'+date].status,'zkp');assert.deepEqual((await f.call('snapshot:get')).duties.assignments[date].employeeIds,[id]);
 await f.call('data:import',{name:'Наявність.json',content:saved});assert.equal((await f.call('snapshot:get')).presenceRecords[id+'|'+date].status,'zkp');
});

test('malformed presence cannot replace the live database during import',async t=>{
 const f=await fixture(t),state=await f.call('snapshot:get'),id=state.employees[0].id,date=domain.dateKeyFromDate(),before=fs.readFileSync(f.database,'utf8');
 state.presenceRecords={[id+'|'+date]:{employeeId:id,date,status:'unknown',note:'',actor:'Керівник',recordedAt:new Date().toISOString()}};
 await assert.rejects(async()=>f.call('data:import',{name:'Зіпсована.json',content:JSON.stringify(state)}),/Наявність/);assert.equal(fs.readFileSync(f.database,'utf8'),before);assert.equal(f.calls.length,0);
});

test('office-return acceptance stores selected ZKP days atomically, preserves presence and supports undo and import',async t=>{
 const f=await fixture(t);await f.call('settings:update',{workdays:[0,1,2,3,4,5,6]});
 const snapshot=await f.call('snapshot:get'),id=snapshot.employees[0].id,today=domain.dateKeyFromDate(),past=domain.addDays(today,-1);
 const presenceInput={employeeIds:[id],startDate:past,endDate:today,status:'zkp',reason:'Робота в іншому офісі'};
 let preview=await f.call('presence:preview',presenceInput);await f.call('presence:apply',{change:preview.change,expectedToken:preview.token});
 const untouched=fs.readFileSync(f.database,'utf8');
 await assert.rejects(async()=>f.call('work:mark-day',{employeeId:id,date:past,status:'submitted',note:'Приніс роботу'}),/повернення/);assert.equal(fs.readFileSync(f.database,'utf8'),untouched);
 preview=await f.call('presence:preview',{...presenceInput,startDate:today,status:'onsite',reason:'Повернувся в офіс'});await f.call('presence:apply',{change:preview.change,expectedToken:preview.token});
 const before=fs.readFileSync(f.database,'utf8'),input={cells:[{employeeId:id,date:past},{employeeId:id,date:today}],action:'status',status:'submitted',note:'Отримано роботу за ЗКП та сьогодні',replaceExisting:true};
 const plan=await f.call('journal:preview-batch',input);assert.equal(fs.readFileSync(f.database,'utf8'),before);assert.equal(plan.canApply,true);
 await assert.rejects(async()=>f.call('journal:apply-batch',{...input,expectedToken:'bad'}),/змінилися/);assert.equal(fs.readFileSync(f.database,'utf8'),before);
 await f.call('journal:apply-batch',{...input,expectedToken:plan.token});const saved=fs.readFileSync(f.database,'utf8');
 const state=await f.call('snapshot:get');assert.equal(state.presenceRecords[id+'|'+past].status,'zkp');assert.equal(state.records[id+'|'+past].status,'submitted');
 const stats=await f.call('analytics:report',{startDate:past,endDate:today,employeeIds:[id]});assert.equal(stats.total.confirmedDays,2);assert.equal(stats.total.zkpDays,1);assert.equal(stats.total.zkpPendingDays,0);
 await f.call('history:undo');assert.equal(fs.readFileSync(f.database,'utf8'),before);
 await f.call('data:import',{name:'Підтвердження ЗКП.json',content:saved});const imported=await f.call('analytics:report',{startDate:past,endDate:today,employeeIds:[id]});assert.equal(imported.total.confirmedDays,2);assert.equal(imported.total.zkpDays,1);
});


test('selected file contents import through production IPC without a second picker, preserve BOM data, checkpoint and undo', async t => {
  const f = await fixture(t), before = fs.readFileSync(f.database,'utf8');
  f.dialog.showOpenDialog = () => { throw Error('The renderer already selected a file'); };
  const result = await f.call('data:import', { name:'Моя копія.json', content:'\uFEFF'+JSON.stringify(f.incoming) });
  assert.equal(result.canceled,false); assert.equal(result.fileName,'Моя копія.json');
  assert.deepEqual(f.calls.map(c=>c.type),['confirm']);
  assert.match(f.calls[0].options.message,/Моя копія.json/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.database)),domain.normalizeState(f.incoming));
  assert.equal(fs.readFileSync(path.join(f.directory,'Counter-data','counter-data.backup.json'),'utf8'),before);
  await f.call('history:undo'); assert.equal(fs.readFileSync(f.database,'utf8'),before);
});

test('cancelling selected-file confirmation preserves all data and permits selecting the same file again', async t => {
  const f = await fixture(t), before = fs.readFileSync(f.database,'utf8'), file={name:'copy.json',content:JSON.stringify(f.incoming)};
  f.dialog.answer={response:1}; assert.equal((await f.call('data:import',file)).canceled,true);
  assert.equal(fs.readFileSync(f.database,'utf8'),before);
  f.dialog.answer={response:0}; assert.equal((await f.call('data:import',file)).canceled,false);
});

test('malformed file payloads and future-schema contents cannot bypass validation or change data', async t => {
  const f=await fixture(t), before=fs.readFileSync(f.database,'utf8');
  for (const file of [null,{}, {name:'copy.json',content:42}, {name:'',content:'{}'},
    ...['{broken','{}','null','[]',JSON.stringify({...f.incoming,schemaVersion:99})].map(content=>({name:'copy.json',content}))]) {
    await assert.rejects(f.call('data:import',file));
    assert.equal(fs.readFileSync(f.database,'utf8'),before);
  }
  assert.equal(f.calls.length,0);
  assert.equal((await f.call('data:import',{name:'copy.json',content:JSON.stringify(f.incoming)})).canceled,false);
});

test('pending selected-file confirmation suspends always-on-top, blocks duplicates and restores it after cancellation', async t => {
  const f=await fixture(t), owner=f.windows[0], before=fs.readFileSync(f.database,'utf8');
  let finish; f.dialog.answer=new Promise(resolve=>{finish=resolve;});
  const first=f.call('data:import',{name:'copy.json',content:JSON.stringify(f.incoming)});
  assert.equal(owner.onTop,false);
  assert.equal((await f.call('data:import',{name:'copy.json',content:JSON.stringify(f.incoming)})).busy,true);
  assert.equal(f.calls.length,1); finish({response:1}); await first;
  assert.equal(owner.onTop,true); assert.equal(fs.readFileSync(f.database,'utf8'),before);
});

test('native dialog failures restore window layering and permit a subsequent selected-file import', async t => {
  const f=await fixture(t), owner=f.windows[0], before=fs.readFileSync(f.database,'utf8');
  f.dialog.showMessageBox=async()=>{assert.equal(owner.onTop,false);throw Error('Dialog failure');};
  const file={name:'copy.json',content:JSON.stringify(f.incoming)};
  await assert.rejects(f.call('data:import',file),/Dialog failure/);
  assert.equal(owner.onTop,true); assert.equal(fs.readFileSync(f.database,'utf8'),before);
  f.dialog.showMessageBox=async()=>({response:0}); await f.call('data:import',file); assert.equal(owner.onTop,true);
});

test('selected files respect disabled confirmations, imported window settings and training isolation', async t => {
  const f=await fixture(t), before=fs.readFileSync(f.database,'utf8');
  await f.call('training:enter');
  await assert.rejects(f.call('data:import',{name:'copy.json',content:JSON.stringify(f.incoming)}),/Вийдіть із навчання/);
  assert.equal(fs.readFileSync(f.database,'utf8'),before); await f.call('training:exit');
  await f.call('settings:update',{confirmDestructiveActions:false});
  f.incoming.settings.alwaysOnTop=false;
  await f.call('data:import',{name:'copy.json',content:JSON.stringify(f.incoming)});
  assert.equal(f.calls.length,0); assert.equal(f.windows[0].onTop,false);
});

test('work changes persist through IPC, undo and selected-file restore with revisions and atomic failures',async t=>{
 const f=await fixture(t),snap=await f.call('snapshot:get'),employee=snap.employees[0],today=domain.dateKeyFromDate();
 let entry=await f.call('work:create',{employeeId:employee.id,title:'Робота без паперів',projectCount:5,startDate:today,estimatedEndDate:today});
 const before=fs.readFileSync(f.database,'utf8');
 assert.throws(()=>f.call('work:update',{id:entry.id,input:{...entry,projectCount:6,expectedRevision:entry.revision}}),/Поясніть/);assert.equal(fs.readFileSync(f.database,'utf8'),before);
 entry=await f.call('work:progress',{id:entry.id,input:{completedProjects:2,expectedRevision:entry.revision}});
 assert.equal(JSON.parse(fs.readFileSync(f.database)).workEntries[0].completedProjects,2);
 await f.call('history:undo');assert.equal(JSON.parse(fs.readFileSync(f.database)).workEntries[0].completedProjects,0);
 const current=await f.call('snapshot:get'),content=JSON.stringify(current);
 await f.call('data:reset-all');assert.equal((await f.call('snapshot:get')).workEntries.length,0);
 await f.call('data:import',{name:'work.json',content});assert.deepEqual((await f.call('snapshot:get')).workEntries,current.workEntries);
 await assert.rejects(f.call('data:import',{name:'bad-work.json',content:JSON.stringify({...current,workEntries:[{...current.workEntries[0],history:[{}]}]})}),/історія/);
 assert.deepEqual((await f.call('snapshot:get')).workEntries,current.workEntries);
});
test('widget preferences control persistent shapes, native hit regions, locking and hide instead of quitting',async t=>{
 const f=await fixture(t),window=f.windows[0];window.emit('ready-to-show');
 await f.call('widget:preferences',{widgetMode:'tasks',widgetShape:'panel',widgetLocked:true,widgetQuickMode:false});
 assert.equal(window.getBounds().height,494);assert.equal(window.shape.length,0);
 const before=window.getBounds();assert.equal(await f.call('window:resize-widget',{size:700,persist:true}),null);assert.deepEqual(window.getBounds(),before);
 assert.throws(()=>f.call('widget:preferences',{workdays:[]}));assert.throws(()=>f.call('widget:preferences',{widgetMode:'bad'}));
 await f.call('window:hide');assert.equal(window.visible,false);
 f.app.emit('second-instance');assert.equal(window.visible,true);
 await f.call('widget:preferences',{widgetShape:'circle',widgetMode:'duties',widgetLocked:false,widgetShortcutEnabled:false});
 assert.equal(window.getBounds().height,380);assert.ok(window.shape.length>300);
 const stored=JSON.parse(fs.readFileSync(f.database));assert.equal(stored.settings.widgetMode,'duties');assert.equal(stored.settings.widgetShape,'circle');
 assert.equal((await f.call('snapshot:get')).widgetWindowStatus.shortcutRegistered,false);
});

test('tray menu and global shortcut change native mode and notify the renderer; exit is distinct from hide',async t=>{
 const f=await fixture(t),window=f.windows[0];window.emit('ready-to-show');
 f.trays[0].menu.find(item=>item.label==='Відкрити ЛАД').click();await new Promise(resolve=>setTimeout(resolve,60));
 assert.equal(window.getBounds().width,1240);assert.deepEqual(Array.from(window.sent.at(-1)),['window:mode-changed','dashboard']);
 f.shortcuts.get('CommandOrControl+Shift+L')();await new Promise(resolve=>setTimeout(resolve,60));
 assert.equal(window.getBounds().width,380);assert.deepEqual(Array.from(window.sent.at(-1)),['window:mode-changed','widget']);
 const lock=f.trays[0].menu.find(item=>item.type==='checkbox');lock.click({checked:true});assert.equal((await f.call('snapshot:get')).settings.widgetLocked,true);
 let prevented=false;window.emit('close',{preventDefault:()=>prevented=true});assert.equal(prevented,true);assert.equal(window.visible,false);assert.ok(!f.calls.some(call=>call.type==='quit'));
 await f.call('window:close');assert.equal(f.calls.at(-1).type,'quit');
 f.app.emit('before-quit');assert.equal(f.shortcuts.size,0);assert.equal(f.trays[0].destroyed,true);prevented=false;window.emit('close',{preventDefault:()=>prevented=true});assert.equal(prevented,false);
});
test('shortcut conflicts are visible, and hiding without a tray leaves a taskbar window',async t=>{
 const f=await fixture(t,{shortcutAvailable:false,trayAvailable:false}),window=f.windows[0];
 const snapshot=await f.call('snapshot:get');assert.equal(snapshot.widgetWindowStatus.shortcutRegistered,false);assert.equal(snapshot.widgetWindowStatus.trayAvailable,false);
 await f.call('window:hide');assert.equal(window.isMinimized(),true);assert.ok(!f.calls.some(call=>call.type==='quit'));
});

test('employee deletion IPC previews accounting, persists atomically and supports undo and restore',async t=>{
  const f=await fixture(t),snapshot=await f.call('snapshot:get'),id=snapshot.employees[0].id;
  const task=await f.call('tasks:create',{title:'Доручення перед видаленням',dueDate:domain.addDays(domain.dateKeyFromDate(),3),assigneeIds:[id],color:'teal',tags:['Контроль']});
  const archive=await f.call('staff:preview-change',{kind:'archive',employeeId:id,reason:'Вибув зі складу'});
  await f.call('staff:apply-change',{change:archive.change,expectedToken:archive.token});
  const preview=await f.call('employee:delete-preview',{employeeId:id}),before=fs.readFileSync(f.database,'utf8');assert.ok(preview.tasks.some(item=>item.id===task.id));
  assert.throws(()=>f.call('employee:delete',{employeeId:id,expectedToken:'stale'}),/змінилися/);assert.equal(fs.readFileSync(f.database,'utf8'),before);
  const refreshed=await f.call('employee:delete-preview',{employeeId:id});await f.call('employee:delete',{employeeId:id,expectedToken:refreshed.token});const saved=JSON.parse(fs.readFileSync(f.database,'utf8'));assert.equal(saved.employees.length,0);assert.equal(saved.tasks[0].status,'blocked');assert.equal(saved.tasks[0].color,'teal');
  const deletedCopy=JSON.stringify(saved);await f.call('history:undo');assert.deepEqual(JSON.parse(fs.readFileSync(f.database,'utf8')),JSON.parse(before));
  await f.call('data:import',{name:'deleted.json',content:deletedCopy});assert.equal((await f.call('snapshot:get')).employees.length,0);assert.equal((await f.call('snapshot:get')).tasks[0].status,'blocked');
});
test('protocol deletion IPC keeps completed tasks and undo, with no reused numbers after import',async t=>{
  const f=await fixture(t),snap=await f.call('snapshot:get'),input={title:'Завершена робота',count:1,participantIds:snap.employees.map(person=>person.id)},draw=await f.call('draws:create',input);
  const task=await f.call('draws:create-task',{id:draw.id,input:{dueDate:domain.dateKeyFromDate()}}),before=fs.readFileSync(f.database,'utf8');
  assert.throws(()=>f.call('draws:delete',{id:draw.id}),/виконайте/);assert.equal(fs.readFileSync(f.database,'utf8'),before);
  await f.call('tasks:status',{id:task.id,input:{status:'done'}});await f.call('draws:delete',{id:draw.id});const saved=await f.call('snapshot:get');assert.equal(saved.draws.length,0);assert.equal(saved.tasks[0].status,'done');
  await f.call('history:undo');assert.equal((await f.call('snapshot:get')).draws.length,1);
  await f.call('data:import',{name:'protocols.json',content:JSON.stringify(saved)});assert.equal((await f.call('draws:create',input)).number,2);
});
