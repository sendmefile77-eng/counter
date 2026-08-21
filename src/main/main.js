const { app, BrowserWindow, dialog, ipcMain, Menu, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  STATUS_LABELS,
  allocateReceiptBackward,
  allocateReceiptForward,
  archiveEmployee,
  calculateDutyStatistics,
  calculateStatistics,
  clearDutyRestriction,
  clearWorkdayOverride,
  clearManualRecord,
  clone,
  createEmployee,
  dateKeyFromDate,
  ensureAutomaticMisses,
  generateDutySchedule,
  initializeDutyHistory,
  normalizeState,
  removeDutyAssignment,
  recordSubmission,
  restoreEmployee,
  setManualStatus,
  setDutyAssignment,
  setDutyRealized,
  setDutyRestriction,
  setWorkdayOverride,
  toggleDutyAssignment,
} = require('../shared/domain');
const { DataStore } = require('./store');

let mainWindow = null;
let store = null;
let closeTimer = null;
let positionSaveTimer = null;
let windowMode = 'widget';
let lastBroadcastDate = null;
const undoStack = [];

function clampWidgetSize(value) {
  return Math.max(260, Math.min(700, Math.round(Number(value) || 380)));
}

function applicationDataDirectory() {
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR
    || (process.env.PORTABLE_EXECUTABLE_FILE
      ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE)
      : null);
  const applicationDirectory = portableDirectory
    || (app.isPackaged ? path.dirname(process.execPath) : app.getAppPath());
  return path.join(applicationDirectory, 'Counter-data');
}

function buildCircularShape(size) {
  const rects = [];
  const radius = size / 2;
  const rowHeight = 1;
  for (let y = 0; y < size; y += rowHeight) {
    const sampleY = Math.min(size - 1, y + rowHeight / 2);
    const distance = sampleY - radius;
    const halfWidth = Math.sqrt(Math.max(0, radius * radius - distance * distance));
    const x = Math.max(0, Math.floor(radius - halfWidth));
    const width = Math.min(size - x, Math.ceil(halfWidth * 2));
    if (width > 0) rects.push({ x, y, width, height: Math.min(rowHeight, size - y) });
  }
  return rects;
}

function applyWidgetShape(size) {
  if (process.platform === 'win32' && mainWindow && typeof mainWindow.setShape === 'function') {
    mainWindow.setShape(buildCircularShape(size));
  }
}

function restoreWidgetPosition(size) {
  const saved = store.state.settings.widgetPosition;
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return false;
  const display = screen.getAllDisplays().find((candidate) => {
    const area = candidate.workArea;
    return saved.x + 80 < area.x + area.width
      && saved.y + 80 < area.y + area.height
      && saved.x + size - 80 > area.x
      && saved.y + size - 80 > area.y;
  });
  if (!display) return false;
  const area = display.workArea;
  const x = Math.max(area.x, Math.min(Math.round(saved.x), area.x + area.width - size));
  const y = Math.max(area.y, Math.min(Math.round(saved.y), area.y + area.height - size));
  mainWindow.setPosition(x, y, false);
  return true;
}

function setWindowBoundsAndWait(bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false);
  mainWindow.setBounds(bounds, false);
  const deadline = Date.now() + 750;
  return new Promise((resolve) => {
    const check = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return resolve(false);
      const current = mainWindow.getBounds();
      const ready = current.x === bounds.x
        && current.y === bounds.y
        && current.width === bounds.width
        && current.height === bounds.height;
      if (ready) return setTimeout(() => resolve(true), 32);
      if (Date.now() >= deadline) {
        mainWindow.setBounds(bounds, false);
        return setTimeout(() => resolve(true), 32);
      }
      setTimeout(check, 16);
    };
    check();
  });
}

function saveWidgetBounds() {
  if (!mainWindow || windowMode !== 'widget') return;
  const bounds = mainWindow.getBounds();
  store.state.settings.widgetSize = clampWidgetSize(Math.min(bounds.width, bounds.height));
  store.state.settings.widgetPosition = { x: bounds.x, y: bounds.y };
  store.save();
}

