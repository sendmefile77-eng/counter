// Browser-history observations use the clock printed in the CSV. The numeric
// timestamps below are wall-clock coordinates, not a claim that CSV time is UTC.
const crypto = require('node:crypto');
const presence = require('./presence');
const work = require('./work');

const MINUTE = 60000;
const DAY = 86400000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_BYTES = 64 * 1024 * 1024;
const DEFAULT_SETTINGS = Object.freeze({
  startTime: '09:00', endTime: '18:00', lunchStart: '13:00', lunchEnd: '14:00',
  toleranceMinutes: 5, gapMinutes: 30, maxVisitMinutes: 15, missingVisitMinutes: 1,
});
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const timeMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
const dateOf = timestamp => new Date(timestamp).toISOString().slice(0, 10);
const clockOf = timestamp => new Date(timestamp).toISOString().slice(11, 19);

function settings(input = {}) {
  const result = { ...DEFAULT_SETTINGS, ...input };
  for (const key of ['startTime', 'endTime', 'lunchStart', 'lunchEnd']) {
    if (!validTime(result[key])) throw Error('Некоректний час у правилах моніторингу.');
  }
  if (!(timeMinutes(result.startTime) < timeMinutes(result.lunchStart)
    && timeMinutes(result.lunchStart) < timeMinutes(result.lunchEnd)
    && timeMinutes(result.lunchEnd) < timeMinutes(result.endTime))) {
    throw Error('Обід має бути всередині робочого дня; кінець має бути після початку.');
  }
  const limits = { toleranceMinutes: [0, 60], gapMinutes: [1, 240], maxVisitMinutes: [1, 120], missingVisitMinutes: [0, 15] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) {
      throw Error(`Параметр «${key}» має бути цілим числом від ${min} до ${max}.`);
    }
  }
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, result[key]]));
}

function empty() { return { settings: settings(), sources: [], imports: [], visits: [] }; }

function parseTime(value) {
  const text = clean(value, 80);
  let m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  let year, month, day, hour, minute, second;
  if (m) [, day, month, year, hour, minute, second = '00'] = m;
  else {
    m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) throw Error('Час відвідування має бути ДД.ММ.РРРР ГГ:ХХ:СС.');
    [, year, month, day, hour, minute, second = '00'] = m;
  }
  const n = [year, month, day, hour, minute, second].map(Number);
  const timestamp = Date.UTC(n[0], n[1] - 1, n[2], n[3], n[4], n[5]);
  const d = new Date(timestamp);
  if (n[0] < 2000 || n[0] > 2100 || d.getUTCFullYear() !== n[0] || d.getUTCMonth() !== n[1] - 1
    || d.getUTCDate() !== n[2] || d.getUTCHours() !== n[3] || d.getUTCMinutes() !== n[4] || d.getUTCSeconds() !== n[5]) {
    throw Error('Некоректна дата або час відвідування.');
  }
  return timestamp;
}

function parseDuration(value) {
  const text = clean(value, 80);
  if (!text) return null;
  const m = text.match(/^(\d+):([0-5]\d):([0-5]\d)(?:[.,](\d{1,6}))?$/);
  if (!m) throw Error('Некоректна тривалість: очікується ГГ:ХХ:СС.мс.');
  const valueMs = Number(m[1]) * 3600000 + Number(m[2]) * MINUTE + Number(m[3]) * 1000
    + Math.round(Number('0.' + (m[4] || '0')) * 1000);
  if (!Number.isSafeInteger(valueMs) || valueMs > 366 * DAY) throw Error('Тривалість виходить за допустимий діапазон.');
  return valueMs;
}

function decode(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: new TextDecoder('utf-16le', { fatal: true }).decode(buffer), encoding: 'UTF-16 LE' };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return { text: new TextDecoder('utf-16be', { fatal: true }).decode(buffer), encoding: 'UTF-16 BE' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' }; }
  catch (_) { return { text: new TextDecoder('windows-1251', { fatal: true }).decode(buffer), encoding: 'Windows-1251' }; }
}

