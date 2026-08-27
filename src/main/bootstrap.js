'use strict';

const { app } = require('electron');

// Counter uses a transparent frameless window on Windows. On some GPU/driver
// combinations Chromium hardware compositing can leave DWM/Desktop artifacts.
// Counter does not need GPU acceleration, so prefer the stable software path.
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

require('./main');
