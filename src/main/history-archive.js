const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const activity = require('../shared/activity');
const { ZONE, kyivWallClock } = require('../shared/activity-time');

const MAX_EXPANDED = 256 * 1024 * 1024;
const MAX_DATABASE = 96 * 1024 * 1024;
const MAX_VISITS = 500000;
const CHROMIUM_EPOCH_US = 11644473600000000n;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let n = 0xffffffff; for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }

function zipEntries(buffer) {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) throw Error('Не вдалося прочитати структуру ZIP.');
  const count = buffer.readUInt16LE(end + 10), centralSize = buffer.readUInt32LE(end + 12), centralOffset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count
    || count === 65535 || count > 2000 || centralOffset + centralSize > end) throw Error('Багатотомний, ZIP64 або надто великий архів не підтримується.');
  let offset = centralOffset, expanded = 0;
  const entries = [], names = new Set();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > centralOffset + centralSize || buffer.readUInt32LE(offset) !== 0x02014b50) throw Error('Пошкоджено каталог ZIP.');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const checksum = buffer.readUInt32LE(offset + 16), compressedSize = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42), next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > centralOffset + centralSize || buffer.readUInt16LE(offset + 34)) throw Error('Пошкоджено запис ZIP.');
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength);
    let name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    for (let p = offset + 46 + nameLength; p + 4 <= offset + 46 + nameLength + extraLength;) {
      const tag = buffer.readUInt16LE(p), length = buffer.readUInt16LE(p + 2); p += 4;
      if (p + length > next - commentLength) throw Error('Пошкоджено додаткові поля ZIP.');
      if (tag === 0x7075 && length >= 5 && buffer[p] === 1 && buffer.readUInt32LE(p + 1) === crc32(rawName)) name = buffer.subarray(p + 5, p + length).toString('utf8');
      p += length;
    }
    name = name.replaceAll('\\', '/');
    if (!name || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')
      || names.has(name) || ((buffer.readUInt32LE(offset + 38) >>> 16) & 0xf000) === 0xa000) throw Error('Архів містить небезпечний або дубльований шлях.');
    names.add(name);
    if (flags & 1) throw Error('ZIP захищено паролем. Потрібен незашифрований архів.');
    if (![0, 8].includes(method)) throw Error('Метод стиснення ZIP не підтримується. Використайте звичайний ZIP.');
    expanded += size;
    if (size > MAX_DATABASE || expanded > MAX_EXPANDED) throw Error('Розпаковані дані перевищують межу: 96 МБ на базу, 256 МБ на архів.');
    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw Error('Пошкоджено заголовок файла ZIP.');
    if (buffer.readUInt16LE(localOffset + 8) !== method || (buffer.readUInt16LE(localOffset + 6) & 1)) throw Error('Неузгоджені заголовки ZIP.');
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (start + compressedSize > centralOffset) throw Error('Дані ZIP обрізано.');
    entries.push({ name, size, compressedSize, method, checksum, start, isDirectory: name.endsWith('/') });
    offset = next;
  }
  if (offset !== centralOffset + centralSize) throw Error('Некоректний розмір каталогу ZIP.');
  return entries;
}

function unzipEntry(buffer, entry) {
  const bytes = buffer.subarray(entry.start, entry.start + entry.compressedSize);
  const result = entry.method === 0 ? Buffer.from(bytes) : zlib.inflateRawSync(bytes, { maxOutputLength: Math.max(1, entry.size) });
  if (result.length !== entry.size || crc32(result) !== entry.checksum) throw Error('Не збігається розмір або контрольна сума файла ZIP.');
  return result;
}
function tableColumns(db, name) { return new Set(db.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name)); }
function numeric(value) { if (value == null) return null; const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null; }
function visitTime(raw, chromium) {
  if (raw == null || BigInt(raw) <= 0n) throw Error('Немає часу відвідування.');
  const utcMs = Number((BigInt(raw) - (chromium ? CHROMIUM_EPOCH_US : 0n)) / 1000n);
  if (!Number.isSafeInteger(utcMs) || utcMs < Date.UTC(2000, 0, 1) || utcMs >= Date.UTC(2101, 0, 1)) throw Error('Час відвідування виходить за допустимий діапазон.');
  return { timestamp: kyivWallClock(utcMs), utcTimestamp: utcMs };
}
function location(entryName, browser) {
  const folder = entryName.split('/').slice(0, -1).join('/') || 'Історія браузера';
  const leaf = folder.split('/').at(-1);
  const match = leaf.match(/^(.*?)\s+(?:Chrome|Edge|Firefox|Opera|Brave|Vivaldi)\s+history$/i);
  return { computer: (match?.[1] || leaf).trim(), folder, browser };
}

