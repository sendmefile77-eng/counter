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
      fs.copyFileSync(this.filePath, corruptPath);
      if (fs.existsSync(this.backupPath)) {
        const backup = JSON.parse(fs.readFileSync(this.backupPath, 'utf8'));
        this.state = normalizeState(backup);
        this.save();
        return this.state;
      }
      throw new Error(`Не вдалося прочитати локальну базу. Пошкоджену копію збережено: ${corruptPath}. ${error.message}`);
    }
  }

  save() {
    if (!this.state) throw new Error('Базу даних ще не завантажено.');
    fs.mkdirSync(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    fs.writeFileSync(temporaryPath, serialized, 'utf8');
    if (fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, this.backupPath);
      fs.mkdirSync(this.backupDirectory, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      fs.copyFileSync(this.filePath, path.join(this.backupDirectory, `counter-data-${day}.json`));
      const retention = Math.max(1, Math.min(30, Number(this.state.settings?.backupRetention) || 7));
      const backups = fs.readdirSync(this.backupDirectory)
        .filter((name) => /^counter-data-\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .sort()
        .reverse();
      for (const name of backups.slice(retention)) {
        fs.unlinkSync(path.join(this.backupDirectory, name));
      }
    }
    fs.renameSync(temporaryPath, this.filePath);
  }

  replace(nextState) {
    this.state = normalizeState(clone(nextState));
    this.save();
    return this.state;
  }

  reset(now = new Date()) {
    fs.mkdirSync(this.directory, { recursive: true });
    this.state = defaultState(now);
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
    if (fs.existsSync(this.backupPath)) fs.unlinkSync(this.backupPath);
    if (fs.existsSync(this.backupDirectory)) {
      for (const fileName of fs.readdirSync(this.backupDirectory)) {
        if (/^counter-data-\d{4}-\d{2}-\d{2}\.json$/.test(fileName)) {
          fs.unlinkSync(path.join(this.backupDirectory, fileName));
        }
      }
      fs.rmdirSync(this.backupDirectory);
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