function createMainWindow() {
  const widgetSize = clampWidgetSize(store.state.settings.widgetSize);
  mainWindow = new BrowserWindow({
    width: widgetSize,
    height: widgetSize,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: store.state.settings.alwaysOnTop,
    resizable: false,
    hasShadow: false,
    roundedCorners: false,
    skipTaskbar: true,
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
  mainWindow.once('ready-to-show', () => {
    applyWidgetShape(widgetSize);
    if (!restoreWidgetPosition(widgetSize)) mainWindow.center();
    mainWindow.show();
  });
  mainWindow.on('moved', () => {
    if (windowMode !== 'widget') return;
    clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(saveWidgetBounds, 300);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function currentSnapshot() {
  const now = new Date();
  const changed = ensureAutomaticMisses(store.state, now);
  if (changed) store.save();
  lastBroadcastDate = dateKeyFromDate(now);
  return {
    ...store.snapshot(),
    generatedAt: now.toISOString(),
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
    'Тип запису',
    'Дата',
    'Працівник',
    'Статус',
    'Дата надходження',
    'Документ',
    'Складний запит на 2 дні',
    'Примітка',
  ];
  const requestRows = Object.values(state.records)
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId))
    .map((record) => {
      const employee = state.employees.find((item) => item.id === record.employeeId);
      return [
        'Облік запитів',
        record.date,
        employee?.name || 'Невідомий працівник',
        STATUS_LABELS[record.status] || record.status,
        record.receivedDate || '',
        record.documentRef || '',
        record.complexTwoDay ? 'Так' : 'Ні',
        record.note || '',
      ];
    });
  const dutyRows = Object.values(state.duties.assignments).flatMap((assignment) => (
    (assignment.employeeIds || []).map((employeeId) => {
      const employee = state.employees.find((item) => item.id === employeeId);
      return [
        'Чергування',
        assignment.date,
        employee?.name || 'Невідомий працівник',
        assignment.realizedEmployeeIds?.includes(employeeId) ? 'Реалізоване' : 'Заплановане',
        '',
        '',
        '',
        assignment.singleApproved ? 'Один черговий за дозволом' : '',
      ];
    })
  ));
  const dutyRestrictionRows = [
    ...Object.values(state.duties.aDays).map((item) => ({ ...item, label: 'А' })),
    ...Object.values(state.duties.unavailable).map((item) => ({ ...item, label: item.type })),
    ...Object.values(state.duties.planningBlocks || {})
      .map((item) => ({ ...item, label: 'Не планувати (без статистики)' })),
  ].map((item) => {
    const employee = state.employees.find((candidate) => candidate.id === item.employeeId);
    return [
      'Обмеження чергувань',
      item.date,
      employee?.name || 'Невідомий працівник',
      item.label,
      '',
      '',
      '',
      item.note || '',
    ];
  });
  const dutyBaselineRows = Object.entries(state.duties.baselines).map(([employeeId, baseline]) => {
    const employee = state.employees.find((item) => item.id === employeeId);
    return [
      'Початковий підсумок чергувань',
      state.duties.baselineYear || '',
      employee?.name || 'Невідомий працівник',
      `Усього: ${baseline.total || 0}; реалізованих: ${baseline.realized || 0}`,
      '',
      '',
      '',
      '',
    ];
  });
  const rows = [...requestRows, ...dutyRows, ...dutyRestrictionRows, ...dutyBaselineRows];
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
  ipcMain.handle('submission:allocate-backward', (_event, { receiptId, units }) => (
    mutate('submission:allocate-backward', (state) => allocateReceiptBackward(state, receiptId, units))
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
  ipcMain.handle('workday-override:set', (_event, { employeeId, date, note }) => (
    mutate('workday-override:set', (state) => setWorkdayOverride(state, employeeId, date, note))
  ));
  ipcMain.handle('workday-override:clear', (_event, { employeeId, date }) => (
    mutate('workday-override:clear', (state) => clearWorkdayOverride(state, employeeId, date))
  ));
  ipcMain.handle('analytics:get', (_event, filter) => calculateStatistics(store.state, filter));
  ipcMain.handle('duties:initialize', (_event, { entries, participantIds }) => (
    mutate('duties:initialize', (state) => initializeDutyHistory(state, entries, participantIds))
  ));
  ipcMain.handle('duties:generate', (_event, filter) => (
    mutate('duties:generate', (state) => generateDutySchedule(state, filter))
  ));
  ipcMain.handle('duties:set-assignment', (_event, payload) => (
    mutate('duties:set-assignment', (state) => setDutyAssignment(state, payload))
  ));
  ipcMain.handle('duties:toggle-assignment', (_event, { employeeId, date }) => (
    mutate('duties:toggle-assignment', (state) => toggleDutyAssignment(state, employeeId, date))
  ));
  ipcMain.handle('duties:remove-assignment', (_event, { employeeId, date }) => (
    mutate('duties:remove-assignment', (state) => removeDutyAssignment(state, employeeId, date))
  ));
  ipcMain.handle('duties:set-realized', (_event, payload) => (
    mutate('duties:set-realized', (state) => setDutyRealized(state, payload.date, payload.employeeId, payload.realized))
  ));
  ipcMain.handle('duties:set-restriction', (_event, payload) => (
    mutate('duties:set-restriction', (state) => setDutyRestriction(state, payload))
  ));
  ipcMain.handle('duties:clear-restriction', (_event, { employeeId, date }) => (
    mutate('duties:clear-restriction', (state) => clearDutyRestriction(state, employeeId, date))
  ));
  ipcMain.handle('duties:stats', (_event, { year } = {}) => calculateDutyStatistics(store.state, year));

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

  ipcMain.handle('data:reset-all', () => {
    store.reset();
    undoStack.length = 0;
    broadcast();
    return { reset: true };
  });

  ipcMain.handle('window:set-mode', async (_event, { mode }) => {
    if (!mainWindow) return false;
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    mainWindow.hide();
    if (mode === 'dialog') {
      if (windowMode === 'widget') saveWidgetBounds();
      windowMode = 'dialog';
      if (process.platform === 'win32' && typeof mainWindow.setShape === 'function') mainWindow.setShape([]);
      mainWindow.setSkipTaskbar(true);
      const width = Math.min(640, display.workArea.width);
      const height = Math.min(800, display.workArea.height);
      const x = display.workArea.x + Math.floor((display.workArea.width - width) / 2);
      const y = display.workArea.y + Math.floor((display.workArea.height - height) / 2);
      await setWindowBoundsAndWait({ x, y, width, height });
    } else if (mode === 'dashboard') {
      saveWidgetBounds();
      windowMode = 'dashboard';
      if (process.platform === 'win32' && typeof mainWindow.setShape === 'function') mainWindow.setShape([]);
      mainWindow.setSkipTaskbar(false);
      const width = Math.min(1240, display.workArea.width);
      const height = Math.min(860, display.workArea.height);
      const x = display.workArea.x + Math.floor((display.workArea.width - width) / 2);
      const y = display.workArea.y + Math.floor((display.workArea.height - height) / 2);
      await setWindowBoundsAndWait({ x, y, width, height });
    } else {
      windowMode = 'widget';
      const size = clampWidgetSize(store.state.settings.widgetSize);
      if (process.platform === 'win32' && typeof mainWindow.setShape === 'function') mainWindow.setShape([]);
      mainWindow.setSkipTaskbar(true);
      mainWindow.setSize(size, size, false);
      if (!restoreWidgetPosition(size)) mainWindow.center();
      const position = mainWindow.getPosition();
      await setWindowBoundsAndWait({ x: position[0], y: position[1], width: size, height: size });
      applyWidgetShape(size);
    }
    mainWindow.show();
    return true;
  });

  ipcMain.handle('window:resize-widget', (_event, { size, persist }) => {
    if (!mainWindow || windowMode !== 'widget') return null;
    const nextSize = clampWidgetSize(size);
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const nextX = Math.max(area.x, Math.min(
      Math.round(centerX - nextSize / 2),
      area.x + area.width - nextSize,
    ));
    const nextY = Math.max(area.y, Math.min(
      Math.round(centerY - nextSize / 2),
      area.y + area.height - nextSize,
    ));
    mainWindow.setBounds({ x: nextX, y: nextY, width: nextSize, height: nextSize }, false);
    applyWidgetShape(nextSize);
    if (persist) {
      store.state.settings.widgetSize = nextSize;
      store.state.settings.widgetPosition = { x: nextX, y: nextY };
      store.save();
      broadcast();
    }
    return nextSize;
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
  store = new DataStore(applicationDataDirectory(), app.getPath('userData'));
  store.load();
  ensureAutomaticMisses(store.state, new Date());
  store.save();
  registerIpc();
  createMainWindow();

  closeTimer = setInterval(() => {
    const now = new Date();
    const changed = ensureAutomaticMisses(store.state, now);
    const currentDate = dateKeyFromDate(now);
    if (changed) store.save();
    if (changed || currentDate !== lastBroadcastDate) broadcast();
  }, 30_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  if (closeTimer) clearInterval(closeTimer);
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  saveWidgetBounds();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
