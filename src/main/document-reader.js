const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const MAX_FILE = 16 * 1024 * 1024, MAX_TOTAL = 32 * 1024 * 1024, MAX_TEXT = 300000;

function officeLimit(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw Error('Пошкоджений офісний документ.');
  const count = buffer.readUInt16LE(end + 10);
  if (count > 2000 || buffer.readUInt16LE(end + 4)) throw Error('Документ має надто складну структуру.');
  let offset = buffer.readUInt32LE(end + 16), size = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw Error('Пошкоджений каталог документа.');
    size += buffer.readUInt32LE(offset + 24);
    if (size > 96 * 1024 * 1024 || buffer.readUInt16LE(offset + 8) & 1) throw Error('Документ зашифрований або завеликий після розпакування.');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}
const decode = text => text.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (match, decimal, hex, named) => {
  if (named) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[named.toLowerCase()];
  const code = Number.parseInt(decimal || hex, decimal ? 10 : 16);
  return code <= 0x10ffff ? String.fromCodePoint(code) : match;
});
function wordText(html) {
  // Strip markup before decoding entities, so literal <text> is never treated as HTML.
  return html.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => match[1].replace(/<\/p>|<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '').trim());
    return cells.join('\t') + '\n';
  }).replace(/<\/(?:p|h[1-6]|li)>|<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').split('\n')
    // Keep boundary tabs: they represent empty table cells, including a missing name.
    .map(line => decode(line).replace(/^[^\S\t]+|[^\S\t]+$/g, '')).filter(line => line.trim()).join('\n');
}
async function createOcr(temporaryDirectory) {
  const directory = fs.mkdtempSync(path.join(temporaryDirectory || require('node:os').tmpdir(), 'lad-ocr-'));
  try {
    for (const code of ['ukr', 'rus', 'eng']) {
      const data = require(`@tesseract.js-data/${code}`);
      fs.copyFileSync(path.join(data.langPath, code + '.traineddata.gz'), path.join(directory, code + '.traineddata.gz'));
    }
    const worker = await require('tesseract.js').createWorker('ukr+rus+eng', 1, { langPath: directory, cacheMethod: 'none', errorHandler: () => {} });
    await worker.setParameters({ preserve_interword_spaces: '1' });
    return {
      recognize: bytes => worker.recognize(bytes),
      terminate: async () => { try { await worker.terminate(); } finally { fs.rmSync(directory, { recursive: true, force: true }); } },
    };
  } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
}
async function readDocuments(files, temporaryDirectory) {
  if (!Array.isArray(files) || !files.length || files.length > 10) throw Error('Оберіть від 1 до 10 документів.');
  let total = 0, ocr;
  const blocks = [], errors = [];
  const recognize = async bytes => {
    ocr ||= await createOcr(temporaryDirectory);
    const { data } = await ocr.recognize(bytes);
    return { text: data.text, confidence: Math.round(data.confidence), ocr: true };
  };
  try {
    for (const file of files) {
      const name = path.basename(String(file.name || 'Документ')), buffer = Buffer.from(file.bytes || []);
      total += buffer.length;
      if (buffer.length > MAX_FILE || total > MAX_TOTAL) throw Error('Межі імпорту: до 16 МБ на файл, до 32 МБ разом.');
      try {
        const ext = path.extname(name).toLowerCase();
        if (['.txt', '.csv', '.tsv'].includes(ext)) {
          let text;
          if (buffer[0] === 255 && buffer[1] === 254) text = buffer.subarray(2).toString('utf16le');
          else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { text = new TextDecoder('windows-1251').decode(buffer); } }
          blocks.push({ name, text: text.replace(/^\uFEFF/, ''), ocr: false });
        } else if (ext === '.docx') {
          officeLimit(buffer);
          const result = await require('mammoth').convertToHtml({ buffer }, { externalFileAccess: false, convertImage: require('mammoth').images.imgElement(() => Promise.resolve({ src: '' })) });
          blocks.push({ name, text: wordText(result.value), ocr: false, warning: result.messages.map(message => message.message).join('; ').slice(0, 1000) });
        } else if (ext === '.xlsx') {
          officeLimit(buffer);
          const book = new (require('exceljs').Workbook)(); await book.xlsx.load(buffer);
          for (const sheet of book.worksheets) {
            const lines = []; if (sheet.rowCount > 2000 || sheet.columnCount > 80) throw Error('Надто великий аркуш. Залиште до 2000 рядків і 80 стовпців.');
            sheet.eachRow(row => lines.push(Array.from({ length: sheet.columnCount }, (_, i) => {
              const cell = row.getCell(i + 1), value = cell.value;
              if (value instanceof Date) return value.toISOString().slice(0, 10);
              return typeof value === 'object' && value?.formula ? String(value.result ?? '') : cell.text.replace(/[\r\n\t]+/g, ' ');
            }).join('\t')));
            blocks.push({ name: `${name} · ${sheet.name}`, text: lines.join('\n'), ocr: false });
          }
        } else if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
          const canvas = require('@napi-rs/canvas'), image = await canvas.loadImage(buffer);
          if (image.width * image.height > 24000000) throw Error('Зображення завелике: до 24 мільйонів пікселів.');
          blocks.push({ name, ...await recognize(buffer) });
        } else if (ext === '.pdf') {
          const pdfPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
          const pdfjs = await import(pathToFileURL(pdfPath).href);
          const root = path.dirname(path.dirname(path.dirname(pdfPath)));
          const loading = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true,
            cMapUrl: path.join(root, 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep });
          let document;
          try {
            document = await loading.promise;
            if (document.numPages > 30) throw Error('За один раз можна прочитати PDF до 30 сторінок.');
            for (let number = 1; number <= document.numPages; number++) {
              const page = await document.getPage(number), content = await page.getTextContent();
              const lines = [];
              for (const item of content.items.filter(item => item.str?.trim()).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
                let line = lines.find(line => Math.abs(line.y - item.transform[5]) < 3);
                if (!line) { line = { y: item.transform[5], items: [] }; lines.push(line); } line.items.push(item);
              }
              const text = lines.map(line => {
                let end = -Infinity;
                return line.items.sort((a, b) => a.transform[4] - b.transform[4]).map(item => {
                  const gap = item.transform[4] - end, prefix = end === -Infinity ? '' : gap > 14 ? '\t' : ' ';
                  end = item.transform[4] + item.width; return prefix + item.str;
                }).join('');
              }).join('\n');
              const label = `${name} · сторінка ${number}`;
              if (text.replace(/\s/g, '').length > 10) blocks.push({ name: label, text, ocr: false });
              else {
                const viewport = page.getViewport({ scale: 2 }), pixels = viewport.width * viewport.height;
                if (pixels > 16000000) throw Error(`Сторінка ${number} завелика для розпізнавання.`);
                const canvas = require('@napi-rs/canvas').createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                blocks.push({ name: label, ...await recognize(await canvas.encode('png')) });
              }
              page.cleanup();
            }
          } finally { await loading.destroy(); }
        } else throw Error('Формат не підтримується. Для старих DOC/XLS збережіть копію як DOCX/XLSX.');
      } catch (error) { errors.push({ name, message: String(error.message).slice(0, 600) }); }
      if (blocks.length > 60 || blocks.reduce((sum, block) => sum + block.text.length, 0) > MAX_TEXT) throw Error('Забагато тексту. Розділіть документи на менші частини.');
    }
  } finally { if (ocr) await ocr.terminate(); }
  return { blocks, errors };
}
module.exports = { readDocuments, wordText, officeLimit };
