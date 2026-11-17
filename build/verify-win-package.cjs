const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');

module.exports = function verifyWindowsPackage(context) {
  if (context.electronPlatformName !== 'win32') return;
  const nativeRoot = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@napi-rs');
  const packages = fs.readdirSync(nativeRoot);
  const foreign = packages.filter(name => /^canvas-(linux|darwin|android|freebsd)-/.test(name));
  if (foreign.length) throw new Error(`Windows package contains foreign native modules: ${foreign.join(', ')}`);
  const dependencies = path.dirname(nativeRoot);
  function checkMaps(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) checkMaps(filename);
      else if (entry.name.endsWith('.map')) throw new Error(`Windows package contains a dependency source map: ${filename}`);
    }
  }
  checkMaps(dependencies);
  const locales = fs.readdirSync(path.join(context.appOutDir, 'locales')).filter(name => name.endsWith('.pak'));
  const expectedLocales = ['uk.pak', 'ru.pak', 'en-US.pak'];
  if (locales.length !== expectedLocales.length || expectedLocales.some(name => !locales.includes(name))) {
    throw new Error('Windows package must contain exactly the Ukrainian, Russian and English Electron locales');
  }
  const arch = Arch[context.arch];
  const binary = path.join(nativeRoot, `canvas-win32-${arch}-msvc`, `skia.win32-${arch}-msvc.node`);
  const fd = fs.openSync(binary, 'r');
  try {
    const magic = Buffer.alloc(2);
    if (fs.readSync(fd, magic, 0, 2, 0) !== 2 || magic.toString('ascii') !== 'MZ') {
      throw new Error('Windows Canvas binary is missing its PE signature');
    }
  } finally { fs.closeSync(fd); }
};
