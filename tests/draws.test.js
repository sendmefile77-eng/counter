const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const domain = require('../src/shared/domain');
const draws = require('../src/shared/draws');
const { DataStore } = require('../src/main/store');
const now = new Date('2026-10-02T12:00:00Z');
function fixture() {
  const state = domain.defaultState(now); state.settings.automaticClose = false;
  const people = ['Олена','Петро','Ірина','Архів'].map(name=>domain.createEmployee(state,name,now));
  people[3].active = false;
  return { state, people, input:{ title:'Підготувати зал', participantIds:people.slice(0,3).map(person=>person.id), count:2 } };
}
test('every permutation has equal inclusion chances and distinct selected participants',()=>{
  const inclusion = [0,0,0], pairs = new Set();
  // All six equally likely branches of the three-person Fisher–Yates shuffle.
  for (let first=0;first<3;first++) for (let second=0;second<2;second++) {
    const {state,people,input} = fixture(), branch=[first,second], limits=[];
    const draw = draws.createDraw(state,input,now,limit=>{limits.push(limit);return branch.shift();});
    assert.deepEqual(limits,[3,2]); assert.equal(new Set(draw.selectedIds).size,2);
    const indices=draw.selectedIds.map(id=>people.findIndex(person=>person.id===id));
    pairs.add(indices.join(',')); indices.forEach(index=>inclusion[index]++);
  }
  assert.equal(pairs.size,6); assert.deepEqual(inclusion,[4,4,4]);
});
test('invalid participants, count, randomness and repeat reason leave the state unchanged',()=>{
  const {state,people,input} = fixture();
  for (const patch of [{title:''},{participantIds:[]},{participantIds:[people[3].id]},
    {participantIds:[people[0].id,people[0].id]},{participantIds:['missing']},{count:0},{count:4},{count:1.5},{previousDrawId:'missing'}]) {
    const before=domain.clone(state); assert.throws(()=>draws.createDraw(state,{...input,...patch},now)); assert.deepEqual(state,before);
  }
  const before=domain.clone(state); assert.throws(()=>draws.createDraw(state,input,now,()=>-1)); assert.deepEqual(state,before);
  const first=draws.createDraw(state,input,now); const saved=domain.clone(state);
  assert.throws(()=>draws.createDraw(state,{...input,previousDrawId:first.id},now),/причину/); assert.deepEqual(state,saved);
});
test('all people can be selected; repeats retain original names, result, time and explanation',()=>{
  const {state,people,input} = fixture(); state.settings.operatorName='Начальник';
  const original=draws.createDraw(state,{...input,count:3},now), saved=domain.clone(original);
  people[0].name='Нове ім’я'; people[0].active=false;
  const repeat=draws.createDraw(state,{...input,participantIds:input.participantIds.slice(1),previousDrawId:original.id,rerollReason:'Олена вибула з роботи'},new Date('2026-10-03T12:00:00Z'));
  assert.deepEqual(original,saved); assert.equal(original.participants[0].name,'Олена');
  assert.equal(repeat.number,2); assert.equal(repeat.previousDrawId,original.id); assert.equal(repeat.createdBy,'Начальник');
  assert.equal(repeat.rerollReason,'Олена вибула з роботи'); assert.equal(state.audit.at(-1).details.previousDrawId,original.id);
  assert.deepEqual(domain.normalizeState(state,now).draws,state.draws);
});
test('a draw creates one shared task for exactly the selected people and preserves the protocol',()=>{
  const {state,input} = fixture(), draw=draws.createDraw(state,input,now);
  const task=draws.taskFromDraw(state,draw.id,{dueDate:'2026-10-05',assigneeIds:[],description:'Прибрати столи'},now);
  assert.deepEqual(task.assigneeIds,draw.selectedIds); assert.equal(task.title,draw.title);
  assert.ok(task.description.includes(draw.id)); assert.ok(task.description.includes('Прибрати столи'));
  assert.equal(draw.taskId,task.id);
  assert.equal(draws.taskFromDraw(state,draw.id,{dueDate:'2026-10-06'},now),task); assert.equal(state.tasks.length,1);
});
test('archiving a selected employee prevents task creation without changing the saved draw',()=>{
  const {state,input} = fixture(), draw=draws.createDraw(state,input,now);
  state.employees.find(person=>person.id===draw.selectedIds[0]).active=false;
  const before=domain.clone(state); assert.throws(()=>draws.taskFromDraw(state,draw.id,{dueDate:'2026-10-05'},now),/архіві/); assert.deepEqual(state,before);
});
test('saved draw protocols survive reload, JSON import, and legacy schema migration',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lad-draw-')); t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const {state,input} = fixture(); draws.createDraw(state,input,now);
  const store=new DataStore(folder); store.replace(state);
  const reloaded=new DataStore(folder); reloaded.load(); assert.deepEqual(reloaded.state.draws,state.draws);
  assert.deepEqual(domain.normalizeState(JSON.parse(JSON.stringify(state)),now).draws,state.draws);
  const old=domain.clone(state); old.schemaVersion=8; delete old.draws;
  const migrated=domain.normalizeState(old,now); assert.equal(migrated.schemaVersion,11); assert.deepEqual(migrated.draws,[]);
});
test('import rejects corrupted selections, duplicate protocols, dangling parents and cycles',()=>{
  const {state,input} = fixture(); const first=draws.createDraw(state,input,now);
  draws.createDraw(state,{...input,previousDrawId:first.id,rerollReason:'Змінено обставини'},now);
  for (const mutate of [s=>s.draws.push(s.draws[0]),s=>s.draws[0].selectedIds[1]=s.draws[0].selectedIds[0],
    s=>s.draws[0].count=3,s=>s.draws[0].createdAt=10,s=>s.draws[1].previousDrawId='missing',
    s=>{s.draws[0].previousDrawId=s.draws[1].id;s.draws[0].rerollReason='cycle';}]) {
    const broken=domain.clone(state); mutate(broken); assert.throws(()=>domain.normalizeState(broken,now));
  }
});
