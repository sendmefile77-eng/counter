/* Saved match draws use the operating system random source in the main process. */
const drawUi = { draft:null, resultId:'', query:'', page:0, busy:false };
function drawById(id) { return (snapshot.draws || []).find(draw => draw.id === id); }
function drawDraft() {
  if (!drawUi.draft) drawUi.draft = { title:'', description:'', count:1, participantIds:activeEmployees().map(person => person.id), previousDrawId:'', rerollReason:'' };
  return drawUi.draft;
}
function matchIcon(short = false) {
  return `<svg class="draw-match ${short ? 'short' : ''}" viewBox="0 0 24 ${short ? 44 : 64}" aria-hidden="true"><path d="M9 15h6v${short ? 26 : 46}H9z"/><ellipse cx="12" cy="12" rx="5" ry="7"/></svg>`;
}
function drawChance(draw) { return `${(100 * draw.count / draw.participants.length).toLocaleString('uk-UA',{ maximumFractionDigits:2 })}%`; }
function drawResultHtml(draw, full = false) {
  const selected = draw.selectedIds.map(id => draw.participants.find(person => person.id === id));
  const linked = draw.taskId && taskById(draw.taskId);
  const unavailable = selected.some(person => !employeeById(person.id)?.active);
  return `<section class="panel draw-result" aria-label="Результат жеребкування"><div class="rules-heading"><div><span class="page-eyebrow">Протокол №${draw.number} · результат збережено</span><h2>${h(draw.title)}</h2><p>${h(new Date(draw.createdAt).toLocaleString('uk-UA'))} · ${h(draw.createdBy)}</p></div><span class="count-pill">${draw.count} із ${draw.participants.length}</span></div><div class="draw-winners">${selected.map(person => `<div class="draw-person">${matchIcon(true)}<div><small>Короткий сірник · виконавець</small><strong>${h(person.name)}</strong></div></div>`).join('')}</div>${draw.description ? `<p class="task-description">${h(draw.description)}</p>` : ''}<p class="muted">Шанс кожного учасника потрапити до складу: ${drawChance(draw)}. Вибір випадковий, без повторів.</p>${draw.previousDrawId ? `<p class="confirm-box">Повторне жеребкування. Причина: ${h(draw.rerollReason)} <button class="button small" data-draw-protocol="${h(draw.previousDrawId)}">Попередній протокол</button></p>` : ''}${unavailable && !linked ? '<p class="confirm-box">Один з обраних працівників уже в архіві. Для нового завдання проведіть нове жеребкування або призначте відповідальних у планувальнику.</p>' : ''}<div class="button-row">${linked ? `<button class="button primary" data-open-task="${h(linked.id)}">Відкрити завдання</button>` : `<button class="button primary" data-draw-task="${h(draw.id)}" ${unavailable ? 'disabled' : ''}>Створити завдання</button>`}${!full ? `<button class="button" data-draw-protocol="${h(draw.id)}">Повний протокол</button>` : ''}<button class="button" data-draw-repeat="${h(draw.id)}">Повторити з поясненням</button></div>${full ? `<h3>Усі учасники · імена на момент розіграшу</h3><div class="draw-participants">${draw.participants.map(person => `<div class="draw-person">${matchIcon(draw.selectedIds.includes(person.id))}<div><strong>${h(person.name)}</strong><small>${draw.selectedIds.includes(person.id) ? 'Короткий сірник · обрано' : 'Довгий сірник · не обрано'}</small></div></div>`).join('')}</div><p class="muted">Метод: рівномірне перемішування Fisher–Yates; випадкові числа від операційної системи. Автор — локальна позначка з налаштувань.</p><small class="muted">ID протоколу: ${h(draw.id)}</small>` : ''}</section>`;
}
function renderDrawPage() {
  const draft = drawDraft(), people = activeEmployees(), selected = new Set(draft.participantIds);
  const result = drawById(drawUi.resultId);
  const query = drawUi.query.toLocaleLowerCase('uk-UA');
  const history = [...(snapshot.draws || [])].reverse().filter(draw => `${draw.number} ${draw.title} ${draw.createdBy} ${draw.rerollReason} ${draw.participants.map(person => person.name).join(' ')}`.toLocaleLowerCase('uk-UA').includes(query));
  const pages = Math.max(1,Math.ceil(history.length / 15)); drawUi.page = Math.min(drawUi.page,pages - 1);
  return `<header class="page-header"><div><span class="page-eyebrow">ЛАД · чесний випадковий вибір</span><h1>Тягнути сірник</h1><p>Немає добровольців? Оберіть коло учасників і кількість виконавців.</p></div><button class="button" data-draw-new>Нове жеребкування</button></header>${result ? drawResultHtml(result) : ''}<div class="draw-layout"><section class="panel"><form id="draw-form"><div class="rules-heading"><div><h2>${draft.previousDrawId ? 'Повторне жеребкування' : 'Кому дістанеться короткий сірник?'}</h2><p>Результат зберігається одразу й залишається в історії.</p></div>${matchIcon()}</div><label class="field"><span>Яку роботу треба виконати? *</span><input name="title" value="${h(draft.title)}" minlength="2" maxlength="160" required placeholder="Наприклад, підготувати приміщення"></label><label class="field"><span>Пояснення роботи</span><textarea name="description" maxlength="1500" rows="2">${h(draft.description)}</textarea></label><label class="field"><span>Кількість виконавців *</span><input type="number" name="count" min="1" max="${Math.max(1,selected.size)}" value="${h(draft.count)}" required></label>${draft.previousDrawId ? `<label class="field"><span>Чому проводите повторно? *</span><textarea name="rerollReason" rows="2" maxlength="500" required>${h(draft.rerollReason)}</textarea><small>Попередній результат залишиться в історії. Склад учасників можна змінити.</small></label>` : ''}<fieldset class="draw-picker"><legend>Хто тягне сірник?</legend><div class="button-row"><button type="button" class="button small" data-draw-select="all">Усі активні</button><button type="button" class="button small" data-draw-select="none">Зняти вибір</button></div><div class="draw-checks">${people.map(person => `<label class="check-row"><input type="checkbox" name="participantIds" value="${h(person.id)}" ${selected.has(person.id) ? 'checked' : ''}><span>${h(person.name)}</span></label>`).join('') || '<p class="muted">Спочатку додайте працівників у розділі «Працівники».</p>'}</div></fieldset><p class="draw-odds" data-draw-odds aria-live="polite"></p><p class="muted draw-note">Збережений розіграш створює точку відліку для скасування дій. Після нього можна скасовувати лише подальші зміни. Табель і графік чергувань не змінюються.</p><p data-draw-error role="alert" hidden></p><button type="submit" class="button primary draw-submit" ${!people.length || drawUi.busy ? 'disabled' : ''}>${drawUi.busy ? 'Зберігаємо результат…' : 'Тягнути сірники й зберегти результат'}</button></form></section><section class="panel draw-history"><h2>Історія жеребкувань <span class="count-pill">${(snapshot.draws || []).length}</span></h2><label class="field"><span>Знайти протокол</span><input type="search" data-draw-search value="${h(drawUi.query)}" placeholder="Робота, ім’я або номер"></label><div>${history.slice(drawUi.page * 15,(drawUi.page + 1) * 15).map(draw => `<button class="draw-history-row" data-draw-protocol="${h(draw.id)}"><span><small>№${draw.number} · ${h(new Date(draw.createdAt).toLocaleString('uk-UA'))}</small><strong>${h(draw.title)}</strong><small>${h(draw.selectedIds.map(id => draw.participants.find(person => person.id === id).name).join(', '))}</small>${draw.previousDrawId ? '<small>Повторний розіграш · є пояснення</small>' : ''}</span><span aria-hidden="true">→</span></button>`).join('') || '<p class="muted">Протоколів поки немає або нічого не знайдено.</p>'}</div>${pages > 1 ? `<div class="button-row"><button class="button small" data-draw-page="-1" ${drawUi.page === 0 ? 'disabled' : ''}>← Назад</button><span>${drawUi.page + 1} / ${pages}</span><button class="button small" data-draw-page="1" ${drawUi.page + 1 === pages ? 'disabled' : ''}>Далі →</button></div>` : ''}</section></div>`;
}
function updateDrawOdds() {
  const form = appRoot.querySelector('#draw-form'); if (!form) return;
  const draft = drawDraft(), n = draft.participantIds.length, k = Number(draft.count);
  form.elements.count.max = Math.max(1,n);
  form.querySelector('[data-draw-odds]').textContent = n && k >= 1 && k <= n ? `Учасників: ${n} · обираємо ${k} · шанс кожного: ${(100*k/n).toLocaleString('uk-UA',{maximumFractionDigits:2})}%` : `Учасників: ${n}. Оберіть учасників і від 1 до ${n || 1} виконавців.`;
}
function captureDrawInput(event) {
  const form = event.target.closest('#draw-form'); if (!form) return;
  const data = new FormData(form), draft = drawDraft();
  Object.assign(draft,{ title:String(data.get('title') || ''), description:String(data.get('description') || ''), count:String(data.get('count') || ''), participantIds:data.getAll('participantIds'), rerollReason:String(data.get('rerollReason') || '') });
  updateDrawOdds();
}
function drawProtocolText(draw) {
  return [`ЛАД · Протокол жеребкування №${draw.number}`,draw.title,draw.description,`Дата: ${new Date(draw.createdAt).toLocaleString('uk-UA')}`,`Автор (локальна позначка): ${draw.createdBy}`,`Обираємо: ${draw.count} із ${draw.participants.length}. Шанс кожного: ${drawChance(draw)}.`,...draw.participants.map(person => `${person.name}: ${draw.selectedIds.includes(person.id) ? 'короткий сірник — обрано' : 'довгий сірник — не обрано'}`),draw.previousDrawId ? `Повторний розіграш. Попередній протокол: ${draw.previousDrawId}. Причина: ${draw.rerollReason}` : '',`Метод: ${draw.method}`,`ID: ${draw.id}`].filter(Boolean).join('\n');
}
function openDrawProtocol(id) {
  const draw = drawById(id); if (!draw) return showToast('Протокол не знайдено.',{error:true});
  openManagementModal(`<header class="modal-head"><div><h2>Протокол жеребкування №${draw.number}</h2><p>Початковий склад і результат розіграшу</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body">${drawResultHtml(draw,true)}</div><footer class="modal-foot"><button class="button" data-draw-copy="${h(id)}">Копіювати протокол</button><button class="button primary" data-close-modal>Закрити</button></footer>`,true);
}
async function handleDrawClick(event) {
  const target = event.target;
  if (target.closest('[data-draw-new]')) { drawUi.draft = null; drawUi.resultId = ''; renderShell(); return true; }
  const select = target.closest('[data-draw-select]'); if (select) { drawDraft().participantIds = select.dataset.drawSelect === 'all' ? activeEmployees().map(person => person.id) : []; renderShell(); return true; }
  const protocol = target.closest('[data-draw-protocol]'); if (protocol) { openDrawProtocol(protocol.dataset.drawProtocol); return true; }
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
  drawUi.busy = true; const submit = event.target.querySelector('[type="submit"]'); submit.disabled = true;
  const result = await run(() => window.counter.createDraw(input),null,{undo:false});
  drawUi.busy = false;
  if (result) { drawUi.resultId = result.id; drawUi.draft.previousDrawId = result.id; drawUi.draft.rerollReason = ''; renderShell(); appRoot.querySelector('.draw-result')?.scrollIntoView({block:'start'}); showToast(`Жеребкування №${result.number} збережено.`); }
  else { renderShell(); const notice = appRoot.querySelector('[data-draw-error]'); if (notice) { notice.hidden = false; notice.textContent = toastRoot.querySelector('.toast.error span')?.textContent || 'Не вдалося зберегти результат. Перевірте дані.'; } }
  return true;
}
