const workUi = { filter:'active', query:'', pending:new Set(), settingsPending:false };
const workById = id => (snapshot.workEntries||[]).find(entry=>entry.id===id);
const workStateLabel = entry => entry.status==='done'?'Завершено':entry.status==='cancelled'?'Скасовано':entry.startDate>localDateKey()?'Заплановано':'У роботі';

function workTodaySummary() {
  const people=activeEmployees(),rows=people.map(person=>({person,status:statusFor(person.id)}));
  const expected=rows.filter(row=>!LadWork.absence.has(row.status)&&!LadPresence.noSubmission.has(row.status)&&!['outside','weekend'].includes(row.status));
  return {people,rows,expected:expected.length,covered:expected.filter(row=>LadWork.confirmed.has(row.status)).length,
    working:rows.filter(row=>row.status==='working').length,absent:rows.filter(row=>LadWork.absence.has(row.status)).length,
    unmarked:expected.filter(row=>['pending','missed','zkp','onsite'].includes(row.status)).length};
}
function workEntriesHtml(entries, compact=false) {
  return entries.map(entry=>`<article class="work-entry ${compact?'work-entry-compact':''}"><button class="work-entry-title" data-work-detail="${h(entry.id)}"><strong>${h(entry.title)}</strong><span>${h(employeeById(entry.employeeId)?.name||'Працівник з історії')} · ${h(workStateLabel(entry))}</span></button><div class="work-entry-progress"><strong>${entry.completedProjects}/${entry.projectCount}</strong><span>проєктів виконано</span><progress max="${entry.projectCount}" value="${entry.completedProjects}" aria-label="Виконано ${entry.completedProjects} з ${entry.projectCount} проєктів"></progress></div><div class="work-entry-dates"><span>Початок: ${h(formatDate(entry.startDate))}</span><span>${entry.finishedDate?'Фактичне завершення':'Орієнтир'}: ${h(formatDate(entry.finishedDate||entry.estimatedEndDate))}</span>${entry.status==='active'&&entry.estimatedEndDate<localDateKey()?'<small class="work-review">Перевірити строк · робота триває</small>':''}</div><button class="button small" data-work-detail="${h(entry.id)}">Відкрити</button></article>`).join('')||'<p class="muted">Робіт за цими умовами немає.</p>';
}
function renderWorkTodayPage() {
  const summary=workTodaySummary(),entries=(snapshot.workEntries||[]).filter(entry=>(workUi.filter==='all'||entry.status===workUi.filter)
    && `${entry.title} ${employeeById(entry.employeeId)?.name||''}`.toLocaleLowerCase('uk-UA').includes(workUi.query.toLocaleLowerCase('uk-UA')));
  const assignment=snapshot.duties?.assignments?.[localDateKey()];
  const dutyNames=(assignment?.employeeIds||[]).map(id=>employeeById(id)?.name||'Працівник з історії');
  return `<div class="page-header"><div><span class="page-eyebrow">Робота команди</span><h1>${h(formatDate(localDateKey(),{weekday:'long',day:'numeric',month:'long'}))}</h1><p>Робочі дні, проєкти та поточні завдання співробітників.</p></div><div class="button-row"><button class="button primary" data-work-new>+ Додати роботу</button><button class="button" data-presence-new>Наявність</button><button class="button" data-tab="journal">Табель →</button></div></div>
  <div class="today-summary"><button data-work-today-filter="all"><span>Роботу зараховано</span><strong>${summary.covered}/${summary.expected}</strong><small>після підтвердження роботи</small></button><button data-work-today-filter="working"><span>У роботі</span><strong>${summary.working}</strong><small>робота ще не завершена</small></button><button data-work-today-filter="unmarked"><span>Очікує підтвердження</span><strong>${summary.unmarked}</strong><small>потрібно перевірити статус</small></button><button data-work-today-filter="absent"><span>Відсутні</span><strong>${summary.absent}</strong><small>за даними наявності</small></button></div>
  <section class="today-duty"><span class="nav-icon">${NAV_ICONS.duties}</span><div><small>Чергування сьогодні · ${h(activeDutySchedule().name)}</small><strong>${h(dutyNames.join(' · ')||'Призначень немає')}</strong></div><button class="button small" ${dutyNames.length?`data-duty-day="${localDateKey()}"`:'data-tab="duties"'}>${dutyNames.length?'Пояснення складу':'Графік'}</button></section>
  ${renderConsequenceBanner()}${renderAttentionPanel()}
  <section class="panel"><div class="work-section-head"><h2>Співробітники сьогодні</h2><label class="field"><span class="sr-only">Знайти співробітника</span><input type="search" data-today-search value="${h(ui.todayQuery)}" placeholder="Знайти співробітника"></label></div><div class="work-people">${summary.rows.filter(row=>row.person.name.toLocaleLowerCase('uk-UA').includes(ui.todayQuery.toLocaleLowerCase('uk-UA'))&&(ui.todayFilter==='all'||ui.todayFilter==='working'&&row.status==='working'||ui.todayFilter==='unmarked'&&['pending','missed','onsite','zkp'].includes(row.status)||ui.todayFilter==='absent'&&LadWork.absence.has(row.status))).map(({person,status})=>{
    const active=(snapshot.workEntries||[]).filter(entry=>entry.employeeId===person.id&&entry.status==='active'&&entry.startDate<=localDateKey());
    return `<article class="work-person"><button class="work-person-name" data-work-person="${h(person.id)}"><strong>${h(person.name)}</strong>${statusBadge(status)}</button><p>${h(active.map(entry=>`${entry.title} · ${entry.completedProjects}/${entry.projectCount}`).join(' · ')||'Активну роботу не додано')}</p><div class="button-row"><button class="button small" data-work-person="${h(person.id)}">Дії</button><button class="button small" data-work-new="${h(person.id)}">+ Робота</button></div></article>`;
  }).join('')||'<p class="muted">Співробітників за цими умовами немає.</p>'}</div></section>
  <section class="panel"><div class="work-section-head"><div><h2>Облік роботи</h2><p class="muted">Орієнтовний строк нагадує про перевірку. Завершення фіксується окремо.</p></div><button class="button" data-work-new>+ Робота</button></div><div class="work-list-tools"><div class="button-row">${[['active','У роботі'],['done','Завершені'],['cancelled','Скасовані'],['all','Усі']].map(([key,label])=>`<button class="button small ${workUi.filter===key?'primary':''}" data-work-filter="${key}" aria-pressed="${workUi.filter===key}">${label}</button>`).join('')}</div><input type="search" data-work-search value="${h(workUi.query)}" aria-label="Знайти роботу" placeholder="Робота або співробітник"></div>${workEntriesHtml(entries)}</section>`;
}
function openWorkForm(employeeId='',id='') {
  const entry=id?workById(id):null;
  if(id&&!entry){showToast('Роботу не знайдено.',{error:true});return;}
  const personId=entry?.employeeId||employeeId||activeEmployees()[0]?.id||'',start=entry?.startDate||localDateKey();
  let end=entry?.estimatedEndDate||start;
  try{if(!entry&&personId)end=LadWork.estimatedEnd(snapshot,personId,start,1);}catch(_error){}
  openModal(`<form id="work-form" data-work-id="${h(id)}" data-revision="${entry?.revision??''}"><header class="modal-head"><div><h2>${entry?'Змінити роботу':'Додати роботу співробітника'}</h2><p>Проєкти та час роботи обліковуються окремо.</p></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body"><div class="form-grid"><label class="field"><span>Співробітник</span><select name="employeeId" ${entry?'disabled':''} required>${snapshot.employees.filter(person=>person.active||person.id===personId).map(person=>`<option value="${h(person.id)}" ${person.id===personId?'selected':''}>${h(person.name)}</option>`).join('')}</select></label><label class="field"><span>Кількість проєктів</span><input type="number" name="projectCount" min="1" max="1000" value="${entry?.projectCount||1}" required></label></div><label class="field"><span>Над чим працює</span><input name="title" maxlength="160" minlength="2" value="${h(entry?.title||'Основна робота')}" required></label><div class="form-grid"><label class="field"><span>Початок роботи</span><input type="date" name="startDate" value="${start}" required></label><label class="field"><span>Орієнтовно робочих днів</span><input type="number" name="estimatedDays" min="1" max="1000" value="${entry?Math.max(1,LadWork.dates(start,end).filter(date=>LadWork.isWorkday(snapshot,personId,date)).length):1}" data-work-estimate><small>Можна змінювати незалежно від кількості проєктів.</small></label></div><label class="field"><span>Орієнтовна дата завершення</span><input type="date" name="estimatedEndDate" value="${end}" required><small>Це орієнтир. Робота не завершується автоматично.</small></label><label class="field"><span>Примітка</span><textarea name="note" maxlength="1000">${h(entry?.note||'')}</textarea></label>${entry?'<label class="field"><span>Причина зміни строку або обсягу</span><input name="reason" maxlength="500" placeholder="Наприклад: складні проєкти, потрібна перевірка"></label>':''}</div><footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit" ${personId?'':'disabled'}>${entry?'Зберегти зміни':'Почати облік роботи'}</button></footer></form>`,true);
}
function openWorkDetail(id) {
  const entry=workById(id);if(!entry)return;
  openModal(`<header class="modal-head"><div><span class="page-eyebrow">${h(workStateLabel(entry))}</span><h2>${h(entry.title)}</h2><p>${h(employeeById(entry.employeeId)?.name||'Співробітник з історії')}</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body"><div class="work-detail-progress"><strong>${entry.completedProjects}/${entry.projectCount}</strong><span>проєктів виконано</span><progress value="${entry.completedProjects}" max="${entry.projectCount}"></progress></div><p>Початок: <strong>${h(formatDate(entry.startDate))}</strong>. Орієнтир: <strong>${h(formatDate(entry.estimatedEndDate))}</strong>. ${entry.finishedDate?`Фактичне завершення: <strong>${h(formatDate(entry.finishedDate))}</strong>.`:''}</p>${entry.status==='active'&&entry.estimatedEndDate<localDateKey()?'<p class="confirm-box">Орієнтир минув. Робота залишається активною: перевірте прогрес або змініть строк із поясненням.</p>':''}${entry.note?`<p>${h(entry.note)}</p>`:''}<p class="muted">Дні роботи визначаються за періодом, робочим календарем і табелем. Відсутність та ручні позначки мають пріоритет. Проєкти не перетворюються на автоматично виконані дні.</p><details class="modal-details"><summary>Історія змін · ${entry.history.length}</summary>${entry.history.slice().reverse().map(item=>`<article class="work-history"><strong>${h({created:'Роботу додано',updated:'Умови змінено',progress:'Прогрес оновлено',done:'Завершено',cancelled:'Скасовано'}[item.type]||item.type)}</strong><small>${h(new Date(item.at).toLocaleString('uk-UA'))} · ${h(item.actor)}</small><p>${h(item.type==='progress'?`${item.details.before} → ${item.details.after} проєктів`:item.details.reason||'')}${item.type==='updated'?Object.entries(item.details.changes||{}).map(([key,value])=>`<span>${h({estimatedEndDate:'Орієнтир',startDate:'Початок',projectCount:'Обсяг',title:'Робота',note:'Примітка'}[key]||key)}: ${h(value.before)} → ${h(value.after)}</span>`).join(''):''}</p></article>`).join('')}</details></div><footer class="modal-foot">${entry.status==='active'?`<button class="button" data-work-edit="${h(id)}">Змінити строк / роботу</button><button class="button" data-work-progress="${h(id)}" ${entry.startDate>localDateKey()?'disabled':''}>Прогрес</button><button class="button success" data-work-finish="${h(id)}" ${entry.startDate>localDateKey()?'disabled':''}>Завершити</button><button class="button danger" data-work-cancel="${h(id)}" ${entry.startDate>localDateKey()?'disabled':''}>Скасувати роботу</button>`:''}<button class="button" data-close-modal>Закрити</button></footer>`,true);
}
function openWorkProgress(id,finishStatus='') {
  const entry=workById(id);if(!entry)return;
  openModal(`<form id="work-progress-form" data-work-id="${h(id)}" data-revision="${entry.revision}" data-finish-status="${finishStatus}"><header class="modal-head"><div><h2>${finishStatus==='done'?'Завершити роботу':finishStatus==='cancelled'?'Скасувати роботу':'Оновити прогрес'}</h2><p>${h(entry.title)} · ${h(employeeById(entry.employeeId)?.name||'')}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body">${finishStatus?`<label class="field"><span>Фактична дата ${finishStatus==='done'?'завершення':'скасування'}</span><input type="date" name="finishedDate" min="${entry.startDate}" max="${localDateKey()}" value="${localDateKey()}" required></label>${finishStatus==='done'?`<p class="confirm-box">Буде зафіксовано виконання всіх ${entry.projectCount} проєктів. Майбутні дні цієї роботи більше не обліковуються.</p>`:''}`:`<label class="field"><span>Усього виконано проєктів</span><input type="number" name="completedProjects" min="0" max="${entry.projectCount}" value="${entry.completedProjects}" required><small>Це загальна виконана кількість, а не додаток до попередньої.</small></label>`}<label class="field"><span>${finishStatus==='cancelled'?'Причина скасування':'Пояснення / причина виправлення'}</span><input name="reason" maxlength="500" ${finishStatus==='cancelled'?'required':''}></label></div><footer class="modal-foot"><button class="button" type="button" data-close-modal>Назад</button><button class="button primary" type="submit">${finishStatus?'Підтвердити':'Зберегти прогрес'}</button></footer></form>`,true);
}
function openWorkActions(employeeId,date=localDateKey()) {
  const person=employeeById(employeeId);if(!person)return;
  const noSubmission=LadPresence.noSubmission.has(presenceMark(employeeId,date)?.status);
  const entries=(snapshot.workEntries||[]).filter(entry=>entry.employeeId===employeeId&&entry.status==='active');
  openModal(`<header class="modal-head"><div><h2>${h(person.name)}</h2><p>${h(formatDate(date))} · ${h(LadWork.labels[statusFor(employeeId,date)]||'Без позначки')}</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body">${noSubmission?'<p class="confirm-box">За цією наявністю здача документів не потрібна. Змінити її можна у «Наявності».</p>':''}<div class="work-quick-actions"><button class="button primary" data-work-new="${h(employeeId)}">+ Додати роботу</button><button class="button" data-work-mark="working" data-employee-id="${h(employeeId)}" data-date="${date}" ${date>localDateKey()||noSubmission?'disabled':''}>У роботі сьогодні</button><button class="button success" data-work-mark="submitted" data-employee-id="${h(employeeId)}" data-date="${date}" ${date>localDateKey()||noSubmission?'disabled':''}>День відпрацьовано</button><button class="button" data-work-tab-status="${h(employeeId)}" data-date="${date}">Статус дня / відсутність</button><button class="button" data-work-accept="${h(employeeId)}">Прийняти роботу за дні ЗКП</button><button class="button" data-new-task data-task-employee="${h(employeeId)}">+ Завдання</button></div><h3>Активна робота</h3>${workEntriesHtml(entries,true)}</div><footer class="modal-foot"><button class="button" data-close-modal>Закрити</button></footer>`,true);
}
async function markEmployeeWork(employeeId,status,date=localDateKey()) {
  const key=employeeId+'|'+date;if(workUi.pending.has(key))return;
  workUi.pending.add(key);const revision=interfaceDialogRevision;
  const note=modalRoot.querySelector('#status-note')?.value||'';
  try{const result=await run(()=>window.counter.markWorkDay({employeeId,date,status,note}),'Роботу за день позначено.');if(result&&revision===interfaceDialogRevision&&modalRoot.children.length)closeModal();}
  finally{workUi.pending.delete(key);}
}
function openWorkAcceptance(employeeId) {
  const person=employeeById(employeeId),today=localDateKey();if(!person)return;
  if(presenceMark(employeeId,today)?.status!=='onsite'){
    openModal(`<header class="modal-head"><div><h2>Прийняти роботу за дні ЗКП</h2><p>${h(person.name)}</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body"><p>Роботу за ЗКП зараховують після повернення в офіс у наступний день. Спочатку позначте «На роботі» на сьогодні, потім виберіть дні, за які отримано роботу.</p></div><footer class="modal-foot"><button class="button" data-close-modal>Скасувати</button><button class="button primary" data-work-office="${h(employeeId)}">Позначити повернення в офіс</button></footer>`,true);return;
  }
  const pending=Object.values(snapshot.presenceRecords||{}).filter(mark=>mark.employeeId===employeeId&&mark.status==='zkp'&&mark.date<today
    &&LadWork.isWorkday(snapshot,employeeId,mark.date)&&LadWork.trackableOn(person,mark.date)&&!LadWork.confirmed.has(statusFor(employeeId,mark.date))).map(mark=>mark.date).sort().reverse();
  const days=[...(LadWork.isWorkday(snapshot,employeeId,today)?[today]:[]),...pending];
  openModal(`<form id="work-accept-form" data-employee-id="${h(employeeId)}"><header class="modal-head"><div><span class="page-eyebrow">Після повернення в офіс</span><h2>Прийняти роботу за дні ЗКП</h2><p>${h(person.name)} · підтвердження ${h(formatDate(today))}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body"><p>Виберіть лише дні, за які працівник приніс роботу. Дні ЗКП не обираються автоматично; їхні позначки в «Наявності» збережуться.</p><fieldset class="presence-picker"><legend>Дні отриманої роботи</legend><div>${days.map(date=>`<label class="check-row"><input type="checkbox" name="dates" value="${date}" ${date===today?'checked':''}><span>${h(formatDate(date))} · ${date===today?'день повернення':'ЗКП'}</span></label>`).join('')||'<p class="muted">Немає робочих днів для підтвердження.</p>'}</div></fieldset><label class="field"><span>Підстава / пояснення *</span><textarea name="note" required maxlength="500" rows="2" placeholder="Що отримано та за які дні"></textarea></label><div data-work-accept-impact aria-live="polite">Перевірте вибрані дні перед зарахуванням.</div><p data-work-accept-error role="alert" hidden></p></div><footer class="modal-foot three-way"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button" type="button" data-work-accept-preview ${days.length?'':'disabled'}>Перевірити дні</button><button class="button primary" type="submit" disabled>Зарахувати роботу</button></footer></form>`,true);
}
function workAcceptanceInput(form) {
  const data=new FormData(form);return {cells:data.getAll('dates').map(date=>({employeeId:form.dataset.employeeId,date:String(date)})),
    action:'status',status:'submitted',note:String(data.get('note')||'').trim(),replaceExisting:true,includeWeekends:false,skipBlocked:false};
}
function invalidateWorkAcceptance(form) {
  delete form.dataset.previewToken;form.querySelector('[type="submit"]').disabled=true;
  form.querySelector('[data-work-accept-impact]').textContent='Дані змінено. Перевірте вибрані дні ще раз.';
}
async function previewWorkAcceptance(form) {
  if(!form.reportValidity()||form.dataset.busy)return;
  const input=workAcceptanceInput(form),revision=interfaceDialogRevision;form.dataset.busy='true';
  form.querySelector('[data-work-accept-preview]').disabled=true;
  try{
    const report=await window.counter.previewJournalBatch(input);
    if(form.isConnected&&revision===interfaceDialogRevision&&JSON.stringify(input)===JSON.stringify(workAcceptanceInput(form))){
      form.querySelector('[data-work-accept-impact]').innerHTML=renderJournalBatchPreview(report);
      form.dataset.previewToken=report.token;form.querySelector('[type="submit"]').disabled=!report.canApply;
      form.querySelector('[data-work-accept-error]').hidden=true;
    }
  }catch(error){if(form.isConnected){const notice=form.querySelector('[data-work-accept-error]');notice.hidden=false;notice.textContent=error.message;}}
  finally{delete form.dataset.busy;if(form.isConnected)form.querySelector('[data-work-accept-preview]').disabled=false;}
}
async function applyWorkAcceptance(form) {
  if(!form.dataset.previewToken||form.dataset.busy)return;
  const input=workAcceptanceInput(form),revision=interfaceDialogRevision;form.dataset.busy='true';
  form.querySelectorAll('input,textarea,button').forEach(control=>control.disabled=true);
  const result=await run(()=>window.counter.applyJournalBatch({...input,expectedToken:form.dataset.previewToken}),'Роботу за вибрані дні зараховано.');
  if(result&&revision===interfaceDialogRevision&&form.isConnected)closeModal(form);
  else if(form.isConnected){delete form.dataset.busy;form.querySelectorAll('input,textarea,button').forEach(control=>control.disabled=false);invalidateWorkAcceptance(form);}
}
for(const type of ['input','change'])document.addEventListener(type,event=>{const form=event.target.closest('#work-accept-form');if(form)invalidateWorkAcceptance(form);});
async function handleWorkClick(event) {
  const button=event.target.closest('[data-work-accept],[data-work-office],[data-work-accept-preview],[data-work-new],[data-work-person],[data-work-detail],[data-work-edit],[data-work-progress],[data-work-finish],[data-work-cancel],[data-work-mark],[data-work-tab-status],[data-work-filter],[data-work-today-filter],[data-widget-mode],[data-widget-shape],[data-widget-setting],[data-widget-hide],[data-widget-options],[data-work-analytics-detail]');
  if(!button)return false;if(button.disabled)return true;
  if(button.dataset.workAccept)openWorkAcceptance(button.dataset.workAccept);
  else if(button.dataset.workOffice)openPresenceForm({employeeId:button.dataset.workOffice,date:localDateKey(),status:'onsite',reason:''});
  else if(button.hasAttribute('data-work-accept-preview'))await previewWorkAcceptance(button.form);
  else if(button.hasAttribute('data-work-new'))openWorkForm(button.dataset.workNew);
  else if(button.dataset.workPerson)openWorkActions(button.dataset.workPerson);
  else if(button.dataset.workDetail)openWorkDetail(button.dataset.workDetail);
  else if(button.dataset.workEdit)openWorkForm('',button.dataset.workEdit);
  else if(button.dataset.workProgress)openWorkProgress(button.dataset.workProgress);
  else if(button.dataset.workFinish)openWorkProgress(button.dataset.workFinish,'done');
  else if(button.dataset.workCancel)openWorkProgress(button.dataset.workCancel,'cancelled');
  else if(button.dataset.workMark)await markEmployeeWork(button.dataset.employeeId,button.dataset.workMark,button.dataset.date);
  else if(button.dataset.workTabStatus)openStatusModal(button.dataset.workTabStatus,button.dataset.date);
  else if(button.dataset.workFilter){workUi.filter=button.dataset.workFilter;renderShell();}
  else if(button.dataset.workTodayFilter){ui.todayFilter=button.dataset.workTodayFilter;renderShell();}
  else if(button.dataset.widgetMode)await updateWidgetPreferences({widgetMode:button.dataset.widgetMode});
  else if(button.dataset.widgetShape)await updateWidgetPreferences({widgetShape:button.dataset.widgetShape});
  else if(button.dataset.widgetSetting){const key=button.dataset.widgetSetting;await updateWidgetPreferences({[key]:!snapshot.settings[key]});}
  else if(button.hasAttribute('data-widget-hide'))await window.counter.hideWindow();
  else if(button.hasAttribute('data-widget-options'))openWidgetOptions();
  else if(button.dataset.workAnalyticsDetail)openWorkAnalyticsDetail(button.dataset.workAnalyticsDetail,button.dataset.employeeId||'');
  return true;
}
async function handleWorkSubmit(event) {
  const form=event.target;if(!['work-accept-form','work-form','work-progress-form','widget-options-form'].includes(form.id))return false;
  if(form.id==='work-accept-form'){await applyWorkAcceptance(form);return true;}
  const data=new FormData(form),revision=interfaceDialogRevision;
  if(form.id==='widget-options-form') {
    const result=await updateWidgetPreferences({widgetMode:String(data.get('widgetMode')),widgetShape:String(data.get('widgetShape')),
      widgetLocked:data.has('widgetLocked'),widgetSnap:data.has('widgetSnap'),widgetQuickMode:data.has('widgetQuickMode'),widgetList:data.has('widgetList'),widgetShortcutEnabled:data.has('widgetShortcutEnabled')});
    if(result&&revision===interfaceDialogRevision&&form.isConnected)closeModal();return true;
  }
  let action;
  if(form.id==='work-form'){
    const payload={employeeId:form.elements.employeeId.value,title:String(data.get('title')),projectCount:Number(data.get('projectCount')),
      startDate:String(data.get('startDate')),estimatedEndDate:String(data.get('estimatedEndDate')),note:String(data.get('note')||''),reason:String(data.get('reason')||''),expectedRevision:Number(form.dataset.revision)};
    action=()=>form.dataset.workId?window.counter.updateWork(form.dataset.workId,payload):window.counter.createWork(payload);
  }else{
    const payload={expectedRevision:Number(form.dataset.revision),completedProjects:Number(data.get('completedProjects')),reason:String(data.get('reason')||''),finishedDate:String(data.get('finishedDate')||''),status:form.dataset.finishStatus};
    action=()=>payload.status?window.counter.finishWork(form.dataset.workId,payload):window.counter.updateWorkProgress(form.dataset.workId,payload);
  }
  const result=await run(action,'Облік роботи збережено.');
  if(result&&revision===interfaceDialogRevision&&form.isConnected)closeModal();return true;
}
function handleWorkChange(event) {
  const form=event.target.closest('#work-form');if(!form)return false;
  if(['projectCount','startDate','employeeId','estimatedDays'].includes(event.target.name)){
    if(event.target.name==='projectCount'&&!form.dataset.workId)form.elements.estimatedDays.value=form.elements.projectCount.value;
    try{form.elements.estimatedEndDate.value=LadWork.estimatedEnd(snapshot,form.elements.employeeId.value,form.elements.startDate.value,Number(form.elements.estimatedDays.value));}
    catch(_error){/* Native field validation handles an incomplete edit. */}
  }
  return true;
}

