const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DataStore } = require('../src/main/store');
const { createEmployee, defaultState } = require('../src/shared/domain');
const {createTrainingState}=require('../src/shared/training');

test('портативна база автоматично копіюється зі старого каталогу Windows', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-store-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const legacyDirectory = path.join(temporaryRoot, 'legacy-appdata');
  const portableDirectory = path.join(temporaryRoot, 'Counter-data');
  fs.mkdirSync(legacyDirectory, { recursive: true });

  const state = defaultState(new Date(2026, 7, 20, 9, 0));
  createEmployee(state, 'Тестовий працівник', new Date(2026, 7, 20, 9, 0));
  fs.writeFileSync(
    path.join(legacyDirectory, 'counter-data.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(legacyDirectory, 'counter-data.backup.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );

  const store = new DataStore(portableDirectory, legacyDirectory);
  store.load();

  assert.equal(store.state.employees[0].name, 'Тестовий працівник');
  assert.equal(fs.existsSync(path.join(portableDirectory, 'counter-data.json')), true);
  assert.equal(fs.existsSync(path.join(portableDirectory, 'counter-data.backup.json')), true);
  assert.equal(fs.existsSync(path.join(legacyDirectory, 'counter-data.json')), true);
});

test('повне обнулення видаляє дані та внутрішню резервну копію', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-reset-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const store = new DataStore(temporaryRoot);
  store.load();
  createEmployee(store.state, 'Працівник для видалення', new Date(2026, 7, 20, 9, 0));
  store.save();
  assert.equal(fs.existsSync(store.backupPath), true);
  const corruptCopyPath = path.join(temporaryRoot, 'counter-data.corrupt-123.json');
  fs.writeFileSync(corruptCopyPath, '{}', 'utf8');

  store.reset(new Date(2026, 7, 21, 9, 0));

  assert.deepEqual(store.state.employees, []);
  assert.deepEqual(store.state.records, {});
  assert.deepEqual(store.state.duties.assignments, {});
  assert.equal(store.state.duties.initialized, false);
  assert.equal(fs.existsSync(store.backupPath), false);
  assert.equal(fs.existsSync(corruptCopyPath), false);
  const persisted = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  assert.deepEqual(persisted.employees, []);
});

test('пошкоджена база відновлюється зі справної копії без перезапису цієї копії', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new DataStore(directory);
  store.load();
  createEmployee(store.state, 'Працівник', new Date(2026, 7, 20, 9, 0));
  store.save();
  store.save();
  const healthy = fs.readFileSync(store.backupPath, 'utf8');
  fs.writeFileSync(store.filePath, '{broken', 'utf8');
  const recovered = new DataStore(directory);
  recovered.load();
  assert.equal(recovered.state.employees[0].name, 'Працівник');
  assert.equal(fs.readFileSync(store.backupPath, 'utf8'), healthy);
  assert.ok(fs.readdirSync(directory).some((name) => name.startsWith('counter-data.corrupt-')));
  assert.ok(recovered.listBackups().length > 0);
});

test('можна переглянути й відновити вибрану локальну копію', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-backups-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new DataStore(directory);
  store.load();
  createEmployee(store.state, 'Перший', new Date(2026, 7, 20, 9, 0));
  store.save();
  createEmployee(store.state, 'Другий', new Date(2026, 7, 20, 9, 0));
  store.save();
  assert.equal(store.listBackups().find((backup) => backup.id === 'previous').employees, 1);
  store.restoreBackup('previous');
  assert.deepEqual(store.state.employees.map((employee) => employee.name), ['Перший']);
});

