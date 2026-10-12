// Small, dependency-free OOXML export for the installed offline Electron app.
// Text cells are always inline strings, including URLs beginning with '='.
const zlib = require('node:zlib');
const xml = value => String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const column = index => { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
const dateNumber = value => (Date.parse(value + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000;
const duration = value => value == null ? null : { value: value / 86400000, style: 3 };
const time = value => value == null ? null : { value: value.split(':').reduce((sum, part, i) => sum + Number(part) * [3600, 60, 1][i], 0) / 86400, style: 4 };

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function zip(files) {
  const parts = [], entries = []; let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path), raw = Buffer.from(content), compressed = zlib.deflateRawSync(raw);
    const crc = crc32(raw), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    parts.push(local, name, compressed); entries.push(central, name); offset += local.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(entries), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

function worksheet(rows, widths) {
  const rowXml = rows.map((row, ri) => `<row r="${ri + 1}"${ri === 0 ? ' ht="32" customHeight="1"' : ''}>${row.map((item, ci) => {
    const ref = column(ci) + (ri + 1);
    if (item == null) return `<c r="${ref}"/>`;
    const value = typeof item === 'object' ? item.value : item, style = ri === 0 ? 1 : item?.style || 0;
    return typeof value === 'number' ? `<c r="${ref}" s="${style}"><v>${value}</v></c>`
      : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const last = column(rows[0].length - 1) + Math.max(1, rows.length);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="19"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}

function activityXlsx(data) {
  const summary = [
    ['Дата', 'Працівник / джерело', 'Норма', 'Оцінка активності', 'Бракує до норми (оцінка)', 'Перший запис', 'Останній запис', 'Записів', 'Без тривалості', 'Довгих пауз', 'Найдовша пауза', 'Аномалії', 'Наявність'],
    ...data.rows.map(row => [{ value: dateNumber(row.date), style: 2 }, row.name, duration(row.expectedMs), duration(row.activeMs), duration(row.deficitMs),
      time(row.first), time(row.last), row.recordCount, row.missingCount, row.longGaps.length, duration(row.maxGapMs), row.anomalies.map(item => item.label).join('; '), row.presence]),
  ];
  const journal = [
    ['Працівник / джерело', 'URL', 'Title', 'Visit Time', 'Visit Count', 'Visited From', 'Visit Type', 'Visit Duration', 'Web Browser', 'User Profile', 'Browser Profile', 'URL Length', 'Typed Count', 'History File', 'Record ID', 'Розпізнаний браузер', 'Файли імпорту'],
    ...data.journal.map(v => [v.name, v.url, v.title, { value: dateNumber(v.date) + v.time.split(':').reduce((sum, part, i) => sum + Number(part) * [3600, 60, 1][i], 0) / 86400, style: 5 },
      v.visitCount, v.visitedFrom, v.visitType, duration(v.durationMs), v.rawBrowser, v.userProfile, v.browserProfile,
      v.urlLength, v.typedCount, v.historyFile, v.recordId, v.browser, v.files.join('; ')]),
  ];
  const rules = data.settings;
  const method = [
    ['Параметр', 'Значення'], ['Період', `${data.startDate} — ${data.endDate}`],
    ['Робочий день', `${rules.startTime}–${rules.endTime}`], ['Обід', `${rules.lunchStart}–${rules.lunchEnd}`],
    ['Допустиме відхилення, хв', rules.toleranceMinutes], ['Довга пауза від, хв', rules.gapMinutes],
    ['Межа одного відвідування в оцінці, хв', rules.maxVisitMinutes], ['Запис без тривалості в оцінці, хв', rules.missingVisitMinutes],
    ['Розрахунок', 'Інтервали обмежено, перетини об’єднано; обід і час поза графіком виключено.'],
    ['Значення оцінки', 'Браузерна історія не підтверджує фактичних годин роботи. Пауза означає відсутність зафіксованої браузерної активності.'],
    ['Дні без записів', 'Немає даних. Оцінка й нестача залишаються порожніми.'],
    ['Час із ZIP', 'SQLite: UTC переведено в Europe/Kyiv з урахуванням літнього часу. У Firefox немає тривалості відвідувань.'],
    ['Час у CSV', 'Використовується час, надрукований у джерелі, без зміни часового поясу.'],
    ['Visit Count', 'Поле джерела; кількість рядків журналу рахується окремо.'],
  ];
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + [1, 2, 3].map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Зведення" sheetId="1" r:id="rId1"/><sheet name="Журнал" sheetId="2" r:id="rId2"/><sheet name="Правила розрахунку" sheetId="3" r:id="rId3"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + [1, 2, 3].map(i => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('') + '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="[h]:mm:ss"/><numFmt numFmtId="167" formatCode="hh:mm:ss"/><numFmt numFmtId="168" formatCode="dd.mm.yyyy hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3148"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': worksheet(summary, [14, 28, 13, 23, 28, 17, 17, 12, 18, 17, 21, 64, 24]),
    'xl/worksheets/sheet2.xml': worksheet(journal, [28, 65, 50, 24, 13, 50, 20, 20, 18, 24, 34, 13, 15, 60, 16, 25, 36]),
    'xl/worksheets/sheet3.xml': worksheet(method, [52, 110]),
  };
  return zip(files);
}

module.exports = { activityXlsx };
