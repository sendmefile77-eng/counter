const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DataStore } = require('../src/main/store');
const { createEmployee, defaultState } = require('../src/shared/domain');

test('портативна база автоматично копіюється зі старого каталогу Windows', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-store-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const legacyDirectory = path.join(temporaryRoot, 'legacy-appdata');
  const portableDirectory = path.join(temporaryRoot, 'Counter-data');
  fs.mkdirSync(legacyDirectory, { recursive: true });

  const state = defaultState(new Date(2026, 7, 20, 9, 0));
  createEmployee(state, 'Тестовий працівник', new Date(2026, 7, 20, 9, 0));
  fs.writeFileSync(
    path.join(legacyDirectory, 'counter-data.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(legacyDirectory, 'counter-data.backup.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );

  const store = new DataStore(portableDirectory, legacyDirectory);
  store.load();

  assert.equal(store.state.employees[0].name, 'Тестовий працівник');
  assert.equal(fs.existsSync(path.join(portableDirectory, 'counter-data.json')), true);
  assert.equal(fs.existsSync(path.join(portableDirectory, 'counter-data.backup.json')), true);
  assert.equal(fs.existsSync(path.join(legacyDirectory, 'counter-data.json')), true);
});

test('повне обнулення видаляє дані та внутрішню резервну копію', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-reset-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const store = new DataStore(temporaryRoot);
  store.load();
  createEmployee(store.state, 'Працівник для видалення', new Date(2026, 7, 20, 9, 0));
  store.save();
  assert.equal(fs.existsSync(store.backupPath), true);
  const corruptCopyPath = path.join(temporaryRoot, 'counter-data.corrupt-123.json');
  fs.writeFileSync(corruptCopyPath, '{}', 'utf8');

  store.reset(new Date(2026, 7, 21, 9, 0));

  assert.deepEqual(store.state.employees, []);
  assert.deepEqual(store.state.records, {});
  assert.deepEqual(store.state.duties.assignments, {});
  assert.equal(store.state.duties.initialized, false);
  assert.equal(fs.existsSync(store.backupPath), false);
  assert.equal(fs.existsSync(corruptCopyPath), false);
  const persisted = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  assert.deepEqual(persisted.employees, []);
});
