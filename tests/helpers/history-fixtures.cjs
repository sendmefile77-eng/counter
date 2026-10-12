const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { crc32 } = require('../../src/main/history-archive');
const EPOCH = 11644473600000000n;
function database(browser = 'Chrome', rows = [{ id: 1, utc: '2026-01-08T07:00:00Z', duration: 60000000n }], walHeader = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-fixture-')), file = path.join(dir, 'history.db');
  let db;
  try {
    db = new DatabaseSync(file);
    if (walHeader) db.exec('PRAGMA journal_mode=WAL');
    const ff = browser === 'Firefox';
    db.exec(ff
      ? 'CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INTEGER,typed INTEGER);CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY,place_id INTEGER,visit_date INTEGER,visit_type INTEGER,from_visit INTEGER);'
      : 'CREATE TABLE urls(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INTEGER,typed_count INTEGER);CREATE TABLE visits(id INTEGER PRIMARY KEY,url INTEGER,visit_time INTEGER,visit_duration INTEGER,transition INTEGER,from_visit INTEGER);');
    const url = db.prepare(`INSERT INTO ${ff ? 'moz_places' : 'urls'} VALUES(?,?,?,?,?)`);
    const visit = db.prepare(`INSERT INTO ${ff ? 'moz_historyvisits' : 'visits'} VALUES(${ff ? '?,?,?,?,?' : '?,?,?,?,?,?'})`);
    for (const row of rows) {
      url.run(row.id, row.url || `https://example.test/${row.id}`, 'Синтетичний тест', 1, 0);
      const time = row.rawTime ?? BigInt(Date.parse(row.utc)) * 1000n + (ff ? 0n : EPOCH);
      if (ff) visit.run(row.id, row.id, time, 1, 0);
      else visit.run(row.id, row.id, time, row.duration ?? 0n, 0, 0);
    }
    db.close(); db = null;
    return fs.readFileSync(file);
  } finally { db?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
function zip(items, method = 8) {
  const local = [], central = []; let offset = 0;
  for (const [name, bytes] of items) {
    const text = Buffer.from(name), compressed = method === 8 ? zlib.deflateRawSync(bytes) : bytes;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc32(bytes), 14); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(bytes.length, 22); head.writeUInt16LE(text.length, 26);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(crc32(bytes), 16); dir.writeUInt32LE(compressed.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(text.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, text, compressed); central.push(dir, text); offset += head.length + text.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const file = (items, name = 'PC-1_20260108_180000.zip', method = 8) => ({ name, bytes: zip(items, method) });
module.exports = { database, zip, file, EPOCH };
