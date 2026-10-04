const { app, BrowserWindow, dialog, ipcMain, Menu, screen, Notification, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  STATUS_LABELS,
  allocateReceiptBackward,
  allocateReceiptForward,
  calculateDutyFairness,
  calculateDutyStatistics,
  calculateJournalReport,
  calculateStatistics,
  calculateAnalyticsTrend,
  clearDutyWeek,
  clearDutyRestriction,
  clearWorkdayOverride,
  clearManualRecord,
  clone,
  correctReceipt,
  createDutySchedule,
  createEmployee,
  createTimeOffEntry,
  dateKeyFromDate,
  deleteDutySchedule,
  deleteTimeOffEntry,
  duplicateDutySchedule,
  ensureAutomaticMisses,
  generateDutySchedule,
  getDutyExplanation,
  initializeDutyHistory,
  moveEmployee,
  normalizeState,
  previewDutySchedule,
  previewReceiptCorrection,
  previewSubmission,
  removeDutyAssignment,
  recordSubmission,
  renameEmployee,
  renameDutySchedule,
  restoreEmployee,
  setManualStatus,
  setDutyAssignment,
  setDutyDayException,
  setDutyRealized,
  setDutyRestriction,
  setDutyWeekLocked,
  setWorkdayOverride,
  switchDutySchedule,
  toggleDutyAssignment,
  updateDutyScheduleRules,
  updateSettings,
  updateTimeOffEntry,
} = require('../shared/domain');
const { DataStore } = require('./store');
const tasks = require('../shared/tasks');
const draws = require('../shared/draws');
const staffChanges = require('../shared/staff-changes');
const dutyReplacements = require('../shared/duty-replacements');
const availability = require('../shared/availability');
const runtimeOptions = require('./runtime-options');
const os = require('node:os');
const {createTrainingState} = require('../shared/training');
const planner = require('../shared/planner');
const { employeeOverview, weeklySummary, buildWeeklyCsv, buildWeeklyHtml } = require('../shared/management');
const { createReminderService, setupWindowsNotifications } = require('./task-reminders');
const { calculateAnalyticsReport, getAnalyticsDetails, buildAnalyticsCsv } = require('../shared/analytics');

let mainWindow = null;
let store = null;
let closeTimer = null;
let positionSaveTimer = null;
let windowMode = 'widget';
let lastBroadcastDate = null;
let reminders = null;
let dataImportPending = false;
let activationRequested = false;
let trainingSession = null;
const undoStack = [];

function clampWidgetSize(value) {
  return Math.max(260, Math.min(700, Math.round(Number(value) || 380)));
}