function widgetAlerts() {
  const tasks=(snapshot.tasks||[]).filter(task=>LadPlanner.active(task)&&!task.archived),today=localDateKey();
  return {overdue:tasks.filter(task=>LadPlanner.urgency(task).key==='overdue').length,
    due:tasks.filter(task=>LadPlanner.urgency(task).key!=='overdue'&&LadPlanner.attention(snapshot).tasks.some(item=>item.id===task.id)).length,
    vacancies:(snapshot.consequences?.issues||[]).filter(issue=>issue.kind==='vacancy'&&issue.date>=today&&issue.date<=shiftDate(today,7)).length,
    review:(snapshot.workEntries||[]).filter(entry=>entry.status==='active'&&entry.estimatedEndDate<today).length};
}
function renderWidgetAlerts() {
  const a=widgetAlerts(),chips=[];
  if(snapshot.recovery)chips.push('<button class="widget-alert urgent" data-tab="data">Відновлено базу</button>');
  if(a.overdue)chips.push(`<button class="widget-alert urgent" data-planner-attention>Прострочено ${a.overdue}</button>`);
  if(a.vacancies)chips.push(`<button class="widget-alert urgent" data-tab="consequences">Підміна ${a.vacancies}</button>`);
  if(a.review)chips.push(`<button class="widget-alert" data-tab="today">Перевірити строк ${a.review}</button>`);
  if(!a.overdue&&a.due)chips.push(`<button class="widget-alert" data-planner-attention>Найближчі строки ${a.due}</button>`);
  const panel=snapshot.settings.widgetShape==='panel';
  return `<div class="widget-alerts" aria-label="Потребує уваги">${(panel?chips:chips.slice(0,2)).join('')}</div>`;
}

