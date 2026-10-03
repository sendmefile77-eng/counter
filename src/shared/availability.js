const crypto=require('node:crypto');
const d=require('./domain');
const staff=require('./staff-changes');
const r=require('./duty-replacements');
const absence=input=>(input.action || 'status')==='status'&&staff.ABSENCES.has(input.status);
const draftOf=state=>{const draft=d.clone(state);const active=draft.dutySchedules.find(item=>item.id===draft.activeDutyScheduleId);if(active)active.data=draft.duties;return draft;};
function previewBatch(state,input,now=new Date()) {
  if(!absence(input))return d.previewJournalBatch(state,input,now);
  const reason=String(input.note || '').trim();
  if(!reason||reason.length>500)throw new Error('Вкажіть причину відсутності від 1 до 500 символів. Вона збережеться разом із підмінами.');
  const cells=d.journalBatchTargets(state,input), shadow=draftOf(state);
  // Use the existing calendar/selection rules; inspect original assignments below.
  const targets=new Set(cells.map(cell=>d.recordKey(cell.employeeId,cell.date)));
  for(const schedule of d.dutySchedules(shadow))for(const item of Object.values(schedule.data.assignments))item.employeeIds=item.employeeIds.filter(id=>!targets.has(d.recordKey(id,item.date)));
  const base=d.previewJournalBatch(shadow,input,now), blocked=[...base.blocked], blockedKeys=new Set(blocked.map(cell=>d.recordKey(cell.employeeId,cell.date)));
  const effects=[];
  for(const employeeId of new Set(base.changes.map(cell=>cell.employeeId))) {
    const dates=base.changes.filter(cell=>cell.employeeId===employeeId).map(cell=>cell.date), change={kind:'status',employeeId,status:input.status,reason};
    const impact=staff.inspectStaffEffects(state,change,dates,now);
    for(const duty of impact.duties)if(duty.locked||duty.realized||duty.past) {
      const cell=base.changes.find(cell=>cell.employeeId===employeeId&&cell.date===duty.date),key=d.recordKey(employeeId,duty.date);
      if(!blockedKeys.has(key)){blocked.push({...cell,reason:duty.locked?`«${duty.scheduleName}»: тиждень заблоковано. Відкрийте день і розблокуйте його.`:`«${duty.scheduleName}»: минуле або виконане чергування. Перевірте фактичний облік у складі дня.`});blockedKeys.add(key);}
    }
    effects.push({employeeId,...impact});
  }
  const changes=base.changes.filter(cell=>!blockedKeys.has(d.recordKey(cell.employeeId,cell.date)));
  const allowed=new Set(changes.map(cell=>d.recordKey(cell.employeeId,cell.date)));
  const duties=effects.flatMap(effect=>effect.duties.filter(item=>allowed.has(d.recordKey(effect.employeeId,item.date))));
  for(const duty of duties)duty.after=duty.before.filter(id=>!duties.some(other=>other.scheduleId===duty.scheduleId&&other.date===duty.date&&other.employeeId===id));
  const taskMap=new Map();for(const effect of effects)for(const task of effect.tasks)if(allowed.has(d.recordKey(effect.employeeId,task.dueDate)))taskMap.set(task.id,task);
  const query={...input,expectedToken:undefined};
  const token=crypto.createHash('sha256').update(JSON.stringify({state:r.fingerprint(state),query,today:d.dateKeyFromDate(now)})).digest('hex');
  return {...base,token,changes,blocked,count:changes.length,canApply:changes.length>0&&(input.skipBlocked===true||blocked.length===0),duties,tasks:[...taskMap.values()],availability:true};
}
function applyBatch(state,input,now=new Date()) {
  if(!absence(input))return d.applyJournalBatch(state,input,now);
  const report=previewBatch(state,input,now);
  if(!input.expectedToken||input.expectedToken!==report.token)throw new Error('Дані або умови змінилися. Натисніть «Перевірити клітинки» ще раз.');
  if(!report.canApply)throw new Error(report.blocked[0]?.reason || 'Немає клітинок для зміни.');
  const draft=draftOf(state),reason=String(input.note).trim();
  for(const employeeId of new Set(report.changes.map(cell=>cell.employeeId)))staff.removeAffectedDuties(draft,report.duties.filter(item=>item.employeeId===employeeId),employeeId,reason,now);
  d.applyJournalBatch(draft,{...input,cells:report.changes.map(({employeeId,date})=>({employeeId,date})),expectedToken:undefined,skipBlocked:false},now);
  for(const duty of report.duties){const view=r.scheduleView(draft,duty.scheduleId),item=view.duties.assignments[duty.date];item.explanation=d.explainDutyAssignment(view,duty.date,item.employeeIds,{now,provenance:'manual'});}
  draft.audit.push({id:crypto.randomUUID(),at:now.toISOString(),action:'availability_batch_applied',details:{status:input.status,reason,actor:state.settings.operatorName,duties:report.duties,tasks:report.tasks,count:report.count}});
  draft.audit=draft.audit.slice(-5000);Object.assign(state,draft);return report;
}
function periodInput(input){return {...input,employeeIds:[input.employeeId],action:'status',note:input.note || '',includeWeekends:false,replaceExisting:true};}
function previewPeriod(state,input,now=new Date()) {
  if(!staff.ABSENCES.has(input.status))return d.previewManualStatuses(state,input,now);
  const report=previewBatch(state,periodInput(input),now);return {...report,dates:report.changes.map(cell=>cell.date)};
}
function applyPeriod(state,input,now=new Date()) {
  if(!staff.ABSENCES.has(input.status))return d.setManualStatuses(state,input,now);
  const report=applyBatch(state,periodInput(input),now);return {...report,dates:report.changes.map(cell=>cell.date)};
}
module.exports={previewBatch,applyBatch,previewPeriod,applyPeriod};
