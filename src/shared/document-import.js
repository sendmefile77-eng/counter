const crypto = require('node:crypto');
const profiles = require('./employee-profiles');
const presence = require('./presence');

const MAX_ROWS = 300;
const key = value => String(value || '').normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
const loose = value => key(value).replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = (state, now) => digest([state.employees, state.records, state.presenceRecords, state.workdayOverrides,
  state.duties, state.dutySchedules, state.tasks, state.documentImport, now.toISOString().slice(0, 10)]);
const cut = (value, limit = 160) => String(value || '').trim().slice(0, limit);
const fields = ['fullName', 'birthDate', 'department', 'position', 'startDate', 'statusText', 'from', 'to', 'assignmentNote'];
const headings = {
  fullName: ['піб', 'фио', 'п.і.б.', 'повне ім’я', 'повне імя', 'прізвище ім’я по батькові', 'працівник', 'сотрудник', 'ім’я', 'имя', 'fullname', 'name'],
  birthDate: ['дата народження', 'дата рождения', 'день народження', 'дн', 'birthdate', 'birthday'],
  department: ['підрозділ', 'подразделение', 'відділ', 'отдел', 'група', 'department'],
  position: ['посада', 'должность', 'position'], startDate: ['дата початку роботи', 'дата прийняття', 'дата приема', 'startdate'],
  statusText: ['статус', 'наявність', 'присутність', 'відсутність', 'status'],
  from: ['з', 'від', 'початок', 'дата', 'с', 'дата начала', 'start', 'from'],
  to: ['по', 'до', 'кінець', 'дата завершення', 'дата окончания', 'end', 'to'],
  assignmentNote: ['пояснення завдання', 'окреме завдання', 'що виконував', 'assignmentnote'],
};
const statuses = {
  special_assignment: ['окреме завдання', 'оз', 'окреме доручення'],
  onsite: ['на роботі', 'на работе', 'присутній', 'присутня'], zkp: ['зкп'],
  vacation: ['відпустка', 'отпуск', 'у відпустці'], sick: ['лікарняний', 'больничный', 'лікарняному'],
  day_off: ['відгул', 'отгул'], weekend: ['вихідний', 'выходной'],
  training_online: ['навчання онлайн', 'обучение онлайн'], training_academy: ['навчання академія', 'обучение академия'],
  arkan: ['аркан', 'а.', 'арк'], business_trip: ['відрядження', 'командировка'], personal_permission: ['особисті справи', 'личные дела'],
};
function empty() { return { rules: [], history: [] }; }
function normalize(input, employees) {
  const ids = new Set(employees.map(person => person.id));
  return {
    rules: (Array.isArray(input?.rules) ? input.rules : []).filter(rule => rule && ['name', 'status', 'shortName'].includes(rule.kind)
      && (rule.kind !== 'name' || ids.has(rule.employeeId))
      && (rule.kind !== 'status' || Object.hasOwn(presence.labels, rule.status))
      && (rule.kind !== 'shortName' || ['patronymic', 'surname'].includes(rule.value)))
      .slice(-2000).map(rule => ({ id: cut(rule.id, 80) || crypto.randomUUID(), source: cut(rule.source), kind: rule.kind,
        value: cut(rule.value, 200), employeeId: rule.kind === 'name' ? rule.employeeId : undefined,
        status: rule.kind === 'status' ? rule.status : undefined })),
    history: (Array.isArray(input?.history) ? input.history : []).slice(-100).map(item => ({
      id: cut(item.id, 80), at: cut(item.at, 40), source: cut(item.source), rows: Number(item.rows) || 0,
      skipped: Number(item.skipped) || 0, signature: cut(item.signature, 80),
    })),
  };
}
function splitRow(line) {
  const unquoted = line.replace(/"(?:[^"]|"")*"/g, '');
  const delimiter = ['\t', ';', '|', ','].find(value => unquoted.includes(value));
  if (!delimiter) return line.split(/\s{2,}/).map(value => value.trim());
  const cells = []; let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { cells.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  cells.push(cell.trim()); return cells;
}
function knownStatus(value, state, source) {
  const saved = state.documentImport?.rules.find(rule => rule.kind === 'status' && key(rule.source) === key(source) && key(rule.value) === key(value));
  if (saved) return saved.status;
  return Object.entries(statuses).find(([status, aliases]) => [status, presence.labels[status], ...aliases].some(alias => key(alias) === key(value)))?.[0] || '';
}
function candidates(state, fullName, source, shortRule = '') {
  const saved = state.documentImport?.rules.find(rule => rule.kind === 'name' && key(rule.source) === key(source) && key(rule.value) === key(fullName));
  if (saved && state.employees.some(person => person.id === saved.employeeId)) return [saved.employeeId];
  const exact = state.employees.filter(person => [person.name, person.profile?.fullName, ...(person.profile?.aliases || [])].some(name => name && key(name) === key(fullName)));
  if (exact.length) return exact.map(person => person.id);
  const parts = String(fullName).split(/\s+/), words = parts.map(loose);
  const rule = shortRule || state.documentImport?.rules.find(rule => rule.kind === 'shortName' && key(rule.source) === key(source))?.value;
  const matches = state.employees.filter(person => {
    const short = person.name.match(/^(.+?)[*_\s]+([\p{L}])$/u);
    if (rule && short && parts.length === 3) {
      return loose(short[1]) === loose(parts[1]) && loose(short[2]) === loose((rule === 'patronymic' ? parts[2] : parts[0])[0]);
    }
    return words.includes(loose(person.name)) || loose(person.profile?.fullName) === loose(fullName);
  });
  return matches.map(person => person.id);
}
function parseBlocks(state, blocks, source, shortRule = '') {
  if (!Array.isArray(blocks) || blocks.length > 60) throw Error('Завантажте до 60 сторінок або аркушів.');
  const rows = [];
  for (const block of blocks) {
    const text = String(block.text || '');
    if (text.length > 300000) throw Error('Забагато тексту. Розділіть документ.');
    let columns = null;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const cells = splitRow(line), header = cells.map(cell => Object.keys(headings).find(field => headings[field].some(alias => key(alias) === key(cell))) || '');
      if (header.includes('fullName') && header.filter(Boolean).length >= 1 && cells.length > 1) { columns = header; continue; }
      const row = Object.fromEntries(fields.map(field => [field, '']));
      if (columns) columns.forEach((field, position) => { if (field) row[field] = cells[position] || ''; });
      else {
        row.fullName = cells[0].replace(/^\s*\d+[.)]?\s+/, '');
        if (cells.length === 2 && /\d[./]\d/.test(cells[1])) row.birthDate = cells[1];
        else if (cells.length > 1) { row.statusText = cells[1]; row.from = cells[2] || ''; row.to = cells[3] || ''; }
      }
      if (!columns && cells.length === 1) {
        const prose = row.fullName.match(/^(.+?)\s+[—–:]\s*(.+)$/);
        if (prose) {
          row.fullName = prose[1].trim();
          const period = prose[2].match(/^(.+?)\s+(?:з|с|від)\s+(\d{1,2}[./]\d{1,2}(?:[./]\d{4})?)(?:\s+(?:до|по)\s+(\d{1,2}[./]\d{1,2}(?:[./]\d{4})?))?\.?$/i);
          const born = prose[2].match(/^(?:дата народження|дата рождения|народилася|народився)\s*[:—–]?\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{4})?)\.?$/i);
          if (period) { row.statusText = period[1]; row.from = period[2]; row.to = period[3] || ''; }
          else if (born) row.birthDate = born[1];
          else row.statusText = prose[2];
        }
      }
      const matches = candidates(state, row.fullName, source, shortRule);
      rows.push({ ...row, id: String(rows.length), sourceText: cut(line, 2000), location: `${cut(block.name)} · рядок ${index + 1}`,
        candidateIds: matches, employeeId: matches.length === 1 ? matches[0] : '', status: knownStatus(row.statusText, state, source),
        resolutionScope: 'once', statusScope: 'once', skip: false });
      if (rows.length > MAX_ROWS) throw Error(`За один раз можна перевірити до ${MAX_ROWS} рядків. Розділіть документ.`);
    }
  }
  return rows;
}
function parseDate(value, year) {
  const text = String(value || '').trim();
  if (profiles.validDate(text)) return text;
  const match = text.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/);
  const actualYear = match?.[3] || String(year || '');
  if (!match || !/^\d{4}$/.test(actualYear)) throw Error('Вкажіть повну дату або рік документа.');
  const result = `${actualYear}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  if (!profiles.validDate(result)) throw Error('Некоректна календарна дата.');
  return result;
}
function saveRule(state, input) {
  const rules = state.documentImport.rules;
  const old = rules.find(rule => rule.kind === input.kind && key(rule.source) === key(input.source) && (input.kind === 'shortName' || key(rule.value) === key(input.value)));
  if (old) Object.assign(old, input);
  else rules.push({ id: crypto.randomUUID(), ...input });
}
function validateRows(input) {
  if (!Array.isArray(input?.rows) || !input.rows.length || input.rows.length > MAX_ROWS) throw Error('Немає рядків для перевірки або їх забагато.');
  if (!cut(input.source)) throw Error('Назвіть джерело, наприклад «Список відділу».');
}
function build(state, input, now = new Date()) {
  validateRows(input);
  const d = require('./domain'), presenceChanges = require('./presence-changes');
  const draft = d.clone(state), source = cut(input.source), results = [], errors = [];
  draft.documentImport ||= empty();
  const documentNames = new Map(), documentStatuses = new Map(), occupiedCells = new Map();
  const sourceProfiles = new Map();
  for (const row of input.rows) {
    if (row.skip) continue;
    if (row.resolutionScope === 'document' && row.employeeId && row.employeeId !== 'new') {
      const previous = documentNames.get(key(row.fullName));
      if (previous && previous !== row.employeeId) errors.push('Різні відповіді для одного імені в документі.');
      documentNames.set(key(row.fullName), row.employeeId);
    }
    if (row.statusScope === 'document' && row.statusText && row.status) {
      const previous = documentStatuses.get(key(row.statusText));
      if (previous && previous !== row.status) errors.push('Різні відповіді для одного статусу в документі.');
      documentStatuses.set(key(row.statusText), row.status);
    }
  }
  for (const [index, raw] of input.rows.entries()) {
    const result = { index, location: cut(raw.location), sourceText: cut(raw.sourceText, 2000), skipped: raw.skip === true,
      changes: [], warnings: [], duties: [], tasks: [], errors: [] };
    results.push(result);
    if (result.skipped) continue;
    try {
      const fullName = cut(raw.fullName), selected = raw.employeeId || documentNames.get(key(fullName));
      if (!fullName) throw Error('Вкажіть ім’я з документа або пропустіть рядок.');
      let person;
      if (selected === 'new') {
        if (draft.employees.some(person => [person.name, person.profile?.fullName].some(value => value && key(value) === key(fullName)))) throw Error('Таке ім’я вже є. Оберіть наявну картку.');
        person = d.createEmployee(draft, cut(raw.displayName || fullName, 80), now);
        result.changes.push(`Створити картку «${person.name}»`);
      } else person = draft.employees.find(person => person.id === selected);
      if (!person) throw Error('Оберіть працівника, створення нової картки або пропуск.');
      if (!person.active) result.warnings.push('Архівний працівник.');
      result.employeeId = person.id; result.name = person.name;
      const previous = profiles.normalize(person.profile), patch = {};
      // A short source label is an alias, not a replacement for an existing full name.
      if (/^[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){2,3}$/u.test(fullName)) patch.fullName = fullName;
      for (const field of ['department', 'position']) if (cut(raw[field])) patch[field] = cut(raw[field], 120);
      if (cut(raw.birthDate)) patch.birthDate = profiles.birthday(raw.birthDate);
      if (cut(raw.startDate)) patch.startDate = parseDate(raw.startDate, input.year);
      // Short labels belong to the selected scope. Only a replaced full identity
      // becomes a global alias, preserving the previous name of the same person.
      if (patch.fullName && previous.fullName && key(patch.fullName) !== key(previous.fullName)) {
        patch.aliases = [...previous.aliases, previous.fullName];
      }
      for (const [field, value] of Object.entries(patch)) {
        if (field === 'aliases') continue;
        const cell = `${person.id}|${field}`, seen = sourceProfiles.get(cell);
        if (seen && seen !== value) throw Error('Рядки документа суперечать один одному в даних картки. Виправте або пропустіть один рядок.');
        sourceProfiles.set(cell, value);
        if (JSON.stringify(previous[field]) === JSON.stringify(value)) continue;
        result.changes.push(`${field}: ${previous[field] || '—'} → ${value}`);
        if (previous[field] && !raw.replaceProfile) throw Error('Дані картки відрізняються. Підтвердьте заміну або виправте значення.');
      }
      profiles.update(draft, person.id, patch, now, `${source} · ${result.location}`);
      const statusText = cut(raw.statusText), status = raw.status || documentStatuses.get(key(statusText)) || knownStatus(statusText, state, source);
      if (statusText || status || raw.from || raw.to) {
        if (!Object.hasOwn(presence.labels, status)) throw Error('Уточніть значення статусу наявності.');
        if (status === 'special_assignment' && !cut(raw.assignmentNote, 500)) throw Error('Поясніть, яке окреме завдання виконував працівник.');
        const startDate = parseDate(raw.from, input.year), endDate = parseDate(raw.to || raw.from, input.year);
        if ((raw.to && raw.to !== raw.from || /(?:^|\s)(?:до|until)\s*\d/i.test(raw.sourceText || '')) && !raw.endConfirmed) throw Error('Уточніть, чи входить останній день у період.');
        const actualEnd = raw.endExclusive ? d.addDays(endDate, -1) : endDate;
        const change = { employeeIds: [person.id], startDate, endDate: actualEnd, status, reason: cut(`${raw.assignmentNote ? raw.assignmentNote + ' · ' : ''}${source}: ${raw.location || ''}`, 500) };
        const report = presenceChanges.preview(draft, change, now);
        if (!report.canApply) throw Error(report.blockers.join(' '));
        for (const cell of report.cells) {
          const cellId = `${person.id}|${cell.date}`, existing = occupiedCells.get(cellId);
          if (existing && existing !== status) throw Error(`Суперечливі статуси в документі на ${cell.date}.`);
          occupiedCells.set(cellId, status);
        }
        const different = report.cells.filter(cell => cell.before && cell.before.source !== 'calendar_presence' && cell.before.status !== status);
        if (different.length && !raw.replacePresence) throw Error(`Є інша наявність на ${different.length} датах. Підтвердьте заміну.`);
        result.duties = report.duties; result.tasks = report.tasks;
        result.warnings.push(...report.skipped.map(cell => `Дата поза періодом роботи: ${cell.date}`));
        result.changes.push(`${presence.labels[status]}: ${startDate} — ${actualEnd}`);
        presenceChanges.apply(draft, { change: report.change, expectedToken: report.token }, now);
      }
      if (raw.resolutionScope === 'source') saveRule(draft, { source, kind: 'name', value: fullName, employeeId: person.id });
      if (raw.statusScope === 'source' && statusText && status) saveRule(draft, { source, kind: 'status', value: statusText, status });
    } catch (error) { result.errors.push(error.message); errors.push(`Рядок ${index + 1}: ${error.message}`); }
  }
  if (input.rememberShortRule && ['patronymic', 'surname'].includes(input.shortRule)) saveRule(draft, { source, kind: 'shortName', value: input.shortRule });
  const skipped = results.filter(row => row.skipped).length;
  if (skipped === results.length) errors.push('Усі рядки пропущено.');
  const signature = digest([source, input.rows.map(row => [row.fullName, row.employeeId, row.displayName, row.birthDate, row.department, row.position, row.startDate, row.statusText, row.status, row.from, row.to, row.skip, row.endExclusive, row.assignmentNote])]);
  if (state.documentImport?.history.some(item => item.signature === signature)) errors.push('Цей набір рядків уже імпортовано.');
  return { draft, report: { rows: results, errors, skipped, source, canApply: !errors.length, signature } };
}
function preview(state, input, now = new Date()) {
  const prepared = build(state, input, now);
  return { ...prepared.report, expectedToken: fingerprint(state, now), inputHash: digest(input) };
}
function apply(state, input, expectedToken, now = new Date()) {
  if (!expectedToken || expectedToken !== fingerprint(state, now)) throw Error('Дані або дата змінилися. Перевірте імпорт ще раз.');
  const { draft, report } = build(state, input, now);
  if (!report.canApply) throw Error(report.errors.join('\n'));
  draft.documentImport.history.push({ id: crypto.randomUUID(), at: now.toISOString(), source: report.source,
    signature: report.signature, rows: report.rows.length - report.skipped, skipped: report.skipped });
  draft.documentImport = normalize(draft.documentImport, draft.employees);
  draft.audit.push({ id: crypto.randomUUID(), at: now.toISOString(), action: 'document_imported',
    details: { source: report.source, rows: report.rows.length - report.skipped, skipped: report.skipped } });
  Object.assign(state, draft);
  return report;
}
function removeRule(state, id) { state.documentImport.rules = state.documentImport.rules.filter(rule => rule.id !== id); return true; }
module.exports = { empty, normalize, parseBlocks, candidates, parseDate, knownStatus, preview, apply, removeRule, MAX_ROWS };