test('за двох пошкоджених основних копій програма бере справну щоденну', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-daily-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new DataStore(directory);
  store.load();
  createEmployee(store.state, 'Зі щоденної копії', new Date(2026, 7, 20, 9, 0));
  store.save();
  store.save();
  fs.writeFileSync(store.filePath, '{broken', 'utf8');
  fs.writeFileSync(store.backupPath, '{}', 'utf8');
  const restored = new DataStore(directory);
  restored.load();
  assert.equal(restored.state.employees[0].name, 'Зі щоденної копії');
  assert.equal(restored.listBackups().find((copy) => copy.id === 'previous').employees, 1);
});
test('failed recovery never creates an empty database on the next launch',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-failed-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.writeFileSync(path.join(directory,'counter-data.json'),'{broken');
 assert.throws(()=>new DataStore(directory).load(),/порожня база не створюється/);assert.equal(fs.readFileSync(path.join(directory,'counter-data.json'),'utf8'),'{broken');
 assert.throws(()=>new DataStore(directory).load(),/порожня база не створюється/);assert.equal(fs.readFileSync(path.join(directory,'counter-data.json'),'utf8'),'{broken');
 fs.unlinkSync(path.join(directory,'counter-data.json'));assert.throws(()=>new DataStore(directory).load(),/порожня база не створюється/);assert.ok(!fs.existsSync(path.join(directory,'counter-data.json')));
});
test('a missing primary database recovers a backup and reports the recovery to the user',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-missing-db-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new DataStore(directory);store.load();createEmployee(store.state,'З копії');store.save();store.save();fs.unlinkSync(store.filePath);
 const next=new DataStore(directory);next.load();assert.equal(next.state.employees[0].name,'З копії');assert.equal(next.recovery.source,'previous');assert.match(next.recovery.message,/Перевірте останні зміни/);
});
test('an import checkpoint survives ordinary edits and can restore the pre-import team',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-checkpoint-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new DataStore(directory);store.load();createEmployee(store.state,'До імпорту');store.save();const original=store.snapshot();
 const next=defaultState();createEmployee(next,'Після імпорту');store.replace(next);createEmployee(store.state,'Ще одна зміна');store.save();const point=store.listBackups().find(copy=>copy.kind==='checkpoint');assert.ok(point);assert.equal(point.employees,1);store.restoreBackup(point.id);assert.deepEqual(store.state.employees,original.employees);
});
test('future schemas are rejected without changing the primary file or silently restoring an older copy',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-future-schema-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new DataStore(directory);store.load();store.save();const future={...defaultState(),schemaVersion:99};const content=JSON.stringify(future);fs.writeFileSync(store.filePath,content);
 assert.throws(()=>new DataStore(directory).load(),/новішою версією/);assert.equal(fs.readFileSync(store.filePath,'utf8'),content);
});
test('updating and recovering retains swap explanations, tasks and draw protocols',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-update-roundtrip-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const demo=createTrainingState(new Date('2026-10-03T08:00:00Z')),r=require('../src/shared/duty-replacements'),draws=require('../src/shared/draws');
 const options=r.getReplacementOptions(demo.state,{date:demo.scenario.date,employeeId:demo.scenario.employeeId},new Date('2026-10-03T08:00:00Z')),plan=options.plans.find(plan=>plan.kind==='swap');r.applyReplacement(demo.state,{query:options.query,expectedToken:options.token,proposalId:plan.id,reason:'Погоджений обмін',acknowledgeWarnings:true},new Date('2026-10-03T08:00:00Z'));
 draws.createDraw(demo.state,{title:'Перевірка протоколу',participantIds:demo.state.employees.map(person=>person.id),count:2},new Date('2026-10-03T08:00:00Z'));
 const store=new DataStore(directory);store.state=demo.state;store.save();store.save();const before=store.snapshot(),next=new DataStore(directory);next.load();assert.deepEqual(next.state.duties.assignments,before.duties.assignments);assert.deepEqual(next.state.tasks,before.tasks);assert.deepEqual(next.state.draws,before.draws);
 fs.writeFileSync(store.filePath,'invalid');const recovered=new DataStore(directory);recovered.load();assert.deepEqual(recovered.state.duties.assignments,before.duties.assignments);assert.deepEqual(recovered.state.tasks,before.tasks);assert.deepEqual(recovered.state.draws,before.draws);
});

test('daily recovery uses the newest healthy copy while minimum retention keeps a pre-import checkpoint separately',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-copy-order-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new DataStore(directory);store.load();store.state.settings.backupRetention=1;createEmployee(store.state,'До імпорту');store.save();
 const imported=defaultState();imported.settings.backupRetention=1;createEmployee(imported,'Після імпорту');store.replace(imported);store.save();
 const point=store.backupCandidates().find(copy=>copy.id.includes('checkpoint-'));assert.ok(point);const daily=store.backupCandidates().find(copy=>/counter-data-\d/.test(copy.id));assert.ok(daily);
 fs.utimesSync(point.path,new Date('2025-01-01'),new Date('2025-01-01'));fs.utimesSync(daily.path,new Date('2026-10-03'),new Date('2026-10-03'));
 fs.writeFileSync(store.filePath,'{broken');fs.writeFileSync(store.backupPath,'{broken');const next=new DataStore(directory);next.load();assert.equal(next.state.employees[0].name,'Після імпорту');assert.equal(next.recovery.source,daily.id);assert.ok(next.listBackups().some(copy=>copy.kind==='checkpoint'));
});
test('missing primary with existing backups cannot be replaced by stale legacy data',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-legacy-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const current=path.join(directory,'current'),legacy=path.join(directory,'legacy');const store=new DataStore(current);store.load();createEmployee(store.state,'Актуальна команда');store.save();store.save();fs.unlinkSync(store.filePath);
 const old=new DataStore(legacy);old.load();createEmployee(old.state,'Стара команда');old.save();const recovered=new DataStore(current,legacy);recovered.load();assert.equal(recovered.state.employees[0].name,'Актуальна команда');assert.equal(recovered.recovery.source,'previous');
});
