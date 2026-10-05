const presenceUi={date:null,query:'',filter:'all',view:'day',draft:null,report:null,busy:false,revision:0};
const presenceMark=(id,date)=>LadPresence.get(snapshot,id,date);
function presenceBadge(mark,date) {
  const status=mark?.status,label=LadPresence.labels[status]||'Не позначено';
  return `<span class="presence-badge presence-${h(status||'pending')}">${date>localDateKey()?'<span class="sr-only">Заплановано: </span>':''}${h(label)}</span>`;
}
function renderPresencePage() {
  const date=presenceUi.date||localDateKey(),people=activeEmployees(),rows=people.map(person=>({person,mark:presenceMark(person.id,date)}));
  const present=rows.filter(row=>LadPresence.working.has(row.mark?.status)).length,zkp=rows.filter(row=>row.mark?.status==='zkp').length;
  const absent=rows.filter(row=>LadPresence.absent.has(row.mark?.status)).length,missing=rows.filter(row=>!row.mark).length;
  const filtered=rows.filter(row=>row.person.name.toLocaleLowerCase('uk-UA').includes(presenceUi.query.toLocaleLowerCase('uk-UA'))
    &&(presenceUi.filter==='all'||presenceUi.filter==='working'&&LadPresence.working.has(row.mark?.status)||presenceUi.filter==='zkp'&&row.mark?.status==='zkp'
      ||presenceUi.filter==='absent'&&LadPresence.absent.has(row.mark?.status)||presenceUi.filter==='pending'&&!row.mark));
  const monday=dutyWeekStart(date),dates=Array.from({length:7},(_,i)=>shiftDate(monday,i));
  const history=(snapshot.audit||[]).filter(item=>item.action==='presence_changed').slice(-8).reverse();
  return `<header class="page-header"><div><span class="page-eyebrow">Доступність команди</span><h1>Наявність</h1><p>Одна позначка для табеля, віджета, аналітики й усіх графіків чергувань.</p></div><div class="button-row"><button class="button primary" data-presence-new ${people.length?'':'disabled'}>+ Позначити день / період</button><button class="button" data-tab="journal">Табель →</button></div></header>
  <section class="panel presence-toolbar"><div class="button-row"><button class="button small" data-presence-shift="-1" aria-label="Попередній день">←</button><label class="field"><span>Дата наявності</span><input type="date" data-presence-date value="${date}" required></label><button class="button small" data-presence-shift="1" aria-label="Наступний день">→</button><button class="button small" data-presence-today>Сьогодні</button></div><div class="button-row">${[['day','За день'],['week','Тиждень']].map(([key,label])=>`<button class="button small ${presenceUi.view===key?'primary':''}" data-presence-view="${key}" aria-pressed="${presenceUi.view===key}">${label}</button>`).join('')}</div></section>
  ${date>localDateKey()?'<p class="confirm-box">Майбутня дата: це план наявності. До фактичних днів роботи він ще не додається.</p>':''}
  <div class="presence-summary">${[['all','Уся команда',people.length],['working','Працюють',present],['zkp','Із них на ЗКП',zkp],['absent','Відсутні',absent],['pending','Не позначено',missing]].map(([key,label,count])=>`<button data-presence-filter="${key}" class="${presenceUi.filter===key?'active':''}"><span>${label}</span><strong>${count}</strong></button>`).join('')}</div>
  ${renderConsequenceBanner()}
  <section class="panel"><div class="work-section-head"><h2>${presenceUi.view==='week'?`${h(formatDate(dates[0]))} — ${h(formatDate(dates[6]))}`:h(formatDate(date,{weekday:'long',day:'numeric',month:'long'}))}</h2><label class="field"><span class="sr-only">Знайти працівника</span><input type="search" data-presence-query value="${h(presenceUi.query)}" placeholder="Знайти працівника"></label></div>
  <div class="table-scroll"><table class="data-table presence-table"><thead><tr><th>Працівник</th>${presenceUi.view==='week'?dates.map(day=>`<th class="presence-calendar-day ${day===date?'selected':''}">${h(formatDate(day,{weekday:'short'}))}<br>${h(formatDate(day,{day:'numeric',month:'short'}))}</th>`).join(''):'<th>Наявність</th><th>Чергування</th><th>Підстава / примітка</th><th>Дія</th>'}</tr></thead><tbody>${filtered.map(({person,mark})=>`<tr><th>${h(person.name)}</th>${presenceUi.view==='week'?dates.map(day=>{
    const item=presenceMark(person.id,day),label=LadPresence.labels[item?.status]||'Не позначено';
    return `<td class="presence-calendar-day ${day===date?'selected':''}"><button class="presence-cell presence-${h(item?.status||'pending')}" data-presence-edit="${h(person.id)}" data-presence-cell-date="${day}" aria-label="${h(person.name+', '+formatDate(day)+': '+label)}" title="${h(label+(item?.note?' · '+item.note:''))}">${h(LadPresence.symbols[item?.status]||'·')}</button></td>`;
  }).join(''):`<td>${presenceBadge(mark,date)}${mark?.status==='zkp'?'<small>Працює в іншому офісі</small>':''}</td><td>${LadPresence.absent.has(mark?.status)?'<span class="presence-unavailable">Недоступний</span>':mark?'<span>Наявність дозволяє</span>':'<span class="muted">Немає обмеження</span>'}</td><td><span>${h(mark?.note||'—')}</span>${mark?.actor?`<small>${h(mark.actor)}</small>`:''}${mark?.source==='legacy_presence'?'<small>Позначка з попереднього табеля</small>':''}</td><td><button class="button small" data-presence-edit="${h(person.id)}" data-presence-cell-date="${date}">${mark?'Змінити':'Позначити'}</button></td>`}</tr>`).join('')||`<tr><td colspan="${presenceUi.view==='week'?8:5}"><p class="muted">${people.length?'За цими умовами працівників немає.':'Додайте працівників у розділі «Працівники».'}</p></td></tr>`}</tbody></table></div>
  <p class="muted">ЗКП — повноцінний робочий день, чергування дозволено. Решта правил графіка діє окремо. Відсутність охоплює календарні дні, включно з вихідними.</p></section>
  <section class="panel presence-explainer"><h2>Як це враховується</h2><p>«Наявність» має пріоритет над ручною позначкою роботи та роботою над проєктами. Відпустка, лікарняний, відгул, особисті справи, неробочий день виключають людину з чергувань. Робота над проєктами зберігається; відсутність не стає пропуском.</p><p>«На роботі» та «ЗКП» зараховують день за робочим календарем. Для роботи у вихідний спочатку зробіть дату робочою в табелі. Без позначки наявності зберігається поточний облік роботи.</p></section>
  <section class="panel"><h2>Останні зміни наявності</h2>${history.map(item=>`<article class="presence-history"><strong>${h(item.details.employeeIds.map(id=>employeeById(id)?.name||id).join(', '))}</strong><span>${h(formatDate(item.details.startDate))} — ${h(formatDate(item.details.endDate))} · ${h(item.details.action==='clear'?'Позначку очищено':LadPresence.labels[item.details.status])}</span><p>${h(item.details.reason)}</p><small>${h(item.details.actor)} · ${h(new Date(item.at).toLocaleString('uk-UA'))}</small></article>`).join('')||'<p class="muted">Нові зміни зберігатимуть тут підставу, автора й час.</p>'}</section>`;
}
function presenceInput(form) {
  const data=new FormData(form),status=String(data.get('status')||'');
  return {employeeIds:data.getAll('employeeIds').map(String),startDate:String(data.get('startDate')||''),endDate:String(data.get('endDate')||''),
    action:status==='clear'?'clear':'set',status:status==='clear'?null:status,reason:String(data.get('reason')||'')};
}
function openPresenceForm(input={}) {
  presenceUi.revision++;presenceUi.busy=false;
  const date=input.startDate||input.date||presenceUi.date||localDateKey(),existing=input.employeeId?presenceMark(input.employeeId,date):null;
  presenceUi.draft={...input,employeeIds:input.employeeIds||[input.employeeId||activeEmployees()[0]?.id].filter(Boolean),startDate:date,endDate:input.endDate||date,
    status:input.status||existing?.status||'onsite',reason:input.reason||existing?.note||''};
  presenceUi.report=null;renderPresenceForm();
}
function presencePreviewHtml(report) {
  const duties=[...new Map(report.duties.map(duty=>[duty.scheduleId+'|'+duty.date,duty])).values()];
  return `<section class="staff-impact" data-presence-impact><h3>Перевірка перед збереженням</h3><p><strong>${report.count}</strong> позначок; <strong>${duties.length}</strong> днів графіків потребують заміни; <strong>${report.tasks.length}</strong> завдань — перевірки.</p>${report.skipped.length?`<p>Пропущено ${report.skipped.length} дат поза періодом роботи працівника.</p>`:''}${report.blockers.length?`<div class="confirm-box" role="alert"><ul>${report.blockers.map(reason=>`<li>${h(reason)}</li>`).join('')}</ul></div>`:''}<details><summary>Перевірити позначки</summary><ul>${report.cells.slice(0,30).map(cell=>`<li>${h(cell.name)} · ${h(formatDate(cell.date))}: ${h(LadPresence.labels[cell.before?.status]||'Не позначено')} → ${h(LadPresence.labels[cell.after]||'Без позначки наявності')}</li>`).join('')}</ul>${report.count>30?`<p>Показано перші 30 із ${report.count} позначок.</p>`:''}</details>${duties.length?`<ul>${duties.map(duty=>`<li>${h(duty.scheduleName)} · ${h(formatDate(duty.date))}: ${h(duty.before.map(id=>employeeById(id)?.name||id).join(', '))} → ${h(duty.after.map(id=>employeeById(id)?.name||id).join(', ')||'Потрібні чергові')}</li>`).join('')}</ul><p>Заплановані призначення буде знято з відсутніх. Оберіть заміни в «Наслідках змін».</p>`:''}${report.tasks.length?`<ul>${report.tasks.map(task=>`<li>${h(task.title)} · ${h(formatDate(task.dueDate))}</li>`).join('')}</ul><p>Завдання збережуться. Перевірте їх строки й виконавців.</p>`:''}</section>`;
}
function renderPresenceForm() {
  const draft=presenceUi.draft,people=snapshot.employees.filter(person=>person.active||draft.employeeIds.includes(person.id));
  openManagementModal(`<form id="presence-form"><header class="modal-head"><div><span class="page-eyebrow">Єдина позначка для всіх розділів</span><h2>Наявність працівників</h2><p>Один день або період до 366 календарних днів.</p></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body task-form-body"><fieldset class="presence-picker"><legend>Працівники</legend><button class="button small" type="button" data-presence-pick-all>Вибрати / зняти всіх</button><div>${people.map(person=>`<label class="check-row"><input type="checkbox" name="employeeIds" value="${h(person.id)}" ${draft.employeeIds.includes(person.id)?'checked':''}><span>${h(person.name)}${person.active?'':' · архів'}</span></label>`).join('')}</div></fieldset><div class="form-grid"><label class="field"><span>Від</span><input type="date" name="startDate" value="${h(draft.startDate)}" required></label><label class="field"><span>До включно</span><input type="date" name="endDate" value="${h(draft.endDate)}" required></label></div><label class="field"><span>Наявність</span><select name="status">${[...Object.entries(LadPresence.labels),['clear','Очистити позначку наявності']].map(([value,label])=>`<option value="${value}" ${draft.status===value?'selected':''}>${h(label)}</option>`).join('')}</select></label><p class="muted">ЗКП: працює в іншому офісі та може чергувати. Очищення поверне облік за роботою й ручними позначками; минулий день без роботи може знову потребувати позначки.</p><label class="field"><span>Підстава / пояснення *</span><textarea name="reason" rows="2" maxlength="500" required placeholder="Наприклад, відпустка за наказом або робота на ЗКП">${h(draft.reason)}</textarea></label>${presenceUi.report?presencePreviewHtml(presenceUi.report):'<p class="muted">Перевірте наслідки перед збереженням: будуть враховані всі графіки.</p>'}<p data-presence-error role="alert" hidden></p></div><footer class="modal-foot three-way"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button" type="submit" ${presenceUi.busy?'disabled':''}>Перевірити наслідки</button><button class="button primary" type="button" data-presence-apply ${!presenceUi.report?.canApply||presenceUi.busy?'disabled':''}>Зберегти наявність</button></footer></form>`,true);
}
function invalidatePresence(form) {
  if(!form)return;
  const input=presenceInput(form);presenceUi.draft={...input,status:input.action==='clear'?'clear':input.status};presenceUi.report=null;
  form.querySelector('[data-presence-apply]').disabled=true;form.querySelector('[data-presence-impact]')?.remove();
}
async function handlePresenceClick(event) {
  const target=event.target;
  if(target.closest('[data-presence-new]')){openPresenceForm();return true;}
  const edit=target.closest('[data-presence-edit]');if(edit){openPresenceForm({employeeId:edit.dataset.presenceEdit,date:edit.dataset.presenceCellDate});return true;}
  const shift=target.closest('[data-presence-shift]');if(shift){presenceUi.date=shiftDate(presenceUi.date||localDateKey(),Number(shift.dataset.presenceShift));renderShell();return true;}
  if(target.closest('[data-presence-today]')){presenceUi.date=localDateKey();renderShell();return true;}
  const filter=target.closest('[data-presence-filter]');if(filter){presenceUi.filter=filter.dataset.presenceFilter;renderShell();return true;}
  const view=target.closest('[data-presence-view]');if(view){presenceUi.view=view.dataset.presenceView;renderShell();return true;}
  if(target.closest('[data-presence-pick-all]')){const form=target.closest('form'),inputs=[...form.querySelectorAll('[name="employeeIds"]')],check=inputs.some(input=>!input.checked);inputs.forEach(input=>input.checked=check);invalidatePresence(form);return true;}
  const apply=target.closest('[data-presence-apply]');if(apply){
    if(presenceUi.busy||!presenceUi.report?.canApply)return true;
    presenceUi.busy=true;const form=apply.form,report=presenceUi.report,revision=presenceUi.revision;
    form.querySelectorAll('input,select,textarea,button').forEach(control=>control.disabled=true);
    const result=await run(()=>window.counter.applyPresence({change:report.change,expectedToken:report.token}),null);
    if(revision===presenceUi.revision){presenceUi.busy=false;presenceUi.report=null;}
    if(result){if(form.isConnected){closeModal(form);ui.tab='presence';presenceUi.date=result.change.startDate;renderShell();}showToast('Наявність збережено для всіх розділів.',{undo:true});}
    else if(form.isConnected){form.querySelectorAll('input,select,textarea,button').forEach(control=>control.disabled=false);invalidatePresence(form);const error=form.querySelector('[data-presence-error]');error.hidden=false;error.textContent='Не вдалося зберегти. Перевірте наслідки ще раз.';}
    return true;
  }
  return false;
}
function handlePresenceInput(event) {
  const input=event.target,form=input.closest('#presence-form');
  if(form){invalidatePresence(form);return true;}
  if(input.matches('[data-presence-query]')){const cursor=input.selectionStart;presenceUi.query=input.value;renderShell();const next=appRoot.querySelector('[data-presence-query]');next.focus();next.setSelectionRange(cursor,cursor);return true;}
  return false;
}
function handlePresenceChange(event) {
  const input=event.target;
  if(input.matches('[data-presence-date]')){if(LadPresence.validDate(input.value)){presenceUi.date=input.value;renderShell();}return true;}
  if(input.closest('#presence-form')){invalidatePresence(input.form);return true;}
  return false;
}
async function handlePresenceSubmit(event) {
  const form=event.target;if(form.id!=='presence-form')return false;
  if(presenceUi.busy)return true;
  presenceUi.busy=true;const revision=presenceUi.revision,input=presenceInput(form),submitted=JSON.stringify(input);presenceUi.draft={...input,status:input.action==='clear'?'clear':input.status};
  form.querySelector('[type="submit"]').disabled=true;
  try {
    const report=await window.counter.previewPresence(input);
    if(revision===presenceUi.revision&&form.isConnected&&submitted===JSON.stringify(presenceInput(form))){presenceUi.report=report;presenceUi.busy=false;renderPresenceForm();modalRoot.querySelector('[data-presence-impact]')?.scrollIntoView({block:'nearest'});}
    else if(form.isConnected)form.querySelector('[type="submit"]').disabled=false;
  }catch(error){if(form.isConnected){const notice=form.querySelector('[data-presence-error]');notice.textContent=error.message;notice.hidden=false;form.querySelector('[type="submit"]').disabled=false;}}
  finally{if(revision===presenceUi.revision)presenceUi.busy=false;}
  return true;
}
