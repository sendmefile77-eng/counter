(function installPresence(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.LadPresence = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function presenceFactory() {
  const labels = Object.freeze({onsite:'На роботі',zkp:'ЗКП',vacation:'Відпустка',sick:'Лікарняний',
    day_off:'Відгул',personal_permission:'Особисті справи',holiday:'Неробочий день'});
  const absent = new Set(['vacation','sick','day_off','personal_permission','holiday']);
  const working = new Set(['onsite','zkp']);
  const symbols = {onsite:'Р',zkp:'ЗКП',vacation:'ВП',sick:'ЛК',day_off:'ВГ',personal_permission:'ОС',holiday:'СВ'};
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value+'T12:00:00Z'))
    && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
  const key = (id,date) => id+'|'+date;
  // Explicit presence is authoritative. Old absence records remain readable
  // without rewriting the user's historical accounting or old backups.
  function get(state,id,date) {
    const explicit=state.presenceRecords?.[key(id,date)];
    if(explicit)return {...explicit,source:'presence'};
    const old=state.records?.[key(id,date)];
    return old&&absent.has(old.status)?{...old,source:'legacy_presence'}:null;
  }
  function normalize(input,state) {
    if(input==null)return {};
    if(typeof input!=='object'||Array.isArray(input))throw Error('Некоректний розділ «Наявність».');
    const result={};
    for(const [cell,item] of Object.entries(input)) {
      if(!item||cell!==key(item.employeeId,item.date)||!state.employees.some(person=>person.id===item.employeeId)
        ||!validDate(item.date)||!Object.hasOwn(labels,item.status)||typeof item.note!=='string'||item.note.length>500
        ||typeof item.actor!=='string'||item.actor.length>80||typeof item.recordedAt!=='string'||!Number.isFinite(Date.parse(item.recordedAt)))
        throw Error('Некоректна позначка в розділі «Наявність».');
      result[cell]={employeeId:item.employeeId,date:item.date,status:item.status,note:item.note,actor:item.actor,recordedAt:item.recordedAt};
    }
    return result;
  }
  function write(state,{employeeId,date,status,note=''},now=new Date()) {
    if(!state.employees.some(person=>person.id===employeeId)||!validDate(date)||!Object.hasOwn(labels,status))throw Error('Оберіть працівника, дату й статус наявності.');
    const record={employeeId,date,status,note:String(note).trim().slice(0,500),actor:state.settings.operatorName||'Керівник',recordedAt:now.toISOString()};
    state.presenceRecords||={};state.presenceRecords[key(employeeId,date)]=record;return record;
  }
  function clear(state,id,date) {
    delete state.presenceRecords?.[key(id,date)];
    // Clearing means clearing the presence mark, including an old absence.
    const old=state.records?.[key(id,date)];
    if(old&&absent.has(old.status)&&!old.receiptId)delete state.records[key(id,date)];
  }
  return {labels,absent,working,symbols,validDate,key,get,normalize,write,clear};
}));
