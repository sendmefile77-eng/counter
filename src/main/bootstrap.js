'use strict';

const { app } = require('electron');

// Counter uses a transparent frameless window on Windows. On some GPU/driver
// combinations Chromium hardware compositing can leave DWM/Desktop artifacts.
// Counter does not need GPU acceleration, so prefer the stable software path.
const selfTestArgument=process.argv?.find(argument=>argument.startsWith('--lad-self-test='));
if (selfTestArgument) {
  app.disableHardwareAcceleration();
  require('./packaged-check').run(selfTestArgument.slice('--lad-self-test='.length));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.disableHardwareAcceleration();
  require('./main');
}