function csvRows(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw Error('Некоректні лапки у CSV.');
      quoted = true;
    } else if (c === delimiter) {
      row.push(field); field = ''; closed = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value.trim())) rows.push(row);
      row = []; field = ''; closed = false;
      if (rows.length > 100001) throw Error('У файлі понад 100 000 записів. Розділіть його за періодами.');
    } else {
      if (closed && !/\s/.test(c)) throw Error('Неочікувані символи після лапок у CSV.');
      if (!closed) field += c;
    }
  }
  if (quoted) throw Error('У CSV не закрито лапки.');
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function browserName(row) {
  const match = String(row['Browser Profile'] || '').match(/\b(Opera|Firefox|Edge|Chrome|Vivaldi|Brave|Yandex)\b/i);
  const value = match?.[1] || clean(row['Web Browser'], 80) || 'Невідомий';
  return value[0].toUpperCase() + value.slice(1);
}

function sourceFor(row, fileHash) {
  const profile = clean(row['Browser Profile'], 500), userProfile = clean(row['User Profile'], 500);
  const historyFile = clean(row['History File'], 2000).replaceAll('/', '\\');
  const directory = historyFile.slice(0, historyFile.lastIndexOf('\\')).toLowerCase();
  const browser = browserName(row);
  const computer = profile.match(/\bPC-[\w-]+/i)?.[0] || '';
  // Export filenames/timestamps are deliberately excluded from source identity.
  const identity = computer ? profile : [profile, directory].filter(Boolean).join('|') || `файл-${fileHash}`;
  const id = digest(JSON.stringify([identity.toLowerCase(), userProfile.toLowerCase(), browser.toLowerCase()]));
  return { id, profile, userProfile, browser, label: profile || userProfile || browser,
    computer, directory, employeeId: null };
}

function parseFile(file) {
  if (!file || typeof file.name !== 'string' || !/\.csv$/i.test(file.name)) throw Error('Виберіть початкові файли CSV історії браузера.');
  if (!(file.bytes instanceof Uint8Array) && !Array.isArray(file.bytes)) throw Error('Не вдалося прочитати файл CSV.');
  const buffer = Buffer.from(file.bytes);
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw Error('Файл порожній або перевищує 32 МБ.');
  const hash = digest(buffer), decoded = decode(buffer);
  const text = decoded.text.replace(/^\uFEFF/, '');
  const header = text.split(/\r?\n/, 1)[0];
  const delimiter = [';', '\t', ','].find(char => header.split(char).some(part => /^"?Visit Time"?$/.test(part.trim()))) || ',';
  const rows = csvRows(text, delimiter), headers = (rows.shift() || []).map(value => value.trim());
  if (!headers.includes('URL') || !headers.includes('Visit Time') || new Set(headers).size !== headers.length) {
    throw Error('Не знайдено унікальних колонок URL і Visit Time. Потрібна повна CSV-вигрузка історії браузера.');
  }
  const sources = new Map(), visits = [], issues = [];
  rows.forEach((values, index) => {
    try {
      if (values.length !== headers.length) throw Error('Кількість полів відрізняється від заголовка.');
      const row = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
      const url = String(row.URL || '').trim();
      if (!url || url.length > 32768) throw Error('Адреса сторінки порожня або надто довга.');
      const timestamp = parseTime(row['Visit Time']), durationMs = parseDuration(row['Visit Duration']);
      const source = sourceFor(row, hash); sources.set(source.id, source);
      const recordId = clean(row['Record ID'], 100);
      const id = digest(JSON.stringify([source.id, recordId, timestamp, url]));
      let domain = '';
      try { const address = new URL(url); domain = address.hostname || address.protocol.replace(':', ''); }
      catch (_) { domain = 'Невизначена адреса'; }
      const countText = clean(row['Visit Count'], 20);
      const visitCount = /^\d+$/.test(countText) && Number.isSafeInteger(Number(countText)) ? Number(countText) : null;
      const numberField = key => /^\d+$/.test(clean(row[key], 20)) && Number.isSafeInteger(Number(row[key])) ? Number(row[key]) : null;
      visits.push({ id, sourceId: source.id, timestamp, recordId, url, domain,
        title: clean(row.Title, 2000), visitType: clean(row['Visit Type'], 100),
        visitedFrom: clean(row['Visited From'], 32768), rawBrowser: clean(row['Web Browser'], 80),
        historyFile: clean(row['History File'], 2000), durationMs, visitCount,
        urlLength: numberField('URL Length'), typedCount: numberField('Typed Count') });
    } catch (error) { issues.push({ row: index + 2, message: error.message }); }
  });
  if (!visits.length) throw Error('У файлі немає придатних записів відвідувань.' + (issues[0] ? ` Рядок ${issues[0].row}: ${issues[0].message}` : ''));
  const timestamps = visits.map(visit => visit.timestamp);
  const min = timestamps.reduce((a, b) => Math.min(a, b)), max = timestamps.reduce((a, b) => Math.max(a, b));
  return { name: clean(file.name, 240), hash, encoding: decoded.encoding, rowCount: rows.length,
    visits, sources: [...sources.values()], issues, startDate: dateOf(min), endDate: dateOf(max) };
}

