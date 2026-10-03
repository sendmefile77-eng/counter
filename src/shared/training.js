const d=require('./domain');
const tasks=require('./tasks');
function createTrainingState(now=new Date()) {
  const state=d.defaultState(now),today=d.dateKeyFromDate(now),date=d.addDays(today,4),swapDate=d.addDays(date,1);
  state.settings.automaticClose=false;state.settings.taskRemindersEnabled=false;state.settings.operatorName='Навчальний приклад';state.settings.onboardingSeen=true;
  const people=['Олена Коваль','Петро Бондар','Ірина Шевченко','Дмитро Мельник','Марія Петренко','Іван Романенко'].map(name=>d.createEmployee(state,`${name} · навчання`,now));
  d.initializeDutyHistory(state,people.map(person=>({employeeId:person.id,total:0,realized:0})),people.map(person=>person.id),now);
  state.duties.baselineThroughDate=d.addDays(today,-1);
  d.updateDutyScheduleRules(state,state.activeDutyScheduleId,{weekdayDutyCount:1,weekendDutyCount:1,minimumRestMode:'require',minimumRestDays:2,maximumDutiesPerWeek:1,preventConsecutiveWeekends:false},now);
  d.setDutyAssignment(state,{date,employeeIds:[people[0].id],note:'Навчальне призначення'},now);
  d.setDutyAssignment(state,{date:swapDate,employeeIds:[people[1].id],note:'Дата для навчального обміну'},now);
  tasks.createTask(state,{title:'Навчання: підготувати звіт',description:'Перевірте строк і виконавця після запису відсутності.',dueDate:date,priority:'urgent',assigneeIds:[people[0].id]},now);
  return {state,scenario:{date,swapDate,employeeId:people[0].id,candidateId:people[1].id}};
}
module.exports={createTrainingState};
