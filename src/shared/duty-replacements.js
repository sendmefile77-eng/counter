const crypto = require('node:crypto');
const d = require('./domain');
const planner = require('./planner');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = state => hash(state);
function scheduleView(state, id = state.activeDutyScheduleId) {
  const schedule = d.dutySchedules(state).find(item => item.id === id);
  if (!schedule) throw new Error('Графік не знайдено.');
  return { ...state, activeDutyScheduleId:id, duties:id === state.activeDutyScheduleId ? state.duties : schedule.data };
}
function idsOn(state, view, date) {
  return [...new Set(d.dutySchedules(state).flatMap(schedule =>
    (schedule.id === view.activeDutyScheduleId ? view.duties : schedule.id === state.activeDutyScheduleId ? state.duties : schedule.data).assignments[date]?.employeeIds || []))];
}
function cleanQuery(state, input, now) {
  const scheduleId = String(input.scheduleId || state.activeDutyScheduleId), date = input.date;
  if (!planner.validDate(date)) throw new Error('Оберіть коректну дату чергування.');
  const searchEndDate = input.searchEndDate || d.addDays(date,28);
  if (!planner.validDate(searchEndDate) || searchEndDate < date || searchEndDate > d.addDays(date,90)) throw new Error('Шукайте обмін у межах 90 днів від чергування.');
  const view = scheduleView(state,scheduleId), assignment = view.duties.assignments[date];
  const employeeId = String(input.employeeId || '');
  if (employeeId && !assignment?.employeeIds?.includes(employeeId)
    && !assignment?.replacementNeeds?.some(item => item.employeeId === employeeId)) throw new Error('Працівник уже не потребує заміни в цьому дні. Оновіть варіанти.');
  const today = planner.dateKey(now), searchStartDate = date<today ? date : [today,d.addDays(date,-28)].sort().at(-1);
  return { scheduleId,date,employeeId,searchStartDate,searchEndDate,today };
}
function planView(view, changes) {
  const assignments = { ...view.duties.assignments };
  for (const change of changes) assignments[change.date] = { ...assignments[change.date], date:change.date, employeeIds:change.after };
  return { ...view, duties:{ ...view.duties, assignments } };
}
function validateChanges(state, view, changes, today) {
  const proposed = planView(view,changes), rules = d.normalizeDutyRules(view.duties.rules), reasons = [];
  for (const change of changes) {
    const original = view.duties.assignments[change.date];
    if (change.date < today) reasons.push(`${change.date}: минуле чергування`);
    if (d.dutyDateLocked(view,change.date)) reasons.push(`${change.date}: тиждень заблоковано`);
    if (change.after.length > d.dutyRequiredCount(view,change.date)) reasons.push(`${change.date}: перевищено потрібний склад`);
    if (new Set(change.after).size !== change.after.length) reasons.push(`${change.date}: дубль працівника`);
    for (const id of change.before.filter(id => !change.after.includes(id))) {
      if (original?.realizedEmployeeIds?.includes(id)) reasons.push(`${change.date}: чергування вже виконано`);
    }
    for (const id of change.after.filter(id => !change.before.includes(id))) {
      const person = state.employees.find(person => person.id === id);
      if (!person?.active || !d.employeeExistsOnDate(person,change.date)) { reasons.push(`${change.date}: працівник недоступний у періоді роботи`); continue; }
      if (!view.duties.participantIds.includes(id)) { reasons.push(`${change.date}: працівник не бере участі в цьому графіку`); continue; }
      const other = d.dutySchedules(state).find(schedule => schedule.id !== view.activeDutyScheduleId
        && (schedule.id === state.activeDutyScheduleId ? state.duties : schedule.data).assignments[change.date]?.employeeIds?.includes(id));
      if (other) reasons.push(`${change.date}: уже чергує у графіку «${other.name}»`);
      reasons.push(...d.dutyCandidateConflicts(proposed,change.date,id,rules,date => idsOn(state,proposed,date)).map(reason => `${change.date}: ${reason}`));
    }
  }
  return [...new Set(reasons)];
}
function warningsFor(state, view, changes) {
  const warnings = [], rules = d.normalizeDutyRules(view.duties.rules), proposed = planView(view,changes);
  const noteException=date=>warnings.push(`${date}: діють збережені разові дозволи. ${view.duties.dayExceptions[date].note || 'Причину дозволу не зазначено.'}`);
  for (const change of changes) for (const id of change.after.filter(id => !change.before.includes(id))) {
    const name = state.employees.find(person => person.id === id)?.name || id;
    for (const task of (state.tasks || []).filter(task => planner.active(task) && task.assigneeIds.includes(id) && task.dueDate === change.date)) {
      warnings.push(`${name}, ${change.date}: ${task.priority === 'urgent' ? 'термінове ' : ''}завдання «${task.title}» зі строком${task.dueTime ? ` ${task.dueTime}` : ' до кінця дня'}. Перевірте сумісність робіт.`);
    }
    for (const entry of (state.timeOffEntries || []).filter(entry => entry.employeeId === id && entry.date === change.date)) {
      warnings.push(`${name}, ${change.date}: відлучення ${entry.startTime}–${entry.endTime}. Час чергування не задано; перевірте сумісність.`);
    }
    if (rules.minimumRestMode === 'prefer') for (let offset=1;offset<=rules.minimumRestDays;offset++) {
      if (idsOn(state,proposed,d.addDays(change.date,-offset)).includes(id) || idsOn(state,proposed,d.addDays(change.date,offset)).includes(id)) {
        warnings.push(`${name}, ${change.date}: відпочинок коротший за бажані ${rules.minimumRestDays} днів.`); break;
      }
    }
    const exception = view.duties.dayExceptions?.[change.date];
    if (exception && Object.entries(exception).some(([key,value]) => key.startsWith('allow') && value === true)) noteException(change.date);
    for(let offset=1;offset<=Math.max(1,rules.minimumRestDays);offset++) {
      const next=d.addDays(change.date,offset), permission=view.duties.dayExceptions?.[next];
      if(idsOn(state,proposed,next).includes(id) && (offset===1&&rules.preventConsecutiveDays&&permission?.allowConsecutiveDay
        ||rules.minimumRestMode==='require'&&offset<=rules.minimumRestDays&&permission?.allowRestGap))noteException(next);
    }
    if(rules.preventConsecutiveWeekends&&[0,6].includes(d.dayOfWeek(change.date))) {
      const saturday=d.dayOfWeek(change.date)===6?change.date:d.addDays(change.date,-1);
      for(let week=1;week<=rules.weekendRestWeeks;week++)for(const offset of [0,1]) {
        const next=d.addDays(saturday,7*week+offset);
        if(idsOn(state,proposed,next).includes(id)&&view.duties.dayExceptions?.[next]?.allowConsecutiveWeekend)noteException(next);
      }
    }
  }
  return [...new Set(warnings)];
}
function changedMetrics(fairness, changes) {
  const rows = fairness.rows.map(row => ({...row}));
  for (const change of changes) for (const row of rows) {
    const delta = Number(change.after.includes(row.employeeId)) - Number(change.before.includes(row.employeeId));
    row.total += delta; if ([0,6].includes(d.dayOfWeek(change.date))) row.weekends += delta;
  }
  const values = rows.map(row=>row.total);
  return { rows, spread:values.length ? Math.max(...values)-Math.min(...values) : 0, squares:values.reduce((sum,value)=>sum+value*value,0) };
}
function replacementGuidance(blocked,rejected,peopleCount) {
  const reasons=[...blocked,...rejected.flatMap(person=>[...person.reasons,...(person.swapRejections || []).flatMap(item=>item.reasons)])].join(' '),tips=[];
  if(/заблокован/.test(reasons))tips.push('Відкрийте склад відповідного дня й розблокуйте тиждень, якщо зміну погоджено. Після цього оновіть пошук.');
  if(/виконано|минуле/.test(reasons))tips.push('Перевірте факт виконання у складі дня. Заміна працює із запланованими датами; виконану роботу не слід переписувати як підміну.');
  if(/відпочинок|попереднього дня|наступного дня|уікенд/.test(reasons))tips.push('Перегляньте обміни на віддаленіші дати. Обмін прибирає обидва старі призначення перед перевіркою відпочинку.');
  if(/тижневий ліміт/.test(reasons))tips.push('Розширте пошук на інший тиждень або оберіть працівника з вільним місцем у тижневому ліміті.');
  if(/графіку|лікарнян|відпуст|недоступ|позначка|напередодні/.test(reasons))tips.push('Перевірте доступність та інші графіки кандидата. Виправляйте помилкову позначку лише за фактичними даними.');
  if(!peopleCount)tips.push('Додайте активних працівників до учасників цього графіка через «Учасники й підсумки».');
  if(!tips.length)tips.push('Перевірте склад дня, список учасників і період обміну. Якщо допустимого варіанта немає, залиште місце незаповненим до погодженого рішення.');
  return tips;
}
function getReplacementOptions(state, input, now = new Date()) {
  const query = cleanQuery(state,input,now), view = scheduleView(state,query.scheduleId), current = view.duties.assignments[query.date];
  const before = current?.employeeIds || [], replacing = before.includes(query.employeeId);
  const blocked = [];
  if (query.date < query.today) blocked.push('Минулі чергування змінюйте вручну після перевірки фактичного обліку.');
  if (d.dutyDateLocked(view,query.date)) blocked.push('Тиждень заблоковано. Спочатку розблокуйте його у складі дня.');
  if (replacing && current.realizedEmployeeIds?.includes(query.employeeId)) blocked.push('Це чергування вже виконано. Заміна не змінює фактичний облік.');
  if (!replacing && before.length >= d.dutyRequiredCount(view,query.date)) blocked.push('Склад дня вже заповнений. Оберіть конкретного чергового для заміни.');
  const period = { startDate:[`${query.date.slice(0,7)}-01`,query.searchStartDate].sort()[0], endDate:query.searchEndDate };
  const fairness = d.calculateDutyFairness(view,period), yearly = d.calculateDutyStatistics(view,query.date.slice(0,4));
  const rules = d.normalizeDutyRules(view.duties.rules), people = state.employees.filter(person => person.active && view.duties.participantIds.includes(person.id));
  const plans = [], rejected = [];
  const oldPerson = state.employees.find(person=>person.id===query.employeeId);
  const addPlan = (person,kind,changes) => {
    const reasons = validateChanges(state,view,changes,query.today);
    if (reasons.length) return reasons;
    const metrics = changedMetrics(fairness,changes), warnings = warningsFor(state,view,changes), proposed = planView(view,changes);
    const originalTotal = yearly.find(row=>row.employeeId===person.id)?.total || 0;
    const delta = changes.filter(change=>change.date.startsWith(query.date.slice(0,4))).reduce((sum,change)=>sum+Number(change.after.includes(person.id))-Number(change.before.includes(person.id)),0);
    const lastDuty = Object.values(proposed.duties.assignments).filter(item=>item.date<query.date && item.employeeIds.includes(person.id)).map(item=>item.date).sort().at(-1) || null;
    const rest = lastDuty ? Math.round((Date.parse(query.date)-Date.parse(lastDuty))/86400000)-1 : null;
    const partnerIds = changes[0].after.filter(id=>id!==person.id), pairStart = d.dutyPairHistoryStart(rules,query.date);
    const pairRepeats = rules.avoidRepeatedPairs ? Object.values(proposed.duties.assignments).filter(item=>item.date>=pairStart && item.date<query.date && item.employeeIds.includes(person.id)).reduce((sum,item)=>sum+partnerIds.filter(id=>item.employeeIds.includes(id)).length,0) : 0;
    const score = rules.planningPriority === 'rest' ? [warnings.length,-(rest??99999),metrics.spread,metrics.squares,pairRepeats]
      : rules.planningPriority === 'rotation' ? [warnings.length,lastDuty ? Date.parse(lastDuty) : 0,metrics.spread,metrics.squares,pairRepeats]
      : rules.planningPriority === 'pairs' ? [warnings.length,pairRepeats,metrics.spread,metrics.squares,originalTotal+delta]
      : [warnings.length,metrics.spread,metrics.squares,originalTotal+delta,pairRepeats];
    const id = hash({kind,candidateId:person.id,changes});
    plans.push({ id,kind,candidateId:person.id,candidateName:person.name,changes,warnings,score,
      reasons:[`Доступний на ${query.date}; обов’язкові правила перевірено для нових призначень в обох напрямках і сусідніх дат.`,
        `Різниця кількості чергувань у періоді: ${fairness.spread} → ${metrics.spread}.`,
        `Черговому ${person.name} за ${query.date.slice(0,4)} рік у цьому графіку: ${originalTotal} → ${originalTotal+delta} (разом із початковим підсумком).`,
        lastDuty ? `Попереднє чергування в цьому графіку: ${lastDuty}; відпочинок до дня заміни: ${rest} дн.` : 'Попередніх дат чергування в цьому графіку немає.',
        kind === 'swap' ? `Обмін двома датами. Кількість чергових: ${changes.map(change=>`${change.date}: ${change.before.length} → ${change.after.length}`).join('; ')}.` : replacing ? 'Зміниться одна людина в одному дні.' : 'Буде заповнено одне вільне місце.'],
      metrics:{ period,beforeSpread:fairness.spread,afterSpread:metrics.spread,rows:metrics.rows,year:query.date.slice(0,4),yearBefore:originalTotal,yearAfter:originalTotal+delta } });
    return [];
  };
  if (!blocked.length) for (const person of people) {
    if (person.id === query.employeeId || before.includes(person.id)) continue;
    const target = {date:query.date,before:[...before],after:replacing ? before.map(id=>id===query.employeeId ? person.id : id) : [...before,person.id]};
    const directReasons = addPlan(person,'direct',[target]); let swapCount=0; const swapRejections=[];
    if (oldPerson?.active) for (const assignment of Object.values(view.duties.assignments)) {
      if (assignment.date === query.date || assignment.date < query.searchStartDate || assignment.date > query.searchEndDate || !assignment.employeeIds.includes(person.id) || assignment.employeeIds.includes(query.employeeId)) continue;
      const other = {date:assignment.date,before:[...assignment.employeeIds],after:assignment.employeeIds.map(id=>id===person.id ? query.employeeId : id)};
      const reasons=addPlan(person,'swap',[target,other]);
      if (!reasons.length) swapCount++; else if(swapRejections.length<5)swapRejections.push({date:assignment.date,reasons});
    }
    if (directReasons.length && !swapCount) rejected.push({employeeId:person.id,name:person.name,reasons:directReasons,swapRejections});
  }
  plans.sort((a,b)=>{for(let i=0;i<a.score.length;i++)if(a.score[i]!==b.score[i])return a.score[i]-b.score[i];return a.changes.length-b.changes.length || a.candidateName.localeCompare(b.candidateName,'uk') || a.id.localeCompare(b.id);});
  return { query,token:fingerprint(state),scheduleName:d.dutySchedules(state).find(schedule=>schedule.id===query.scheduleId).name,
    employeeName:oldPerson?.name || '', vacancy:!replacing, priority:rules.planningPriority, period, blocked, plans:plans.slice(0,100), totalPlans:plans.length, rejected,
    guidance:replacementGuidance(blocked,rejected,people.length) };
}
function applyReplacement(state,input,now = new Date()) {
  if (!input.expectedToken || fingerprint(state)!==input.expectedToken) throw new Error('Дані змінилися. Оновіть варіанти заміни перед застосуванням.');
  const reason = String(input.reason || '').trim();
  if (!reason || reason.length>500) throw new Error('Вкажіть причину заміни від 1 до 500 символів.');
  const report = getReplacementOptions(state,input.query,now), plan = report.plans.find(plan=>plan.id===input.proposalId);
  if (!plan) throw new Error('Цей варіант більше не доступний. Оновіть пошук.');
  if (plan.warnings.length && input.acknowledgeWarnings !== true) throw new Error('Перевірте попередження та підтвердьте, що врахували їх.');
  const view = scheduleView(state,report.query.scheduleId), actor = state.settings.operatorName || 'Керівник';
  const decision = {kind:plan.kind,reason,actor,createdAt:now.toISOString(),changes:d.clone(plan.changes),reasons:plan.reasons,warnings:plan.warnings,metrics:plan.metrics};
  for (const change of plan.changes) {
    const previous = view.duties.assignments[change.date] || {};
    view.duties.assignments[change.date] = { ...previous,date:change.date,employeeIds:[...change.after],
      realizedEmployeeIds:(previous.realizedEmployeeIds || []).filter(id=>change.after.includes(id)),
      singleApproved:change.after.length===1 && Boolean(previous.singleApproved),source:'manual_replacement',manualEmployeeIds:[...change.after],
      previousNote:previous.note || '',note:reason,updatedAt:now.toISOString(),
      replacementNeeds:(previous.replacementNeeds || []).filter((item,index)=>report.query.employeeId ? item.employeeId!==report.query.employeeId : index>0) };
  }
  for (const change of plan.changes) {
    const assignment = view.duties.assignments[change.date];
    assignment.explanation = d.explainDutyAssignment(view,change.date,assignment.employeeIds,{now,provenance:'manual'});
    assignment.explanation.replacement = decision;
  }
  state.audit.push({id:crypto.randomUUID(),at:now.toISOString(),action:'duty_replacement_applied',details:{scheduleId:report.query.scheduleId,employeeId:report.query.employeeId,...decision}});
  if(state.audit.length>5000)state.audit=state.audit.slice(-5000);
  return {scheduleId:report.query.scheduleId,dates:plan.changes.map(change=>change.date),decision};
}
module.exports = { scheduleView, fingerprint, getReplacementOptions, applyReplacement, warningsFor };