const importFingerprint = state => digest(JSON.stringify([state.activity || empty(), state.employees.map(p => [p.id, p.name])]));

function previewImports(state, files) {
  if (!Array.isArray(files) || !files.length || files.length > 50) throw Error('Виберіть від 1 до 50 файлів CSV.');
  if (files.reduce((sum, file) => sum + (file.bytes?.length || 0), 0) > MAX_BATCH_BYTES) throw Error('Загальний розмір файлів перевищує 64 МБ.');
  const activity = state.activity || empty(), hashes = new Set(activity.imports.map(item => item.hash));
  const ids = new Set(activity.visits.map(item => item.id)), knownSources = new Map(activity.sources.map(item => [item.id, item]));
  const staged = files.map(parseFile), sources = new Map();
  const reports = staged.map(file => {
    const duplicateFile = hashes.has(file.hash); hashes.add(file.hash);
    let newCount = 0, duplicateCount = 0;
    if (!duplicateFile) {
      for (const visit of file.visits) {
        if (ids.has(visit.id)) duplicateCount++;
        else { ids.add(visit.id); newCount++; }
      }
      for (const source of file.sources) sources.set(source.id, knownSources.get(source.id) || source);
    }
    return { name: file.name, hash: file.hash, encoding: file.encoding, rowCount: file.rowCount,
      validCount: file.visits.length, newCount, duplicateCount, duplicateFile,
      startDate: file.startDate, endDate: file.endDate, issues: file.issues };
  });
  return { staged, fingerprint: importFingerprint(state), report: { files: reports, sources: [...sources.values()],
    newCount: reports.reduce((sum, file) => sum + file.newCount, 0),
    issueCount: reports.reduce((sum, file) => sum + (file.duplicateFile ? 0 : file.issues.length), 0),
    startDate: staged.map(file => file.startDate).sort()[0], endDate: staged.map(file => file.endDate).sort().at(-1) } };
}

function audit(state, action, details, now) {
  state.audit.push({ id: crypto.randomUUID(), at: now.toISOString(), action, details });
  state.audit = state.audit.slice(-5000);
}

