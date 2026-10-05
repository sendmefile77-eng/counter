const crypto = require('node:crypto');
const tasks = require('./tasks');
const planner = require('./planner');
const presence = require('./presence');
const METHOD = 'crypto.randomInt/Fisher-Yates';
const clean = (value, max) => String(value || '').trim().slice(0, max);
function audit(state, action, details, now) {
  state.audit.push({ id:crypto.randomUUID(), at:now.toISOString(), action, details });
  if (state.audit.length > 5000) state.audit = state.audit.slice(-5000);
}
function createDraw(state, input, now = new Date(), randomInt = crypto.randomInt) {
  const title = clean(input.title,160), description = clean(input.description,1500);
  if (title.length < 2) throw new Error('Вкажіть роботу, для якої обираєте виконавців.');
  if (!Array.isArray(input.participantIds) || !input.participantIds.length) throw new Error('Оберіть учасників жеребкування.');
  const ids = [...new Set(input.participantIds)];
  if (ids.length !== input.participantIds.length) throw new Error('Учасник не може тягнути два сірники в одному жеребкуванні.');
  const people = ids.map(id => state.employees.find(person => person.id === id));
  if (people.some(person => !person?.active)) throw new Error('У складі є недоступний або архівний працівник. Оновіть список учасників.');
  const unavailable=people.filter(person=>presence.absent.has(presence.get(state,person.id,planner.dateKey(now))?.status));
  if(unavailable.length)throw new Error(`За даними «Наявності» сьогодні відсутні: ${unavailable.map(person=>person.name).join(', ')}. Оновіть склад жеребкування.`);
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > ids.length) throw new Error(`Оберіть від 1 до ${ids.length} виконавців.`);
  const previousDrawId = clean(input.previousDrawId,100), rerollReason = clean(input.rerollReason,500);
  if (previousDrawId && !state.draws.some(draw => draw.id === previousDrawId)) throw new Error('Попередній протокол не знайдено.');
  if (previousDrawId && !rerollReason) throw new Error('Вкажіть причину повторного жеребкування. Попередній результат залишиться в історії.');
  const pool = [...ids];
  for (let i=pool.length-1; i>0; i--) {
    const j = randomInt(i+1);
    if (!Number.isInteger(j) || j<0 || j>i) throw new Error('Не вдалося отримати випадковий результат. Спробуйте ще раз.');
    [pool[i],pool[j]] = [pool[j],pool[i]];
  }
  const number = Math.max(state.drawSequence || 0, state.draws.reduce((max,item)=>Math.max(max,item.number),0)) + 1;
  if (!Number.isSafeInteger(number)) throw new Error('Вичерпано лічильник протоколів.');
  const draw = { id:crypto.randomUUID(), number,
    title, description, participants:people.map(person=>({ id:person.id, name:clean(person.name,160) })),
    selectedIds:pool.slice(0,count), count, createdAt:now.toISOString(),
    createdBy:clean(state.settings.operatorName,80)||'Керівник', method:METHOD,
    previousDrawId:previousDrawId||null, previousDrawNumber:previousDrawId ? state.draws.find(item => item.id === previousDrawId).number : null,
    previousDrawDeleted:false, rerollReason:previousDrawId?rerollReason:'', taskId:null };
  state.draws.push(draw);
  state.drawSequence = number;
  audit(state,'draw_created',{ drawId:draw.id, number:draw.number, participantIds:ids, selectedIds:draw.selectedIds,
    count, previousDrawId:draw.previousDrawId, rerollReason:draw.rerollReason },now);
  return draw;
}
function taskFromDraw(state, id, input, now = new Date()) {
  const draw = state.draws.find(item => item.id === id);
  if (!draw) throw new Error('Протокол жеребкування не знайдено.');
  const existing = draw.taskId && state.tasks.find(task => task.id === draw.taskId);
  if (existing) return existing;
  if (draw.selectedIds.some(id=>!state.employees.find(person=>person.id===id)?.active)) {
    throw new Error('Один з обраних працівників уже в архіві. Проведіть нове жеребкування або створіть завдання окремо; початковий протокол збережено.');
  }
  const reference = `За результатом жеребкування №${draw.number} від ${planner.dateKey(new Date(draw.createdAt))}. Протокол: ${draw.id}.`;
  const task = tasks.createTask(state,{ ...input, title:input.title||draw.title, assigneeIds:[...draw.selectedIds],
    description:`${reference}\n\n${clean(input.description||draw.description,2800)}` },now);
  draw.taskId = task.id;
  audit(state,'draw_task_created',{ drawId:draw.id, taskId:task.id },now);
  return task;
}
function deleteDraw(state, id, now = new Date()) {
  const draw = state.draws.find(item => item.id === id);
  if (!draw) throw new Error('Протокол не знайдено. Оновіть історію.');
  const task = draw.taskId && state.tasks.find(item => item.id === draw.taskId);
  if (task && planner.active(task)) throw new Error('Спочатку виконайте або скасуйте пов’язане завдання.');
  state.drawSequence = Math.max(state.drawSequence || 0, state.draws.reduce((max, item) => Math.max(max, item.number), 0));
  for (const child of state.draws.filter(item => item.previousDrawId === id)) {
    child.previousDrawDeleted = true; child.previousDrawNumber = draw.number;
  }
  state.draws = state.draws.filter(item => item.id !== id);
  audit(state, 'draw_deleted', { drawId:id, number:draw.number, title:draw.title, taskId:draw.taskId, actor:clean(state.settings.operatorName,80)||'Керівник' }, now);
  return { id, number:draw.number, taskId:draw.taskId };
}
function normalizeDraws(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error('Історія жеребкувань має бути списком.');
  const ids = new Set(), numbers = new Set();
  const draws = input.map(raw => {
    if (!raw || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id) || !Number.isInteger(raw.number)
      || raw.number < 1 || numbers.has(raw.number)) throw new Error('У базі є пошкоджений або дубльований протокол жеребкування.');
    ids.add(raw.id); numbers.add(raw.number);
    if (!Array.isArray(raw.participants) || !raw.participants.length) throw new Error('У протоколі немає учасників.');
    const peopleIds = new Set();
    const participants = raw.participants.map(person => {
      if (!person || typeof person.id !== 'string' || !person.id || peopleIds.has(person.id) || !clean(person.name,160)) throw new Error('У протоколі є некоректний учасник.');
      peopleIds.add(person.id); return { id:person.id, name:clean(person.name,160) };
    });
    if (!Number.isInteger(raw.count) || raw.count<1 || raw.count>participants.length || !Array.isArray(raw.selectedIds)
      || raw.selectedIds.length!==raw.count || new Set(raw.selectedIds).size!==raw.count || raw.selectedIds.some(id=>!peopleIds.has(id))) throw new Error('Результат жеребкування не відповідає списку учасників.');
    if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt)) || clean(raw.title,160).length<2 || raw.method && raw.method!==METHOD) throw new Error('У протоколі є некоректна дата, назва або спосіб жеребкування.');
    const previousDrawId=clean(raw.previousDrawId,100)||null, rerollReason=clean(raw.rerollReason,500);
    if (previousDrawId&&!rerollReason) throw new Error('Для повторного жеребкування не вказано причину.');
    const previousDrawDeleted=raw.previousDrawDeleted===true, previousDrawNumber=raw.previousDrawNumber ?? null;
    if (previousDrawNumber !== null && (!Number.isSafeInteger(previousDrawNumber) || previousDrawNumber < 1)
      || previousDrawDeleted && (!previousDrawId || !previousDrawNumber)) throw new Error('Пошкоджено посилання на видалений протокол.');
    return { id:raw.id, number:raw.number, title:clean(raw.title,160), description:clean(raw.description,1500),
      participants, selectedIds:[...raw.selectedIds], count:raw.count, createdAt:raw.createdAt,
      createdBy:clean(raw.createdBy,80)||'Керівник', method:METHOD, previousDrawId, previousDrawNumber, previousDrawDeleted,
      rerollReason:previousDrawId?rerollReason:'', taskId:clean(raw.taskId,100)||null };
  });
  const byId = new Map(draws.map(draw => [draw.id,draw])), checked = new Set();
  for (const draw of draws) {
    const seen = new Set([draw.id]); let child=draw, parent=child.previousDrawId;
    while(parent && !checked.has(parent)) {
      if (!ids.has(parent) && child.previousDrawDeleted && child.previousDrawNumber) break;
      if(seen.has(parent)||!ids.has(parent))throw new Error('Пошкоджений зв’язок повторних жеребкувань.');
      seen.add(parent);child=byId.get(parent);parent=child.previousDrawId;
    }
    for (const id of seen) checked.add(id);
  }
  return draws;
}
module.exports = { createDraw, taskFromDraw, deleteDraw, normalizeDraws, METHOD };
