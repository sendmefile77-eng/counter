/* Saved match draws use the operating system random source in the main process. */
const availableDrawPeople=()=>activeEmployees().filter(person=>!LadPresence.absent.has(LadPresence.get(snapshot,person.id,localDateKey())?.status));
const drawUi = { draft:null, resultId:'', query:'', page:0, busy:false, reveal:null };
function drawById(id) { return (snapshot.draws || []).find(draw => draw.id === id); }
function drawDraft() {
  if (!drawUi.draft) drawUi.draft = { title:'', description:'', count:1, participantIds:availableDrawPeople().map(person => person.id), previousDrawId:'', rerollReason:'' };
  if(!drawUi.busy){const ids=new Set(availableDrawPeople().map(person=>person.id));drawUi.draft.participantIds=drawUi.draft.participantIds.filter(id=>ids.has(id));}
  return drawUi.draft;
}
function matchIcon(short = false) {
  return `<svg class="draw-match ${short ? 'short' : ''}" viewBox="0 0 24 ${short ? 44 : 64}" aria-hidden="true"><path d="M9 15h6v${short ? 26 : 46}H9z"/><ellipse cx="12" cy="12" rx="5" ry="7"/></svg>`;
}
function drawChance(draw) { return `${(100 * draw.count / draw.participants.length).toLocaleString('uk-UA',{ maximumFractionDigits:2 })}%`; }
function drawDeleteButton(draw) {
  const task=draw.taskId&&taskById(draw.taskId),blocked=task&&LadPlanner.active(task);
  return `<button class="button small danger" data-draw-delete="${h(draw.id)}" ${blocked||drawUi.busy?'disabled':''} title="${blocked?'Спочатку виконайте або скасуйте пов’язане завдання':'Видалити завершений протокол; завдання збережеться'}" aria-label="Видалити протокол №${draw.number}">Видалити</button>`;
}
function drawResultHtml(draw, full = false) {
  const selected = draw.selectedIds.map(id => draw.participants.find(person => person.id === id));
  const linked = draw.taskId && taskById(draw.taskId);
  const unavailable = selected.some(person => !employeeById(person.id)?.active);
  return `<section class="panel draw-result" aria-label="Результат жеребкування"><div class="rules-heading"><div><span class="page-eyebrow">Протокол №${draw.number} · результат збережено</span><h2>${h(draw.title)}</h2><p>${h(new Date(draw.createdAt).toLocaleString('uk-UA'))} · ${h(draw.createdBy)}</p></div><span class="count-pill">${draw.count} із ${draw.participants.length}</span></div><div class="draw-winners">${selected.map(person => `<div class="draw-person">${matchIcon(true)}<div><small>Короткий сірник · виконавець</small><strong>${h(person.name)}</strong></div></div>`).join('')}</div>${draw.description ? `<p class="task-description">${h(draw.description)}</p>` : ''}<p class="muted">Шанс кожного учасника потрапити до складу: ${drawChance(draw)}. Вибір випадковий, без повторів.</p>${draw.previousDrawId ? `<p class="confirm-box">Повторне жеребкування. Причина: ${h(draw.rerollReason)} ${drawById(draw.previousDrawId)?`<button class="button small" data-draw-protocol="${h(draw.previousDrawId)}">Попередній протокол</button>`:`<span>Попередній протокол №${draw.previousDrawNumber||'—'} видалено.</span>`}</p>` : ''}${unavailable && !linked ? '<p class="confirm-box">Один з обраних працівників уже в архіві. Для нового завдання проведіть нове жеребкування або призначте відповідальних у планувальнику.</p>' : ''}<div class="button-row">${linked ? `<button class="button primary" data-open-task="${h(linked.id)}">Відкрити завдання</button>` : `<button class="button primary" data-draw-task="${h(draw.id)}" ${unavailable ? 'disabled' : ''}>Створити завдання</button>`}${!full ? `<button class="button" data-draw-protocol="${h(draw.id)}">Повний протокол</button>` : ''}<button class="button" data-draw-repeat="${h(draw.id)}">Повторити з поясненням</button>${drawDeleteButton(draw)}</div>${full ? `<h3>Усі учасники · імена на момент розіграшу</h3><div class="draw-participants">${draw.participants.map(person => `<div class="draw-person">${matchIcon(draw.selectedIds.includes(person.id))}<div><strong>${h(person.name)}</strong><small>${draw.selectedIds.includes(person.id) ? 'Короткий сірник · обрано' : 'Довгий сірник · не обрано'}</small></div></div>`).join('')}</div><p class="muted">Метод: рівномірне перемішування Fisher–Yates; випадкові числа від операційної системи. Автор — локальна позначка з налаштувань.</p><small class="muted">ID протоколу: ${h(draw.id)}</small>` : ''}</section>`;
}
function renderDrawPage() {
  const draft = drawDraft(), people = availableDrawPeople(), selected = new Set(draft.participantIds);
  const result = drawUi.reveal ? null : drawById(drawUi.resultId);
  const query = drawUi.query.toLocaleLowerCase('uk-UA');
  const history = [...(snapshot.draws || [])].reverse().filter(draw => `${draw.number} ${draw.title} ${draw.createdBy} ${draw.rerollReason} ${draw.participants.map(person => person.name).join(' ')}`.toLocaleLowerCase('uk-UA').includes(query));
  const pages = Math.max(1,Math.ceil(history.length / 15)); drawUi.page = Math.min(drawUi.page,pages - 1);
  return `<header class="page-header"><div><span class="page-eyebrow">ЛАД · чесний випадковий вибір</span><h1>Тягнути сірник</h1><p>Немає добровольців? Оберіть коло учасників і кількість виконавців. Відсутні за даними «Наявності» не беруть участі.</p></div><div class="button-row"><button class="button" data-tab="coins">Підкинути монетку →</button><button class="button primary" data-draw-new>Нове жеребкування</button></div></header>${result ? drawResultHtml(result) : ''}<div class="draw-layout"><section class="panel"><form id="draw-form"><div class="rules-heading"><div><h2>${draft.previousDrawId ? 'Повторне жеребкування' : 'Кому дістанеться короткий сірник?'}</h2><p>Результат зберігається одразу й залишається в історії.</p></div>${matchIcon()}</div><label class="field"><span>Яку роботу треба виконати? *</span><input name="title" value="${h(draft.title)}" minlength="2" maxlength="160" required placeholder="Наприклад, підготувати приміщення"></label><label class="field"><span>Пояснення роботи</span><textarea name="description" maxlength="1500" rows="2">${h(draft.description)}</textarea></label><label class="field"><span>Кількість виконавців *</span><input type="number" name="count" min="1" max="${Math.max(1,selected.size)}" value="${h(draft.count)}" required></label>${draft.previousDrawId ? `<label class="field"><span>Чому проводите повторно? *</span><textarea name="rerollReason" rows="2" maxlength="500" required>${h(draft.rerollReason)}</textarea><small>Попередній результат залишиться в історії. Склад учасників можна змінити.</small></label>` : ''}<fieldset class="draw-picker"><legend>Хто тягне сірник?</legend><div class="button-row"><button type="button" class="button small" data-draw-select="all">Усі доступні сьогодні</button><button type="button" class="button small" data-draw-select="none">Зняти вибір</button></div><div class="draw-checks">${people.map(person => `<label class="check-row"><input type="checkbox" name="participantIds" value="${h(person.id)}" ${selected.has(person.id) ? 'checked' : ''}><span>${h(person.name)}</span></label>`).join('') || '<p class="muted">Спочатку додайте працівників у розділі «Працівники».</p>'}</div></fieldset><p class="draw-odds" data-draw-odds aria-live="polite"></p><p class="muted draw-note">Збережений розіграш створює точку відліку для скасування дій. Після нього можна скасовувати лише подальші зміни. Табель і графік чергувань не змінюються.</p><p data-draw-error role="alert" hidden></p><button type="submit" class="button primary draw-submit" ${!people.length || drawUi.busy ? 'disabled' : ''}>${drawUi.busy ? 'Зберігаємо результат…' : 'Тягнути сірники й зберегти результат'}</button></form></section><section class="panel draw-history"><h2>Історія жеребкувань <span class="count-pill">${(snapshot.draws || []).length}</span></h2><label class="field"><span>Знайти протокол</span><input type="search" data-draw-search value="${h(drawUi.query)}" placeholder="Робота, ім’я або номер"></label><div>${history.slice(drawUi.page * 15,(drawUi.page + 1) * 15).map(draw => `<div class="draw-history-item"><button class="draw-history-row" data-draw-protocol="${h(draw.id)}"><span><small>№${draw.number} · ${h(new Date(draw.createdAt).toLocaleString('uk-UA'))}</small><strong>${h(draw.title)}</strong><small>${drawUi.reveal && draw.id === drawUi.resultId ? 'Сірники ще витягуються…' : h(draw.selectedIds.map(id => draw.participants.find(person => person.id === id).name).join(', '))}</small>${draw.previousDrawId ? '<small>Повторний розіграш · є пояснення</small>' : ''}</span><span aria-hidden="true">→</span></button>${drawDeleteButton(draw)}</div>`).join('') || '<p class="muted">Протоколів поки немає або нічого не знайдено.</p>'}</div>${pages > 1 ? `<div class="button-row"><button class="button small" data-draw-page="-1" ${drawUi.page === 0 ? 'disabled' : ''}>← Назад</button><span>${drawUi.page + 1} / ${pages}</span><button class="button small" data-draw-page="1" ${drawUi.page + 1 === pages ? 'disabled' : ''}>Далі →</button></div>` : ''}</section></div>`;
}
function updateDrawOdds() {
  const form = appRoot.querySelector('#draw-form'); if (!form) return;
  form.setAttribute('aria-busy',String(drawUi.busy));
  form.querySelectorAll('input,textarea,[data-draw-select]').forEach(field => { field.disabled = drawUi.busy; });
  const draft = drawDraft(), n = draft.participantIds.length, k = Number(draft.count);
  form.elements.count.max = Math.max(1,n);
  form.querySelector('[data-draw-odds]').textContent = n && k >= 1 && k <= n ? `Учасників: ${n} · обираємо ${k} · шанс кожного: ${(100*k/n).toLocaleString('uk-UA',{maximumFractionDigits:2})}%` : `Учасників: ${n}. Оберіть учасників і від 1 до ${n || 1} виконавців.`;
}
// The show only reveals an already saved protocol; it never draws again.
function finishDrawReveal({ close = true, focus = true } = {}) {
  const reveal = drawUi.reveal;
  if (!reveal) return;
  clearTimeout(reveal.timer);
  document.removeEventListener('visibilitychange',reveal.onVisibility);
  reveal.motion.removeEventListener('change',reveal.onMotion);
  drawUi.reveal = null;
  drawUi.busy = false;
  renderShell();
  if (close && modalRoot.contains(reveal.dialog)) closeModal(reveal.dialog);
  const showResult = () => {
    if (ui.tab !== 'draws' || modalRoot.childElementCount) return;
    appRoot.querySelector('.draw-result')?.scrollIntoView({block:'start'});
    if (focus) appRoot.querySelector('.draw-result [data-draw-task], .draw-result [data-open-task]')?.focus({preventScroll:true});
  };
  if (close) showResult(); else queueMicrotask(showResult);
}
function startDrawReveal(draw) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || document.hidden || (typeof LadMotion !== 'undefined' && LadMotion.level() !== 'full')) return false;
  const count = draw.selectedIds.length, pace = Math.max(650,Math.min(3200,11000/count)), suspenseTime=Math.round(pace*.25), pullTime = Math.round(pace*.56);
  const sticks = draw.participants.map(person => `<span class="draw-bundle-match" data-reveal-stick="${h(person.id)}"><i></i></span>`).join('');
  toastRoot.querySelectorAll('.toast').forEach(toast => toast.remove());
  openModal(`<header class="modal-head"><div><span class="page-eyebrow">Протокол №${draw.number}</span><h2>Тягнемо сірники</h2><p>${h(draw.title)}</p></div><button class="icon-button" type="button" data-close-modal aria-label="Пропустити анімацію та показати результат">×</button></header><div class="modal-body draw-reveal-body"><div class="draw-reveal-stage" data-reveal-phase="mix" aria-hidden="true"><div class="draw-stage-ring"></div><div class="draw-stage-rays"></div><div class="draw-stage-sparks">${Array.from({length:12},(_,i)=>`<i data-spark="${i}"></i>`).join('')}</div><div class="draw-match-bundle">${sticks}</div><div class="draw-match-band"><strong>ЛАД</strong><span>Кому короткий?</span></div><div class="draw-pull-slot"></div><span class="draw-short-label">Короткий сірник</span></div><p class="draw-reveal-status" role="status" aria-live="polite">Перемішуємо сірники…</p><div class="draw-reveal-people">${draw.selectedIds.map((id,index) => `<div class="draw-reveal-person" data-reveal-person="${h(id)}"><span class="draw-reveal-number">${index + 1}</span><div><small>Виконавець ${index + 1}</small><strong>Сірник ще не витягнуто</strong></div></div>`).join('')}</div><p class="draw-reveal-note">Результат уже збережено. Можна пропустити анімацію — склад залишиться тим самим.</p></div><footer class="modal-foot"><span class="draw-reveal-progress">0 із ${count}</span><button class="button primary" type="button" data-draw-reveal-skip>Показати результат</button></footer>`,true);
  const dialog = modalRoot.querySelector('.modal');
  dialog.classList.add('draw-reveal-modal');
  dialog.querySelectorAll('[data-reveal-stick]').forEach((stick,index) => {
    const offset = index - (draw.participants.length - 1) / 2;
    stick.style.setProperty('--match-x',`${offset * 13}px`);
    stick.style.setProperty('--match-angle',`${offset * 4}deg`);
    stick.style.setProperty('--match-delay',`${index * -53}ms`);
  });
  dialog.querySelectorAll('[data-spark]').forEach((spark,index)=>{spark.style.setProperty('--spark-angle',`${index*30}deg`);spark.style.setProperty('--spark-delay',`${index*23}ms`);});
  const reveal = { dialog, timer:null, motion,
    onVisibility:() => { if (document.hidden) finishDrawReveal(); },
    onMotion:event => { if (event.matches) finishDrawReveal(); } };
  drawUi.reveal = reveal;
  renderShell();
  document.addEventListener('visibilitychange',reveal.onVisibility);
  motion.addEventListener('change',reveal.onMotion);
  const later = (callback,delay) => { reveal.timer = setTimeout(() => { if (drawUi.reveal === reveal && dialog.isConnected) callback(); },delay); };
  const stage = dialog.querySelector('.draw-reveal-stage'), status = dialog.querySelector('.draw-reveal-status');
  const step = index => {
    const id = draw.selectedIds[index], person = draw.participants.find(item => item.id === id);
    stage.dataset.revealPhase = 'suspense';
    stage.querySelector('.draw-pull-slot').innerHTML = '';
    status.textContent = `Зараз дізнаємося… сірник ${index + 1} із ${count}`;
    later(() => {
      stage.dataset.revealPhase = 'pull';
      status.textContent = 'Повільно витягуємо…';
      [...stage.querySelectorAll('[data-reveal-stick]')].find(stick => stick.dataset.revealStick === id).classList.add('is-taken');
      stage.querySelector('.draw-pull-slot').innerHTML = '<span class="draw-pulled-match"><i></i></span>';
      stage.querySelector('.draw-pulled-match').style.setProperty('--pull-time',`${pullTime}ms`);
      later(() => {
        stage.dataset.revealPhase = 'revealed';
        const card = [...dialog.querySelectorAll('[data-reveal-person]')].find(item => item.dataset.revealPerson === id);
        card.classList.add('is-revealed');card.querySelector('strong').textContent = person.name;
        status.textContent = `Короткий сірник — ${person.name}`;
        dialog.querySelector('.draw-reveal-progress').textContent = `${index + 1} із ${count}`;
        card.scrollIntoView({block:'nearest'});
        later(() => {
          if (index + 1 < count) step(index + 1);
          else {
            stage.dataset.revealPhase = 'complete';dialog.querySelector('h2').textContent = 'Сірники витягнуто';
            status.textContent = `Обрано ${count} із ${draw.participants.length}. Результат збережено.`;
            later(() => finishDrawReveal(),1500);
          }
        },pace-suspenseTime-pullTime);
      },pullTime);
    },suspenseTime);
  };
  later(() => {
    stage.dataset.revealPhase='suspense';status.textContent='Усі сірники однакові на вигляд. Хто витягне короткий?';
    later(()=>step(0),1200);
  },3000);
  return true;
}
function captureDrawInput(event) {
  const form = event.target.closest('#draw-form'); if (!form) return;
  const data = new FormData(form), draft = drawDraft();
  Object.assign(draft,{ title:String(data.get('title') || ''), description:String(data.get('description') || ''), count:String(data.get('count') || ''), participantIds:data.getAll('participantIds'), rerollReason:String(data.get('rerollReason') || '') });
  updateDrawOdds();
}
function drawProtocolText(draw) {
  return [`ЛАД · Протокол жеребкування №${draw.number}`,draw.title,draw.description,`Дата: ${new Date(draw.createdAt).toLocaleString('uk-UA')}`,`Автор (локальна позначка): ${draw.createdBy}`,`Обираємо: ${draw.count} із ${draw.participants.length}. Шанс кожного: ${drawChance(draw)}.`,...draw.participants.map(person => `${person.name}: ${draw.selectedIds.includes(person.id) ? 'короткий сірник — обрано' : 'довгий сірник — не обрано'}`),draw.previousDrawId ? `Повторний розіграш. Попередній протокол: ${draw.previousDrawId}${draw.previousDrawDeleted?` (№${draw.previousDrawNumber}, видалено)`:""}. Причина: ${draw.rerollReason}` : '',`Метод: ${draw.method}`,`ID: ${draw.id}`].filter(Boolean).join('\n');
}
function openDrawProtocol(id) {
  const draw = drawById(id); if (!draw) return showToast('Протокол не знайдено.',{error:true});
  openManagementModal(`<header class="modal-head"><div><h2>Протокол жеребкування №${draw.number}</h2><p>Початковий склад і результат розіграшу</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body">${drawResultHtml(draw,true)}</div><footer class="modal-foot"><button class="button" data-draw-copy="${h(id)}">Копіювати протокол</button><button class="button primary" data-close-modal>Закрити</button></footer>`,true);
}
async function handleDrawClick(event) {
  const target = event.target;
  if (target.closest('[data-draw-reveal-skip]')) { finishDrawReveal(); return true; }
  if (drawUi.busy && target.closest('[data-draw-new], [data-draw-select], [data-draw-repeat], [data-draw-delete]')) return true;
  if (target.closest('[data-draw-new]')) { drawUi.draft = null; drawUi.resultId = ''; renderShell(); return true; }
  const select = target.closest('[data-draw-select]'); if (select) { drawDraft().participantIds = select.dataset.drawSelect === 'all' ? availableDrawPeople().map(person => person.id) : []; renderShell(); return true; }
  const protocol = target.closest('[data-draw-protocol]'); if (protocol) { openDrawProtocol(protocol.dataset.drawProtocol); return true; }
  const remove=target.closest('[data-draw-delete]');if(remove){
    const draw=drawById(remove.dataset.drawDelete);if(!draw)return true;
    if(!(await confirmAction(`Видалити завершений протокол №${draw.number} «${draw.title}»? Пов’язане завдання збережеться, повторні розіграші збережуть причину. Дію можна скасувати.`,true)))return true;
    const owner=remove.closest('.modal');remove.disabled=true;
    const result=await run(()=>window.counter.deleteDraw(draw.id),null);
    if(result){if(owner?.isConnected)closeModal(owner);if(drawUi.resultId===draw.id)drawUi.resultId='';if(drawUi.draft?.previousDrawId===draw.id)drawUi.draft=null;renderShell();showToast(`Протокол №${draw.number} видалено.`,{undo:true});}
    else if(remove.isConnected)remove.disabled=false;
    return true;
  }
  const repeat = target.closest('[data-draw-repeat]'); if (repeat) {
    const draw = drawById(repeat.dataset.drawRepeat); if (!draw) return true;
    drawUi.draft = { title:draw.title, description:draw.description, count:draw.count, participantIds:draw.participants.filter(person => employeeById(person.id)?.active).map(person => person.id), previousDrawId:draw.id, rerollReason:'' };
    drawUi.resultId = ''; closeModal(); await navigateToTab('draws'); appRoot.querySelector('[name="rerollReason"]')?.focus(); return true;
  }
  const task = target.closest('[data-draw-task]'); if (task) {
    const draw = drawById(task.dataset.drawTask); if (draw) openTaskEditor('','','',{drawId:draw.id,title:draw.title,description:draw.description,assigneeIds:[...draw.selectedIds]}); return true;
  }
  const copy = target.closest('[data-draw-copy]'); if (copy) { try { await navigator.clipboard.writeText(drawProtocolText(drawById(copy.dataset.drawCopy))); showToast('Протокол скопійовано.'); } catch { showToast('Не вдалося скопіювати протокол. Спробуйте ще раз.',{error:true}); } return true; }
  const page = target.closest('[data-draw-page]'); if (page) { drawUi.page += Number(page.dataset.drawPage); renderShell(); return true; }
  return false;
}
async function handleDrawSubmit(event) {
  if (event.target.id !== 'draw-form') return false;
  if (drawUi.busy) return true;
  captureDrawInput({target:event.target.querySelector('[name="title"]')});
  const input = {...drawDraft(),participantIds:[...drawDraft().participantIds]};
  const revision = interfaceDialogRevision, training = Boolean(snapshot.training?.active);
  drawUi.busy = true; renderShell();
  const result = await run(() => window.counter.createDraw(input),null,{undo:false});
  if (training !== Boolean(snapshot.training?.active)) { drawUi.busy = false; renderShell(); return true; }
  if (result) {
    drawUi.resultId = result.id;
    drawUi.draft = {...input,previousDrawId:result.id,rerollReason:''};
    if (ui.tab === 'draws' && ui.mode !== 'widget' && revision === interfaceDialogRevision && startDrawReveal(result)) return true;
    drawUi.busy = false; renderShell();
    if (ui.tab === 'draws' && !modalRoot.childElementCount) appRoot.querySelector('.draw-result')?.scrollIntoView({block:'start'});
    showToast(`Жеребкування №${result.number} збережено.`);
  } else { drawUi.busy = false; renderShell(); const notice = appRoot.querySelector('[data-draw-error]'); if (notice) { notice.hidden = false; notice.textContent = toastRoot.querySelector('.toast.error span')?.textContent || 'Не вдалося зберегти результат. Перевірте дані.'; } }
  return true;
}
