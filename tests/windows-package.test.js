const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Arch } = require('builder-util');
const verify = require('../build/verify-win-package.cjs');
function packageFixture(t, arch = 'x64') {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lad-package-'));
  t.after(() => fs.rmSync(appOutDir, { recursive: true, force: true }));
  const locales = path.join(appOutDir, 'locales');
  fs.mkdirSync(locales);
  for (const name of ['uk', 'ru', 'en-US']) fs.writeFileSync(path.join(locales, name + '.pak'), 'locale');
  const root = path.join(appOutDir, 'resources/app.asar.unpacked/node_modules/@napi-rs');
  const binary = path.join(root, `canvas-win32-${arch}-msvc`, `skia.win32-${arch}-msvc.node`);
  fs.mkdirSync(path.dirname(binary), { recursive: true }); fs.writeFileSync(binary, 'MZtest');
  return { root, binary, context: { appOutDir, electronPlatformName: 'win32', arch: Arch[arch] } };
}
test('Windows guard accepts the matching x64 and arm64 PE binaries', t => {
  for (const arch of ['x64', 'arm64']) assert.doesNotThrow(() => verify(packageFixture(t, arch).context));
});
test('Windows guard rejects a foreign Canvas module even alongside a valid Windows module', t => {
  const p = packageFixture(t); fs.mkdirSync(path.join(p.root, 'canvas-linux-x64-musl'));
  assert.throws(() => verify(p.context), /foreign native modules/);
});
test('Windows guard rejects missing and non-PE native binaries', t => {
  const p = packageFixture(t); fs.writeFileSync(p.binary, '\x7fELF');
  assert.throws(() => verify(p.context), /PE signature/);fs.unlinkSync(p.binary);assert.throws(() => verify(p.context), /ENOENT/);
});
test('Windows guard leaves other target platforms alone', () => {
  assert.doesNotThrow(() => verify({electronPlatformName:'linux'}));
});

test('Windows guard rejects debug maps and unexpected locales', t => {
  const p = packageFixture(t); const map = path.join(p.root, 'debug.map'); fs.writeFileSync(map, '{}');
  assert.throws(() => verify(p.context), /source map/); fs.unlinkSync(map);
  fs.writeFileSync(path.join(p.context.appOutDir, 'locales', 'fr.pak'), 'locale');
  assert.throws(() => verify(p.context), /exactly the Ukrainian/);
});
