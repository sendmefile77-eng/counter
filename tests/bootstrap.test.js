const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/main/bootstrap.js'),'utf8');
for (const lock of [false,true]) test(`bootstrap ${lock ? 'loads the main process after obtaining the single instance lock' : 'quits the second process before loading or writing application data'}`,()=>{
  const calls=[];
  const app={requestSingleInstanceLock(){calls.push('lock');return lock;},quit(){calls.push('quit');},disableHardwareAcceleration(){calls.push('disable-gpu');}};
  vm.runInNewContext(source,{process:{platform:'win32'},require(name){if(name==='electron')return{app};assert.equal(name,'./main');calls.push('main');}});
  assert.deepEqual(calls,lock?['lock','disable-gpu','main']:['lock','quit']);
});
