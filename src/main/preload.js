const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('counter', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  addEmployee: (name) => ipcRenderer.invoke('employee:add', { name }),
  archiveEmployee: (employeeId) => ipcRenderer.invoke('employee:archive', { employeeId }),
  restoreEmployee: (employeeId) => ipcRenderer.invoke('employee:restore', { employeeId }),
  recordSubmission: (payload) => ipcRenderer.invoke('submission:record', payload),
  allocateForward: (receiptId, units) => ipcRenderer.invoke('submission:allocate-forward', { receiptId, units }),
  setStatus: (payload) => ipcRenderer.invoke('record:set-status', payload),
  clearStatus: (employeeId, date) => ipcRenderer.invoke('record:clear', { employeeId, date }),
  getAnalytics: (filter) => ipcRenderer.invoke('analytics:get', filter),
  undo: () => ipcRenderer.invoke('history:undo'),
  exportData: (format) => ipcRenderer.invoke('data:export', { format }),
  importData: () => ipcRenderer.invoke('data:import'),
  setWindowMode: (mode) => ipcRenderer.invoke('window:set-mode', { mode }),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window:set-always-on-top', { value }),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  onChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('counter:changed', listener);
    return () => ipcRenderer.removeListener('counter:changed', listener);
  },
});
