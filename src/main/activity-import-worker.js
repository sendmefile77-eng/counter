const { parentPort, workerData } = require('node:worker_threads');
try {
  parentPort.postMessage({ parsed: require('./history-archive').parseInputs(workerData.files, workerData.temporaryDirectory) });
} catch (error) { parentPort.postMessage({ error: error.message }); }
