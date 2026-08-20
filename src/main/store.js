const fs = require('node:fs');
const path = require('node:path');
const { defaultState, normalizeState, clone } = require('../shared/domain');

class DataStore {
  constructor(directory) {
    this.directory = directory;
    this.filePath = path.join(directory, 'counter-data.json');
    this.backupPath = path.join(directory, 'counter-data.backup.json');
    this.state = null;
  }

  load() {
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
    }
    fs.renameSync(temporaryPath, this.filePath);
  }

  replace(nextState) {
    this.state = normalizeState(clone(nextState));
    this.save();
    return this.state;
  }

  snapshot() {
    return clone(this.state);
  }
}

module.exports = { DataStore };