function applyImports(state, prepared, input = {}, now = new Date()) {
  if (!prepared || importFingerprint(state) !== prepared.fingerprint) throw Error('Дані змінилися. Перевірте імпорт ще раз.');
  if (prepared.report.issueCount && input.acceptIssues !== true) throw Error('Перевірте проблемні рядки та підтвердьте імпорт решти.');
  const activity = structuredClone(state.activity || empty()), assignments = input.assignments || {};
  const employeeIds = new Set(state.employees.map(p => p.id));
  for (const source of prepared.report.sources) {
    const employeeId = Object.hasOwn(assignments, source.id) ? assignments[source.id] : source.employeeId;
    if (employeeId != null && employeeId !== '' && !employeeIds.has(employeeId)) throw Error('Працівника для джерела не знайдено.');
    let saved = activity.sources.find(item => item.id === source.id);
    if (!saved) { saved = { ...source }; activity.sources.push(saved); }
    saved.employeeId = employeeId || null;
  }
  const hashes = new Set(activity.imports.map(item => item.hash)), byId = new Map(activity.visits.map(item => [item.id, item]));
  let importedFiles = 0, newCount = 0, duplicateCount = 0;
  for (const file of prepared.staged) {
    if (hashes.has(file.hash)) continue;
    hashes.add(file.hash);
    const importId = crypto.randomUUID();
    let added = 0, reused = 0;
    const inFile = new Set();
    for (const visit of file.visits) {
      if (inFile.has(visit.id)) { reused++; continue; }
      inFile.add(visit.id);
      const version = { importId, durationMs: visit.durationMs, visitCount: visit.visitCount, title: visit.title, historyFile: visit.historyFile };
      let saved = byId.get(visit.id);
      if (saved) { saved.versions.push(version); reused++; }
      else {
        const { durationMs, visitCount, title, historyFile, ...event } = visit;
        saved = { ...event, versions: [version] }; activity.visits.push(saved); byId.set(saved.id, saved); added++;
      }
    }
    activity.imports.push({ id: importId, name: file.name, hash: file.hash, encoding: file.encoding,
      importedAt: now.toISOString(), rowCount: file.rowCount, validCount: file.visits.length, newCount: added,
      duplicateCount: reused, issues: file.issues, startDate: file.startDate, endDate: file.endDate });
    importedFiles++; newCount += added; duplicateCount += reused;
  }
  state.activity = activity;
  const result = { importedFiles, newCount, duplicateCount, skippedFiles: prepared.staged.length - importedFiles,
    startDate: prepared.report.startDate, endDate: prepared.report.endDate };
  audit(state, 'activity_imported', result, now);
  return result;
}

function removeImport(state, id, now = new Date()) {
  const activity = state.activity, item = activity?.imports.find(item => item.id === id);
  if (!item) throw Error('Завантаження не знайдено.');
  activity.imports = activity.imports.filter(item => item.id !== id);
  activity.visits = activity.visits.filter(visit => {
    visit.versions = visit.versions.filter(version => version.importId !== id);
    return visit.versions.length;
  });
  const used = new Set(activity.visits.map(visit => visit.sourceId));
  activity.sources = activity.sources.filter(source => used.has(source.id));
  audit(state, 'activity_import_removed', { id, name: item.name }, now);
  return { id };
}

function assignSource(state, sourceId, employeeId, now = new Date()) {
  const source = state.activity?.sources.find(item => item.id === sourceId);
  if (!source) throw Error('Джерело не знайдено.');
  if (employeeId && !state.employees.some(person => person.id === employeeId)) throw Error('Працівника не знайдено.');
  const previous = source.employeeId;
  source.employeeId = employeeId || null;
  audit(state, 'activity_source_assigned', { sourceId, employeeId: source.employeeId, previous }, now);
  return source;
}

function updateSettings(state, input, now = new Date()) {
  state.activity ||= empty();
  state.activity.settings = settings({ ...state.activity.settings, ...input });
  audit(state, 'activity_settings_changed', state.activity.settings, now);
  return state.activity.settings;
}

function effectiveVisit(visit) {
  const last = visit.versions.at(-1);
  // Missing duration in a later snapshot must not erase an earlier observation.
  const durationVersion = visit.versions.findLast(version => version.durationMs !== null);
  return { ...visit, ...last, durationMs: durationVersion?.durationMs ?? null };
}

