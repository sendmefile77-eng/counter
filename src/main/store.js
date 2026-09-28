const fs = require('node:fs');
const path = require('node:path');
const { defaultState, normalizeState, clone } = require('../shared/domain');

class DataStore {
  constructor(directory, legacyDirectory = null) {
    this.directory = directory;
    this.legacyDirectory = legacyDirectory;
    this.filePath = path.join(directory, 'counter-data.json');
    this.backupPath = path.join(directory, 'counter-data.backup.json');
    this.backupDirectory = path.join(directory, 'backups');
    this.state = null;
  }

  migrateLegacyData() {
    if (!this.legacyDirectory) return false;
    if (path.resolve(this.legacyDirectory) === path.resolve(this.directory)) return false;
    if (fs.existsSync(this.filePath)) return false;
    const legacyFilePath = path.join(this.legacyDirectory, 'counter-data.json');
    if (!fs.existsSync(legacyFilePath)) return false;

    fs.mkdirSync(this.directory, { recursive: true });
    fs.copyFileSync(legacyFilePath, this.filePath);
    const legacyBackupPath = path.join(this.legacyDirectory, 'counter-data.backup.json');
    if (fs.existsSync(legacyBackupPath)) {
      fs.copyFileSync(legacyBackupPath, this.backupPath);
    }
    return true;
  }

  load() {
    this.migrateLegacyData();
    fs.mkdirSync(this.directory, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.state = defaultState();
      this.save();
      return this.state;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.state = normalizeState(parsed);
      return this.state;
    } catch (error) {
      const corruptPath = path.join(this.directory, `counter-data.corrupt-${Date.now()}.json`);
      fs.renameSync(this.filePath, corruptPath);
      for (const backup of this.backupCandidates()) {
        let restored;
        try {
          restored = this.readBackup(backup.path);
        } catch (_backupError) {
          // Try the next older copy; never overwrite a valid backup with corrupt data.
          continue;
        }
        this.state = restored;
        if (backup.id !== 'previous') fs.copyFileSync(backup.path, this.backupPath);
        this.save();
        return this.state;
      }
      throw new Error(`Не вдалося прочитати локальну базу. Пошкоджену копію збережено: ${corruptPath}. ${error.message}`);
    }
  }

  backupCandidates() {
    const candidates = [];
    if (fs.existsSync(this.backupPath)) {
      candidates.push({ id: 'previous', path: this.backupPath });
    }
    if (fs.existsSync(this.backupDirectory)) {
      const names = fs.readdirSync(this.backupDirectory)
        .filter((name) => /^counter-data-\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .sort().reverse();
      for (const name of names) candidates.push({ id: name, path: path.join(this.backupDirectory, name) });
    }
    return candidates;
  }

  readBackup(backupPath) {
    const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    if (!Array.isArray(data.employees) || !data.records || typeof data.records !== 'object') {
      throw new Error('Резервна копія не містить необхідних розділів бази.');
    }
    return normalizeState(data);
  }

  listBackups() {
    return this.backupCandidates().flatMap(({ id, path: backupPath }) => {
      try {
        const state = this.readBackup(backupPath);
        return [{ id, employees: state.employees.length, receipts: state.receipts.length,
          savedAt: fs.statSync(backupPath).mtime.toISOString() }];
      } catch (_error) {
        return [];
      }
    });
  }

  restoreBackup(id) {
    const candidate = this.backupCandidates().find((item) => item.id === id);
    if (!candidate) throw new Error('Резервну копію не знайдено.');
    const restored = this.readBackup(candidate.path);
    return this.replace(restored);
  }

  save() {
    if (!this.state) throw new Error('Базу даних ще не завантажено.');
    fs.mkdirSync(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    fs.writeFileSync(temporaryPath, serialized, 'utf8');
    try {
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
        fs.mkdirSync(this.backupDirectory, { recursive: true });
        const day = new Date().toISOString().slice(0, 10);
        fs.copyFileSync(this.filePath, path.join(this.backupDirectory, `counter-data-${day}.json`));
      }
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      throw error;
    }
    const retention = Math.max(1, Math.min(30, Number(this.state.settings?.backupRetention) || 7));
    const backups = this.backupCandidates().filter((item) => item.id !== 'previous');
    for (const item of backups.slice(retention)) {
      try { fs.unlinkSync(item.path); } catch (_error) { /* A failed cleanup must not undo a successful save. */ }
    }
  }

  replace(nextState) {
    const previous = this.state;
    this.state = normalizeState(clone(nextState));
    try {
      this.save();
      return this.state;
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  reset(now = new Date()) {
    fs.mkdirSync(this.directory, { recursive: true });
    const fresh = defaultState(now);
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
    try { fs.renameSync(temporaryPath, this.filePath); }
    catch (error) {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      throw error;
    }
    this.state = fresh;
    if (fs.existsSync(this.backupPath)) fs.unlinkSync(this.backupPath);
    if (fs.existsSync(this.backupDirectory)) {
      for (const fileName of fs.readdirSync(this.backupDirectory)) {
        if (/^counter-data-\d{4}-\d{2}-\d{2}\.json$/.test(fileName)) {
          fs.unlinkSync(path.join(this.backupDirectory, fileName));
        }
      }
      if (fs.readdirSync(this.backupDirectory).length === 0) fs.rmdirSync(this.backupDirectory);
    }
    for (const fileName of fs.readdirSync(this.directory)) {
      if (fileName.startsWith('counter-data.corrupt-') && fileName.endsWith('.json')) {
        fs.unlinkSync(path.join(this.directory, fileName));
      }
    }
    return this.state;
  }

  snapshot() {
    return clone(this.state);
  }
}

module.exports = { DataStore };