function renderWorkWidget() {
  const settings=snapshot.settings,mode=settings.widgetMode||'team',panel=settings.widgetShape==='panel',list=settings.widgetList||panel,summary=workTodaySummary();
  const tabs=`<nav class="widget-mode-tabs" aria-label="Режим віджета">${[['team','Команда'],['duties','Чергування'],['tasks','Завдання']].map(([id,label])=>`<button data-widget-mode="${id}" aria-pressed="${mode===id}" ${workUi.settingsPending?'disabled':''}>${label}</button>`).join('')}</nav>`;
  let content='';
  if(mode==='team') {
    const people=list?`<div class="widget-work-list" aria-label="Робота співробітників">${summary.rows.map(({person,status})=>`<button class="widget-work-person" data-work-person="${h(person.id)}" title="${h(person.name)}"><strong>${h(panel?person.name:shortName(person.name))}</strong><span>${h(LadWork.labels[status])}</span></button>`).join('')||'<p>Додайте співробітників у ЛАД.</p>'}</div>`:summary.people.length?renderRadial(summary.people):'<div class="widget-empty"><p>Співробітників немає</p><button class="button small" data-action="open-employees">Додати</button></div>';
    const center=`<div class="widget-work-summary ${!panel&&!list?'widget-center':''}" ${settings.widgetLocked?'':'data-widget-drag'} title="${settings.widgetLocked?'Положення зафіксовано':'Перетягніть, щоб перемістити'}"><b class="widget-brand">ЛАД</b><span>${h(formatDate(localDateKey(),{day:'numeric',month:'short'}))}</span><strong>${summary.expected?`${summary.covered}/${summary.expected}`:'—'}</strong><small>${summary.expected?'роботу зараховано':'неробочий день'}</small>${panel?`<small>У роботі: ${summary.working} · відсутні: ${summary.absent}</small>`:''}</div>`;
    content=`${panel||list?center:''}<div class="widget-work-team ${list?'is-list':''}">${people}</div>${!panel&&!list?center:''}`;
  } else if(mode==='duties') {
    const schedule=activeDutySchedule(),assignment=snapshot.duties?.assignments?.[localDateKey()],ids=assignment?.employeeIds||[];
    content=`<div class="widget-mode-content"><span class="widget-kicker" ${settings.widgetLocked?'':'data-widget-drag'}>Сьогодні · ${h(formatDate(localDateKey(),{day:'numeric',month:'short'}))}</span><h2>Чергові</h2><label class="widget-schedule"><span class="sr-only">Графік чергувань</span><select data-widget-schedule>${snapshot.dutySchedules.map(item=>`<option value="${h(item.id)}" ${item.id===schedule.id?'selected':''}>${h(item.name)}</option>`).join('')}</select></label><div class="widget-duty-people">${ids.map(id=>`<button data-duty-day="${localDateKey()}"><strong>${h(employeeById(id)?.name||'Співробітник з історії')}</strong><span>${assignment.realizedEmployeeIds?.includes(id)?'Виконано':'Призначено'} · пояснення →</span></button>`).join('')||'<p class="muted">Призначень на сьогодні немає.</p>'}</div><button class="button small" ${ids.length?`data-duty-day="${localDateKey()}"`:'data-tab="duties"'}>${ids.length?'Чому цей склад?':'Відкрити графік'}</button></div>`;
  } else {
    const tasks=LadPlanner.selectTasks(snapshot,{status:'active'}).slice(0,panel?5:3);
    content=`<div class="widget-mode-content"><span class="widget-kicker" ${settings.widgetLocked?'':'data-widget-drag'}>Найближчі строки</span><h2>Завдання</h2><div class="widget-task-list">${tasks.map(task=>`<button data-open-task="${h(task.id)}" class="${LadPlanner.urgency(task).key==='overdue'?'is-overdue':''}"><strong>${h(task.title)}</strong><span>${h(formatDate(task.dueDate,{day:'numeric',month:'short'}))}${task.dueTime?` · ${h(task.dueTime)}`:''} · ${h(LadPlanner.STATUS_LABELS[task.status])}</span></button>`).join('')||'<p class="muted">Активних завдань немає.</p>'}</div><button class="button small" data-new-task>+ Завдання</button></div>`;
  }
  return `<section class="widget-view"><div class="widget-circle work-widget ${panel?'widget-panel':''} widget-mode-${mode} ${settings.widgetLocked?'widget-locked':''} ${list?'widget-list-view':''}" ${settings.widgetLocked?'':'data-widget-drag'}>${tabs}${content}${renderWidgetAlerts()}<div class="widget-work-tools"><button data-work-new title="Додати роботу" aria-label="Додати роботу">+</button><button data-new-task title="Додати завдання" aria-label="Додати завдання">✓</button><button data-staff-change title="Позначити відсутність" aria-label="Позначити відсутність">◷</button><button data-action="undo" title="Скасувати останню дію" aria-label="Скасувати останню дію">↶</button></div><div class="widget-controls"><button data-widget-shape="${panel?'circle':'panel'}" title="${panel?'Круглий віджет':'Прямокутна панель'}" aria-label="Змінити форму">${panel?'◉':'▤'}</button><button data-widget-options title="Налаштування віджета" aria-label="Налаштування віджета">⚙</button><button data-action="toggle-mode" title="Відкрити ЛАД" aria-label="Відкрити ЛАД">▦</button><button data-widget-hide title="Сховати біля годинника" aria-label="Сховати біля годинника">−</button></div>${settings.widgetLocked?'':`<div class="widget-resize-handle" data-widget-resize title="Змінити розмір">⌟</div>`}</div></section>`;
}
async function updateWidgetPreferences(input) {
  if(workUi.settingsPending)return null;workUi.settingsPending=true;
  try{return await run(()=>window.counter.updateWidgetPreferences(input),null,{undo:false});}
  finally{workUi.settingsPending=false;renderShell({preserveDrafts:true});}
}
function openWidgetOptions() {
  const settings=snapshot.settings;
  openModal(`<form id="widget-options-form"><header class="modal-head"><div><h2>Ваш віджет ЛАД</h2><p>Вигляд, дії та поведінка на робочому столі.</p></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body"><div class="form-grid"><label class="field"><span>Режим при відкритті</span><select name="widgetMode">${[['team','Команда'],['duties','Чергування'],['tasks','Завдання']].map(([id,label])=>`<option value="${id}" ${settings.widgetMode===id?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>Форма</span><select name="widgetShape"><option value="circle" ${settings.widgetShape!=='panel'?'selected':''}>Круглий</option><option value="panel" ${settings.widgetShape==='panel'?'selected':''}>Прямокутна панель</option></select></label></div>${[['widgetList','Список замість секторів','Повні статуси у компактному списку.'],['widgetLocked','Зафіксувати положення','Віджет не пересувається й не змінює розмір випадково.'],['widgetSnap','Прилипати до країв екрана','Під час переміщення поблизу краю віджет вирівнюється.'],['widgetQuickMode','Швидкий режим','Клік по сектору одразу позначає день відпрацьованим. Кількість виконаних проєктів не змінюється.'],['widgetShortcutEnabled','Показати віджет: Ctrl+Shift+L','Повертає віджет із будь-якої програми.']].map(([key,title,copy])=>`<label class="check-row"><input type="checkbox" name="${key}" ${settings[key]?'checked':''}><span><strong>${title}</strong><span>${copy}</span></span></label>`).join('')}<p class="muted">${snapshot.widgetWindowStatus?.shortcutRegistered===false?'Ctrl+Shift+L зайнято іншою програмою або вимкнено. Віджет доступний через значок ЛАД біля годинника.':'Кнопка «Сховати» залишає ЛАД і нагадування працювати. «Вийти» закриває програму.'}</p></div><footer class="modal-foot"><button class="button danger" type="button" data-action="close">Вийти з ЛАД</button><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти</button></footer></form>`,true);
}

function renderWorkAnalytics(report) {
  const keys=['workedDays','workingDays','confirmedDays','projectsCompleted','absent','coveragePercent'],total=report.total;
  const descriptions={workedDays:'Дні з обліком роботи. Непідтверджені дні ЗКП не включено.',workingDays:'Дні роботи над активними або скасованими пізніше роботами.',confirmedDays:'Підтверджені дні, зокрема з попереднього обліку.',projectsCompleted:'Проєкти робіт, завершених у вибраному періоді.',absent:'Позначки відсутності мають пріоритет над періодом роботи.',coveragePercent:'Частка днів з обліком роботи. Це не оцінка продуктивності.'};
  const value=(key,n)=>n==null?'—':key==='coveragePercent'?`${n}%`:String(n);
  const rows=report.rows.filter(row=>row.name.toLocaleLowerCase('uk-UA').includes(ui.analyticsQuery.toLocaleLowerCase('uk-UA'))
    &&(ui.analyticsRowFilter==='all'||ui.analyticsRowFilter==='pending'&&row.pending+row.missed>0||ui.analyticsRowFilter==='workingDays'&&row.workingDays>0||ui.analyticsRowFilter==='dueForReview'&&row.dueForReview>0))
    .sort((a,b)=>ui.analyticsSort==='name'?ui.analyticsSortDirection*a.name.localeCompare(b.name,'uk'):ui.analyticsSortDirection*((a[ui.analyticsSort]??-1)-(b[ui.analyticsSort]??-1)));
  const columns=ui.analyticsColumns==='full'?[...keys,'calendarWorkdays','onsiteDays','zkpDays','zkpPendingDays','trainingDays','arkanDays','otherTasks','pending','missed','projectsStarted','openProjects','dueForReview']:keys;
  const header=(key,label)=>`<th><button data-analytics-sort="${key}">${h(label)}${ui.analyticsSort===key?(ui.analyticsSortDirection===1?' ↑':' ↓'):''}</button></th>`;
  const trendKey=ui.analyticsChart==='projects'?'projectsCompleted':'workedDays',maximum=Math.max(1,...report.trend.map(row=>row[trendKey]));
  return `<div class="analytics-report-heading"><div><strong>${h(formatDate(report.startDate))} — ${h(formatDate(report.endDate))}</strong><p>${report.rows.length} співробітників. Майбутні дні не додаються до фактичного обліку.</p></div><div class="button-row">${[['workers','CSV співробітників'],['trend','CSV динаміки'],['days','CSV днів']].map(([view,label])=>`<button class="button small" data-export-analytics-view="${view}" ${ui.analyticsError||!report.rows.length?'disabled':''}>${label}</button>`).join('')}</div></div><div class="analytics-metric-grid">${keys.map(key=>`<button class="metric-card analytics-metric-card" data-work-analytics-detail="${key}"><span>${h(LadWork.metricLabels[key])}</span><strong>${value(key,total[key])}</strong><small>${descriptions[key]}</small>${report.comparison?`<small>Попередній період: ${value(key,report.comparison.total[key])}</small>`:''}</button>`).join('')}</div><p class="analytics-notice">ЗКП очікує здачі: ${total.zkpPendingDays}; навчання: ${total.trainingDays}; Аркан (здача не потрібна): ${total.arkanDays}; без позначки: ${total.pending}; роботу не позначено після закриття дня: ${total.missed}. Проєкти й дні — різні величини; 5 проєктів можуть потребувати більше ніж 5 днів.</p><div class="button-row analytics-view-tabs">${[['overview','Динаміка'],['workers','Співробітники'],['days','За датами']].map(([key,label])=>`<button class="button ${ui.analyticsView===key?'primary':''}" data-analytics-view="${key}">${label}</button>`).join('')}</div>
  ${ui.analyticsView==='workers'?`<section class="panel"><label class="field"><span>Знайти співробітника</span><input type="search" data-analytics-search value="${h(ui.analyticsQuery)}"></label><div class="button-row work-list-tools">${[['all','Усі'],['pending','Без обліку'],['workingDays','У роботі'],['dueForReview','Перевірити строк']].map(([key,label])=>`<button class="button small ${ui.analyticsRowFilter===key?'primary':''}" data-analytics-row-filter="${key}">${label}</button>`).join('')}<button class="button small" data-analytics-columns="${ui.analyticsColumns==='full'?'simple':'full'}">${ui.analyticsColumns==='full'?'Основні показники':'Усі показники'}</button></div><p class="muted">Показано ${rows.length} із ${report.rows.length}. Залишок проєктів і перевірка строків — поточний стан, незалежно від періоду. Фільтри таблиці не змінюють картки й CSV.</p><div class="table-scroll"><table class="data-table"><thead><tr>${header('name','Співробітник')}${columns.map(key=>header(key,LadWork.metricLabels[key])).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th>${h(row.name)}</th>${columns.map(key=>`<td><button class="analytics-number-button" data-work-analytics-detail="${key}" data-employee-id="${h(row.employeeId)}">${value(key,row[key])}</button></td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`:ui.analyticsView==='days'?renderWorkFacts(report.facts):`<section class="panel"><div class="work-section-head"><h2>${trendKey==='projectsCompleted'?'Завершені проєкти':'Дні роботи'} у часі</h2><div class="button-row"><button class="button small" data-analytics-chart="days">Дні роботи</button><button class="button small" data-analytics-chart="projects">Завершені проєкти</button></div></div><p class="muted">Однакова шкала для всіх періодів: 0–${maximum} ${trendKey==='projectsCompleted'?'проєктів':'днів'}.</p><div class="work-trend">${report.trend.map(row=>`<div><span>${h(formatDate(row.from,{day:'numeric',month:'short'}))}</span><progress value="${row[trendKey]}" max="${maximum}" aria-label="${row[trendKey]} ${trendKey==='projectsCompleted'?'проєктів':'днів роботи'}"></progress><strong>${row[trendKey]}</strong><small>без обліку: ${row.pending+row.missed}</small></div>`).join('')||'<p class="muted">Фактичних днів у цьому періоді ще немає.</p>'}</div></section><section class="panel"><h2>Як рахуються показники</h2><p>«Наявність» має пріоритет: «На роботі» позначає присутність. ЗКП не зараховує роботу: потрібне окреме підтвердження після повернення в офіс. Навчання обліковується окремо й не стає пропуском. Відсутність виключає день з очікуваної роботи. Активна робота враховується від початку до фактичного завершення за робочим календарем. Орієнтовний строк не завершує роботу. Відсутність, неробочі дні й ручні позначки враховуються окремо.</p><p>Один день співробітника рахується один раз, навіть якщо в нього кілька робіт. Прогрес активних робіт видно в обліку роботи; показник завершених проєктів включає тільки роботи, завершення яких підтверджено у вибраному періоді.</p></section>`}`;
}
function renderWorkFacts(facts) {
  facts=facts.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'uk'));
  return `<section class="panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Дата</th><th>Співробітник</th><th>Статус</th><th>Робота / пояснення</th></tr></thead><tbody>${facts.slice(0,500).map(f=>`<tr><td>${h(formatDate(f.date))}</td><td>${h(f.name)}</td><td>${h(LadWork.factLabel(f))}</td><td>${h(f.note||'—')}</td></tr>`).join('')||'<tr><td colspan="4">Дат за цими умовами немає.</td></tr>'}</tbody></table></div>${facts.length>500?'<p class="muted">На екрані перші 500 рядків. Повний період доступний у CSV днів.</p>':''}</section>`;
}
function openWorkAnalyticsDetail(key,employeeId='') {
  const report=ui.analytics;if(!report)return;
  const data=employeeId?report.rows.find(row=>row.employeeId===employeeId):report.total;
  const relevant=report.facts.filter(f=>!employeeId||f.employeeId===employeeId).filter(f=>key==='onsiteDays'?(f.presenceStatus||f.status)==='onsite':key==='zkpDays'?(f.presenceStatus||f.status)==='zkp':key==='zkpPendingDays'?f.status==='zkp':key==='arkanDays'?f.status==='arkan':key==='trainingDays'?LadPresence.learning.has(f.status):key==='workingDays'?f.status==='working':key==='confirmedDays'?LadWork.confirmed.has(f.status):key==='calendarWorkdays'?true:key==='pending'?f.status==='pending':key==='missed'?f.status==='missed':key==='otherTasks'?f.status==='other_tasks':key==='absent'?LadWork.absence.has(f.status):['workedDays','coveragePercent'].includes(key)?['working','other_tasks','onsite','arkan'].includes(f.status)||LadWork.confirmed.has(f.status):true);
  const entries=report.entries.filter(entry=>(!employeeId||entry.employeeId===employeeId)&&entry.status==='done'&&entry.finishedDate>=report.startDate&&entry.finishedDate<=report.endDate);
  const workKeys=['projectsCompleted','projectsStarted','openProjects','dueForReview'];
  const workEntries=key==='projectsStarted'?report.entries.filter(entry=>(!employeeId||entry.employeeId===employeeId)&&entry.startDate>=report.startDate&&entry.startDate<=report.endDate&&entry.startDate<=report.asOfDate):key==='openProjects'||key==='dueForReview'?report.entries.filter(entry=>(!employeeId||entry.employeeId===employeeId)&&entry.status==='active'&&(key==='dueForReview'?entry.estimatedEndDate<report.asOfDate:entry.startDate<=report.asOfDate)):entries;
  openModal(`<header class="modal-head"><div><h2>${h(LadWork.metricLabels[key])}: ${data?.[key]??'—'}${key==='coveragePercent'?'%':''}</h2><p>${employeeId?h(employeeById(employeeId)?.name||''):''} ${h(formatDate(report.startDate))} — ${h(formatDate(report.endDate))}</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body">${workKeys.includes(key)?workEntriesHtml(workEntries):renderWorkFacts(relevant)}</div><footer class="modal-foot"><button class="button" data-close-modal>Закрити</button></footer>`,true);
}
