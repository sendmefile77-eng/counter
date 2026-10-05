const { app, BrowserWindow, dialog, ipcMain, Menu, screen, Notification, shell, Tray, nativeImage, globalShortcut } = require('electron');
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
const work = require('../shared/work');
const tasks = require('../shared/tasks');
const draws = require('../shared/draws');
const employeeDeletion = require('../shared/employee-deletion');
const staffChanges = require('../shared/staff-changes');
const presence = require('../shared/presence');
const presenceChanges = require('../shared/presence-changes');
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
const widgetWindow = require('./widget-window');
let tray = null, quitting = false, shortcutRegistered = false, widgetConfigKey = '';
let windowTransition=Promise.resolve(),shortcutEnabled=null;
const widgetShortcut = 'CommandOrControl+Shift+L';

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
    mainWindow.setShape(store.state.settings.widgetShape === 'panel' ? [] : buildCircularShape(size));
  }
}
function restoreWidgetPosition() {
  const bounds=widgetWindow.savedBounds(store.state.settings,screen.getAllDisplays(),screen.getDisplayMatching(mainWindow.getBounds()));
  mainWindow.setBounds(bounds,false);
  return Boolean(store.state.settings.widgetPosition);
}
function updateTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    {label:'Показати віджет',click:()=>void revealMode('widget')},
    {label:'Відкрити ЛАД',click:()=>void revealMode('dashboard')},
    {type:'separator'},
    {label:'Зафіксувати положення',type:'checkbox',checked:store.state.settings.widgetLocked,
      click:item=>{updateSettings(store.state,{widgetLocked:item.checked});store.save();broadcast();}},
    {type:'separator'},{label:'Вийти з ЛАД',click:()=>app.quit()},
  ]));
}
function configureWidget() {
  const settings=store.state.settings;
  const key=JSON.stringify([settings.widgetShape,settings.widgetSize,settings.widgetShortcutEnabled,settings.widgetLocked,settings.widgetSnap,settings.widgetPosition]);
  if(key===widgetConfigKey)return;
  widgetConfigKey=key;
  if(shortcutEnabled!==settings.widgetShortcutEnabled){
    globalShortcut.unregister(widgetShortcut);shortcutEnabled=settings.widgetShortcutEnabled;
    shortcutRegistered=shortcutEnabled&&globalShortcut.register(widgetShortcut,()=>void revealMode('widget'));
  }
  updateTrayMenu();
  if(mainWindow && windowMode==='widget'){restoreWidgetPosition();applyWidgetShape(mainWindow.getBounds().width);}
}
function createTray() {
  try {
    tray=new Tray(nativeImage.createFromBuffer(Buffer.from(require('./tray-icon'),'base64')));
    tray.setToolTip('ЛАД · Люди. Аналітика. Документи.');
    tray.on('double-click',()=>void revealMode('widget'));
    updateTrayMenu();
  } catch(error) { console.error('Tray unavailable:',error.message); tray=null; }
  configureWidget();
}
async function revealMode(mode) {
  if(!mainWindow || mainWindow.isDestroyed())createMainWindow();
  if(mainWindow.isMinimized())mainWindow.restore();
  await setWindowMode(mode);
  mainWindow.webContents.send('window:mode-changed',mode);
  mainWindow.show();mainWindow.focus();
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
  store.state.settings.widgetSize = clampWidgetSize(bounds.width);
  store.state.settings.widgetPosition = { x: bounds.x, y: bounds.y };
  store.save();
  widgetConfigKey='';
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
    restoreWidgetPosition();
    applyWidgetShape(mainWindow.getBounds().width);
    mainWindow.show();
    if (activationRequested) { mainWindow.focus(); activationRequested = false; }
    reminders?.check();
  });
  mainWindow.on('moved', () => {
    if (windowMode !== 'widget') return;
    clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(() => {
      const bounds=mainWindow?.getBounds();if(!bounds||windowMode!=='widget')return;
      const fitted=widgetWindow.fit(bounds,screen.getDisplayMatching(bounds).workArea,store.state.settings.widgetSnap);
      if(fitted.x!==bounds.x||fitted.y!==bounds.y)mainWindow.setBounds(fitted,false);
      saveWidgetBounds();
    }, 300);
  });
  mainWindow.on('leave-full-screen', () => {
    if (windowMode === 'fullscreen') {
      windowMode = 'dashboard';
      mainWindow.webContents.send('window:mode-changed', 'dashboard');
    }
  });
  mainWindow.on('close', event => {if(!quitting&&tray){event.preventDefault();saveWidgetBounds();mainWindow.hide();}});
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
    widgetWindowStatus: {shortcutRegistered:Boolean(shortcutRegistered),trayAvailable:Boolean(tray)},
    reminderStatus: reminders?.status() || { supported: false, lastError: '' },
    consequences: staffChanges.getConsequences(store.state,{},now),
    recovery: store.recovery,
    training: trainingSession ? {active:true,...trainingSession.scenario} : {active:false},
  };
}

