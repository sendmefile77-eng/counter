const presenceUi={date:null,query:'',filter:'all',view:'month',draft:null,report:null,busy:false,revision:0,pendingCells:new Set(),quickQueue:Promise.resolve()};
const presenceMark=(id,date)=>LadPresence.get(snapshot,id,date);
function presenceBadge(mark,date) {
  const status=mark?.status,label=LadPresence.labels[status]||'Не позначено';
  return `<span class="presence-badge presence-${h(status||'pending')}">${date>localDateKey()?'<span class="sr-only">Заплановано: </span>':''}${h(label)}</span>`;
}
function presenceShiftDate(date, direction) {
  if (presenceUi.view==='day'||presenceUi.view==='week') return shiftDate(date,direction*(presenceUi.view==='week'?7:1));
  const month=monthShift(date.slice(0,7),direction*(presenceUi.view==='quarter'?3:1));
  const last=LadPlanner.range(month+'-01','month').endDate;
  return `${month}-${String(Math.min(Number(date.slice(-2)),Number(last.slice(-2)))).padStart(2,'0')}`;
}
const presenceContext={menu:null,cell:null,scrollPositions:new Map()};
function closePresenceContext(restoreFocus=false) {
  const {menu,cell}=presenceContext;
  menu?.remove();cell?.removeAttribute('aria-expanded');cell?.removeAttribute('aria-controls');
  presenceContext.menu=null;presenceContext.cell=null;
  presenceContext.scrollPositions.clear();
  if(restoreFocus&&cell?.isConnected)cell.focus({preventScroll:true});
}
function presenceContextCell(target) {
  return target.closest('[data-presence-edit]')||target.closest('td.presence-calendar-day')?.querySelector('[data-presence-edit]');
}
function openPresenceContext(cell,x,y) {
  closePresenceContext();
  const id=cell.dataset.presenceEdit,date=cell.dataset.presenceCellDate,person=employeeById(id);
  if(cell.disabled||!person||!LadPresence.validDate(date)||!LadWork.trackableOn(person,date))return;
  const mark=presenceMark(id,date),canClear=mark&&mark.source!=='calendar_presence',menu=document.createElement('div');
  menu.id='presence-context-menu';menu.className='presence-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-labelledby','presence-context-title');
  menu.innerHTML=`<div class="presence-context-head" role="presentation"><strong id="presence-context-title">${h(person.name)} · ${h(formatDate(date))}</strong><span>Призначити наявність</span></div>${Object.entries(LadPresence.labels).map(([status,label])=>`<button type="button" role="menuitemradio" tabindex="-1" aria-checked="${mark?.status===status}" data-presence-context-action="${status}"><b class="presence-${status}" aria-hidden="true">${h(LadPresence.symbols[status])}</b><span>${h(label)}</span><span class="presence-context-check" aria-hidden="true">${mark?.status===status?'✓':''}</span></button>`).join('')}<div class="presence-context-separator" role="separator"></div><button type="button" role="menuitem" tabindex="-1" data-presence-context-action="edit">Змінити день / період…</button><button type="button" role="menuitem" tabindex="-1" class="presence-context-delete" data-presence-context-action="clear" ${canClear?'':'disabled'}>Видалити позначку${canClear?'':mark?.source==='calendar_presence'?' · календарний вихідний':' · немає позначки'}</button>`;
  presenceContext.menu=menu;presenceContext.cell=cell;
  cell.setAttribute('aria-expanded','true');cell.setAttribute('aria-controls',menu.id);document.body.append(menu);
  const box=menu.getBoundingClientRect(),anchor=cell.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(x??anchor.left,window.innerWidth-box.width-8))+'px';
  menu.style.top=Math.max(8,Math.min(y??anchor.bottom,window.innerHeight-box.height-8))+'px';
  menu.querySelector('[aria-checked="true"]')?.focus({preventScroll:true});
  if(!menu.contains(document.activeElement))menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  // A right click can deliver an already completed scroll after the menu opens.
  // Dismiss only when a container actually moves from its opening position.
  for(let ancestor=cell.parentElement;ancestor;ancestor=ancestor.parentElement)
    presenceContext.scrollPositions.set(ancestor,{left:ancestor.scrollLeft,top:ancestor.scrollTop});
  if(document.scrollingElement)presenceContext.scrollPositions.set(document.scrollingElement,{left:document.scrollingElement.scrollLeft,top:document.scrollingElement.scrollTop});
  menu.addEventListener('click',event=>{
    const action=event.target.closest('[data-presence-context-action]');if(!action||action.disabled)return;
    const status=action.dataset.presenceContextAction;closePresenceContext(true);
    if(status==='edit')openPresenceForm({employeeId:id,date});
    else void saveQuickPresence(id,date,status);
  });
  menu.addEventListener('contextmenu',event=>event.preventDefault());
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'||event.key==='Tab'){if(event.key==='Escape')event.preventDefault();event.stopPropagation();closePresenceContext(true);return;}
    const items=[...menu.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);
    const next={ArrowDown:(index+1)%items.length,ArrowUp:(index-1+items.length)%items.length,Home:0,End:items.length-1}[event.key];
    if(next!==undefined){event.preventDefault();event.stopPropagation();items[next].focus();}
  });
}
async function saveQuickPresence(employeeId,date,status) {
  const key=employeeId+'|'+date,mark=presenceMark(employeeId,date);
  if(presenceUi.pendingCells.has(key)||status===mark?.status||status==='clear'&&!mark)return;
  presenceUi.pendingCells.add(key);
  const cell=appRoot.querySelector('[data-presence-edit="'+CSS.escape(employeeId)+'"][data-presence-cell-date="'+date+'"]');
  const restoreFocus=cell===document.activeElement;
  if(cell){cell.disabled=true;cell.setAttribute('aria-busy','true');}
  const input={employeeIds:[employeeId],startDate:date,endDate:date,action:status==='clear'?'clear':'set',status:status==='clear'?null:status,reason:''};
  const save=async()=>{
    try{
      const result=await run(()=>window.counter.savePresence(input),null);
      if(result)showToast(status==='clear'?'Позначку видалено.':'Наявність: '+LadPresence.labels[status]+'.',{undo:true});
    }finally{
      presenceUi.pendingCells.delete(key);
      if(ui.tab==='presence') {
        const focusEmpty=document.activeElement===document.body;
        renderShell();
        if(restoreFocus&&focusEmpty)appRoot.querySelector('[data-presence-edit="'+CSS.escape(employeeId)+'"][data-presence-cell-date="'+date+'"]')?.focus({preventScroll:true});
      }
    }
  };
  presenceUi.quickQueue=presenceUi.quickQueue.then(save,save);await presenceUi.quickQueue;
}
function handlePresenceContextMenu(event) {
  const cell=presenceContextCell(event.target);if(!cell)return false;
  event.preventDefault();openPresenceContext(cell,event.clientX||undefined,event.clientY||undefined);return true;
}
function handlePresenceContextKey(event) {
  if(event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return false;
  const cell=presenceContextCell(event.target);if(!cell)return false;
  event.preventDefault();openPresenceContext(cell);return true;
}
document.addEventListener('pointerdown',event=>{if(presenceContext.menu&&!presenceContext.menu.contains(event.target))closePresenceContext();},true);
document.addEventListener('scroll',event=>{
  if(!presenceContext.menu||presenceContext.menu.contains(event.target))return;
  const target=event.target===document?document.scrollingElement:event.target,before=presenceContext.scrollPositions.get(target);
  if(before&&before.left===target.scrollLeft&&before.top===target.scrollTop)return;
  closePresenceContext(true);
},true);
document.addEventListener('focusin',event=>{if(presenceContext.menu&&!presenceContext.menu.contains(event.target))closePresenceContext();});
window.addEventListener('resize',()=>closePresenceContext(true));
function presenceCalendar(people,startDate,endDate,compact=false) {
  const dates=LadWork.dates(startDate,endDate),today=localDateKey(),selected=presenceUi.date||today;
  return `<div class="table-scroll presence-calendar-scroll" data-scroll-key="presence-${startDate.slice(0,7)}"><table class="data-table presence-table ${compact?'presence-month-table':''}"><thead><tr><th class="presence-name">Працівник</th>${dates.map(day=>`<th class="presence-calendar-day ${day===today?'is-today':''} ${day===selected?'selected':''} ${[0,6].includes(dateFromKey(day).getDay())?'presence-weekend':''}"><button data-presence-select-date="${day}" aria-label="Стан команди на ${h(formatDate(day))}"><strong>${Number(day.slice(-2))}</strong><small>${h(formatDate(day,{weekday:'short'}))}</small></button></th>`).join('')}</tr></thead><tbody>${people.map(person=>`<tr data-employee-row-color="${activeEmployees().findIndex(item=>item.id===person.id)%DUTY_ROW_COLORS.length}" data-employee-row-id="${h(person.id)}"><th class="presence-name"><span title="${h(person.name)}">${h(shortName(person.name))}</span></th>${dates.map(day=>{
    const valid=LadWork.trackableOn(person,day),item=valid?presenceMark(person.id,day):null,label=valid?(LadPresence.labels[item?.status]||'Не позначено'):'Поза періодом роботи';
    return `<td class="presence-calendar-day ${day===today?'is-today':''} ${day===selected?'selected':''} ${[0,6].includes(dateFromKey(day).getDay())?'presence-weekend':''}"><button class="presence-cell presence-${h(item?.status||'pending')}" aria-haspopup="menu" data-presence-edit="${h(person.id)}" data-presence-cell-date="${day}" ${valid&&!presenceUi.pendingCells.has(person.id+'|'+day)?'':'disabled'} aria-label="${h(person.name+', '+formatDate(day)+': '+label)}" title="${h(label+(item?.note?' · '+item.note:''))}">${h(valid?(LadPresence.symbols[item?.status]||'·'):'—')}</button></td>`;
  }).join('')}</tr>`).join('')||`<tr><td colspan="${dates.length+1}" class="muted">Працівників за цими умовами немає.</td></tr>`}</tbody></table></div>`;
}
function renderPresencePage() {
  const date=presenceUi.date||localDateKey(),people=activeEmployees(),rows=people.map(person=>({person,mark:presenceMark(person.id,date)}));
  const present=rows.filter(row=>LadPresence.working.has(row.mark?.status)).length,zkp=rows.filter(row=>row.mark?.status==='zkp').length;
  const learning=rows.filter(row=>LadPresence.learning.has(row.mark?.status)).length;
  const absent=rows.filter(row=>LadPresence.absent.has(row.mark?.status)).length,missing=rows.filter(row=>!row.mark).length;
  const filtered=rows.filter(row=>row.person.name.toLocaleLowerCase('uk-UA').includes(presenceUi.query.toLocaleLowerCase('uk-UA'))
    &&(presenceUi.filter==='all'||presenceUi.filter==='working'&&LadPresence.working.has(row.mark?.status)||presenceUi.filter==='zkp'&&row.mark?.status==='zkp'
      ||presenceUi.filter==='learning'&&LadPresence.learning.has(row.mark?.status)||presenceUi.filter==='absent'&&LadPresence.absent.has(row.mark?.status)||presenceUi.filter==='pending'&&!row.mark));
  const range=LadPlanner.range(date,presenceUi.view),history=(snapshot.audit||[]).filter(item=>item.action==='presence_changed').slice(-8).reverse();
  const title=presenceUi.view==='month'?formatMonth(date.slice(0,7)):presenceUi.view==='quarter'?`${Math.floor((Number(date.slice(5,7))-1)/3)+1} квартал ${date.slice(0,4)}`:presenceUi.view==='week'?`${formatDate(range.startDate)} — ${formatDate(range.endDate)}`:formatDate(date);
  let content='';
  if(presenceUi.view==='day')content=`<div class="table-scroll"><table class="data-table presence-table"><thead><tr><th>Працівник</th><th>Наявність</th><th>Чергування</th><th>Підстава / примітка</th><th>Дія</th></tr></thead><tbody>${filtered.map(({person,mark})=>`<tr><th>${h(person.name)}</th><td>${presenceBadge(mark,date)}${mark?.status==='zkp'?'<small>Працює в іншому офісі</small>':''}</td><td>${LadPresence.dutyBlocked.has(mark?.status)?'<span class="presence-unavailable">Недоступний</span>':mark?'<span>Наявність дозволяє</span>':'<span class="muted">Немає обмеження</span>'}</td><td>${h(mark?.note||'—')}${mark?.actor?`<small>${h(mark.actor)}</small>`:''}</td><td><button class="button small" aria-haspopup="menu" data-presence-edit="${h(person.id)}" data-presence-cell-date="${date}" ${presenceUi.pendingCells.has(person.id+'|'+date)?'disabled aria-busy="true"':''}>${mark?'Змінити':'Позначити'}</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">Працівників за цими умовами немає.</td></tr>'}</tbody></table></div>`;
  else if(presenceUi.view==='quarter')content=Array.from({length:3},(_,i)=>{
    const month=monthShift(range.startDate.slice(0,7),i),period=LadPlanner.range(month+'-01','month');
    return `<section class="presence-quarter-month"><button class="presence-month-link" data-presence-month="${month}">${h(formatMonth(month))} ↗</button>${presenceCalendar(filtered.map(row=>row.person),period.startDate,period.endDate,true)}</section>`;
  }).join('');
  else content=presenceCalendar(filtered.map(row=>row.person),range.startDate,range.endDate,presenceUi.view==='month');
  return `<header class="page-header presence-page-header"><div><span class="page-eyebrow">Доступність команди</span><h1>Наявність</h1><p>Головна позначка для табеля, віджета, аналітики й чергувань. Субота й неділя — вихідні, доки ви не зміните статус.</p></div><div class="button-row"><button class="button primary" data-presence-new ${people.length?'':'disabled'}>+ День / період</button><button class="button" data-tab="journal">Табель →</button></div></header>
  <section class="panel presence-controls"><div class="presence-toolbar"><div class="button-row"><button class="button small" data-presence-shift="-1" aria-label="Попередній період">←</button><strong class="presence-period-title">${h(title)}</strong><button class="button small" data-presence-shift="1" aria-label="Наступний період">→</button><button class="button small" data-presence-today>Сьогодні</button></div><div class="button-row" role="group" aria-label="Період наявності">${[['week','Тиждень'],['month','Місяць'],['quarter','Квартал'],['day','День']].map(([key,label])=>`<button class="button small ${presenceUi.view===key?'primary':''}" data-presence-view="${key}" aria-pressed="${presenceUi.view===key}">${label}</button>`).join('')}</div></div>
  <div class="presence-filter-line"><label class="field presence-date-field"><span>Стан на дату</span><input type="date" data-presence-date value="${date}" required></label><label class="field presence-search"><span class="sr-only">Знайти працівника</span><input type="search" data-presence-query value="${h(presenceUi.query)}" placeholder="Знайти працівника"></label><div class="presence-summary" aria-label="Фільтри за наявністю на вибрану дату">${[['all','Усі',people.length],['working','Працюють',present],['zkp','ЗКП',zkp],['learning','Навчання',learning],['absent','Відсутні',absent],['pending','Без позначки',missing]].map(([key,label,count])=>`<button data-presence-filter="${key}" class="${presenceUi.filter===key?'active':''}" aria-pressed="${presenceUi.filter===key}"><span>${label}</span><strong>${count}</strong></button>`).join('')}</div></div></section>
  ${date>localDateKey()?'<p class="presence-plan-note">Майбутні позначки — план. До фактичних днів роботи вони ще не додаються.</p>':''}${renderConsequenceBanner()}
  <section class="panel presence-calendar-panel">${content}<div class="presence-legend" aria-label="Позначки наявності">${Object.entries(LadPresence.labels).map(([key,label])=>`<span><b class="presence-${key}">${h(LadPresence.symbols[key])}</b>${h(label)}</span>`).join('')}<span><b>·</b>Не позначено</span></div><p class="muted presence-hint">Ліва кнопка — змінити день. Права кнопка — одразу зберегти статус або видалити позначку (з клавіатури: Shift+F10). «+ День / період» — для кількох людей і дат. ЗКП дозволяє чергування. Аркан («А») — робота без здачі документів; не чергує цього дня й напередодні. Вихідний можна замінити будь-яким статусом.</p></section>
  <details class="panel presence-explainer"><summary>Як працює наявність</summary><p>Позначки тут мають пріоритет над ручним обліком і роботою над проєктами. Відсутність охоплює календарні дні, включно з вихідними, виключає людину з чергувань і не стає пропуском.</p><p>«На роботі» та «ЗКП» визначають місце роботи. ЗКП не зараховує роботу автоматично: після повернення в офіс підтвердьте ті дні, за які отримано роботу. Аркан («А») — працівник на роботі, документи здавати не потрібно; чергування заборонене цього дня та напередодні в усіх графіках. Вихідний не створює пропуску; чергування у вихідні визначають правила графіка. Обидва види навчання дозволяють чергування; навчання рахується окремо й не стає пропуском. Для роботи у вихідний позначте «На роботі» у «Наявності»; дата стане робочою. Без позначки зберігається поточний облік роботи. Інші правила графіка діють окремо.</p></details>
  <details class="panel presence-history-panel"><summary>Останні зміни наявності <span class="count-pill">${history.length}</span></summary>${history.map(item=>`<article class="presence-history"><strong>${h(item.details.employeeIds.map(id=>employeeById(id)?.name||'Працівник з історії').join(', '))}</strong><span>${h(formatDate(item.details.startDate))} — ${h(formatDate(item.details.endDate))} · ${h(item.details.action==='clear'?'Позначку очищено':LadPresence.labels[item.details.status])}</span><p>${h(item.details.reason)}</p><small>${h(item.details.actor)} · ${h(new Date(item.at).toLocaleString('uk-UA'))}</small></article>`).join('')||'<p class="muted">Зміни зберігатимуть тут підставу, автора й час.</p>'}</details>`;
}
function presenceInput(form) {
  const data=new FormData(form),status=String(data.get('status')||'');
  return {employeeIds:data.getAll('employeeIds').map(String),startDate:String(data.get('startDate')||''),endDate:String(data.get('endDate')||''),
    action:status==='clear'?'clear':'set',status:status==='clear'?null:status,reason:String(data.get('reason')||'')};
}
function openPresenceForm(input={}) {
  closePresenceContext(true);
  presenceUi.revision++;presenceUi.busy=false;
  const date=input.startDate||input.date||presenceUi.date||localDateKey(),existing=input.employeeId?presenceMark(input.employeeId,date):null;
  presenceUi.draft={...input,employeeIds:input.employeeIds||[input.employeeId||activeEmployees()[0]?.id].filter(Boolean),startDate:date,endDate:input.endDate||date,
    status:input.status||existing?.status||'onsite',reason:input.reason??(existing?.source==='calendar_presence'?'':existing?.note)??''};
  presenceUi.report=null;renderPresenceForm();
}
function presencePreviewHtml(report) {
  const duties=[...new Map(report.duties.map(duty=>[duty.scheduleId+'|'+duty.date,duty])).values()];
  return `<section class="staff-impact" data-presence-impact><h3>Перевірка перед збереженням</h3><p><strong>${report.count}</strong> позначок; <strong>${duties.length}</strong> днів графіків потребують заміни; <strong>${report.tasks.length}</strong> завдань — перевірки.</p>${report.skipped.length?`<p>Пропущено ${report.skipped.length} дат поза періодом роботи працівника.</p>`:''}${report.blockers.length?`<div class="confirm-box" role="alert"><ul>${report.blockers.map(reason=>`<li>${h(reason)}</li>`).join('')}</ul></div>`:''}<details><summary>Перевірити позначки</summary><ul>${report.cells.slice(0,30).map(cell=>`<li>${h(cell.name)} · ${h(formatDate(cell.date))}: ${h(LadPresence.labels[cell.before?.status]||'Не позначено')} → ${h(LadPresence.labels[cell.after]||'Без позначки наявності')}</li>`).join('')}</ul>${report.count>30?`<p>Показано перші 30 із ${report.count} позначок.</p>`:''}</details>${duties.length?`<ul>${duties.map(duty=>`<li>${h(duty.scheduleName)} · ${h(formatDate(duty.date))}: ${h(duty.before.map(id=>employeeById(id)?.name||id).join(', '))} → ${h(duty.after.map(id=>employeeById(id)?.name||id).join(', ')||'Потрібні чергові')}</li>`).join('')}</ul><p>Заплановані призначення буде знято з відсутніх. Оберіть заміни в «Наслідках змін».</p>`:''}${report.tasks.length?`<ul>${report.tasks.map(task=>`<li>${h(task.title)} · ${h(formatDate(task.dueDate))}</li>`).join('')}</ul><p>Завдання збережуться. Перевірте їх строки й виконавців.</p>`:''}</section>`;
}
function renderPresenceForm() {
  const draft=presenceUi.draft,people=snapshot.employees.filter(person=>person.active||draft.employeeIds.includes(person.id));
  openManagementModal(`<form id="presence-form"><header class="modal-head"><div><span class="page-eyebrow">Єдина позначка для всіх розділів</span><h2>Наявність працівників</h2><p>Один день або період до 366 календарних днів.</p></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body task-form-body"><fieldset class="presence-picker"><legend>Працівники</legend><button class="button small" type="button" data-presence-pick-all>Вибрати / зняти всіх</button><div>${people.map(person=>`<label class="check-row"><input type="checkbox" name="employeeIds" value="${h(person.id)}" ${draft.employeeIds.includes(person.id)?'checked':''}><span>${h(person.name)}${person.active?'':' · архів'}</span></label>`).join('')}</div></fieldset><div class="form-grid"><label class="field"><span>Від</span><input type="date" name="startDate" value="${h(draft.startDate)}" required></label><label class="field"><span>До включно</span><input type="date" name="endDate" value="${h(draft.endDate)}" required></label></div><label class="field"><span>Наявність</span><select name="status">${[...Object.entries(LadPresence.labels),['clear','Очистити позначку наявності']].map(([value,label])=>`<option value="${value}" ${draft.status===value?'selected':''}>${h(label)}</option>`).join('')}</select></label><p class="muted">ЗКП: працює в іншому офісі та може чергувати; роботу зараховують окремо після повернення в офіс. Обидва види навчання також дозволяють чергування. Очищення поверне облік за роботою й ручними позначками; минулий день без роботи може знову потребувати позначки.</p><label class="field"><span>Підстава / пояснення · необов’язково</span><textarea name="reason" rows="2" maxlength="500" placeholder="Наприклад, відпустка за наказом або робота на ЗКП">${h(draft.reason)}</textarea></label>${presenceUi.report?presencePreviewHtml(presenceUi.report):'<p class="muted">Можна зберегти одразу. «Перевірити наслідки» — за бажанням; обмеження перевіряються під час збереження.</p>'}<p data-presence-error role="alert" hidden></p></div><footer class="modal-foot three-way"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button" type="submit" ${presenceUi.busy?'disabled':''}>Перевірити наслідки</button><button class="button primary" type="button" data-presence-apply ${presenceUi.busy||presenceUi.report&&!presenceUi.report.canApply?'disabled':''}>Зберегти наявність</button></footer></form>`,true);
}
function invalidatePresence(form) {
  if(!form)return;
  const input=presenceInput(form);presenceUi.draft={...input,status:input.action==='clear'?'clear':input.status};presenceUi.report=null;
  form.querySelector('[data-presence-apply]').disabled=presenceUi.busy;form.querySelector('[data-presence-impact]')?.remove();
}
async function handlePresenceClick(event) {
  const target=event.target;
  if(target.closest('[data-presence-new]')){openPresenceForm();return true;}
  const edit=target.closest('[data-presence-edit]');if(edit){openPresenceForm({employeeId:edit.dataset.presenceEdit,date:edit.dataset.presenceCellDate});return true;}
  const shift=target.closest('[data-presence-shift]');if(shift){presenceUi.date=presenceShiftDate(presenceUi.date||localDateKey(),Number(shift.dataset.presenceShift));renderShell();return true;}
  if(target.closest('[data-presence-today]')){presenceUi.date=localDateKey();renderShell();return true;}
  const filter=target.closest('[data-presence-filter]');if(filter){presenceUi.filter=filter.dataset.presenceFilter;renderShell();return true;}
  const selectedDate=target.closest('[data-presence-select-date]');if(selectedDate){presenceUi.date=selectedDate.dataset.presenceSelectDate;renderShell();return true;}
  const month=target.closest('[data-presence-month]');if(month){presenceUi.date=month.dataset.presenceMonth+'-01';presenceUi.view='month';renderShell();return true;}
  const view=target.closest('[data-presence-view]');if(view){presenceUi.view=view.dataset.presenceView;renderShell();return true;}
  if(target.closest('[data-presence-pick-all]')){const form=target.closest('form'),inputs=[...form.querySelectorAll('[name="employeeIds"]')],check=inputs.some(input=>!input.checked);inputs.forEach(input=>input.checked=check);invalidatePresence(form);return true;}
  const apply=target.closest('[data-presence-apply]');if(apply){
    if(presenceUi.busy||!apply.form.reportValidity())return true;
    presenceUi.busy=true;const form=apply.form,report=presenceUi.report,revision=presenceUi.revision,input=presenceInput(form);
    form.querySelectorAll('input,select,textarea,button').forEach(control=>control.disabled=true);
    const result=await run(()=>report?window.counter.applyPresence({change:report.change,expectedToken:report.token}):window.counter.savePresence(input),null);
    if(revision===presenceUi.revision){presenceUi.busy=false;presenceUi.report=null;}
    if(result){if(form.isConnected){closeModal(form);ui.tab='presence';presenceUi.date=result.change.startDate;renderShell();}showToast('Наявність збережено для всіх розділів.',{undo:true});}
    else if(form.isConnected){form.querySelectorAll('input,select,textarea,button').forEach(control=>control.disabled=false);invalidatePresence(form);const error=form.querySelector('[data-presence-error]');error.hidden=false;error.textContent='Зміну не збережено. Усуньте вказану причину й спробуйте ще раз.';}
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
  form.querySelector('[data-presence-apply]').disabled=true;
  try {
    const report=await window.counter.previewPresence(input);
    if(revision===presenceUi.revision&&form.isConnected&&submitted===JSON.stringify(presenceInput(form))){presenceUi.report=report;presenceUi.busy=false;renderPresenceForm();modalRoot.querySelector('[data-presence-impact]')?.scrollIntoView({block:'nearest'});}
    else if(form.isConnected)form.querySelector('[type="submit"]').disabled=false;
  }catch(error){if(form.isConnected){const notice=form.querySelector('[data-presence-error]');notice.textContent=error.message;notice.hidden=false;form.querySelector('[type="submit"]').disabled=false;}}
  finally{if(revision===presenceUi.revision){presenceUi.busy=false;if(form.isConnected)form.querySelector('[data-presence-apply]').disabled=Boolean(presenceUi.report&&!presenceUi.report.canApply);}}
  return true;
}
