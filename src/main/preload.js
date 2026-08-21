const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('counter', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  addEmployee: (name) => ipcRenderer.invoke('employee:add', { name }),
  archiveEmployee: (employeeId) => ipcRenderer.invoke('employee:archive', { employeeId }),
  restoreEmployee: (employeeId) => ipcRenderer.invoke('employee:restore', { employeeId }),
  recordSubmission: (payload) => ipcRenderer.invoke('submission:record', payload),
  allocateBackward: (receiptId, units) => ipcRenderer.invoke('submission:allocate-backward', { receiptId, units }),
  allocateForward: (receiptId, units) => ipcRenderer.invoke('submission:allocate-forward', { receiptId, units }),
  setStatus: (payload) => ipcRenderer.invoke('record:set-status', payload),
  clearStatus: (employeeId, date) => ipcRenderer.invoke('record:clear', { employeeId, date }),
  setWorkdayOverride: (employeeId, date, note = '') => (
    ipcRenderer.invoke('workday-override:set', { employeeId, date, note })
  ),
  clearWorkdayOverride: (employeeId, date) => (
    ipcRenderer.invoke('workday-override:clear', { employeeId, date })
  ),
  getAnalytics: (filter) => ipcRenderer.invoke('analytics:get', filter),
  initializeDuties: (entries, participantIds) => ipcRenderer.invoke('duties:initialize', { entries, participantIds }),
  generateDuties: (filter) => ipcRenderer.invoke('duties:generate', filter),
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
  undo: () => ipcRenderer.invoke('history:undo'),
  exportData: (format) => ipcRenderer.invoke('data:export', { format }),
  importData: () => ipcRenderer.invoke('data:import'),
  resetAllData: () => ipcRenderer.invoke('data:reset-all'),
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
});