function readDatabase(buffer, entry, sidecars, temporaryDirectory, ordinal, profileCounts, bytes) {
  const filePath = path.join(temporaryDirectory, `database-${ordinal}.sqlite`);
  fs.writeFileSync(filePath, bytes, { mode: 0o600 });
  const wal = sidecars.get(entry.name + '-wal');
  if (wal) fs.writeFileSync(filePath + '-wal', unzipEntry(buffer, wal), { mode: 0o600 });
  // No archive path is ever used as an output path. Immutable standalone copies
  // also read Firefox snapshots whose header declares WAL mode.
  const uri = pathToFileURL(filePath); uri.search = wal ? '?mode=ro' : '?mode=ro&immutable=1';
  const db = new DatabaseSync(uri.href, { readOnly: true, allowExtension: false, timeout: 1000 });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const chromium = tables.has('urls') && tables.has('visits'), firefox = tables.has('moz_places') && tables.has('moz_historyvisits');
    if (!chromium && !firefox) throw Error('У SQLite немає таблиць історії підтримуваного браузера.');
    const browser = firefox ? 'Firefox' : /\bEdge\b/i.test(entry.name) ? 'Edge' : /\bOpera\b/i.test(entry.name) ? 'Opera' : 'Chrome';
    const loc = location(entry.name, browser), group = `${loc.computer.toLowerCase()}|${browser}`;
    const profileIndex = (profileCounts.get(group) || 0) + 1; profileCounts.set(group, profileIndex);
    const visitTable = chromium ? 'visits' : 'moz_historyvisits';
    const count = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${visitTable}`).get().n);
    if (count > MAX_VISITS) throw Error('У базі понад 500 000 відвідувань. Виберіть коротшу вигрузку.');
    const columns = tableColumns(db, visitTable), urlColumns = tableColumns(db, chromium ? 'urls' : 'moz_places');
    const optional = (alias, available, name) => available.has(name) ? `${alias}.${name}` : 'NULL';
    const query = chromium
      ? `SELECT v.id, v.visit_time AS raw_time, u.url, ${optional('u', urlColumns, 'title')} AS title,
          ${optional('v', columns, 'visit_duration')} AS duration, ${optional('v', columns, 'transition')} AS transition,
          ${optional('u', urlColumns, 'visit_count')} AS visit_count, ${optional('u', urlColumns, 'typed_count')} AS typed_count,
          r.url AS referrer FROM visits v JOIN urls u ON u.id=v.url LEFT JOIN visits p ON p.id=v.from_visit LEFT JOIN urls r ON r.id=p.url ORDER BY v.visit_time,v.id`
      : `SELECT v.id, v.visit_date AS raw_time, u.url, ${optional('u', urlColumns, 'title')} AS title,
          NULL AS duration, ${optional('v', columns, 'visit_type')} AS transition,
          ${optional('u', urlColumns, 'visit_count')} AS visit_count, ${optional('u', urlColumns, 'typed')} AS typed_count,
          r.url AS referrer FROM moz_historyvisits v JOIN moz_places u ON u.id=v.place_id LEFT JOIN moz_historyvisits p ON p.id=v.from_visit LEFT JOIN moz_places r ON r.id=p.place_id ORDER BY v.visit_date,v.id`;
    const statement = db.prepare(query); statement.setReadBigInts(true);
    const visits = [], issues = [];
    for (const row of statement.iterate()) {
      try {
        const url = String(row.url || '').trim();
        if (!url || url.length > 32768) throw Error('Адреса порожня або надто довга.');
        const times = visitTime(row.raw_time, chromium), recordId = String(row.id);
        const rawDuration = row.duration == null ? null : BigInt(row.duration);
        if (rawDuration != null && rawDuration < 0n) throw Error('Некоректна тривалість відвідування.');
        const durationMs = rawDuration != null && rawDuration > 0n ? Number(rawDuration / 1000n) : null;
        if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs > 366 * 86400000)) throw Error('Некоректна тривалість відвідування.');
        let domain; try { const u = new URL(url); domain = u.hostname || u.protocol.replace(':', ''); } catch (_) { domain = 'Невизначена адреса'; }
        const type = row.transition == null ? null : Number(BigInt(row.transition) & 255n);
        const labels = chromium ? ['Link', 'Typed URL', 'Auto Bookmark', 'Auto Subframe', 'Manual Subframe', 'Generated', 'Auto TopLevel', 'Form Submit', 'Reload', 'Keyword', 'Keyword Generated']
          : { 1: 'Link', 2: 'Typed URL', 3: 'Bookmark', 4: 'Embed', 5: 'Permanent Redirect', 6: 'Temporary Redirect', 7: 'Download', 8: 'Framed Link', 9: 'Reload' };
        visits.push({ ...times, recordId, url, domain, durationMs, visitCount: numeric(row.visit_count), typedCount: numeric(row.typed_count),
          title: String(row.title || '').slice(0, 2000), visitType: labels[type] || String(type ?? ''), rawBrowser: browser,
          visitedFrom: String(row.referrer || '').slice(0, 32768), historyFile: entry.name, urlLength: url.length });
      } catch (error) { issues.push({ entry: entry.name, row: String(row.id), message: error.message }); }
    }
    if (visits.length + issues.length !== count) {
      const lost = count - visits.length - issues.length;
      if (lost > 0) issues.push({ entry: entry.name, message: `${lost} записів не мають пов’язаної адреси.` });
    }
    const first = visits[0];
    const profileKey = first ? hash(JSON.stringify([first.recordId, first.utcTimestamp, first.url])) : hash(bytes);
    const sourceId = hash(JSON.stringify(['sqlite', loc.computer.toLowerCase(), browser.toLowerCase(), profileKey]));
    const source = { id: sourceId, profile: loc.folder, userProfile: '', browser, computer: loc.computer,
      directory: loc.folder.toLowerCase(), label: `${loc.folder} · профіль ${profileIndex}`, employeeId: null,
      format: 'sqlite', profileKey, profileIndex, timeZone: ZONE };
    for (const visit of visits) { visit.sourceId = sourceId; visit.id = hash(JSON.stringify([sourceId, visit.recordId, visit.timestamp, visit.url])); }
    return { source, visits, issues, database: { name: entry.name, browser, profileIndex, records: count, readRecords: visits.length, status: count ? 'read' : 'empty' } };
  } finally { db.close(); }
}

function parseArchive(file, temporaryRoot = os.tmpdir()) {
  if (!file || typeof file.name !== 'string' || !/\.zip$/i.test(file.name)
    || (!(file.bytes instanceof Uint8Array) && !Array.isArray(file.bytes))) throw Error('Виберіть ZIP із базами історії браузерів.');
  const buffer = Buffer.from(file.bytes);
  if (!buffer.length || buffer.length > activity.MAX_FILE_BYTES) throw Error('ZIP порожній або перевищує 32 МБ.');
  const entries = zipEntries(buffer), sidecars = new Map(entries.map(entry => [entry.name, entry]));
  const temporary = fs.mkdtempSync(path.join(temporaryRoot, 'lad-history-'));
  const sources = [], visits = [], issues = [], databases = [], profileCounts = new Map();
  let ignoredFiles = 0, rowCount = 0;
  try {
    for (let index = 0; index < entries.length; index++) {
      if (rowCount > MAX_VISITS) throw Error('В архіві понад 500 000 записів. Розділіть вигрузку.');
      const entry = entries[index];
      if (entry.isDirectory || /-(?:wal|shm)$/.test(entry.name)) continue;
      try {
        if (/\.csv$/i.test(entry.name)) {
          const parsed = activity.parseFile({ name: path.basename(entry.name), bytes: unzipEntry(buffer, entry) });
          sources.push(...parsed.sources); visits.push(...parsed.visits); rowCount += parsed.rowCount;
          issues.push(...parsed.issues.map(issue => ({ ...issue, entry: entry.name })));
          databases.push({ name: entry.name, browser: 'CSV', records: parsed.rowCount, readRecords: parsed.visits.length, status: 'read' });
          continue;
        }
        const bytes = unzipEntry(buffer, entry);
        if (bytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') {
          if (/(?:history|places\.sqlite|\.db|\.sqlite)$/i.test(entry.name)) throw Error('Файл історії не є справною базою SQLite.');
          ignoredFiles++; continue;
        }
        const result = readDatabase(buffer, entry, sidecars, temporary, index, profileCounts, bytes);
        databases.push(result.database); rowCount += result.database.records; issues.push(...result.issues);
        if (result.visits.length) {
          if (sources.some(source => source.id === result.source.id)) {
            // Identical copies inside one archive can be distinct profiles.
            result.source.id = hash(result.source.id + '|' + result.source.profileIndex);
            for (const visit of result.visits) { visit.sourceId = result.source.id; visit.id = hash(JSON.stringify([visit.sourceId, visit.recordId, visit.timestamp, visit.url])); }
          }
          sources.push(result.source); visits.push(...result.visits);
        }
      } catch (error) { issues.push({ entry: entry.name, message: error.message }); databases.push({ name: entry.name, status: 'error', records: null, readRecords: 0 }); }
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  if (rowCount > MAX_VISITS) throw Error('В архіві понад 500 000 записів. Розділіть вигрузку.');
  if (!databases.length) throw Error('У ZIP не знайдено баз історії Chrome, Edge, Firefox або CSV.');
  if (!visits.length && issues.length) throw Error(`Не вдалося прочитати історію: ${issues[0].entry}: ${issues[0].message}`);
  const times = visits.map(visit => visit.timestamp);
  let fallback = file.name.match(/(20\d{2})(\d{2})(\d{2})_/)?.slice(1).join('-') || new Date().toISOString().slice(0, 10);
  try { activity.parseTime(fallback + ' 00:00:00'); } catch (_) { fallback = new Date().toISOString().slice(0, 10); }
  const extent = times.length ? [times.reduce((a, b) => Math.min(a, b)), times.reduce((a, b) => Math.max(a, b))].map(t => new Date(t).toISOString().slice(0, 10)) : [fallback, fallback];
  return { name: file.name.slice(0, 240), hash: hash(buffer), encoding: `ZIP / SQLite · ${ZONE}`, format: 'zip',
    rowCount, visits, sources, issues, databases, ignoredFiles, startDate: extent[0], endDate: extent[1] };
}

function parseInputs(files, temporaryRoot) {
  if (!Array.isArray(files) || !files.length || files.length > 50) throw Error('Виберіть від 1 до 50 файлів CSV або ZIP.');
  if (files.reduce((sum, file) => sum + (file?.bytes?.length || 0), 0) > activity.MAX_BATCH_BYTES) throw Error('Разом файли перевищують 64 МБ.');
  return files.map(file => /\.zip$/i.test(file?.name || '') ? parseArchive(file, temporaryRoot) : activity.parseFile(file));
}
module.exports = { zipEntries, unzipEntry, crc32, visitTime, parseArchive, parseInputs, MAX_EXPANDED };
