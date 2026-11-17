const d=require('../../src/shared/domain'),p=require('../../src/shared/productivity'),presence=require('../../src/shared/presence'),tasks=require('../../src/shared/tasks');
const now=new Date('2026-11-17T12:00:00Z');
function fixture(mode='demo'){
 const state=d.defaultState(now);state.settings.onboardingSeen=true;
 const names=mode==='worst'?['Олександра-Єлизавета Костянтинівна Вернигора-Заболотна','Юлія_О','Юлія_С','Лі','👩🏽‍💻 Анна','Олена <тест> & підтримка','Đặng Thị Ngọc Hân','王秀英','Віктор','Ганна','Наталія','Оксана','Максим','Тетяна','Софія']:['Олена','Віктор','Юлія_О','Юлія_С'];
 const people=names.slice(0,mode==='empty'?0:mode==='one'?1:names.length).map((name,i)=>{
  const person=d.createEmployee(state,name,new Date('2026-10-01T09:00:00Z'));
  person.profile={...person.profile,fullName:name,position:i===0?'Провідна аналітикиня з координації міжвідомчих інформаційно-аналітичних досліджень':'',department:i===0?'Сектор стратегічного аналізу та опрацювання інформації з відкритих джерел':'',birthDate:i===0?'1990-05-12':''};
  p.setObjects(state,{employeeId:person.id,date:'2026-11-16',count:mode==='worst'&&i===0?100000:i+1,expectedCount:0,reason:'Синтетичний результат для перевірки інтерфейсу'},now);return person;
 });
 if(people[0]){
  for(const [i,status] of ['zkp','sick','vacation','day_off','arkan','special_assignment'].entries())if(people[i])presence.write(state,{employeeId:people[i].id,date:'2026-11-17',status,note:status==='special_assignment'?'Підготовка міжвідомчої аналітичної довідки':''},now);
  for(let i=0;i<(mode==='worst'?1000:3);i++)tasks.createTask(state,{title:i===0?'Перевірити матеріали міжвідомчого аналізу й погодити остаточні висновки перед передачею керівнику':`Завдання для перевірки № ${i+1}`,assigneeIds:[people[0].id],dueDate:'2026-11-18'},now);
 }
 if(mode==='legacy'&&people[0])state.records[people[0].id+'|2026-11-02']={employeeId:people[0].id,date:'2026-11-02',status:'submitted',receiptId:'legacy-unknown'};
 return {state,people,now};
}
module.exports={fixture};
