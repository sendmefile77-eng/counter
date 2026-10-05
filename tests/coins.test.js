const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../src/shared/domain'),coins=require('../src/shared/coins');
const now=new Date('2026-10-05T12:00:00Z');
test('coin uses two equally sized outcomes and stores the exact question, answer, author and time before display',()=>{
 const state=d.defaultState(now);state.settings.operatorName='Начальник';const bounds=[];
 for(const [bit,answer] of [[0,'yes'],[1,'no']]){
  const result=coins.flip(state,{question:'  Перенести нараду?  '},now,bound=>{bounds.push(bound);return bit;});
  assert.equal(result.answer,answer);assert.equal(result.question,'Перенести нараду?');assert.equal(result.createdAt,now.toISOString());assert.equal(result.createdBy,'Начальник');assert.equal(result.method,coins.METHOD);
  assert.deepEqual(state.coinFlips.at(-1),result);assert.equal(state.audit.at(-1).action,'coin_flipped');
 }
 assert.deepEqual(bounds,[2,2]);assert.equal(state.coinSequence,2);assert.equal(new Set(state.coinFlips.map(item=>item.id)).size,2);
 const reload=d.normalizeState(d.clone(state),now);assert.deepEqual(reload.coinFlips,state.coinFlips);assert.equal(reload.coinSequence,2);
});
test('invalid coin requests and damaged backup histories are rejected without changing live data',()=>{
 const state=d.defaultState(now),before=d.clone(state);
 for(const input of [{question:'а'.repeat(301)}])assert.throws(()=>coins.flip(state,input,now));
 for(const bit of [-1,2,0.5,undefined])assert.throws(()=>coins.flip(state,{},now,()=>bit));assert.deepEqual(state,before);
 const record=coins.flip(state,{},now,()=>0);assert.equal(record.question,'');
 for(const patch of [{answer:'maybe'},{number:0},{createdAt:'invalid'},{method:'Math.random'},{question:'а'.repeat(301)}]) {
  const broken=d.clone(state);Object.assign(broken.coinFlips[0],patch);assert.throws(()=>d.normalizeState(broken,now),/монетки/);
 }
 const duplicate=d.clone(state);duplicate.coinFlips.push(d.clone(record));assert.throws(()=>d.normalizeState(duplicate,now),/монетки/);
 const legacy=d.clone(before);delete legacy.coinFlips;delete legacy.coinSequence;assert.deepEqual(d.normalizeState(legacy,now).coinFlips,[]);
});
test('coin history keeps the last 500 flips and a monotonic number across reloads',()=>{
 const state=d.defaultState(now);
 for(let i=0;i<=coins.LIMIT;i++)coins.flip(state,{question:'Питання '+i},now,()=>i%2);
 assert.equal(state.coinFlips.length,coins.LIMIT);assert.equal(state.coinFlips[0].number,2);assert.equal(state.coinSequence,501);
 const reload=d.normalizeState(d.clone(state),now),next=coins.flip(reload,{},now,()=>1);assert.equal(next.number,502);assert.equal(reload.coinFlips.length,500);
});
