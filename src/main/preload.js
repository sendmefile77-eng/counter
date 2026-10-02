const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('counter', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  addEmployee: (name) => ipcRenderer.invoke('employee:add', { name }),
  archiveEmployee: (employeeId) => ipcRenderer.invoke('employee:archive', { employeeId }),
  restoreEmployee: (employeeId) => ipcRenderer.invoke('employee:restore', { employeeId }),
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
  clearStatus: (employeeId, date) => ipcRenderer.invoke('record:clear', { employeeId, date }),
  setWorkdayOverride: (employeeId, date, note = '') => (
    ipcRenderer.invoke('workday-override:set', { employeeId, date, note })
  ),
  clearWorkdayOverride: (employeeId, date) => (
    ipcRenderer.invoke('workday-override:clear', { employeeId, date })
  ),
  getAnalytics: (filter) => ipcRenderer.invoke('analytics:get', filter),
  getAnalyticsTrend: (filter) => ipcRenderer.invoke('analytics:trend', filter),
  exportAnalytics: (filter) => ipcRenderer.invoke('analytics:export', filter),
  initializeDuties: (entries, participantIds) => ipcRenderer.invoke('duties:initialize', { entries, participantIds }),
  generateDuties: (filter) => ipcRenderer.invoke('duties:generate', filter),
  previewDuties: (filter) => ipcRenderer.invoke('duties:preview', filter),
  getDutyExplanation: (date) => ipcRenderer.invoke('duties:explanation', { date }),
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
  importData: () => ipcRenderer.invoke('data:import'),
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