function broadcast() {
  configureWidget();
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
  const today=work.dateKey(),from=state.employees.reduce((start,person)=>person.createdDate<start?person.createdDate:start,today);
  const oldest=work.addDays(today,-3659),startDate=from<oldest?oldest:from;
  const report=work.report(state,{startDate,endDate:today,scope:'all',groupBy:'month'});
  const rows=[['Облік роботи · період',startDate,today],['Робота','Співробітник','Стан','Проєктів','Виконано','Початок','Орієнтир','Фактичне завершення','Примітка'],
    ...(state.workEntries||[]).map(entry=>[entry.title,state.employees.find(person=>person.id===entry.employeeId)?.name||entry.employeeId,
      {active:'У роботі',done:'Завершено',cancelled:'Скасовано'}[entry.status],entry.projectCount,entry.completedProjects,entry.startDate,entry.estimatedEndDate,entry.finishedDate,entry.note]),
    [],['Наявність','Дата','Працівник','Статус','Підстава','Автор'],
    ...[...new Set([...Object.keys(state.presenceRecords||{}),...Object.keys(state.records)])].sort().flatMap(key=>{
      const [id,date]=key.split('|'),mark=presence.get(state,id,date);
      return mark?[[date>today?'План наявності':'Позначка наявності',date,state.employees.find(person=>person.id===id)?.name||id,presence.labels[mark.status],mark.note,mark.actor||'']]:[];
    }),
    [],['Чергування','Дата','Працівник','Стан'],...(state.dutySchedules||[]).flatMap(schedule=>Object.values((schedule.id===state.activeDutyScheduleId?state.duties:schedule.data).assignments)
      .flatMap(day=>(day.employeeIds||[]).map(id=>[schedule.name,day.date,state.employees.find(person=>person.id===id)?.name||id,day.realizedEmployeeIds?.includes(id)?'Реалізовано':'Заплановано']))),
    [],['Жеребкування','Дата','Учасник','Результат','Завдання','Пояснення'],...(state.draws||[]).flatMap(draw=>draw.participants.map(person=>[
      `Жеребкування №${draw.number}`,draw.createdAt,person.name,draw.selectedIds.includes(person.id)?'Короткий сірник · обрано':'Довгий сірник · не обрано',draw.title,
      `${draw.description}${draw.rerollReason?`; Повторне: ${draw.rerollReason}`:''}; Автор: ${draw.createdBy}; Протокол: ${draw.id}`])),
    [],['Відлучення','Дата','Працівник','Час','Куди','Пояснення'],...(state.timeOffEntries||[]).map(entry=>['Відлучення',entry.date,state.employees.find(person=>person.id===entry.employeeId)?.name||entry.employeeId,`${entry.startTime}–${entry.endTime}`,entry.destination,entry.note]),
    [],['Обмеження чергувань','Дата','Працівник','Тип','Пояснення'],...(state.dutySchedules||[]).flatMap(schedule=>[
      ...Object.values(schedule.data.aDays).map(item=>({...item,label:'А'})),...Object.values(schedule.data.unavailable).map(item=>({...item,label:item.type})),
      ...Object.values(schedule.data.planningBlocks||{}).map(item=>({...item,label:'Не планувати'}))].map(item=>[schedule.name,item.date,state.employees.find(person=>person.id===item.employeeId)?.name||item.employeeId,item.label,item.note])),
    [],['Початкові підсумки','Рік','Працівник','Усього','Реалізовано'],...(state.dutySchedules||[]).flatMap(schedule=>Object.entries(schedule.data.baselines).map(([id,value])=>[schedule.name,schedule.data.baselineYear,state.employees.find(person=>person.id===id)?.name||id,value.total||0,value.realized||0])),
    [],['Завдання','Строк','Відповідальні','Статус','Пояснення'],...(state.tasks||[]).map(task=>[task.title,task.dueDate,task.assigneeIds.map(id=>state.employees.find(person=>person.id===id)?.name||id).join(', ')||'Керівник',planner.STATUS_LABELS[task.status],task.description])];
  return work.csv(report,'workers')+'\r\n'+rows.map(row=>row.map(csvEscape).join(';')).join('\r\n')+'\r\n';
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

function setWindowMode(mode) {
  windowTransition=windowTransition.catch(()=>null).then(()=>applyWindowMode(mode));
  return windowTransition;
}
async function applyWindowMode(mode) {
    if (!mainWindow) return false;
    if (!['dialog', 'dashboard', 'fullscreen', 'widget'].includes(mode)) return false;
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    if(windowMode==='widget')saveWidgetBounds();
    if (mainWindow.isFullScreen() && mode !== 'fullscreen') mainWindow.setFullScreen(false);
    mainWindow.hide();
    mainWindow.setResizable(mode === 'dashboard' || mode === 'fullscreen');
    if (mode === 'dialog') {
      windowMode = 'dialog';
      if (process.platform === 'win32' && typeof mainWindow.setShape === 'function') mainWindow.setShape([]);
      mainWindow.setSkipTaskbar(true);
      const width = Math.min(640, display.workArea.width);
      const height = Math.min(800, display.workArea.height);
      const x = display.workArea.x + Math.floor((display.workArea.width - width) / 2);
      const y = display.workArea.y + Math.floor((display.workArea.height - height) / 2);
      await setWindowBoundsAndWait({ x, y, width, height });
    } else if (mode === 'dashboard' || mode === 'fullscreen') {
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
      mainWindow.setSkipTaskbar(true);
      restoreWidgetPosition();
      const bounds=mainWindow.getBounds();
      await setWindowBoundsAndWait(bounds);
      applyWidgetShape(bounds.width);
    }
    mainWindow.show();
    return true;
}

function registerIpc() {
  ipcMain.handle('presence:preview', (_event,input) => presenceChanges.preview(store.state,input));
  ipcMain.handle('presence:apply', (_event,input) => mutate('presence:apply',state=>presenceChanges.apply(state,input)));
  ipcMain.handle('work:create', (_event,input) => mutate('work:create',state=>work.create(state,input)));
  ipcMain.handle('work:update', (_event,{id,input}) => mutate('work:update',state=>work.update(state,id,input)));
  ipcMain.handle('work:progress', (_event,{id,input}) => mutate('work:progress',state=>work.progress(state,id,input)));
  ipcMain.handle('work:finish', (_event,{id,input}) => mutate('work:finish',state=>work.finish(state,id,input)));
  ipcMain.handle('work:mark-day', (_event,input) => mutate('work:mark-day',state=>{
    if(!['working','submitted'].includes(input.status)||input.date>dateKeyFromDate())throw new Error('Позначити роботу можна до сьогодні включно.');
    const employee=state.employees.find(person=>person.id===input.employeeId);
    if(!employee||!work.validDate(input.date)||!work.trackableOn(employee,input.date))throw new Error('Дата не входить до періоду роботи працівника.');
    const previous=state.records[`${input.employeeId}|${input.date}`];
    if(work.absence.has(presence.get(state,input.employeeId,input.date)?.status))throw new Error('Спочатку перевірте позначку відсутності в «Наявності».');
    if(!work.isWorkday(state,input.employeeId,input.date))throw new Error('Спочатку зробіть цю дату робочим днем у табелі.');
    const legacyReceiptId=previous?.receiptId;
    if(legacyReceiptId){if(!String(input.note||'').trim())throw new Error('Поясніть виправлення позначки попереднього обліку.');previous.receiptId=null;}
    const record=setManualStatus(state,input);
    if(legacyReceiptId)record.legacyReceiptId=legacyReceiptId;
    return record;
  }));
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
  ipcMain.handle('draws:delete', (_event, { id }) => mutate('draws:delete', state => draws.deleteDraw(state, id)));
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
  ipcMain.handle('employee:delete-preview', (_event, { employeeId }) => employeeDeletion.preview(store.state, employeeId));
  ipcMain.handle('employee:delete', (_event, input) => mutate('employee:delete', state => employeeDeletion.apply(state, input)));
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
  ipcMain.handle('analytics:report', (_event, filter) => work.report(store.state, filter));
  ipcMain.handle('analytics:details', (_event, input) => getAnalyticsDetails(store.state, input));
  ipcMain.handle('analytics:export-report', async (_event, { filter, view }) => {
    if(!['workers','trend','days'].includes(view))throw new Error('Невідомий вигляд звіту роботи.');
    const report = work.report(store.state, filter);
    const csv = work.csv(report, view);
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
          detail: `Працівників: ${normalized.employees.length}; робіт: ${normalized.workEntries.length}; записів попереднього обліку: ${normalized.receipts.length}; завдань: ${normalized.tasks.length}; графіків: ${normalized.dutySchedules.length}; жеребкувань: ${normalized.draws.length}.\n\nПоточну базу буде замінено. Попередня база залишиться в локальній резервній копії; імпорт також можна скасувати кнопкою «Скасувати останню дію».`,
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

  ipcMain.handle('window:set-mode', (_event, {mode}) => setWindowMode(mode));

  ipcMain.handle('widget:preferences', (_event,input) => {
    const allowed=['widgetMode','widgetShape','widgetList','widgetLocked','widgetSnap','widgetQuickMode','widgetShortcutEnabled'];
    if(!input||typeof input!=='object'||Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('Некоректні налаштування віджета.');
    if(('widgetMode' in input&&!['team','duties','tasks'].includes(input.widgetMode))||('widgetShape' in input&&!['circle','panel'].includes(input.widgetShape))
      ||allowed.slice(2).some(key=>key in input&&typeof input[key]!=='boolean'))throw new Error('Некоректні налаштування віджета.');
    const before=store.snapshot();
    try{updateSettings(store.state,input);store.save();}catch(error){store.state=normalizeState(before);throw error;}
    broadcast();return clone(store.state.settings);
  });
  ipcMain.handle('window:resize-widget', (_event, { size, persist }) => {
    if (!mainWindow || windowMode !== 'widget' || store.state.settings.widgetLocked) return null;
    const nextSize=clampWidgetSize(size),bounds=mainWindow.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
    const dimensions=widgetWindow.dimensions({...store.state.settings,widgetSize:nextSize},area);
    const next=widgetWindow.fit({x:bounds.x+(bounds.width-dimensions.width)/2,y:bounds.y+(bounds.height-dimensions.height)/2,...dimensions},area);
    mainWindow.setBounds(next,false);applyWidgetShape(next.width);
    if(persist){store.state.settings.widgetSize=nextSize;store.state.settings.widgetPosition={x:next.x,y:next.y};store.save();broadcast();}
    return next.width;
  });
  ipcMain.handle('window:hide', () => {
    if(!mainWindow)return false;
    if(tray){saveWidgetBounds();mainWindow.hide();}else{mainWindow.setSkipTaskbar(false);mainWindow.minimize();}
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
  ipcMain.handle('window:minimize', () => { mainWindow?.setSkipTaskbar(false); mainWindow?.minimize(); });
  ipcMain.handle('window:close', () => app.quit());
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
  createTray();

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
  quitting=true;globalShortcut.unregisterAll();tray?.destroy();tray=null;
  if (closeTimer) clearInterval(closeTimer);
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  saveWidgetBounds();
  if(trainingSession){try{fs.rmSync(trainingSession.directory,{recursive:true,force:true});}catch(_error){/* Temporary cleanup must not block closing the app. */}}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin'&&!tray) app.quit();
});
module.exports={getMainWindow:()=>mainWindow,getStore:()=>store};
