const { parentPort, workerData } = require('node:worker_threads');
require('./document-reader').readDocuments(workerData.files, workerData.temporaryDirectory).then(
  result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: error.message }),
);
