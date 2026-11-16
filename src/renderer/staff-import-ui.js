const documentFileInput = document.querySelector('#document-file-input');
let documentUi = { blocks: [], rows: [], source: '', year: '', shortRule: '', rememberShortRule: false, errors: [], report: null, busy: false };
const profileLabels = { fullName: 'Повне ПІБ', birthDate: 'Дата народження', department: 'Підрозділ / група', position: 'Посада', startDate: 'Початок роботи', aliases: 'Варіанти імені', note: 'Примітка' };
function birthLabel(value) {
  if (!value) return '';
  return value.startsWith('--') ? value.slice(5) + '.' + value.slice(2, 4) : value.split('-').reverse().join('.');
}
function upcomingBirthdays() {
  const today = localDateKey(), year = Number(today.slice(0, 4)), people = [];
  for (const person of activeEmployees()) {
    const birth = person.profile?.birthDate;
    if (!birth) continue;
    const monthDay = birth.slice(-5);
    let next = `${year}-${monthDay}`;
    if (next < today) next = `${year + 1}-${monthDay}`;
    // February 29 remains February 29; no implicit change to February 28.
    for (let attempt = 0; attempt < 4 && new Date(next + 'T12:00:00Z').toISOString().slice(0, 10) !== next; attempt++) next = `${Number(next.slice(0, 4)) + 1}-${monthDay}`;
    const days = Math.round((Date.parse(next + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
    if (days <= 30) people.push({ person, next, days, age: birth.startsWith('--') ? null : Number(next.slice(0, 4)) - Number(birth.slice(0, 4)) });
  }
  return people.sort((a, b) => a.days - b.days);
}
function calendarBirthdays(date) {
  return activeEmployees().filter(person => (!ui.plannerEmployee || ui.plannerEmployee === person.id) && person.profile?.birthDate?.slice(-5) === date.slice(-5))
    .map(person => `<button class="calendar-task calendar-birthday" data-employee-profile="${h(person.id)}"><small>День народження</small><strong>${h(person.name)}</strong></button>`).join('');
}
function birthdayPanel() {
  const people = upcomingBirthdays();
  if (!people.length) return '';
  return `<section class="panel birthday-panel"><h2>Дні народження · найближчі 30 днів</h2><div class="birthday-list">${people.map(({ person, next, days, age }) => `<button class="birthday-item" data-employee-profile="${h(person.id)}"><strong>${h(person.name)}</strong><span>${days === 0 ? 'Сьогодні' : birthLabel(next)}${age == null ? '' : ` · ${age} р.${age % 5 === 0 ? ' · ювілей' : ''}`}</span></button>`).join('')}</div></section>`;
}
function staffImportPanel() {
  return `<section class="panel staff-import-panel"><div><span class="page-eyebrow">Дані з документів</span><h2>Прочитати, уточнити, внести</h2><p>Word, Excel, PDF, фото й скриншоти. ПІБ, дати народження, підрозділи, посади й наявність. Спочатку перевірте текст і зіставлення.</p></div><div class="button-row"><button class="button primary" data-document-pick ${documentUi.busy ? 'disabled' : ''}>${documentUi.busy ? 'Читання…' : 'Завантажити документи'}</button><button class="button" data-document-paste>Вставити текст</button><button class="button" data-document-rules>Збережені правила</button></div><div class="document-drop" data-document-drop tabindex="0" role="button" aria-label="Вибрати або перетягнути документи">Перетягніть сюди до 10 файлів · DOCX, XLSX, PDF, PNG, JPG, WEBP, BMP, TXT, CSV, TSV</div></section>${birthdayPanel()}`;
}
function openEmployeeData(employeeId) {
  const person = employeeById(employeeId); if (!person) return;
  const profile = person.profile || {};
  const field = (name, type = 'text', extra = '') => `<label class="field"><span>${profileLabels[name]}</span><input name="${name}" type="${type}" value="${h(name === 'birthDate' ? birthLabel(profile[name]) : profile[name] || '')}" ${extra}></label>`;
    openModal(`<form id="employee-data-form" data-employee-id="${h(employeeId)}"><header class="modal-head"><div><span class="page-eyebrow">Особова картка</span><h2>${h(person.name)}</h2><p>Коротке ім’я в таблицях зберігається. Дата початку роботи в картці не змінює історію обліку.</p></div><button type="button" class="icon-button" data-close-modal>×</button></header><div class="modal-body"><div class="form-grid">${field('fullName', 'text', 'maxlength="160"')}${field('birthDate', 'text', 'placeholder="12.03.1985 або 12.03" maxlength="10"')}${field('department', 'text', 'maxlength="120"')}${field('position', 'text', 'maxlength="120"')}${field('startDate', 'date')}<label class="field"><span>Варіанти імені · через крапку з комою</span><input name="aliases" maxlength="2000" value="${h((profile.aliases || []).join('; '))}"></label></div><label class="field"><span>Примітка</span><textarea name="note" maxlength="1000" rows="3">${h(profile.note || '')}</textarea></label><details><summary>Історія змін · ${(profile.history || []).length}</summary>${(profile.history || []).slice().reverse().map(item => `<article class="document-history"><strong>${h(new Date(item.at).toLocaleString('uk-UA'))}</strong><small>${h(item.source)}</small><p>${h(item.changes.split(', ').map(field => profileLabels[field] || field).join(', '))}</p></article>`).join('') || '<p class="muted">Змін ще немає.</p>'}</details></div><footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти дані</button></footer></form>`, true);
}
function pickDocumentFiles() { if (!documentUi.busy) { documentFileInput.value = ''; documentFileInput.click(); } }
async function readDocumentSelection(files) {
  if (documentUi.busy || !files?.length) return;
  if (files.length > 10 || files.some(file => file.size > 16 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) { showToast('До 10 файлів, до 16 МБ на файл і до 32 МБ разом.', { error: true }); return; }
  documentUi.busy = true;
  openModal('<header class="modal-head"><h2>Читання документів</h2><button class="icon-button" data-close-modal>×</button></header><div class="modal-body"><p role="status">Текст і таблиці читаються локально. Розпізнавання зображень може тривати кілька хвилин.</p></div>');
  const revision = interfaceDialogRevision;
  try {
    const payload = []; for (const file of files) payload.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    const parsed = await window.counter.readDocuments(payload);
    if (revision !== interfaceDialogRevision || !modalRoot.childElementCount) return;
    documentUi = { ...documentUi, ...parsed, source: files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Список працівників', rows: [], report: null, year: '', shortRule: '', rememberShortRule: false };
    renderDocumentText();
  } catch (error) { if (revision === interfaceDialogRevision) openModal(`<header class="modal-head"><h2>Документи не прочитано</h2><button class="icon-button" data-close-modal>×</button></header><div class="modal-body"><p>${h(error.message)}</p><button class="button" data-close-modal>Закрити</button></div>`); }
  finally { documentUi.busy = false; if (ui.tab === 'employees') renderShell(); }
}
documentFileInput.addEventListener('change', () => { void readDocumentSelection([...documentFileInput.files]); });
function shortRuleOptions(value) { return [['', 'Уточню вручну'], ['patronymic', 'Буква після імені — від по батькові'], ['surname', 'Буква після імені — від прізвища']].map(([key, label]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`).join(''); }
function renderDocumentText() {
  const blocks = documentUi.blocks.length ? documentUi.blocks : [{ name: 'Вставлений текст', text: '', ocr: false }];
  documentUi.blocks = blocks;
  openModal(`<form id="document-text-form"><header class="modal-head"><div><span class="page-eyebrow">Імпорт · 1 із 3</span><h2>Перевірте прочитаний текст</h2><p>Таблиці зберігають стовпці через табуляцію. Для довільного тексту залиште по одному працівнику на рядок і виправте поля на наступному кроці.</p></div><button type="button" class="icon-button" data-close-modal>×</button></header><div class="modal-body"><div class="form-grid"><label class="field"><span>Назва джерела для правил</span><input name="source" maxlength="160" value="${h(documentUi.source)}" placeholder="Наприклад, список відділу" required></label><label class="field"><span>Рік для дат без року · за потреби</span><input name="year" type="number" min="1900" max="2200" value="${h(documentUi.year)}"></label></div>${documentUi.errors.length ? `<div class="document-errors">${documentUi.errors.map(error => `<p>${h(error.name)}: ${h(error.message)}</p>`).join('')}<label class="check-row"><input type="checkbox" name="acceptPartial" required>Перевірив помилки, продовжити зі зчитаною частиною</label></div>` : ''}${blocks.map((block, index) => `<details ${index === 0 ? 'open' : ''} class="document-source"><summary>${h(block.name)}${block.ocr ? ` · розпізнано ${block.confidence}%` : ''}</summary>${block.warning ? `<p class="muted">${h(block.warning)}</p>` : ''}<label class="field"><span>Текст · можна виправити</span><textarea name="block:${index}" rows="9" maxlength="300000" spellcheck="false">${h(block.text)}</textarea></label></details>`).join('')}${blocks.some(block => block.ocr) ? '<label class="check-row document-errors"><input name="ocrReviewed" type="checkbox" required>Перевірив розпізнаний текст, особливо ПІБ та цифри</label>' : ''}<p class="muted">Заголовки таблиці: ПІБ, Дата народження, Підрозділ, Посада, Статус, З, До. Також можна вставити таблицю з Excel.</p></div><footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Розібрати рядки</button></footer></form>`, true);
}
function documentEmployeeOptions(selected) {
  return `<option value="">Кого означає цей рядок?</option><option value="new" ${selected === 'new' ? 'selected' : ''}>+ Створити нового працівника</option>` + snapshot.employees.map(person => `<option value="${h(person.id)}" ${person.id === selected ? 'selected' : ''}>${h(person.name)}${person.profile?.fullName ? ` · ${h(person.profile.fullName)}` : ''}${person.active ? '' : ' · архів'}</option>`).join('');
}
function documentScope(name, value) {
  return `<label class="field"><span>Застосувати відповідь</span><select name="${name}">${[['once', 'Тільки цей рядок'], ['document', 'Однакові значення в цьому документі'], ['source', 'Запам’ятати для цього джерела']].map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
}
function renderDocumentRows() {
  openModal(`<form id="document-rows-form"><header class="modal-head"><div><span class="page-eyebrow">Імпорт · 2 із 3</span><h2>Працівники та уточнення · ${documentUi.rows.length}</h2><p>Відкрийте рядок, зіставте людину й перевірте поля. Зайві заголовки або нерозібраний текст можна пропустити.</p></div><button type="button" class="icon-button" data-close-modal>×</button></header><div class="modal-body"><div class="document-rule-box"><label class="field"><span>Що означає буква у короткому імені, наприклад Юлія*О?</span><select name="shortRule">${shortRuleOptions(documentUi.shortRule)}</select></label><div class="button-row"><button class="button" type="button" data-document-match>Зіставити за правилом</button><label class="check-row"><input type="checkbox" name="rememberShortRule" ${documentUi.rememberShortRule ? 'checked' : ''}>Запам’ятати для джерела</label></div></div><p class="muted">Джерело: ${h(documentUi.source)}. Рік для неповних дат: ${h(documentUi.year || 'не задано')}.</p>${documentUi.rows.map((row, index) => `<details class="document-row ${row.skip ? 'document-skipped' : ''}" data-document-row="${index}" ${(!row.employeeId || row.statusText || row.from) && !row.skip ? 'open' : ''}><summary><span>${index + 1}. ${h(row.fullName || 'Нерозпізнаний рядок')}</span><small>${row.skip ? 'Пропустити' : row.employeeId ? h(employeeById(row.employeeId)?.name || 'Новий працівник') : 'Потрібне уточнення'}</small></summary><p class="muted">${h(row.location)}</p><pre class="document-fragment">${h(row.sourceText)}</pre><label class="check-row"><input type="checkbox" name="skip" ${row.skip ? 'checked' : ''}>Пропустити цей рядок</label><div class="form-grid"><label class="field"><span>ПІБ / ім’я з документа</span><input name="fullName" maxlength="160" value="${h(row.fullName)}"></label><label class="field"><span>Відповідність у ЛАД</span><select name="employeeId">${documentEmployeeOptions(row.employeeId)}</select></label>${documentScope('resolutionScope', row.resolutionScope)}<label class="field"><span>Коротке ім’я · лише для нової картки</span><input name="displayName" maxlength="80" value="${h(row.displayName || '')}" placeholder="За замовчуванням — ПІБ"></label>${['birthDate', 'department', 'position', 'startDate'].map(field => `<label class="field"><span>${profileLabels[field]}</span><input name="${field}" maxlength="160" value="${h(row[field] || '')}" placeholder="${['birthDate', 'startDate'].includes(field) ? 'ДД.ММ.РРРР' : ''}"></label>`).join('')}</div><label class="check-row"><input type="checkbox" name="replaceProfile" ${row.replaceProfile ? 'checked' : ''}>Підтверджую заміну заповнених полів картки значеннями цього рядка</label><details ${row.statusText || row.from ? 'open' : ''}><summary>Наявність і період</summary><div class="form-grid"><label class="field"><span>Статус у документі / скорочення</span><input name="statusText" value="${h(row.statusText || '')}" maxlength="160"></label><label class="field"><span>Що означає статус?</span><select name="status"><option value="">Наявність не вноситься / уточніть</option>${Object.entries(LadPresence.labels).map(([status, label]) => `<option value="${status}" ${row.status === status ? 'selected' : ''}>${h(label)}</option>`).join('')}</select></label>${documentScope('statusScope', row.statusScope)}<label class="field"><span>Початок</span><input name="from" value="${h(row.from || '')}" maxlength="20"></label><label class="field"><span>Остання дата</span><input name="to" value="${h(row.to || '')}" maxlength="20"></label><label class="field"><span>Остання дата входить у період?</span><select name="endMode"><option value="">Уточніть для періоду</option><option value="inclusive" ${row.endConfirmed && !row.endExclusive ? 'selected' : ''}>Так, включно</option><option value="exclusive" ${row.endExclusive ? 'selected' : ''}>Ні, до цієї дати</option></select></label></div><label class="field"><span>Пояснення окремого завдання · обов’язково для ОЗ</span><textarea name="assignmentNote" maxlength="500" rows="2">${h(row.assignmentNote || '')}</textarea></label><label class="check-row"><input name="replacePresence" type="checkbox" ${row.replacePresence ? 'checked' : ''}>Підтверджую заміну інших збережених позначок наявності</label></details></details>`).join('')}</div><footer class="modal-foot"><button class="button" type="button" data-document-back-text>До тексту</button><button class="button primary" type="submit">Перевірити зміни та наслідки</button></footer></form>`, true);
}
function collectDocumentRows(form) {
  documentUi.shortRule = form.elements.shortRule.value; documentUi.rememberShortRule = form.elements.rememberShortRule.checked;
  documentUi.rows = [...form.querySelectorAll('[data-document-row]')].map(element => {
    const row = { ...documentUi.rows[Number(element.dataset.documentRow)] };
    element.querySelectorAll('input, select, textarea').forEach(input => { if (input.type === 'checkbox') row[input.name] = input.checked; else row[input.name] = input.value; });
    row.endConfirmed = Boolean(row.endMode); row.endExclusive = row.endMode === 'exclusive'; return row;
  });
  return { source: documentUi.source, year: documentUi.year, rows: documentUi.rows, shortRule: documentUi.shortRule, rememberShortRule: documentUi.rememberShortRule };
}
function renderDocumentPreview(report) {
  documentUi.report = report;
  const changes = text => text.replace(/^birthDate: (.+?) → (.+)$/, (_, before, after) => `birthDate: ${before === '—' ? before : birthLabel(before)} → ${birthLabel(after)}`).replace(/^([a-zA-Z]+):/, (_, field) => `${profileLabels[field] || field}:`);
  openModal(`<header class="modal-head"><div><span class="page-eyebrow">Імпорт · 3 із 3</span><h2>Перевірка змін</h2><p>${h(report.source)} · рядків ${report.rows.length}, пропущено ${report.skipped}. Збереження всього імпорту можна скасувати одним кроком.</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body">${report.errors.length ? `<div class="document-errors" role="alert"><strong>Потрібні уточнення</strong>${report.errors.map(error => `<p>${h(error)}</p>`).join('')}</div>` : '<p class="confirm-box">Перевірку пройдено. Перегляньте зміни й наслідки перед внесенням.</p>'}${report.rows.map(row => `<article class="document-result"><h3>${row.index + 1}. ${h(row.name || row.location)}${row.skipped ? ' · пропущено' : ''}</h3><pre class="document-fragment">${h(row.sourceText)}</pre>${row.changes.map(change => `<p>${h(changes(change))}</p>`).join('')}${row.errors.map(error => `<p class="document-errors">${h(error)}</p>`).join('')}${row.warnings.map(warning => `<p class="muted">${h(warning)}</p>`).join('')}${row.duties.length ? `<p class="document-errors">Зняти з ${row.duties.length} чергувань; залишаться місця для підміни.</p><ul>${row.duties.map(duty => `<li>${h(duty.date)} · ${h(duty.scheduleName)} · ${h(duty.before.map(id => employeeById(id)?.name || id).join(', '))} → ${h(duty.after.map(id => employeeById(id)?.name || id).join(', ') || 'вільно')}</li>`).join('')}</ul>` : ''}${row.tasks.length ? `<p>Зачеплені завдання: ${row.tasks.map(task => h(task.title)).join('; ')}.</p>` : ''}</article>`).join('')}</div><footer class="modal-foot"><button class="button" data-document-back-rows>До уточнень</button><button class="button primary" data-document-apply ${report.canApply ? '' : 'disabled'}>Внести перевірені дані</button></footer>`, true);
}
function openDocumentRules() {
  const data = snapshot.documentImport || { rules: [], history: [] };
  openModal(`<header class="modal-head"><div><h2>Збережені правила імпорту</h2><p>Діють для вказаного джерела. Точні ПІБ та варіанти імен також зберігаються в особових картках.</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body">${data.rules.map(rule => `<article class="document-history"><strong>${h(rule.source)}</strong><p>${h(rule.kind === 'name' ? `${rule.value} → ${employeeById(rule.employeeId)?.name || 'Працівник відсутній'}` : rule.kind === 'status' ? `${rule.value} → ${LadPresence.labels[rule.status]}` : rule.value === 'patronymic' ? 'Буква короткого імені — від по батькові' : 'Буква короткого імені — від прізвища')}</p><button class="button small danger" data-document-remove-rule="${h(rule.id)}">Видалити правило</button></article>`).join('') || '<p>Правил ще немає.</p>'}<details><summary>Історія імпорту · ${data.history.length}</summary>${data.history.slice().reverse().map(item => `<p>${h(new Date(item.at).toLocaleString('uk-UA'))} · ${h(item.source)} · внесено ${item.rows}, пропущено ${item.skipped}</p>`).join('')}</details></div><footer class="modal-foot"><button class="button" data-close-modal>Закрити</button></footer>`, true);
}
async function handleStaffImportClick(event) {
  const target = event.target;
  const employee = target.closest('[data-employee-data]'); if (employee) { openEmployeeData(employee.dataset.employeeData); return true; }
  if (target.closest('[data-document-paste]')) { documentUi = { ...documentUi, blocks: [], rows: [], source: '', errors: [], report: null }; renderDocumentText(); return true; }
  if (target.closest('[data-document-rules]')) { openDocumentRules(); return true; }
  if (target.closest('[data-document-back-text]')) { collectDocumentRows(target.closest('form')); renderDocumentText(); return true; }
  if (target.closest('[data-document-back-rows]')) { renderDocumentRows(); return true; }
  const remove = target.closest('[data-document-remove-rule]');
  if (remove) { const result = await run(() => window.counter.removeDocumentRule(remove.dataset.documentRemoveRule), 'Правило прибрано.'); if (result) openDocumentRules(); return true; }
  if (target.closest('[data-document-match]')) {
    const form = target.closest('form'), input = collectDocumentRows(form), revision = interfaceDialogRevision;
    let matches;
    try { matches = await window.counter.matchDocumentNames({ names: input.rows.map(row => row.fullName), source: input.source, shortRule: input.shortRule }); }
    catch (error) { showToast(error.message, { error: true }); return true; }
    if (revision !== interfaceDialogRevision) return true;
    documentUi.rows.forEach((row, index) => { if (!row.employeeId && matches[index].length === 1) row.employeeId = matches[index][0]; });
    renderDocumentRows(); return true;
  }
  if (target.closest('[data-document-apply]')) {
    const button = target.closest('button'); if (button.disabled) return true; button.disabled = true;
    const result = await run(() => window.counter.applyDocuments(documentUi.report.token), null);
    if (result) { closeModal(button); showToast(`Внесено ${result.rows.length - result.skipped} рядків.`, { undo: true }); }
    else if (button.isConnected) { const footer = button.closest('footer'); button.remove(); footer.insertAdjacentHTML('beforeend', '<span class="muted">Поверніться до уточнень і перевірте імпорт знову.</span>'); }
    return true;
  }
  return false;
}
async function handleStaffImportSubmit(event) {
  const form = event.target;
  if (form.id === 'employee-data-form') {
    const data = Object.fromEntries(new FormData(form));
    const result = await run(() => window.counter.updateEmployeeProfile(form.dataset.employeeId, data), 'Дані працівника збережено.');
    if (result) closeModal(form); return true;
  }
  if (form.id === 'document-text-form') {
    const data = new FormData(form), revision = interfaceDialogRevision;
    documentUi.source = String(data.get('source')); documentUi.year = String(data.get('year') || '');
    documentUi.blocks = documentUi.blocks.map((block, index) => ({ ...block, text: String(data.get(`block:${index}`) || '') }));
    const rows = await window.counter.parseDocuments({ blocks: documentUi.blocks, source: documentUi.source, shortRule: documentUi.shortRule });
    if (revision !== interfaceDialogRevision) return true;
    if (!rows.length) throw Error('У тексті немає рядків.');
    documentUi.rows = rows; renderDocumentRows(); return true;
  }
  if (form.id === 'document-rows-form') {
    const revision = interfaceDialogRevision, report = await window.counter.previewDocuments(collectDocumentRows(form));
    if (revision === interfaceDialogRevision) renderDocumentPreview(report); return true;
  }
  return false;
}
document.addEventListener('dragover', event => { if (event.target.closest('[data-document-drop]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('drop', event => { if (event.target.closest('[data-document-drop]')) { event.preventDefault(); void readDocumentSelection([...event.dataTransfer.files]); } });
document.addEventListener('keydown', event => { if (event.target.matches('[data-document-drop]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); pickDocumentFiles(); } });
