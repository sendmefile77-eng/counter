const test = require('node:test');
const assert = require('node:assert/strict');
const { readDocumentFiles } = require('../src/main/document-job');
const { wordText } = require('../src/main/document-reader');
function pdf(objects) {
  const parts = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  objects.forEach((object, index) => { offsets.push(parts.reduce((sum, part) => sum + part.length, 0)); parts.push(Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')); });
  const start = parts.reduce((sum, part) => sum + part.length, 0);
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`));
  return Buffer.concat(parts);
}
function stream(data, header = '') { return Buffer.concat([Buffer.from(`<< /Length ${data.length} ${header} >>\nstream\n`), data, Buffer.from('\nendstream')]); }
test('DOCX and XLSX preserve table columns and source locations in a background worker', async () => {
  const zip = new (require('jszip'))();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const cell = text => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr>${cell('ПІБ')}${cell('Дата народження')}</w:tr><w:tr>${cell('Коваленко Юлія Олександрівна')}${cell('12.03.1985')}</w:tr></w:tbl></w:body></w:document>`);
  const docx = await zip.generateAsync({ type: 'nodebuffer' });
  const book = new (require('exceljs').Workbook)(), sheet = book.addWorksheet('Люди');
  sheet.addRow(['ПІБ', 'Дата народження']); sheet.addRow(['Коваленко Юлія Олександрівна', new Date('1985-03-12T00:00:00Z')]);
  const result = await readDocumentFiles([{ name: 'Люди.docx', bytes: docx }, { name: 'Люди.xlsx', bytes: await book.xlsx.writeBuffer() }]);
  assert.deepEqual(result.errors, []); assert.equal(result.blocks.length, 2);
  assert.match(result.blocks[0].text, /ПІБ\tДата народження/);
  assert.match(result.blocks[0].text, /Коваленко Юлія Олександрівна\t12.03.1985/);
  assert.match(result.blocks[1].text, /Коваленко Юлія Олександрівна\t1985-03-12/);
  assert.match(result.blocks[1].name, /Люди.xlsx · Люди/);
});
test('text PDF and malformed files return readable content and explicit per-file errors', async () => {
  const content = Buffer.from('BT /F1 16 Tf 30 150 Td (Employee Name 12.03.1985) Tj ET');
  const document = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', stream(content)]);
  const result = await readDocumentFiles([{ name: 'text.pdf', bytes: document }, { name: 'old.doc', bytes: Buffer.from('old') }]);
  assert.equal(result.blocks.length, 1); assert.equal(result.blocks[0].ocr, false); assert.match(result.blocks[0].text, /Employee Name/);
  assert.equal(result.errors.length, 1); assert.match(result.errors[0].message, /DOCX/);
});
test('offline OCR reads an image and scanned PDF using bundled Ukrainian language data', { timeout: 90000 }, async () => {
  const canvas = require('@napi-rs/canvas').createCanvas(1200, 180), context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 1200, 180); context.fillStyle = 'black'; context.font = '42px sans-serif';
  context.fillText('Коваленко Юлія Олександрівна', 30, 65); context.fillText('12.03.1985', 30, 125);
  const png = await canvas.encode('png'), jpeg = await canvas.encode('jpeg');
  const content = Buffer.from('q 600 0 0 90 0 0 cm /Im0 Do Q');
  const scanned = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 90] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    stream(jpeg, '/Type /XObject /Subtype /Image /Width 1200 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'), stream(content)]);
  const result = await readDocumentFiles([{ name: 'photo.png', bytes: png }, { name: 'scan.pdf', bytes: scanned }]);
  assert.deepEqual(result.errors, []); assert.equal(result.blocks.length, 2);
  for (const block of result.blocks) { assert.equal(block.ocr, true); assert.match(block.text, /Коваленко/); assert.match(block.text, /12\.03\.1985/); assert.ok(block.confidence > 50); }
});
test('Word text preserves literal characters and table separators', () => {
  assert.equal(wordText('<p>А &amp; Б</p><table><tr><td><p>Юлія</p></td><td><p>12.03</p></td></tr></table>'), 'А & Б\nЮлія\t12.03');
});