function normalize(input, employees = []) {
  if (input == null) return empty();
  if (!input || typeof input !== 'object' || !Array.isArray(input.sources) || !Array.isArray(input.imports) || !Array.isArray(input.visits)) {
    throw Error('Некоректний розділ моніторингу активності.');
  }
  const value = structuredClone(input);
  value.settings = settings(value.settings);
  const personIds = new Set(employees.map(p => p.id)), sourceIds = new Set(), importIds = new Set(), visitIds = new Set();
  const fail = () => { throw Error('Пошкоджено зв’язки або записи моніторингу активності.'); };
  for (const source of value.sources) {
    if (!source || typeof source.id !== 'string' || sourceIds.has(source.id) || typeof source.label !== 'string'
      || typeof source.browser !== 'string' || (source.employeeId && !personIds.has(source.employeeId))) fail();
    sourceIds.add(source.id);
  }
  for (const item of value.imports) {
    if (!item || typeof item.id !== 'string' || importIds.has(item.id) || typeof item.name !== 'string'
      || !/^[a-f0-9]{64}$/.test(item.hash) || !work.validDate(item.startDate) || !work.validDate(item.endDate)
      || !Array.isArray(item.issues) || !Number.isFinite(Date.parse(item.importedAt))) fail();
    importIds.add(item.id);
  }
  for (const visit of value.visits) {
    if (!visit || typeof visit.id !== 'string' || visitIds.has(visit.id) || !sourceIds.has(visit.sourceId)
      || !Number.isSafeInteger(visit.timestamp) || visit.timestamp < Date.UTC(2000, 0, 1) || visit.timestamp > Date.UTC(2101, 0, 1)
      || typeof visit.url !== 'string' || !visit.url || !Array.isArray(visit.versions) || !visit.versions.length) fail();
    const versionIds = new Set();
    for (const version of visit.versions) {
      if (!version || !importIds.has(version.importId) || versionIds.has(version.importId)
        || typeof version.title !== 'string' || typeof version.historyFile !== 'string'
        || (version.durationMs !== null && (!Number.isSafeInteger(version.durationMs) || version.durationMs < 0 || version.durationMs > 366 * DAY))
        || (version.visitCount !== null && (!Number.isSafeInteger(version.visitCount) || version.visitCount < 0))) fail();
      versionIds.add(version.importId);
    }
    visitIds.add(visit.id);
  }
  return value;
}

function removeEmployee(activity, id) {
  if (!activity) return;
  const removed = new Set(activity.sources.filter(source => source.employeeId === id).map(source => source.id));
  activity.sources = activity.sources.filter(source => !removed.has(source.id));
  activity.visits = activity.visits.filter(visit => !removed.has(visit.sourceId));
}

function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
const intervalLength = intervals => intervals.reduce((sum, [s, e]) => sum + e - s, 0);
function intersect(intervals, windows) {
  return mergeIntervals(intervals.flatMap(([s, e]) => windows.map(([a, b]) => [Math.max(s, a), Math.min(e, b)])));
}
function complement(intervals, windows) {
  const gaps = [];
  for (const [a, b] of windows) {
    let cursor = a;
    for (const [s, e] of intersect(intervals, [[a, b]])) {
      if (s > cursor) gaps.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < b) gaps.push([cursor, b]);
  }
  return gaps;
}

