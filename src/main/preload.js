const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('counter', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  previewPresence: input => ipcRenderer.invoke('presence:preview',input),
  applyPresence: input => ipcRenderer.invoke('presence:apply',input),
  savePresence: input => ipcRenderer.invoke('presence:save',input),
  flipCoin: input=>ipcRenderer.invoke('coins:flip',input),
  setEmployeeDutyColor: (employeeId,color)=>ipcRenderer.invoke('employee:duty-color',{employeeId,color}),
  acknowledgeRecovery: () => ipcRenderer.invoke('data:ack-recovery'),
  enterTraining: () => ipcRenderer.invoke('training:enter'),
  exitTraining: () => ipcRenderer.invoke('training:exit'),
  completeOnboarding: () => ipcRenderer.invoke('training:seen'),
  previewStaffChange: input => ipcRenderer.invoke('staff:preview-change',input),
  applyStaffChange: input => ipcRenderer.invoke('staff:apply-change',input),
  getConsequences: input => ipcRenderer.invoke('staff:consequences',input),
  getDutyReplacements: input => ipcRenderer.invoke('duties:replacements',input),
  applyDutyReplacement: input => ipcRenderer.invoke('duties:apply-replacement',input),
  createDraw: input => ipcRenderer.invoke('draws:create', input),
  deleteDraw: id => ipcRenderer.invoke('draws:delete', { id }),
  createTaskFromDraw: (id, input) => ipcRenderer.invoke('draws:create-task', { id, input }),
  confirmAction: message => ipcRenderer.invoke('dialog:confirm', message),
  createTask: input => ipcRenderer.invoke('tasks:create', input),
  updateTask: (id, input) => ipcRenderer.invoke('tasks:update', { id, input }),
  setTaskStatus: (id, input) => ipcRenderer.invoke('tasks:status', { id, input }),
  archiveTask: (id, archived) => ipcRenderer.invoke('tasks:archive', { id, archived }),
  snoozeTask: (id, minutes) => ipcRenderer.invoke('tasks:snooze', { id, minutes }),
  testTaskReminder: () => ipcRenderer.invoke('tasks:test-reminder'),
  getEmployeeOverview: input => ipcRenderer.invoke('employee:overview', input),
  getWeeklySummary: anchor => ipcRenderer.invoke('management:week', { anchor }),
  exportWeeklySummary: (anchor, format) => ipcRenderer.invoke('management:export-week', { anchor, format }),
  onOpenTask: callback => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on('tasks:open', listener);
    return () => ipcRenderer.removeListener('tasks:open', listener);
  },
  addEmployee: (name) => ipcRenderer.invoke('employee:add', { name }),
  archiveEmployee: (employeeId) => ipcRenderer.invoke('employee:archive', { employeeId }),
  restoreEmployee: (employeeId) => ipcRenderer.invoke('employee:restore', { employeeId }),
  previewEmployeeDeletion: employeeId => ipcRenderer.invoke('employee:delete-preview', { employeeId }),
  deleteEmployee: input => ipcRenderer.invoke('employee:delete', input),
  renameEmployee: (employeeId, name) => ipcRenderer.invoke('employee:rename', { employeeId, name }),
  moveEmployee: (employeeId, direction) => ipcRenderer.invoke('employee:move', { employeeId, direction }),
  previewSubmission: (payload) => ipcRenderer.invoke('submission:preview', payload),
  recordSubmission: (payload) => ipcRenderer.invoke('submission:record', payload),
  previewReceiptCorrection: (receiptId, input) => ipcRenderer.invoke('submission:correct-preview', { receiptId, input }),
  correctReceipt: (receiptId, input) => ipcRenderer.invoke('submission:correct', { receiptId, input }),
  allocateBackward: (receiptId, units) => ipcRenderer.invoke('submission:allocate-backward', { receiptId, units }),
  allocateForward: (receiptId, units) => ipcRenderer.invoke('submission:allocate-forward', { receiptId, units }),
  setStatus: (payload) => ipcRenderer.invoke('record:set-status', payload),
  setStatusPeriod: (payload) => ipcRenderer.invoke('record:set-period', payload),
  previewStatusPeriod: (payload) => ipcRenderer.invoke('record:preview-period', payload),
  previewJournalBatch: (payload) => ipcRenderer.invoke('journal:preview-batch', payload),
  applyJournalBatch: (payload) => ipcRenderer.invoke('journal:apply-batch', payload),
  exportJournal: (filter) => ipcRenderer.invoke('journal:export', filter),
  clearStatus: (employeeId, date) => ipcRenderer.invoke('record:clear', { employeeId, date }),
  setWorkdayOverride: (employeeId, date, note = '') => (
    ipcRenderer.invoke('workday-override:set', { employeeId, date, note })
  ),
  clearWorkdayOverride: (employeeId, date) => (
    ipcRenderer.invoke('workday-override:clear', { employeeId, date })
  ),
  getAnalytics: (filter) => ipcRenderer.invoke('analytics:get', filter),
  getAnalyticsTrend: (filter) => ipcRenderer.invoke('analytics:trend', filter),
  getAnalyticsReport: (filter) => ipcRenderer.invoke('analytics:report', filter),
  getAnalyticsDetails: (input) => ipcRenderer.invoke('analytics:details', input),
  exportAnalyticsReport: (input) => ipcRenderer.invoke('analytics:export-report', input),
  exportAnalytics: (filter) => ipcRenderer.invoke('analytics:export', filter),
  initializeDuties: (entries, participantIds) => ipcRenderer.invoke('duties:initialize', { entries, participantIds }),
  generateDuties: (filter) => ipcRenderer.invoke('duties:generate', filter),
  previewDuties: (filter) => ipcRenderer.invoke('duties:preview', filter),
  getDutyExplanation: (date, scheduleId) => ipcRenderer.invoke('duties:explanation', { date, scheduleId }),
  setDutyAssignment: (payload) => ipcRenderer.invoke('duties:set-assignment', payload),
  toggleDutyAssignment: (employeeId, date) => (
    ipcRenderer.invoke('duties:toggle-assignment', { employeeId, date })
  ),
  removeDutyAssignment: (employeeId, date) => (
    ipcRenderer.invoke('duties:remove-assignment', { employeeId, date })
  ),
  setDutyRealized: (date, employeeId, realized) => (
    ipcRenderer.invoke('duties:set-realized', { date, employeeId, realized })
  ),
  setDutyRestriction: (payload) => ipcRenderer.invoke('duties:set-restriction', payload),
  clearDutyRestriction: (employeeId, date) => (
    ipcRenderer.invoke('duties:clear-restriction', { employeeId, date })
  ),
  getDutyStats: (year) => ipcRenderer.invoke('duties:stats', { year }),
  getDutyFairness: (filter) => ipcRenderer.invoke('duties:fairness', filter),
  createDutySchedule: (name) => ipcRenderer.invoke('duties:schedule-create', { name }),
  renameDutySchedule: (scheduleId, name) => (
    ipcRenderer.invoke('duties:schedule-rename', { scheduleId, name })
  ),
  switchDutySchedule: (scheduleId) => (
    ipcRenderer.invoke('duties:schedule-switch', { scheduleId })
  ),
  deleteDutySchedule: (scheduleId) => (
    ipcRenderer.invoke('duties:schedule-delete', { scheduleId })
  ),
  duplicateDutySchedule: (scheduleId, name) => (
    ipcRenderer.invoke('duties:schedule-duplicate', { scheduleId, name })
  ),
  updateDutyScheduleRules: (scheduleId, rules) => (
    ipcRenderer.invoke('duties:schedule-rules', { scheduleId, rules })
  ),
  setDutyWeekLocked: (date, locked) => (
    ipcRenderer.invoke('duties:week-lock', { date, locked })
  ),
  clearDutyWeek: (date, mode = 'all') => ipcRenderer.invoke('duties:week-clear', { date, mode }),
  setDutyDayException: (date, exception) => (
    ipcRenderer.invoke('duties:day-exception', { date, exception })
  ),
  createTimeOffEntry: (payload) => ipcRenderer.invoke('time-off:create', payload),
  updateTimeOffEntry: (entryId, input) => ipcRenderer.invoke('time-off:update', { entryId, input }),
  deleteTimeOffEntry: (entryId) => ipcRenderer.invoke('time-off:delete', { entryId }),
  undo: () => ipcRenderer.invoke('history:undo'),
  exportData: (format) => ipcRenderer.invoke('data:export', { format }),
  importData: (file) => ipcRenderer.invoke('data:import', file),
  createWork: input => ipcRenderer.invoke('work:create',input),
  updateWork: (id,input) => ipcRenderer.invoke('work:update',{id,input}),
  updateWorkProgress: (id,input) => ipcRenderer.invoke('work:progress',{id,input}),
  finishWork: (id,input) => ipcRenderer.invoke('work:finish',{id,input}),
  markWorkDay: input => ipcRenderer.invoke('work:mark-day',input),
  updateWidgetPreferences: input => ipcRenderer.invoke('widget:preferences',input),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  listBackups: () => ipcRenderer.invoke('data:backups'),
  restoreBackup: (id) => ipcRenderer.invoke('data:restore-backup', { id }),
  resetAllData: () => ipcRenderer.invoke('data:reset-all'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  setWindowMode: (mode) => ipcRenderer.invoke('window:set-mode', { mode }),
  resizeWidget: (size, persist = false) => ipcRenderer.invoke('window:resize-widget', { size, persist }),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window:set-always-on-top', { value }),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  onChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('counter:changed', listener);
    return () => ipcRenderer.removeListener('counter:changed', listener);
  },
  onWindowModeChanged: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('window:mode-changed', listener);
    return () => ipcRenderer.removeListener('window:mode-changed', listener);
  },
});
