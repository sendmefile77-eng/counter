const { app, BrowserWindow, dialog, ipcMain, Menu, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  STATUS_LABELS,
  allocateReceiptForward,
  archiveEmployee,
  calculateStatistics,
  clearManualRecord,
  clone,
  createEmployee,
  ensureAutomaticMisses,
  normalizeState,
  recordSubmission,
  restoreEmployee,
  setManualStatus,
} = require('../shared/domain');
const { DataStore } = require('./store');

let mainWindow = null;
let store = null;
let closeTimer = null;
const undoStack = [];

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 690,
    height: 760,
    minWidth: 560,
    minHeight: 640,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: store.state.settings.alwaysOnTop,
    resizable: true,
    show: false,
    title: 'Щоденний облік',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function currentSnapshot() {
  const changed = ensureAutomaticMisses(store.state, new Date());
  if (changed) store.save();
  return {
    ...store.snapshot(),
    generatedAt: new Date().toISOString(),
    dataFilePath: store.filePath,
  };
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('counter:changed', currentSnapshot());
  }
}

function mutate(action, callback) {
  const before = store.snapshot();
  try {
    const result = callback(store.state);
    undoStack.push({ action, before });
    if (undoStack.length > 30) undoStack.shift();
    store.save();
    broadcast();
    return clone(result);
  } catch (error) {
    store.state = before;
    throw error;
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCsv(state) {
  const header = [
    'Дата',
    'Працівник',
    'Статус',
    'Дата надходження',
    'Документ',
    'Складний запит на 2 дні',
    'Примітка',
  ];
  const rows = Object.values(state.records)
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId))
    .map((record) => {
      const employee = state.employees.find((item) => item.id === record.employeeId);
      return [
        record.date,
        employee?.name || 'Невідомий працівник',
        STATUS_LABELS[record.status] || record.status,
        record.receivedDate || '',
        record.documentRef || '',
        record.complexTwoDay ? 'Так' : 'Ні',
        record.note || '',
      ];
    });
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}

function registerIpc() {
  ipcMain.handle('snapshot:get', () => currentSnapshot());

  ipcMain.handle('employee:add', (_event, { name }) => (
    mutate('employee:add', (state) => createEmployee(state, name))
  ));
  ipcMain.handle('employee:archive', (_event, { employeeId }) => (
    mutate('employee:archive', (state) => archiveEmployee(state, employeeId))
  ));
  ipcMain.handle('employee:restore', (_event, { employeeId }) => (
    mutate('employee:restore', (state) => restoreEmployee(state, employeeId))
  ));
  ipcMain.handle('submission:record', (_event, payload) => (
    mutate('submission:record', (state) => recordSubmission(state, payload))
  ));
  ipcMain.handle('submission:allocate-forward', (_event, { receiptId, units }) => (
    mutate('submission:allocate-forward', (state) => allocateReceiptForward(state, receiptId, units))
  ));
  ipcMain.handle('record:set-status', (_event, payload) => (
    mutate('record:set-status', (state) => setManualStatus(state, payload))
  ));
  ipcMain.handle('record:clear', (_event, { employeeId, date }) => (
    mutate('record:clear', (state) => clearManualRecord(state, employeeId, date))
  ));
  ipcMain.handle('analytics:get', (_event, filter) => calculateStatistics(store.state, filter));

  ipcMain.handle('history:undo', () => {
    const last = undoStack.pop();
    if (!last) throw new Error('Немає дії, яку можна скасувати.');
    store.replace(last.before);
    broadcast();
    return { undone: last.action };
  });

  ipcMain.handle('data:export', async (_event, { format }) => {
    const isJson = format === 'json';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: isJson ? 'Зберегти резервну копію' : 'Експортувати таблицю',
      defaultPath: isJson ? 'shchodennyi-oblik-backup.json' : 'shchodennyi-oblik.csv',
      filters: isJson
        ? [{ name: 'Резервна копія JSON', extensions: ['json'] }]
        : [{ name: 'Таблиця CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const content = isJson
      ? `${JSON.stringify(store.state, null, 2)}\n`
      : buildCsv(store.state);
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('data:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Відкрити резервну копію',
      properties: ['openFile'],
      filters: [{ name: 'Резервна копія JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    const normalized = normalizeState(parsed);
    const before = store.snapshot();
    store.replace(normalized);
    undoStack.push({ action: 'data:import', before });
    broadcast();
    return { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('window:set-mode', (_event, { mode }) => {
    if (!mainWindow) return false;
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    if (mode === 'dashboard') {
      const width = Math.min(1240, display.workArea.width);
      const height = Math.min(860, display.workArea.height);
      mainWindow.setSize(width, height, true);
      mainWindow.center();
    } else {
      mainWindow.setSize(Math.min(690, display.workArea.width), Math.min(760, display.workArea.height), true);
    }
    return true;
  });

  ipcMain.handle('window:set-always-on-top', (_event, { value }) => {
    const enabled = Boolean(value);
    store.state.settings.alwaysOnTop = enabled;
    store.save();
    mainWindow?.setAlwaysOnTop(enabled);
    broadcast();
    return enabled;
  });
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:close', () => mainWindow?.close());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  store = new DataStore(app.getPath('userData'));
  store.load();
  ensureAutomaticMisses(store.state, new Date());
  store.save();
  registerIpc();
  createMainWindow();

  closeTimer = setInterval(() => {
    const changed = ensureAutomaticMisses(store.state, new Date());
    if (changed) {
      store.save();
      broadcast();
    }
  }, 30_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  if (closeTimer) clearInterval(closeTimer);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