function dayReport(state, group, date, visits, rules, now = new Date()) {
  const midnight = Date.parse(date + 'T00:00:00Z');
  const start = midnight + timeMinutes(rules.startTime) * MINUTE, end = midnight + timeMinutes(rules.endTime) * MINUTE;
  const lunchStart = midnight + timeMinutes(rules.lunchStart) * MINUTE, lunchEnd = midnight + timeMinutes(rules.lunchEnd) * MINUTE;
  const windows = [[start, lunchStart], [lunchEnd, end]];
  const today = work.dateKey(now), future = date > today;
  const currentTime = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
  const inProgress = date === today && currentTime < end;
  const observedWindows = future ? [] : inProgress ? intersect(windows, [[midnight, currentTime]]) : windows;
  const person = group.employeeId && state.employees.find(person => person.id === group.employeeId);
  const mark = person ? presence.get(state, person.id, date) : null;
  const calendarWorkday = person ? work.isWorkday(state, person.id, date) : state.settings.workdays.includes(new Date(midnight).getUTCDay());
  const exempt = mark && (presence.absent.has(mark.status) || presence.learning.has(mark.status));
  const expectedMs = calendarWorkday && !exempt ? intervalLength(windows) : 0;
  const ordered = visits.slice().sort((a, b) => a.timestamp - b.timestamp);
  // Bound each history duration. Open background tabs must not cover hours of
  // unobserved work; this is a configurable estimate, never actual attendance.
  const estimates = mergeIntervals(ordered.map(visit => [visit.timestamp, visit.timestamp +
    (visit.durationMs === null ? rules.missingVisitMinutes * MINUTE : Math.min(visit.durationMs, rules.maxVisitMinutes * MINUTE))]));
  const intervals = intersect(estimates, observedWindows), activeMs = ordered.length ? intervalLength(intervals) : null;
  const first = ordered[0]?.timestamp ?? null, last = ordered.at(-1)?.timestamp ?? null;
  const gaps = ordered.length && expectedMs ? complement(intervals, observedWindows).map(([from, to]) => ({
    from: clockOf(from), to: clockOf(to), durationMs: to - from,
    kind: from === start ? 'start' : to === end ? 'end' : 'gap', start: from, end: to,
  })) : [];
  const longGaps = gaps.filter(gap => gap.durationMs >= rules.gapMinutes * MINUTE);
  const lateMs = first !== null && expectedMs ? intervalLength(intersect([[start, Math.max(start, first)]], windows)) : null;
  const lastEvidence = last === null ? null : intervals.reduce((latest, interval) => Math.max(latest, interval[1]), last);
  const earlyMs = lastEvidence !== null && expectedMs ? intervalLength(intersect([[Math.min(end, lastEvidence), end]], windows)) : null;
  const outsideMs = ordered.length ? intervalLength(intersect(estimates, [[midnight, start], [end, midnight + DAY]])) : null;
  const anomalies = [];
  if (expectedMs && ordered.length && !future) {
    if (!inProgress && expectedMs - activeMs > rules.toleranceMinutes * MINUTE) anomalies.push({ code: 'under_norm', label: 'Оцінка активності нижча за норму', durationMs: expectedMs - activeMs });
    if (lateMs > rules.toleranceMinutes * MINUTE) anomalies.push({ code: 'late', label: 'Пізній перший запис', durationMs: lateMs });
    if (!inProgress && earlyMs > rules.toleranceMinutes * MINUTE) anomalies.push({ code: 'early', label: 'Активність завершується раніше графіка (оцінка)', durationMs: earlyMs });
    for (const gap of longGaps.filter(gap => gap.kind === 'gap')) anomalies.push({ code: 'gap', label: `Пауза ${gap.from.slice(0, 5)}–${gap.to.slice(0, 5)}`, durationMs: gap.durationMs });
  }
  if (ordered.some(visit => visit.timestamp < start || visit.timestamp >= end)) anomalies.push({ code: 'outside', label: 'Записи поза графіком', durationMs: outsideMs });
  if (!calendarWorkday && ordered.length) anomalies.push({ code: 'weekend', label: 'Активність у вихідний', durationMs: activeMs });
  if (exempt && ordered.length) anomalies.push({ code: 'presence', label: `Наявність: ${presence.labels[mark.status]}`, durationMs: null });
  const missingCount = ordered.filter(visit => visit.durationMs === null).length;
  const cappedCount = ordered.filter(visit => visit.durationMs > rules.maxVisitMinutes * MINUTE).length;
  return { key: group.key + '|' + date, groupKey: group.key, employeeId: group.employeeId, name: group.name, date,
    presence: mark ? presence.labels[mark.status] : calendarWorkday ? 'Робочий день' : 'Вихідний',
    expectedMs, activeMs, deficitMs: activeMs === null || inProgress || future ? null : Math.max(0, expectedMs - activeMs),
    first: first === null ? null : clockOf(first), last: last === null ? null : clockOf(last),
    recordCount: ordered.length, missingCount, cappedCount, lateMs, earlyMs, outsideMs,
    rawDurationMs: ordered.reduce((sum, visit) => sum + (visit.durationMs || 0), 0),
    gaps, longGaps, maxGapMs: gaps.reduce((max, gap) => Math.max(max, gap.durationMs), 0),
    intervals: intervals.map(([from, to]) => ({ from: clockOf(from), to: clockOf(to), start: from, end: to })),
    anomalies, inProgress, future, status: !ordered.length ? 'no-data' : anomalies.length ? 'review' : !expectedMs ? 'off' : 'observed',
  };
}

