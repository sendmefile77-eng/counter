const ladGuide={active:false,mode:'tour',step:0,revision:0,frame:0,target:null,busy:false,collapsed:false};
function renderLearningIntro() {
  if(snapshot.training?.active)return '<section class="effect-banner training-banner"><div><strong>Навчальна база · ваші робочі дані збережені окремо</strong><p>Усі зміни цього прикладу буде прибрано після виходу.</p></div><button class="button" data-end-training>Повернутися до моїх даних</button></section>';
  if(snapshot.employees.length||snapshot.settings.onboardingSeen)return '';
  return '<section class="effect-banner"><div><strong>Почнімо роботу з ЛАД</strong><p>Пройдіть коротку екскурсію або навчальний приклад із вигаданими працівниками.</p></div><div class="button-row"><button class="button" data-start-guide="tour">Показати кнопки</button><button class="button primary" data-start-guide="practice">Спробувати на прикладі</button></div></section>';
}
function guideSteps() {
  const practice=ladGuide.mode==='practice',scenario=snapshot.training || {},modal=(selector,fallback)=>modalRoot.querySelector(selector)?selector:fallback;
  return [
    {tab:'today',title:'Усе важливе на початку дня',text:'Тут видно роботу співробітників, прогрес проєктів, чергових і завдання зі строками. Із цього огляду починайте щоденну роботу.',selector:'.today-summary'},
    {tab:'employees',title:'Працівники',text:practice?'Це вигадані працівники. Можете додати ще одного для вправи. У робочій базі спочатку додайте людей, які братимуть участь у графіку.':'Додайте працівників. Ім’я відкриває картку; «Наявність» визначає робочі дні, ЗКП та відсутність для всіх розділів.',selector:'#employee-form'},
    {tab:'duties',title:'Учасники й початкові підсумки',text:'Оберіть учасників саме цього графіка та внесіть відомі підсумки. Якщо починаєте з нуля, залиште нулі. Історію іншого графіка сюди переносити не потрібно.',selector:()=>modal('#duty-history-form .modal-body','[data-duty-history]'),prepare:()=>{if(activeEmployees().length)openDutyHistoryModal();}},
    {tab:'duties',title:'Правила графіка',text:'Кількість людей, відпочинок і тижневий ліміт налаштовуються окремо для кожного графіка. Обов’язкові обмеження можуть залишити незаповнене місце; програма пояснить причину.',selector:()=>modal('#duty-rules-form .settings-grid','[data-duty-rules]'),prepare:()=>openDutyRulesModal()},
    {tab:'duties',title:'Перегляд перед формуванням',text:'Виберіть тиждень і натисніть «Переглянути й сформувати». Спочатку перевірте склад і нестачу людей, потім застосуйте. Ручні призначення й заблоковані дні захищені.',selector:()=>modal('[data-apply-duty-preview]','[data-generate-duties]')},
    {tab:'presence',title:practice?'Вправа: запишіть лікарняний':'Записати відсутність',text:practice?`Олена має чергування та строк звіту на ${formatDate(scenario.date)}. Причину вже заповнено для вправи. Натисніть «Перевірити наслідки», перегляньте їх і збережіть зміну.`:'Оберіть працівника, календарний період і причину. Перевірка покаже всі зачеплені графіки й завдання. Виконане чергування чи заблокований тиждень спершу потрібно перевірити окремо.',selector:()=>modal('#presence-form [data-presence-apply]:not(:disabled)',modal('#presence-form [type="submit"]','[data-presence-new]')),prepare:()=>{if(practice)openPresenceForm({employeeId:scenario.employeeId,date:scenario.date,status:'sick',reason:'Навчальний приклад: працівник повідомив про лікарняний'});},ready:()=>!practice||LadPresence.get(snapshot,scenario.employeeId,scenario.date)?.status==='sick'},
    {tab:'consequences',title:'Підміна або обмін',text:practice?'Оберіть будь-яку допустиму підміну, перегляньте аргументи та напишіть причину. Попередження потрібно підтвердити. Застосуйте варіант — вільне місце зникне зі списку.':'Із незаповненого місця відкрийте пошук заміни. Підміна змінює одну дату, обмін — дві. Для обох варіантів перевіряються правила; причина й склад до та після збережуться.',selector:()=>modal('#replacement-apply-form [name="reason"]',modal('[data-replacement-select]','[data-find-replacement]')),prepare:()=>{if(practice)return openReplacementSearch({date:scenario.date,employeeId:scenario.employeeId});},ready:()=>!practice||snapshot.duties.assignments[scenario.date]?.source==='manual_replacement'},
    {tab:'duties',title:'Відповідь на «чому я чергую?»',text:'Тут збережено причину підміни, автора, обидва склади та перевірені умови. Скопіюйте пояснення, щоб показати його працівникові. Це дані на момент рішення.',selector:()=>modal('[data-copy-duty-explanation]','[data-duty-day]'),prepare:()=>{if(practice)return openDutyDayModal(scenario.date);}},
    {tab:'consequences',title:practice?'Вправа: перевірте завдання':'Завдання після зміни доступності',text:practice?'Звіт залишився за відсутньою Оленою. У формі зніміть її та оберіть іншого виконавця або перенесіть строк із причиною. Збережіть завдання — питання зникне.':'Завдання не передаються автоматично. Перевірте виконавця та строк; перенесення потребує пояснення. Виконані й скасовані завдання більше не створюють питання.',selector:()=>modal('#task-form [name="assigneeIds"]','[data-edit-task]'),prepare:()=>{if(practice){const task=snapshot.tasks.find(item=>item.assigneeIds.includes(scenario.employeeId)&&item.dueDate===scenario.date);if(task)openTaskEditor(task.id);}},ready:()=>!practice||!snapshot.tasks.some(task=>LadPlanner.active(task)&&task.assigneeIds.includes(scenario.employeeId)&&task.dueDate===scenario.date)},
    {tab:'data',title:'Резервна копія й завершення',text:practice?'Ви пройшли лікарняний, підміну, пояснення та перевірку завдання. У власній базі зберігайте JSON-копію перед перенесенням чи оновленням. Натисніть «Завершити»: навчальні дані буде прибрано, відкриються ваші.':'JSON містить усю базу. Перед оновленням збережіть копію й залиште папку Counter-data поруч з EXE. Імпорт і відновлення створюють окрему копію попередньої бази.',selector:'[data-export="json"]'},
  ];
}
async function startLadGuide(mode='tour') {
  if(ladGuide.busy)return;ladGuide.busy=true;
  try {
    if(ladGuide.active)await finishLadGuide();
    if(mode==='practice'){await window.counter.enterTraining();await refresh({analytics:false,duties:false});}
    if(ui.mode==='widget'){await window.counter.setWindowMode('dashboard');ui.mode='dashboard';}
    ladGuide.mode=mode;ladGuide.active=true;ladGuide.step=0;await prepareGuideStep();
  }catch(error){showToast(error.message,{error:true});}finally{ladGuide.busy=false;}
}
async function prepareGuideStep() {
  const revision=++ladGuide.revision,step=guideSteps()[ladGuide.step];ladGuide.collapsed=false;closeModal();
  await navigateToTab(step.tab);if(!ladGuide.active||revision!==ladGuide.revision)return;
  await step.prepare?.();if(!ladGuide.active||revision!==ladGuide.revision)return;
  const selector=typeof step.selector==='function'?step.selector():step.selector;
  document.querySelector(selector)?.scrollIntoView({block:'center',behavior:'instant'});
  renderGuide();document.querySelector('#guide-root [data-guide-next]')?.focus();
}
function scheduleGuide(){if(!ladGuide.active||ladGuide.frame)return;ladGuide.frame=requestAnimationFrame(()=>{ladGuide.frame=0;renderGuide();});}
function renderGuide() {
  const root=document.querySelector('#guide-root');if(!ladGuide.active){root.innerHTML='';return;}
  const steps=guideSteps(),step=steps[ladGuide.step],selector=typeof step.selector==='function'?step.selector():step.selector;
  let target=document.querySelector(selector);if(!target||!target.getClientRects().length)target=document.querySelector('.page-header') || appRoot;
  ladGuide.target=target;const box=target.getBoundingClientRect(),pad=7;
  const x=Math.max(8,Math.min(innerWidth-8,box.left-pad)),y=Math.max(8,Math.min(innerHeight-8,box.top-pad)),right=Math.max(x,Math.min(innerWidth-8,box.right+pad)),bottom=Math.max(y,Math.min(innerHeight-8,box.bottom+pad));
  const focused=root.contains(document.activeElement)?document.activeElement.dataset:null;
  root.classList.toggle('guide-with-modal',Boolean(modalRoot.childElementCount));
  root.innerHTML=`<div class="guide-mask" data-mask="top"></div><div class="guide-mask" data-mask="left"></div><div class="guide-mask" data-mask="right"></div><div class="guide-mask" data-mask="bottom"></div><div class="guide-focus" aria-hidden="true"></div><aside class="guide-card" role="dialog" aria-label="Навчання ЛАД"><div class="rules-heading"><span class="page-eyebrow">${ladGuide.mode==='practice'?'Навчальний приклад':'Екскурсія'} · ${ladGuide.step+1} / ${steps.length}</span><div class="button-row"><button class="icon-button" data-guide-toggle aria-label="${ladGuide.collapsed?'Показати підказку':'Згорнути підказку'}">${ladGuide.collapsed?'+':'−'}</button><button class="icon-button" data-guide-close aria-label="Закрити навчання">×</button></div></div><div ${ladGuide.collapsed?'hidden':''}><h2>${h(step.title)}</h2><p>${h(step.text)}</p>${step.ready&&!step.ready()?'<p class="guide-wait" role="status">Виконайте дію, щоб перейти далі. Можна повернутися або завершити навчання.</p>':''}${!document.querySelector(selector)?'<p class="muted">Ця кнопка з’явиться після додавання працівників та початкових даних графіка. У навчальному прикладі вони вже підготовлені.</p>':''}</div><footer class="button-row"><button class="button small" data-guide-back ${ladGuide.step===0?'disabled':''}>← Назад</button><button class="button small" data-guide-close>Завершити</button><button class="button primary small" data-guide-next ${step.ready&&!step.ready()?'disabled':''}>${ladGuide.step===steps.length-1?'Готово':'Далі →'}</button></footer></aside>`;
  const place=(el,left,top,width,height)=>Object.assign(el.style,{left:`${left}px`,top:`${top}px`,width:`${Math.max(0,width)}px`,height:`${Math.max(0,height)}px`});
  place(root.querySelector('[data-mask="top"]'),0,0,innerWidth,y);place(root.querySelector('[data-mask="left"]'),0,y,x,bottom-y);place(root.querySelector('[data-mask="right"]'),right,y,innerWidth-right,bottom-y);place(root.querySelector('[data-mask="bottom"]'),0,bottom,innerWidth,innerHeight-bottom);place(root.querySelector('.guide-focus'),x,y,right-x,bottom-y);
  const card=root.querySelector('.guide-card'),width=Math.min(390,innerWidth-32);card.style.width=`${width}px`;
  const height=Math.min(card.scrollHeight,innerHeight-32),left=Math.min(innerWidth-width-16,Math.max(16,x)),top=bottom+16+height<=innerHeight?bottom+16:y-height-16>=16?y-height-16:16;
  Object.assign(card.style,{left:`${left}px`,top:`${top}px`,maxHeight:`${innerHeight-32}px`});
  if(focused){const key=Object.keys(focused).find(key=>key.startsWith('guide'));if(key)root.querySelector(`[data-${key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}]`)?.focus({preventScroll:true});}
}
async function finishLadGuide() {
  const practice=ladGuide.mode==='practice';ladGuide.active=false;ladGuide.revision++;document.querySelector('#guide-root').innerHTML='';closeModal();
  if(snapshot.training?.active){await window.counter.exitTraining();effectsUi.employeeId='';effectsUi.scheduleId='';effectsUi.query='';effectsUi.kind='all';effectsUi.staffReport=null;effectsUi.replacementReport=null;ui.dutyStats=null;ui.dutyFairness=null;ui.tab='today';await refresh({analytics:false,duties:false});}
  if(!practice&&window.counter.completeOnboarding){await window.counter.completeOnboarding();await refresh({analytics:false,duties:false});}
}
async function handleLearningClick(event) {
  const start=event.target.closest('[data-start-guide]');if(start){await startLadGuide(start.dataset.startGuide);return true;}
  if(event.target.closest('[data-end-training]')){await finishLadGuide();return true;}
  if(event.target.closest('[data-recovery-dismiss]')){await window.counter.acknowledgeRecovery();await refresh();return true;}
  return false;
}
document.querySelector('#guide-root').addEventListener('click',async event=>{
  if(event.target.closest('[data-guide-toggle]')){ladGuide.collapsed=!ladGuide.collapsed;renderGuide();return;}
  if(event.target.closest('[data-guide-close]'))return finishLadGuide().catch(error=>showToast(error.message,{error:true}));
  const back=event.target.closest('[data-guide-back]'),next=event.target.closest('[data-guide-next]');if(!back&&!next||ladGuide.busy)return;
  if(next&&next.disabled)return;ladGuide.busy=true;
  try {if(next&&ladGuide.step===guideSteps().length-1)await finishLadGuide();else{ladGuide.step+=back?-1:1;await prepareGuideStep();}}catch(error){showToast(error.message,{error:true});}finally{ladGuide.busy=false;}
});
document.addEventListener('keydown',event=>{
  if(!ladGuide.active)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();void finishLadGuide().catch(error=>showToast(error.message,{error:true}));return;}
  if(event.key==='Tab') {
    const scope=modalRoot.childElementCount?modalRoot:ladGuide.target,selector='button,input,select,textarea,a[href],[tabindex="0"]';
    const elements=[...(scope?.matches(selector)?[scope]:[]),...(scope?.querySelectorAll(selector) || []),...document.querySelectorAll('#guide-root button')].filter(el=>!el.disabled&&el.getClientRects().length);
    if(elements.length){event.preventDefault();event.stopImmediatePropagation();const current=elements.indexOf(document.activeElement);elements[(current+(event.shiftKey?-1:1)+elements.length)%elements.length].focus();}
  }
},true);
window.addEventListener('resize',scheduleGuide);document.addEventListener('scroll',scheduleGuide,true);
new MutationObserver(scheduleGuide).observe(document.querySelector('#app'),{childList:true,subtree:true});
new MutationObserver(scheduleGuide).observe(document.querySelector('#modal-root'),{childList:true,subtree:true});
