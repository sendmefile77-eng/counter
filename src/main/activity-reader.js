const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
function readActivityFiles(files) {
  return new Promise((resolve, reject) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-history-job-'));
    let worker;
    try { worker = new Worker(path.join(__dirname, 'activity-import-worker.js'), { workerData: { files, temporaryDirectory } }); }
    catch (error) { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); reject(error); return; }
    let finished = false;
    const finish = (error, value) => {
      if (finished) return; finished = true; clearTimeout(timer);
      void (async () => {
        try {
          await worker.terminate();
          fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
          error ? reject(error) : resolve(value);
        } catch (cleanupError) { reject(error || cleanupError); }
      })();
    };
    const timer = setTimeout(() => finish(Error('Читання історії триває надто довго. Спробуйте менші архіви.')), 120000);
    worker.once('message', result => finish(result.error ? Error(result.error) : null, result.parsed));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!finished) finish(Error(`Читання історії перервано (${code}).`)); });
  });
}
module.exports = { readActivityFiles };
