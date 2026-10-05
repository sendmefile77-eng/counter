const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../src/shared/domain');
const now=new Date('2026-10-05T12:00:00Z');
test('employee color follows their identity through reorder, rename, archive, reload and reset',()=>{
 const state=d.defaultState(now),person=d.createEmployee(state,'Олена Коваль',now);d.createEmployee(state,'Петро Бондар',now);
 d.setEmployeeDutyColor(state,person.id,'#AA33EE',now);assert.equal(person.dutyColor,'#aa33ee');assert.equal(state.audit.at(-1).details.employeeId,person.id);
 d.moveEmployee(state,person.id,1,now);d.renameEmployee(state,person.id,'Олена Петренко',now);d.archiveEmployee(state,person.id,now);
 const reload=d.normalizeState(d.clone(state),now),saved=reload.employees.find(item=>item.id===person.id);assert.equal(saved.dutyColor,'#aa33ee');
 d.setEmployeeDutyColor(reload,person.id,null,now);assert.equal(saved.dutyColor,null);assert.equal(reload.employees.find(item=>item.id!==person.id).dutyColor,null);
});
test('invalid colors and damaged backup values are rejected without changing employee data',()=>{
 const state=d.defaultState(now),person=d.createEmployee(state,'Олена',now),before=d.clone(state);
 for(const color of ['red','#fff','#11223344','url(foo)',{},undefined]){assert.throws(()=>d.setEmployeeDutyColor(state,person.id,color,now));assert.deepEqual(state,before);}
 const broken=d.clone(state);broken.employees[0].dutyColor='red';assert.throws(()=>d.normalizeState(broken,now),/колір/);
 const legacy=d.clone(state);delete legacy.employees[0].dutyColor;assert.equal(d.normalizeState(legacy,now).employees[0].dutyColor,null);
});