function report(state, filter = {}, now = new Date()) {
  const activity = state.activity || empty();
  const today = work.dateKey(now);
  const startDate = filter.startDate || today, endDate = filter.endDate || today;
  if (!work.validDate(startDate) || !work.validDate(endDate) || startDate > endDate) throw Error('Перевірте початок і кінець періоду.');
  if ((Date.parse(endDate) - Date.parse(startDate)) / DAY > 365) throw Error('Оберіть період не довше одного року.');
  const rules = settings(activity.settings), sources = new Map(activity.sources.map(source => [source.id, source]));
  const groups = new Map();
  for (const source of activity.sources) {
    if (filter.employeeId === 'unassigned' ? source.employeeId : filter.employeeId && source.employeeId !== filter.employeeId) continue;
    const key = source.employeeId || `source:${source.id}`;
    const name = state.employees.find(person => person.id === source.employeeId)?.name || source.label;
    if (!groups.has(key)) groups.set(key, { key, employeeId: source.employeeId, name, sourceIds: [] });
    groups.get(key).sourceIds.push(source.id);
  }
  const byDate = new Map(), journal = [];
  for (const saved of activity.visits) {
    const source = sources.get(saved.sourceId), groupKey = source?.employeeId || `source:${saved.sourceId}`;
    if (!source || !groups.has(groupKey)) continue;
    const visit = effectiveVisit(saved), date = dateOf(visit.timestamp);
    if (date < startDate || date > endDate) continue;
    const key = groupKey + '|' + date;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(visit);
    journal.push({ id: visit.id, groupKey, employeeId: source.employeeId, name: groups.get(groupKey).name,
      date, time: clockOf(visit.timestamp), timestamp: visit.timestamp, url: visit.url, title: visit.title,
      domain: visit.domain, browser: source.browser, source: source.label, durationMs: visit.durationMs,
      visitCount: visit.visitCount, typedCount: visit.typedCount, urlLength: visit.urlLength,
      rawBrowser: visit.rawBrowser, userProfile: source.userProfile, browserProfile: source.profile,
      capped: visit.durationMs !== null && visit.durationMs > rules.maxVisitMinutes * MINUTE,
      visitType: visit.visitType, recordId: visit.recordId, visitedFrom: visit.visitedFrom, historyFile: visit.historyFile,
      files: visit.versions.map(version => activity.imports.find(item => item.id === version.importId)?.name).filter(Boolean) });
  }
  const allRows = [];
  for (const group of groups.values()) {
    for (let date = startDate; date <= endDate; date = dateOf(Date.parse(date + 'T00:00:00Z') + DAY)) {
      const visits = byDate.get(group.key + '|' + date) || [];
      const row = dayReport(state, group, date, visits, rules, now);
      if (row.recordCount || row.expectedMs) allRows.push(row);
    }
  }
  const query = clean(filter.query, 200).toLocaleLowerCase('uk-UA');
  const rowMatches = row => !query || `${row.name} ${row.date} ${row.anomalies.map(item => item.label).join(' ')}`.toLocaleLowerCase('uk-UA').includes(query);
  const rows = allRows.filter(row => rowMatches(row) && (!filter.onlyAnomalies || row.anomalies.length))
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'uk-UA'));
  const filteredJournal = journal.filter(visit => !query || `${visit.name} ${visit.date} ${visit.title} ${visit.url} ${visit.browser}`.toLocaleLowerCase('uk-UA').includes(query))
    .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
  const sites = new Map();
  for (const visit of filteredJournal) {
    const key = visit.groupKey + '|' + visit.domain;
    if (!sites.has(key)) sites.set(key, { key, name: visit.name, domain: visit.domain, recordCount: 0, durationMs: 0, missingCount: 0 });
    const site = sites.get(key); site.recordCount++; site.durationMs += visit.durationMs || 0; site.missingCount += visit.durationMs === null ? 1 : 0;
  }
  return { startDate, endDate, settings: rules, rows, journal: filteredJournal,
    sites: [...sites.values()].sort((a, b) => b.recordCount - a.recordCount),
    sources: activity.sources.map(source => ({ ...source, name: state.employees.find(p => p.id === source.employeeId)?.name || '',
      recordCount: activity.visits.filter(visit => visit.sourceId === source.id).length })),
    imports: activity.imports.slice().reverse().map(item => ({ ...item,
      retainedCount: activity.visits.filter(visit => visit.versions.some(v => v.importId === item.id)).length })),
    totals: { observedDays: rows.filter(row => row.recordCount).length, noDataDays: rows.filter(row => !row.recordCount).length,
      anomalyDays: rows.filter(row => row.anomalies.length).length,
      activeMs: rows.reduce((sum, row) => sum + (row.activeMs || 0), 0),
      expectedMs: rows.filter(row => row.recordCount).reduce((sum, row) => sum + row.expectedMs, 0),
      recordCount: filteredJournal.length, unassignedSources: activity.sources.filter(source => !source.employeeId).length } };
}

