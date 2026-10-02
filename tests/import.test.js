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

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-import-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), calls = [];
  const app = new EventEmitter();
  Object.assign(app, { whenReady: () => Promise.resolve(), getPath: () => directory,
    getAppPath: () => directory, getVersion: () => '0.11.1', isPackaged: false, quit() {} });
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = { send() {}, on() {} }; }
    loadFile() {} setAlwaysOnTop() {} isDestroyed() { return false; }
    isMinimized() { return false; } restore() {} show() {} focus() {}
    getBounds() { return { x:0, y:0, width:380, height:380 }; }
    static getAllWindows() { return []; }
  }
  const dialog = {
    openResult: { canceled:false, filePaths:[] }, answer: { response:0 },
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
  return { call, dialog, calls, database, filePath, incoming, directory };
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
