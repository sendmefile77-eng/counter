const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DataStore}=require('../src/main/store');
const {defaultState,createEmployee}=require('../src/shared/domain');
const {chooseLegacyData}=require('../src/main/startup-data');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lad-startup-data-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const legacy=path.join(root,'legacy'),current=path.join(root,'app','Counter-data');fs.mkdirSync(legacy);
 const state=defaultState();createEmployee(state,'Попередня команда');
 const bytes=JSON.stringify(state);fs.writeFileSync(path.join(legacy,'counter-data.json'),bytes);
 return {store:new DataStore(current,legacy),legacy,current,bytes};
}
test('a fresh folder asks before copying a legacy database, and cancel writes nothing',async t=>{
 const f=fixture(t);let dialog;
 assert.equal(await chooseLegacyData(f.store,async options=>{dialog=options;return{response:2};}),false);
 assert.match(dialog.detail,/legacy/);assert.equal(dialog.defaultId,2);
 assert.equal(fs.existsSync(f.current),false);assert.equal(fs.readFileSync(path.join(f.legacy,'counter-data.json'),'utf8'),f.bytes);
});
test('starting empty leaves the legacy database intact and does not ask on the next run',async t=>{
 const f=fixture(t);
 assert.equal(await chooseLegacyData(f.store,async()=>({response:1})),true);f.store.load();
 assert.equal(f.store.state.employees.length,0);
 assert.equal(fs.readFileSync(path.join(f.legacy,'counter-data.json'),'utf8'),f.bytes);
 const next=new DataStore(f.current,f.legacy);assert.equal(await chooseLegacyData(next,()=>{throw Error('Must not ask again');}),true);
 next.load();assert.equal(next.state.employees.length,0);
});
test('explicitly copying legacy data preserves the original and opens that team',async t=>{
 const f=fixture(t);assert.equal(await chooseLegacyData(f.store,async()=>({response:0})),true);f.store.load();
 assert.equal(f.store.state.employees[0].name,'Попередня команда');
 assert.equal(fs.readFileSync(path.join(f.legacy,'counter-data.json'),'utf8'),f.bytes);
});
test('existing local backups prevent offering an unrelated legacy database',async t=>{
 const f=fixture(t);fs.mkdirSync(f.current,{recursive:true});fs.writeFileSync(f.store.backupPath,JSON.stringify(defaultState()));
 assert.equal(await chooseLegacyData(f.store,()=>{throw Error('Recovery must use local backups');}),true);
 f.store.load();assert.equal(f.store.state.employees.length,0);assert.ok(f.store.recovery);
});