function applicationDataDirectory() {
  if (runtimeOptions.selfTestDirectory) return runtimeOptions.selfTestDirectory;
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
    title: 'ЛАД — Люди. Аналітика. Документи.',
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
    if (activationRequested) { mainWindow.focus(); activationRequested = false; }
    reminders?.check();
  });
  mainWindow.on('moved', () => {
    if (windowMode !== 'widget') return;
    clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(saveWidgetBounds, 300);
  });
  mainWindow.on('leave-full-screen', () => {
    if (windowMode === 'fullscreen') {
      windowMode = 'dashboard';
      mainWindow.webContents.send('window:mode-changed', 'dashboard');
    }
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
    appVersion: app.getVersion(),
    dataFilePath: store.filePath,
    reminderStatus: reminders?.status() || { supported: false, lastError: '' },
    consequences: staffChanges.getConsequences(store.state,{},now),
    recovery: store.recovery,
    training: trainingSession ? {active:true,...trainingSession.scenario} : {active:false},
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
    store.save();
    reminders?.reconcile();
    undoStack.push({ action, before });
    if (undoStack.length > 30) undoStack.shift();
    broadcast();
    return clone(result);
  } catch (error) {
    store.state = normalizeState(before);
    throw error;
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^[=+@-]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
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
  const schedules = Array.isArray(state.dutySchedules) && state.dutySchedules.length
    ? state.dutySchedules
    : [{ name: 'Основний', data: state.duties }];
  const dutyRows = schedules.flatMap((schedule) => (
    Object.values(schedule.data.assignments).flatMap((assignment) => (
      (assignment.employeeIds || []).map((employeeId) => {
        const employee = state.employees.find((item) => item.id === employeeId);
        return [
          `Чергування · ${schedule.name}`,
          assignment.date,
          employee?.name || 'Невідомий працівник',
          assignment.realizedEmployeeIds?.includes(employeeId) ? 'Реалізоване' : 'Заплановане',
          '',
          '',
          '',
          assignment.singleApproved ? 'Один черговий за дозволом' : '',
        ];
      })
    ))
  ));
  const dutyRestrictionRows = schedules.flatMap((schedule) => ([
    ...Object.values(schedule.data.aDays).map((item) => ({ ...item, label: 'А' })),
    ...Object.values(schedule.data.unavailable).map((item) => ({ ...item, label: item.type })),
    ...Object.values(schedule.data.planningBlocks || {})
      .map((item) => ({ ...item, label: 'Не планувати (без статистики)' })),
  ].map((item) => {
    const employee = state.employees.find((candidate) => candidate.id === item.employeeId);
    return [
      `Обмеження чергувань · ${schedule.name}`,
      item.date,
      employee?.name || 'Невідомий працівник',
      item.label,
      '',
      '',
      '',
      item.note || '',
    ];
  })));
  const dutyBaselineRows = schedules.flatMap((schedule) => (
    Object.entries(schedule.data.baselines).map(([employeeId, baseline]) => {
      const employee = state.employees.find((item) => item.id === employeeId);
      return [
        `Початковий підсумок чергувань · ${schedule.name}`,
        schedule.data.baselineYear || '',
        employee?.name || 'Невідомий працівник',
        `Усього: ${baseline.total || 0}; реалізованих: ${baseline.realized || 0}`,
        '',
        '',
        '',
        '',
      ];
    })
  ));
  const timeOffRows = (state.timeOffEntries || []).map((entry) => {
    const employee = state.employees.find((item) => item.id === entry.employeeId);
    return [
      'Відпросився',
      entry.date,
      employee?.name || 'Невідомий працівник',
      `${entry.startTime}–${entry.endTime} (${entry.durationMinutes} хв)`,
      '',
      entry.destination,
      '',
      entry.note || '',
    ];
  });
  const taskRows = (state.tasks || []).map(task => [
    `Завдання · ${task.title}${task.archived ? ' · архів' : ''}`, task.dueDate,
    task.assigneeIds.map(id => state.employees.find(person => person.id === id)?.name || id).join(', ') || 'Керівник',
    planner.STATUS_LABELS[task.status], task.dueTime || 'До кінця дня',
    task.documentRef || '', task.recurrence === 'none' ? '' : planner.RECURRENCE_LABELS[task.recurrence], task.description || '',
  ]);
  const rows = [
    ...(state.draws || []).flatMap(draw => draw.participants.map(person => [
      `Жеребкування №${draw.number}`, draw.createdAt, person.name,
      draw.selectedIds.includes(person.id) ? 'Короткий сірник · обрано' : 'Довгий сірник · не обрано',
      '', draw.title, '', `${draw.description}${draw.rerollReason ? `; Повторне: ${draw.rerollReason}` : ''}; Автор: ${draw.createdBy}; Протокол: ${draw.id}`,
    ])),
    ...taskRows,
    ...requestRows,
    ...dutyRows,
    ...dutyRestrictionRows,
    ...dutyBaselineRows,
    ...timeOffRows,
  ];
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}

async function withNativeDialog(owner, showDialog) {
  if (!owner || owner.isDestroyed()) throw new Error('Вікно застосунку закрито. Відкрийте ЛАД і повторіть дію.');
  // The transparent widget must not cover a Windows system dialog.
  const onTop = owner.isAlwaysOnTop();
  if (onTop) owner.setAlwaysOnTop(false);
  try {
    if (owner.isMinimized()) owner.restore();
    owner.show(); owner.focus();
    return await showDialog();
  } finally {
    if (!owner.isDestroyed()) owner.setAlwaysOnTop(Boolean(store.state.settings.alwaysOnTop));
  }
}

function registerIpc() {
  ipcMain.handle('snapshot:get', () => currentSnapshot());
  ipcMain.handle('training:enter', () => {
    if(trainingSession)return {entered:true};
    if(dataImportPending)throw new Error('Дочекайтеся завершення імпорту.');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-training-')),demo=createTrainingState(),practice=new DataStore(directory);
    practice.state=demo.state;
    try { practice.save(); } catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error;}
    trainingSession={original:store,history:[...undoStack],directory,scenario:demo.scenario};
    store=practice;undoStack.length=0;reminders?.disable('Навчальний режим: системні сповіщення вимкнені.');broadcast();return {entered:true};
  });
  ipcMain.handle('training:exit', () => {
    if(!trainingSession)return {exited:true};
    const session=trainingSession;store=session.original;undoStack.splice(0,undoStack.length,...session.history);trainingSession=null;
    try { fs.rmSync(session.directory,{recursive:true,force:true}); } catch(_error) { /* Returning to work data must not fail because a temporary file is still open. */ }
    if(store.state.settings.taskRemindersEnabled){const setup=setupWindowsNotifications({app,shell});if(setup.supported)reminders?.enable();else reminders?.disable(setup.error);}
    else reminders?.enable();
    broadcast();return {exited:true};
  });
  ipcMain.handle('training:seen', () => {
    if(trainingSession)return true;
    const previous=store.state.settings.onboardingSeen;store.state.settings.onboardingSeen=true;
    try{store.save();}catch(error){store.state.settings.onboardingSeen=previous;throw error;}broadcast();return true;
  });
  ipcMain.handle('staff:preview-change', (_event, input) => staffChanges.previewStaffChange(store.state,input));
  ipcMain.handle('staff:apply-change', (_event, input) => mutate('staff:apply-change',state => staffChanges.applyStaffChange(state,input)));
  ipcMain.handle('staff:consequences', (_event, input) => staffChanges.getConsequences(store.state,input));
  ipcMain.handle('duties:replacements', (_event, input) => dutyReplacements.getReplacementOptions(store.state,input));
  ipcMain.handle('duties:apply-replacement', (_event, input) => mutate('duties:apply-replacement',state => dutyReplacements.applyReplacement(state,input)));
  ipcMain.handle('draws:create', (_event, input) => {
    const result = mutate('draws:create', state => draws.createDraw(state,input));
    // A saved draw is a checkpoint: undoing earlier edits must not erase its result.
    undoStack.length = 0;
    return result;
  });
  ipcMain.handle('draws:create-task', (_event, { id, input }) => {
    const existing = store.state.draws.find(draw=>draw.id===id)?.taskId;
    if (existing && store.state.tasks.some(task=>task.id===existing)) return store.state.tasks.find(task=>task.id===existing);
    return mutate('draws:create-task', state => draws.taskFromDraw(state,id,input));
  });
  ipcMain.handle('dialog:confirm', async (_event, message) => {
    if (typeof message !== 'string' || !message.trim() || message.length>2500) throw new Error('Некоректний текст підтвердження.');
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const answer = await withNativeDialog(mainWindow, () => dialog.showMessageBox(mainWindow,{ type:'question', title:'ЛАД · Підтвердження',
      message, buttons:['Продовжити','Скасувати'], defaultId:1, cancelId:1, noLink:true }));
    return answer.response===0;
  });

  ipcMain.handle('tasks:create', (_event, input) => mutate('tasks:create', state => tasks.createTask(state, input)));
  ipcMain.handle('tasks:update', (_event, { id, input }) => mutate('tasks:update', state => tasks.updateTask(state, id, input)));
  ipcMain.handle('tasks:status', (_event, { id, input }) => mutate('tasks:status', state => tasks.setTaskStatus(state, id, input)));
  ipcMain.handle('tasks:archive', (_event, { id, archived }) => mutate('tasks:archive', state => tasks.archiveTask(state, id, archived)));
  ipcMain.handle('tasks:snooze', (_event, { id, minutes }) => mutate('tasks:snooze', state => tasks.snoozeTask(state, id, minutes)));
  ipcMain.handle('tasks:test-reminder', () => {
    if(trainingSession)throw new Error('У навчанні системні сповіщення вимкнені. Перевірте їх після повернення до своїх даних.');
    const setup = setupWindowsNotifications({ app, shell });
    if (!setup.supported) throw new Error(setup.error);
    reminders.enable(); return reminders.test();
  });
  ipcMain.handle('employee:overview', (_event, input) => employeeOverview(store.state, input));
  ipcMain.handle('management:week', (_event, { anchor }) => weeklySummary(store.state, anchor));
  ipcMain.handle('management:export-week', async (_event, { anchor, format }) => {
    if (!['csv', 'pdf'].includes(format)) throw new Error('Невідомий формат звіту.');
    const report = weeklySummary(store.state, anchor);
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Зберегти тижневе зведення',
      defaultPath: `LAD-week-${report.startDate}.${format}`, filters: [{ name: format === 'pdf' ? 'Документ PDF' : 'Таблиця CSV', extensions: [format] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    if (format === 'csv') fs.writeFileSync(result.filePath, buildWeeklyCsv(report), 'utf8');
    else {
      const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
      try {
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildWeeklyHtml(report))}`);
        const bytes = await printWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
        fs.writeFileSync(result.filePath, bytes);
      } finally { printWindow.destroy(); }
    }
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('employee:add', (_event, { name }) => (
    mutate('employee:add', (state) => createEmployee(state, name))
  ));
  ipcMain.handle('employee:archive', (_event, { employeeId }) => (
    (()=>{throw new Error('Перед переведенням до архіву відкрийте «Доступність» і перевірте наслідки.');})()
  ));
  ipcMain.handle('employee:restore', (_event, { employeeId }) => (
    mutate('employee:restore', (state) => restoreEmployee(state, employeeId))
  ));
  ipcMain.handle('employee:rename', (_event, { employeeId, name }) => (
    mutate('employee:rename', (state) => renameEmployee(state, employeeId, name))
  ));
  ipcMain.handle('employee:move', (_event, { employeeId, direction }) => (
    mutate('employee:move', (state) => moveEmployee(state, employeeId, direction))
  ));
  ipcMain.handle('submission:preview', (_event, payload) => previewSubmission(store.state, payload));
  ipcMain.handle('submission:record', (_event, payload) => (
    mutate('submission:record', (state) => recordSubmission(state, payload))
  ));
  ipcMain.handle('submission:correct-preview', (_event, { receiptId, input }) => (
    previewReceiptCorrection(store.state, receiptId, input)
  ));
  ipcMain.handle('submission:correct', (_event, { receiptId, input }) => (
    mutate('submission:correct', (state) => correctReceipt(state, receiptId, input))
  ));
  ipcMain.handle('submission:allocate-backward', (_event, { receiptId, units }) => (
    mutate('submission:allocate-backward', (state) => allocateReceiptBackward(state, receiptId, units))
  ));
  ipcMain.handle('submission:allocate-forward', (_event, { receiptId, units }) => (
    mutate('submission:allocate-forward', (state) => allocateReceiptForward(state, receiptId, units))
  ));
  ipcMain.handle('record:set-status', (_event, payload) => (
    mutate('record:set-status', (state) => {
      if(staffChanges.ABSENCES.has(payload.status))throw new Error('Відсутність записуйте через «Зміну доступності»: спочатку перевірте зачеплені графіки та завдання.');
      return setManualStatus(state,payload);
    })
  ));
  ipcMain.handle('record:set-period', (_event, payload) => (
    mutate('record:set-period', (state) => availability.applyPeriod(state, payload))
  ));
  ipcMain.handle('record:preview-period', (_event, payload) => availability.previewPeriod(store.state, payload));
  ipcMain.handle('journal:preview-batch', (_event, payload) => availability.previewBatch(store.state, payload));
  ipcMain.handle('journal:apply-batch', (_event, payload) => mutate('journal:apply-batch', (state) => availability.applyBatch(state, payload)));
  ipcMain.handle('journal:export', async (_event, filter) => {
    const report = calculateJournalReport(store.state, filter);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Експортувати відкритий табель', defaultPath: `counter-journal-${filter.startDate}-${filter.endDate}.csv`,
      filters: [{ name: 'Таблиця CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const header = ['Працівник', ...report.dates, 'Подав', 'Пропуски', 'Інші завдання', 'Відсутність', 'Очікує до сьогодні'];
    const rows = report.rows.map((row) => [row.name, ...row.cells.map((cell) => cell.symbol), row.totals.submitted,
      row.totals.missed, row.totals.other, row.totals.absent, row.totals.pending]);
    const safeCsv = (value) => csvEscape(typeof value === 'string' && /^[=+@-]/.test(value) ? `'${value}` : value);
    fs.writeFileSync(result.filePath, `\uFEFF${[header, ...rows].map((row) => row.map(safeCsv).join(';')).join('\r\n')}\r\n`, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
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
  ipcMain.handle('analytics:trend', (_event, filter) => calculateAnalyticsTrend(store.state, filter));
  ipcMain.handle('analytics:report', (_event, filter) => calculateAnalyticsReport(store.state, filter));
  ipcMain.handle('analytics:details', (_event, input) => getAnalyticsDetails(store.state, input));
  ipcMain.handle('analytics:export-report', async (_event, { filter, view }) => {
    const report = calculateAnalyticsReport(store.state, filter);
    const csv = buildAnalyticsCsv(report, view);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Експортувати статистику', defaultPath: `counter-statistics-${view}-${report.startDate}-${report.endDate}.csv`,
      filters: [{ name: 'Таблиця CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, csv, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle('analytics:export', async (_event, filter) => {
    const analytics = calculateStatistics(store.state, filter);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Експортувати звіт за вибраний період',
      defaultPath: `counter-report-${filter.startDate}-${filter.endDate}.csv`,
      filters: [{ name: 'Таблиця CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const header = ['Працівник', 'Робочі дні', 'Відпрацьовано', 'Фактичні запити',
      'Закрито запитами', 'Пропуски', 'Інші завдання', 'Особисті справи', 'Виконання %'];
    const rows = analytics.rows.map((row) => [row.name, row.calendarWorkdays, row.workedDays,
      row.actualRequestsReceived, row.requestDays, row.missed, row.otherTasks,
      row.personalPermission, row.completionPercent]);
    fs.writeFileSync(result.filePath,
      `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n')}\r\n`, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle('duties:initialize', (_event, { entries, participantIds }) => (
    mutate('duties:initialize', (state) => initializeDutyHistory(state, entries, participantIds))
  ));
  ipcMain.handle('duties:generate', (_event, filter) => (
    mutate('duties:generate', (state) => generateDutySchedule(state, filter))
  ));
  ipcMain.handle('duties:preview', (_event, filter) => (
    previewDutySchedule(store.state, filter)
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
  ipcMain.handle('duties:fairness', (_event, filter) => calculateDutyFairness(store.state, filter));
  ipcMain.handle('duties:schedule-create', (_event, { name }) => (
    mutate('duties:schedule-create', (state) => createDutySchedule(state, name))
  ));
  ipcMain.handle('duties:schedule-rename', (_event, { scheduleId, name }) => (
    mutate('duties:schedule-rename', (state) => renameDutySchedule(state, scheduleId, name))
  ));
  ipcMain.handle('duties:schedule-switch', (_event, { scheduleId }) => (
    mutate('duties:schedule-switch', (state) => switchDutySchedule(state, scheduleId))
  ));
  ipcMain.handle('duties:schedule-delete', (_event, { scheduleId }) => (
    mutate('duties:schedule-delete', (state) => deleteDutySchedule(state, scheduleId))
  ));
  ipcMain.handle('duties:schedule-duplicate', (_event, { scheduleId, name }) => (
    mutate('duties:schedule-duplicate', (state) => duplicateDutySchedule(state, scheduleId, name))
  ));
  ipcMain.handle('duties:schedule-rules', (_event, { scheduleId, rules }) => (
    mutate('duties:schedule-rules', (state) => updateDutyScheduleRules(state, scheduleId, rules))
  ));
  ipcMain.handle('duties:explanation', (_event, { date, scheduleId }) => {
    const schedule = scheduleId && store.state.dutySchedules.find(item => item.id === scheduleId);
    if (scheduleId && !schedule) throw new Error('Графік більше не існує.');
    return getDutyExplanation(schedule ? { ...store.state, duties: schedule.data, activeDutyScheduleId: schedule.id } : store.state, date);
  });
  ipcMain.handle('duties:week-lock', (_event, { date, locked }) => (
    mutate('duties:week-lock', (state) => setDutyWeekLocked(state, date, locked))
  ));
  ipcMain.handle('duties:week-clear', (_event, { date, mode }) => (
    mutate('duties:week-clear', (state) => clearDutyWeek(state, date, new Date(), mode))
  ));
  ipcMain.handle('duties:day-exception', (_event, { date, exception }) => (
    mutate('duties:day-exception', (state) => setDutyDayException(state, date, exception))
  ));
  ipcMain.handle('time-off:create', (_event, payload) => (
    mutate('time-off:create', (state) => createTimeOffEntry(state, payload))
  ));
  ipcMain.handle('time-off:update', (_event, { entryId, input }) => (
    mutate('time-off:update', (state) => updateTimeOffEntry(state, entryId, input))
  ));
  ipcMain.handle('time-off:delete', (_event, { entryId }) => (
    mutate('time-off:delete', (state) => deleteTimeOffEntry(state, entryId))
  ));
  ipcMain.handle('settings:update', (_event, settings) => {
    const result = mutate('settings:update', (state) => updateSettings(state, settings));
    mainWindow?.setAlwaysOnTop(result.alwaysOnTop);
    if (result.taskRemindersEnabled && !trainingSession) {
      const setup = setupWindowsNotifications({ app, shell });
      if (setup.supported) reminders.enable(); else reminders.disable(setup.error);
    }
    return result;
  });

  ipcMain.handle('history:undo', () => {
    const last = undoStack.at(-1);
    if (!last) throw new Error('Немає дії, яку можна скасувати.');
    store.replace(last.before);
    reminders?.reconcile();
    undoStack.pop();
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

  ipcMain.handle('data:import', async (_event, file) => {
    if(trainingSession)throw new Error('Вийдіть із навчання, щоб імпортувати свою робочу базу.');
    if (dataImportPending) return { canceled: true, busy: true };
    dataImportPending = true;
    try {
      const owner = mainWindow;
      if (!owner || owner.isDestroyed()) throw new Error('Вікно застосунку закрито. Відкрийте ЛАД і повторіть імпорт.');
      let filePath, fileName, normalized;
      if (file !== undefined) {
        if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255 || typeof file.content !== 'string') {
          throw new Error('Виберіть один файл резервної копії JSON.');
        }
        fileName = path.basename(file.name);
        normalized = store.parseBackup(file.content);
      } else {
        const result = await withNativeDialog(owner, () => dialog.showOpenDialog(owner, {
          title: 'Відкрити резервну копію ЛАД',
          buttonLabel: 'Вибрати копію',
          properties: ['openFile'],
          filters: [{ name: 'Резервна копія JSON', extensions: ['json'] }],
        }));
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        filePath = result.filePaths[0];
        fileName = path.basename(filePath);
        normalized = store.readBackup(filePath);
      }
      if (store.state.settings.confirmDestructiveActions !== false) {
        const answer = await withNativeDialog(owner, () => dialog.showMessageBox(owner, {
          type: 'question',
          title: 'Імпорт резервної копії ЛАД',
          message: `Імпортувати «${fileName}»?`,
          detail: `Працівників: ${normalized.employees.length}; документів: ${normalized.receipts.length}; завдань: ${normalized.tasks.length}; графіків: ${normalized.dutySchedules.length}; жеребкувань: ${normalized.draws.length}.\n\nПоточну базу буде замінено. Попередня база залишиться в локальній резервній копії; імпорт також можна скасувати кнопкою «Скасувати останню дію».`,
          buttons: ['Імпортувати', 'Скасувати'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }));
        if (answer.response !== 0) return { canceled: true };
      }
      const before = store.snapshot();
      store.replace(normalized);
      if (!owner.isDestroyed()) owner.setAlwaysOnTop(Boolean(store.state.settings.alwaysOnTop));
      reminders?.reconcile();
      undoStack.push({ action: 'data:import', before });
      if (undoStack.length > 30) undoStack.shift();
      broadcast();
      return { canceled: false, filePath, fileName };
    } finally {
      dataImportPending = false;
    }
  });

  ipcMain.handle('data:backups', () => store.listBackups());
  ipcMain.handle('data:ack-recovery', () => {store.recovery=null;broadcast();return true;});
  ipcMain.handle('data:restore-backup', (_event, { id }) => {
    const before = store.snapshot();
    store.restoreBackup(id);
    reminders?.reconcile();
    undoStack.push({ action: 'data:restore-backup', before });
    if (undoStack.length > 30) undoStack.shift();
    broadcast();
    return { restored: true };
  });

  ipcMain.handle('data:reset-all', () => {
    store.reset();
    reminders?.reconcile();
    undoStack.length = 0;
    broadcast();
    return { reset: true };
  });

  ipcMain.handle('window:set-mode', async (_event, { mode }) => {
    if (!mainWindow) return false;
    if (!['dialog', 'dashboard', 'fullscreen', 'widget'].includes(mode)) return false;
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    if (mainWindow.isFullScreen() && mode !== 'fullscreen') mainWindow.setFullScreen(false);
    mainWindow.hide();
    mainWindow.setResizable(mode === 'dashboard' || mode === 'fullscreen');
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
    } else if (mode === 'dashboard' || mode === 'fullscreen') {
      if (windowMode === 'widget') saveWidgetBounds();
      windowMode = mode;
      if (process.platform === 'win32' && typeof mainWindow.setShape === 'function') mainWindow.setShape([]);
      mainWindow.setSkipTaskbar(false);
      const width = Math.min(1240, display.workArea.width);
      const height = Math.min(860, display.workArea.height);
      const x = display.workArea.x + Math.floor((display.workArea.width - width) / 2);
      const y = display.workArea.y + Math.floor((display.workArea.height - height) / 2);
      await setWindowBoundsAndWait({ x, y, width, height });
      if (mode === 'fullscreen') mainWindow.setFullScreen(true);
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
  ipcMain.handle('window:minimize', () => { mainWindow?.setSkipTaskbar(false); mainWindow?.minimize(); });
  ipcMain.handle('window:close', () => mainWindow?.close());
}

function revealMainWindow() {
  activationRequested = true;
  if (!store) return;
  if (!mainWindow || mainWindow.isDestroyed()) { createMainWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
app.on('second-instance', revealMainWindow);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  store = new DataStore(applicationDataDirectory(), runtimeOptions.selfTestDirectory ? null : app.getPath('userData'));
  try { store.load(); }
  catch(error) {
    const answer=await dialog.showMessageBox({type:'error',title:'ЛАД · відновлення бази',message:'Не вдалося відкрити робочу базу',detail:error.message,buttons:['Вибрати резервну копію','Закрити'],defaultId:1,cancelId:1,noLink:true});
    if(answer.response!==0){app.quit();return;}
    const selected=await dialog.showOpenDialog({title:'Вибрати справну копію ЛАД',properties:['openFile'],filters:[{name:'Резервна копія JSON',extensions:['json']}]});
    if(selected.canceled||!selected.filePaths[0]){app.quit();return;}
    store.replace(store.readBackup(selected.filePaths[0]));
    store.recovery={source:'selected',restoredAt:new Date().toISOString(),message:'Відновлено вибрану копію. Перевірте її дату та останні зміни.'};
  }
  ensureAutomaticMisses(store.state, new Date());
  store.save();
  const notificationSetup = store.state.settings.taskRemindersEnabled ? setupWindowsNotifications({ app, shell }) : { supported: true };
  reminders = createReminderService({ Notification, store, broadcast,
    openTask: id => {
      if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show(); mainWindow.focus();
      mainWindow.webContents.send('tasks:open', id);
    },
    act: (id, action) => mutate(`tasks:${action}`, state => action === 'done'
      ? tasks.setTaskStatus(state, id, { status: 'done' }) : tasks.snoozeTask(state, id, 60)),
  });
  if (!notificationSetup.supported) reminders.disable(notificationSetup.error);
  registerIpc();
  createMainWindow();

  closeTimer = setInterval(() => {
    const now = new Date();
    const changed = ensureAutomaticMisses(store.state, now);
    const currentDate = dateKeyFromDate(now);
    if (changed) store.save();
    reminders.check();
    if (changed || currentDate !== lastBroadcastDate) broadcast();
  }, 30_000);

  app.on('activate', revealMainWindow);
}).catch(async error => {
  await dialog.showMessageBox({type:'error',title:'ЛАД · запуск',message:'ЛАД не вдалося запустити',detail:error.message,buttons:['Закрити']});
  app.quit();
});

app.on('before-quit', () => {
  if (closeTimer) clearInterval(closeTimer);
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  saveWidgetBounds();
  if(trainingSession){try{fs.rmSync(trainingSession.directory,{recursive:true,force:true});}catch(_error){/* Temporary cleanup must not block closing the app. */}}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
module.exports={getMainWindow:()=>mainWindow,getStore:()=>store};
