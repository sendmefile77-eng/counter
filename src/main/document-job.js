const path = require('node:path');
const { Worker } = require('node:worker_threads');
const fs = require('node:fs'), os = require('node:os');
function readDocumentFiles(files) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'document-worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-documents-'));
    let worker;
    try { worker = new Worker(workerPath, { workerData: { files, temporaryDirectory }, resourceLimits: { maxOldGenerationSizeMb: 512 } }); }
    catch (error) { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); reject(error); return; }
    let finished = false;
    const finish = (error, result) => {
      if (finished) return; finished = true; clearTimeout(timer);
      void (async () => {
        try {
          await worker.terminate();
          fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
          error ? reject(error) : resolve(result);
        } catch (cleanupError) { reject(error || cleanupError); }
      })();
    };
    const timer = setTimeout(() => finish(Error('Читання документів триває надто довго. Спробуйте менші файли.')), 180000);
    worker.once('message', message => finish(message.error ? Error(message.error) : null, message.result));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!finished) finish(Error(`Читання документів перервано (${code}).`)); });
  });
}
module.exports = { readDocumentFiles };
