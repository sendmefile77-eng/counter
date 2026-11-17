/* Local, event-driven UI feedback. Presentation never writes accounting data. */
const LadExperience = (() => {
  const savedSegments = new Map(), savedNumbers = new Map(), frames = new Set();
  const imports = {}, pane = {id:'',data:null,view:'overview',loading:false,error:'',revision:0};
  let collapsed = false, tip = null, tipOwner = null, pinned = false, lastReport = null;
  try { collapsed = localStorage.getItem('lad.sidebar.collapsed') === 'true'; } catch (_) {}
  const reduced = () => document.hidden || ['off','reduced'].includes(document.documentElement.dataset.motion) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const number = n => n == null ? '—' : n.toLocaleString('uk-UA', {maximumFractionDigits:1});
  function animate(el, keyframes, options = {}) {
    if (!el?.animate || reduced()) return;
    const a = el.animate(keyframes, {duration:220, easing:'cubic-bezier(.2,.7,.2,1)', ...options});
    a.finished?.catch(() => {}); return a;
  }
  function clearTip() { tip?.remove(); tip = tipOwner = null; pinned = false; }
  function beforeRender() {
    clearTip();
    for (const id of frames) cancelAnimationFrame(id); frames.clear();
    document.querySelectorAll('[data-motion-number]').forEach(el => savedNumbers.set(el.dataset.motionNumber, Number(el.dataset.value)));
    document.querySelectorAll('[data-segment-key]').forEach(group => {
      const b = group.querySelector('button[aria-pressed="true"],button.primary');
      if (b) savedSegments.set(group.dataset.segmentKey, {left:b.offsetLeft,width:b.offsetWidth});
    });
  }
  function roll(el) {
    if (el.dataset.value === '') return;
    const to = Number(el.dataset.value), from = savedNumbers.get(el.dataset.motionNumber);
    if (!Number.isFinite(to) || !Number.isFinite(from) || from === to || reduced()) return;
    const start = performance.now(), percent = el.dataset.percent === 'true';
    function step(time) {
      if (!el.isConnected || reduced()) { el.textContent = number(to) + (percent ? '%' : ''); return; }
      const t = Math.min(1,(time-start)/320), value = from + (to-from)*(1-(1-t)**3);
      el.textContent = number(percent ? Math.round(value*10)/10 : Math.round(value)) + (percent ? '%' : '');
      if (t<1) { const id=requestAnimationFrame(time=>{frames.delete(id);step(time);}); frames.add(id); }
    }
    const id=requestAnimationFrame(time=>{frames.delete(id);step(time);}); frames.add(id);
  }
  function segments(root) {
    for (const attr of ['data-journal-view','data-analytics-preset','data-result-analytics-tab','data-profile-view','data-pane-view','data-activity-period','data-activity-view']) {
      // A contextual action may share a tab attribute. Keep every control in
      // its original section; only sibling choices form a segmented control.
      const parents = new Map();
      root.querySelectorAll('button['+attr+']').forEach(button => {
        const parent=button.parentElement;
        if(!parents.has(parent))parents.set(parent,[]);
        parents.get(parent).push(button);
      });
      let index=0;
      for(const [parent,buttons] of parents) {
        if(buttons.length<2&&!parent.matches('[data-segment-key]'))continue;
        let group=parent.matches('[data-segment-key]')?parent:null;
        if(!group){group=document.createElement('div');group.className='motion-segments';group.dataset.segmentKey=attr+'-'+index;group.setAttribute('role','group');group.setAttribute('aria-label',attr.includes('view')?'Перегляд':'Період');parent.insertBefore(group,buttons[0]);buttons.forEach(button=>group.append(button));}
        index++;
        const selected=buttons.find(button=>button.classList.contains('primary')||button.getAttribute('aria-pressed')==='true');
        if(!selected)continue;
        buttons.forEach(button=>button.setAttribute('aria-pressed',String(button===selected)));
        let indicator=group.querySelector('.motion-segment-indicator');
        if(!indicator){indicator=document.createElement('span');indicator.className='motion-segment-indicator';indicator.setAttribute('aria-hidden','true');group.prepend(indicator);}
        const target={left:selected.offsetLeft,top:selected.offsetTop,width:selected.offsetWidth,height:selected.offsetHeight};
        Object.assign(indicator.style,{left:target.left+'px',top:target.top+'px',width:target.width+'px',height:target.height+'px'});
        const previous=savedSegments.get(group.dataset.segmentKey);
        if(previous)animate(indicator,[{left:previous.left+'px',width:previous.width+'px'},{left:target.left+'px',width:target.width+'px'}]);
      }
    }
  }
  function afterRender(root = appRoot) {
    segments(root);
    root.querySelectorAll('[data-motion-number]').forEach(roll);
    root.querySelectorAll('[data-motion-chart]').forEach(path => {
      if (reduced()) return;
      const length=path.getTotalLength?.(); if(length)animate(path,[{strokeDasharray:length,strokeDashoffset:length},{strokeDasharray:length,strokeDashoffset:0}],{duration:360});
    });
    root.querySelectorAll('[data-pane-row]').forEach(row=>row.dataset.selected=String(row.dataset.paneRow===pane.id));
    const count=root.querySelector('.motion-stepper input');if(count)stepperState(count);
  }
  function stats(report) {
    lastReport=report;
    const points=LadAnalyticsPresentation.series(report.facts,report.rules.daysPerObject);
    return `<div class="motion-stats">${[['workedDays','Відпрацьовано',`Із ${report.total.calendarWorkdays} днів за календарем`],['objectsReceived','Прийнято об’єктів','За фактичною датою здачі'],['kpi','KPI команди',`Норма: ${report.rules.daysPerObject} дня на об’єкт`]].map(([key,label,detail])=>{
      const value=report.total[key], delta=LadAnalyticsPresentation.change(report.total,report.previous?.total,key), plot=LadAnalyticsPresentation.chart(points,key);
      return `<button type="button" class="motion-stat motion-stat-${key}" data-experience-stat="${key}" aria-label="${h(label)}: ${number(value)}${key==='kpi'?'%':''}. Переглянути деталі"><span class="motion-stat-heading">${h(label)}${delta?`<small class="motion-delta ${delta.value<0?'is-negative':''}" title="${h(formatDate(report.previous.startDate))} — ${h(formatDate(report.previous.endDate))}">${delta.value>0?'+':''}${number(delta.value)}${delta.unit==='points'?' в.п.':'%'}</small>`:''}</span><strong data-motion-number="analytics-${key}" data-value="${value??''}" data-percent="${key==='kpi'}">${number(value)}${key==='kpi'&&value!=null?'%':''}</strong><svg viewBox="0 0 300 74" class="motion-chart" role="img" aria-label="${h(label)}: динаміка за датами вибраного періоду"><path d="${plot.path}" data-motion-chart fill="none"/>${plot.points.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="2.7"><title>${h(formatDate(p.from))} — ${h(formatDate(p.to))}: ${number(p.value)}${key==='kpi'?'%':''}</title></circle>`).join('')}</svg><span class="motion-stat-detail">${h(detail)}</span></button>`;
    }).join('')}</div>${report.previous?`<p class="result-note">Порівняння з ${h(formatDate(report.previous.startDate))} — ${h(formatDate(report.previous.endDate))}: така сама кількість минулих календарних днів. Відсоток не показано за відсутності бази або неповної історії.</p>`:''}<div class="motion-exclusions"><strong>Виключено з KPI: ${report.total.excludedDays} днів</strong>${h(resultReasons(report.total)||'Без виключень')}</div>`;
  }
  let tipId=0;
  function kpi(row, rules = LadProductivity.settings(snapshot.settings.productivity)) {
    const id='kpi-tip-'+(++tipId), text=row.kpi==null?'KPI не визначено: немає робочих днів або неповна історія об’єктів.':`${row.objectsReceived} × ${rules.daysPerObject} / ${row.workedDays} × 100 = ${resultPercent(row.kpi)}. ${row.calendarWorkdays} за календарем − ${row.excludedDays} виключено = ${row.workedDays} відпрацьовано. ${resultReasons(row)||'Без виключень'}`;
    return `<button type="button" class="motion-kpi" data-motion-tip="${h(text)}" aria-label="Пояснити KPI ${resultPercent(row.kpi)}" aria-describedby="${id}" data-tip-id="${id}">${resultPercent(row.kpi)} <span aria-hidden="true">ⓘ</span></button>`;
  }
  function showTip(owner, pin = false) {
    if(tipOwner===owner&&pin&&pinned){clearTip();return;}
    clearTip();tipOwner=owner;pinned=pin;
    tip=document.createElement('div');tip.className='motion-tooltip';tip.id=owner.dataset.tipId;tip.setAttribute('role','tooltip');tip.textContent=owner.dataset.motionTip;document.body.append(tip);
    const b=owner.getBoundingClientRect(), r=tip.getBoundingClientRect();
    tip.style.left=Math.max(8,Math.min(innerWidth-r.width-8,b.right-r.width))+'px';tip.style.top=Math.max(8,b.top-r.height-10)+'px';
    animate(tip,[{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:140});
  }
  function steps(kind) {
    const state=imports[kind]; if(!state)return '';
    const names=kind==='activity'?['Читання','Перевірка повторів','Зіставлення','Збереження']:['Читання','Зіставлення','Перевірка','Збереження'];
    return `<section class="motion-import ${state.error?'has-error':state.step===4?'is-done':''}" data-import-status="${kind}" aria-live="polite"><ol>${names.map((label,i)=>`<li class="${i<state.step?'is-done':i===state.step?'is-current':''}" ${i===state.step?'aria-current="step"':''}><b aria-hidden="true">${i<state.step?'✓':i+1}</b>${label}</li>`).join('')}</ol><p>${h(state.message)}</p>${state.step===4?'<span class="motion-success-mark" aria-hidden="true">✓</span>':''}</section>`;
  }
  function stage(kind, step, message, error=false) {
    imports[kind]={step,message,error};
    if(!document.querySelector('[data-import-status="'+kind+'"]')) {
      const anchor=kind==='activity'?appRoot.querySelector('.motion-drop'):appRoot.querySelector('.staff-import-panel');
      anchor?.insertAdjacentHTML('afterend',steps(kind));
    }
    document.querySelectorAll('[data-import-status="'+kind+'"]').forEach(el=>{const holder=document.createElement('div');holder.innerHTML=steps(kind);el.replaceWith(holder.firstElementChild);});
  }
  function dropZone() {return `<div class="motion-drop" data-activity-drop data-activity-pick tabindex="0" role="button" aria-label="Вибрати або перетягнути CSV або ZIP"><span aria-hidden="true">⇧</span><div><strong>Перетягніть сюди історію браузера</strong><small>CSV / ZIP · локальна обробка · перевірка повторів</small></div></div>${steps('activity')}`;}
  function paneHtml() {
    if(!pane.id)return '';
    const person=employeeById(pane.id);if(!person){pane.id='';pane.data=null;pane.revision++;return '';}
    const data=pane.data, profile=person.profile||{}, row=data?.metrics;
    const head=`<header><span class="motion-avatar" aria-hidden="true">${h(person.name.slice(0,2).toLocaleUpperCase('uk-UA'))}</span><div><h2>${h(profile.fullName||person.name)}</h2><p>${h(profile.position||'Посаду не зазначено')}</p></div><button class="icon-button" data-pane-close aria-label="Закрити картку працівника">×</button></header>`;
    const body=pane.loading?'<p role="status">Завантаження картки…</p>':pane.error?`<p role="alert">${h(pane.error)}</p><button class="button" data-pane-retry>Повторити</button>`:data?`<p class="motion-profile-facts">${h(profile.department||'Підрозділ не зазначено')} · ${profile.birthDate?'День народження '+h(birthLabel(profile.birthDate)):'Дата народження не зазначена'}</p><span class="status-badge">${h(resultDayStatus(LadProductivity.fact(snapshot,person,localDateKey())))}</span><div class="motion-profile-totals"><div><strong>${row.workedDays}</strong><small>днів</small></div><div><strong>${row.objectsReceived}</strong><small>об’єктів</small></div><div>${kpi(row)}<small>KPI за поточний місяць</small></div></div><div class="result-tabs">${[['overview','Огляд'],['tasks','Завдання'],['duties','Чергування']].map(([key,label])=>`<button class="button small ${pane.view===key?'primary':''}" data-pane-view="${key}">${label}</button>`).join('')}</div>${pane.view==='tasks'?data.tasks.map(task=>taskRow(task)).join('')||'<p>Завдань немає.</p>':pane.view==='duties'?data.duties.map(d=>`<p>${h(formatDate(d.date))} · ${h(d.scheduleName)} · ${d.realized?'Реалізовано':'Призначено'}</p>`).join('')||'<p>Чергувань немає.</p>':`<p>${h(formatDate(data.startDate))} — ${h(formatDate(data.endDate))}</p><p>${h(resultReasons(row)||'Без виключень із робочих днів')}</p><button class="button" data-pane-full>Докладні результати</button>`}<footer><button class="button" data-employee-data="${h(person.id)}">Редагувати дані</button></footer>`:'';
    return `<aside class="motion-profile-pane" aria-label="Картка працівника" tabindex="-1">${head}${body}</aside>`;
  }
  async function openPane(id, quiet=false) {
    if(!employeeById(id))return;const changed=pane.id!==id;pane.id=id;pane.loading=!quiet;pane.error='';if(changed){pane.data=null;pane.view='overview';}
    const revision=++pane.revision;
    if(!quiet)renderShell({preserveDrafts:true});
    try {const data=await window.counter.getEmployeeOverview({employeeId:id,startDate:localDateKey().slice(0,7)+'-01',endDate:localDateKey()});if(revision!==pane.revision)return;pane.data=data;}
    catch(error){if(revision===pane.revision)pane.error=error.message||String(error);}
    finally {if(revision===pane.revision){pane.loading=false;if(ui.tab==='employees')renderShell({preserveDrafts:true});}}
    if(changed){const el=appRoot.querySelector('.motion-profile-pane');el?.focus({preventScroll:true});animate(el,[{opacity:0,transform:'translateX(12px)'},{opacity:1,transform:'translateX(0)'}]);}
  }
  function stepperState(input) {const group=input.closest('.motion-stepper'),v=input.valueAsNumber;group?.querySelectorAll('[data-count-step]').forEach(b=>b.disabled=!Number.isFinite(v)||(Number(b.dataset.countStep)<0?v<=Number(input.min||0):v>=Number(input.max||100000)));}
  function periodKey(filter) {
    const today=localDateKey();if(filter.endDate!==today)return '';
    const starts={month:today.slice(0,7)+'-01',week:dutyWeekStart(today),year:today.slice(0,4)+'-01-01'};
    if(starts[ui.analyticsPreset]===filter.startDate)return ui.analyticsPreset;
    return Object.keys(starts).find(key=>starts[key]===filter.startDate)||'';
  }
  function palette(dialog) {
    dialog.classList.add('motion-command-palette');
    const trigger=appRoot.querySelector('[data-action="quick-search"]'), b=trigger?.getBoundingClientRect(),d=dialog.getBoundingClientRect();
    if(b)animate(dialog,[{opacity:0,transform:`translate(${(b.left+b.width/2)-(d.left+d.width/2)}px,${b.top-d.top}px) scale(.6)`},{opacity:1,transform:'translate(0,0) scale(1)'}]);
  }
  function quickHighlight(button) {const parent=button?.closest('.quick-results');if(!parent)return;let bar=parent.querySelector('.motion-quick-highlight');if(!bar){bar=document.createElement('span');bar.className='motion-quick-highlight';bar.setAttribute('aria-hidden','true');parent.prepend(bar);}const p=parent.getBoundingClientRect(),b=button.getBoundingClientRect();Object.assign(bar.style,{top:b.top-p.top+parent.scrollTop+'px',height:b.height+'px'});}
  function syncToasts() {
    const toasts=[...toastRoot.querySelectorAll('.toast')];let control=toastRoot.querySelector('[data-toast-stack]');
    if(toasts.length<2){control?.remove();toastRoot.dataset.expanded='false';}else{if(!control){control=document.createElement('button');control.type='button';control.className='motion-toast-control';control.dataset.toastStack='';control.setAttribute('aria-live','off');toastRoot.prepend(control);}const expanded=toastRoot.dataset.expanded==='true';control.textContent=`${toasts.length} повідомлень · ${expanded?'Згорнути':'Показати всі'}`;control.setAttribute('aria-expanded',String(expanded));}
    toasts.forEach((el,i)=>{const hidden=toastRoot.dataset.expanded!=='true'&&i<toasts.length-1;el.toggleAttribute('inert',hidden);el.setAttribute('aria-hidden',String(hidden));el.dataset.toastLatest=String(i===toasts.length-1);el.style.setProperty('--toast-depth',Math.min(2,toasts.length-i-1));});
    toastRoot.dataset.count=String(toasts.length);
  }
  function toastAdded(toast) {
    if(toast.querySelector('[data-toast-undo]'))toastRoot.querySelectorAll('.toast:not(:last-child) [data-toast-undo]').forEach(b=>{b.disabled=true;b.title='Скасування доступне для останньої зміни';});
    syncToasts();if(toastRoot.matches(':hover'))toast.ladPause?.();animate(toast,[{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}]);
  }
  async function click(event) {
    const target=event.target;
    if(target.closest('[data-sidebar-toggle]')){collapsed=!collapsed;try{localStorage.setItem('lad.sidebar.collapsed',String(collapsed));}catch(_){}const layout=appRoot.querySelector('.dashboard-layout');layout.dataset.sidebarCollapsed=String(collapsed);const b=layout.querySelector('[data-sidebar-toggle]');b.setAttribute('aria-expanded',String(!collapsed));b.setAttribute('aria-label',collapsed?'Розгорнути меню':'Згорнути меню');b.textContent=collapsed?'»':'«';setTimeout(updateDutyScrollExtent,reduced()?0:220);return true;}
    const count=target.closest('[data-count-step]');if(count){const input=count.closest('.motion-stepper').querySelector('input');if(!input.checkValidity()){input.reportValidity();return true;}input.value=String(Math.max(Number(input.min||0),Math.min(Number(input.max||100000),input.valueAsNumber+Number(count.dataset.countStep))));input.dispatchEvent(new Event('input',{bubbles:true}));animate(input,[{transform:'translateY(5px)',opacity:.4},{transform:'translateY(0)',opacity:1}],{duration:150});return true;}
    const tipButton=target.closest('[data-motion-tip]');if(tipButton){showTip(tipButton,true);return true;}
    const person=target.closest('[data-employee-profile]');if(person&&ui.tab==='employees'&&appRoot.contains(person)){await openPane(person.dataset.employeeProfile);return true;}
    if(target.closest('[data-pane-close]')){const id=pane.id;pane.id='';pane.data=null;pane.revision++;renderShell({preserveDrafts:true});appRoot.querySelector(`[data-employee-profile="${id}"]`)?.focus();return true;}
    if(target.closest('[data-pane-retry]')){await openPane(pane.id);return true;}
    const view=target.closest('[data-pane-view]');if(view){pane.view=view.dataset.paneView;renderShell({preserveDrafts:true});return true;}
    if(target.closest('[data-pane-full]')){await openEmployeeProfile(pane.id,{view:'results'});return true;}
    const stat=target.closest('[data-experience-stat]');if(stat&&lastReport){const r=lastReport,key=stat.dataset.experienceStat;openModal(`<header class="modal-head"><h2>${{workedDays:'Відпрацьовані дні',objectsReceived:'Прийняті об’єкти',kpi:'Розрахунок KPI'}[key]}</h2><button class="icon-button" data-close-modal>×</button></header><div class="modal-body"><p>${h(formatDate(r.startDate))} — ${h(formatDate(r.endDate))}</p>${key==='kpi'?`<p>${r.total.objectsReceived} × ${r.rules.daysPerObject} / ${r.total.workedDays} × 100 = ${resultPercent(r.total.kpi)}</p><p>${h(resultReasons(r.total)||'Без виключень')}</p>`:''}<div class="table-scroll"><table class="data-table"><thead><tr><th>Працівник</th><th>Дні</th><th>Об’єкти</th><th>KPI</th></tr></thead><tbody>${r.rows.map(row=>`<tr><td><button class="task-title" data-employee-profile="${h(row.employeeId)}">${h(row.name)}</button></td><td>${row.workedDays} із ${row.calendarWorkdays}</td><td>${row.objectsReceived}</td><td>${kpi(row,r.rules)}</td></tr>`).join('')}</tbody></table></div></div>`,true);return true;}
    if(target.closest('[data-activity-drop]')){pickActivityFiles();return true;}
    return false;
  }
  document.addEventListener('pointerover',e=>{const b=e.target.closest('[data-motion-tip]');if(b&&!pinned&&tipOwner!==b)showTip(b);const q=e.target.closest('.quick-result');if(q)quickHighlight(q);});
  document.addEventListener('pointerout',e=>{if(!pinned&&tipOwner?.contains(e.target)&&!tipOwner.contains(e.relatedTarget))clearTip();});
  document.addEventListener('focusin',e=>{const b=e.target.closest('[data-motion-tip]');if(b)showTip(b);const q=e.target.closest('.quick-result');if(q)quickHighlight(q);});
  document.addEventListener('focusout',e=>{if(!pinned&&tipOwner?.contains(e.target))clearTip();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&tip){e.preventDefault();e.stopPropagation();clearTip();}},true);
  document.addEventListener('keydown',e=>{if(e.target.matches('[data-activity-drop]')&&['Enter',' '].includes(e.key)){e.preventDefault();pickActivityFiles();}});
  document.addEventListener('pointerdown',e=>{if(pinned&&!tip?.contains(e.target)&&!tipOwner?.contains(e.target))clearTip();});
  document.addEventListener('input',e=>{if(e.target.matches('.motion-stepper input'))stepperState(e.target);});
  document.addEventListener('dragover',e=>{const zone=e.target.closest('[data-activity-drop],[data-document-drop]');if(zone){e.preventDefault();zone.dataset.dragging='true';}});
  document.addEventListener('dragleave',e=>{const zone=e.target.closest('[data-activity-drop],[data-document-drop]');if(zone&&!zone.contains(e.relatedTarget))delete zone.dataset.dragging;});
  document.addEventListener('drop',()=>{document.querySelectorAll('[data-dragging]').forEach(z=>delete z.dataset.dragging);});
  new MutationObserver(syncToasts).observe(document.getElementById('toast-root'),{childList:true});
  document.getElementById('toast-root').addEventListener('click',e=>{if(e.target.closest('[data-toast-stack]')){toastRoot.dataset.expanded=String(toastRoot.dataset.expanded!=='true');syncToasts();}});
  document.getElementById('toast-root').addEventListener('mouseenter',()=>toastRoot.querySelectorAll('.toast').forEach(t=>t.ladPause?.()));
  document.getElementById('toast-root').addEventListener('mouseleave',()=>toastRoot.querySelectorAll('.toast').forEach(t=>t.ladResume?.()));
  document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const id of frames)cancelAnimationFrame(id);frames.clear();clearTip();document.querySelectorAll('[data-motion-number]').forEach(el=>el.textContent=number(el.dataset.value===''?null:Number(el.dataset.value))+(el.dataset.percent==='true'&&el.dataset.value!==''?'%':''));}});
  window.addEventListener('resize',()=>{if(typeof appRoot!=='undefined'){segments(appRoot);segments(document.getElementById('modal-root'));}});
  return {beforeRender,afterRender,stats,kpi,stage,steps,dropZone,paneHtml,openPane,click,palette,toastAdded,periodKey,get collapsed(){return collapsed;},get paneId(){return pane.id;},refreshPane:()=>{if(pane.id&&!employeeById(pane.id)){pane.id='';pane.data=null;pane.revision++;}return pane.id?openPane(pane.id,true):Promise.resolve();}};
})();