function dailyDetail(state, input) {
  const data = report(state, { startDate: input.date, endDate: input.date });
  const row = data.rows.find(row => row.groupKey === input.groupKey);
  if (!row) throw Error('День не знайдено.');
  return { row, settings: data.settings, journal: data.journal.filter(visit => visit.groupKey === input.groupKey).reverse() };
}

function reportCsv(data) {
  const escape = value => {
    const text = String(value ?? '');
    return '"' + (/^[=+@-]/.test(text.trimStart()) ? "'" + text : text).replaceAll('"', '""') + '"';
  };
  const minutes = value => value === null ? '' : Math.round(value / MINUTE * 100) / 100;
  return '\uFEFF' + [
    ['Дата', 'Працівник / джерело', 'Норма, хв', 'Оцінка активності, хв', 'Бракує до норми (оцінка), хв', 'Перший запис', 'Останній запис', 'Записів', 'Без тривалості', 'Довгих пауз', 'Найдовша пауза, хв', 'Аномалії', 'Наявність'],
    ...data.rows.map(row => [row.date, row.name, minutes(row.expectedMs), minutes(row.activeMs), minutes(row.deficitMs), row.first, row.last,
      row.recordCount, row.missingCount, row.longGaps.length, minutes(row.maxGapMs), row.anomalies.map(item => item.label).join('; '), row.presence]),
  ].map(row => row.map(escape).join(';')).join('\r\n');
}

module.exports = { DEFAULT_SETTINGS, MAX_FILE_BYTES, MAX_BATCH_BYTES, settings, empty, normalize,
  parseTime, parseDuration, decode, csvRows, parseFile, previewImports, applyImports, removeImport,
  assignSource, updateSettings, removeEmployee, effectiveVisit, mergeIntervals, dayReport, report, dailyDetail, reportCsv };
