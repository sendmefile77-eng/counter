const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { defaultState, normalizeState, clone } = require('../shared/domain');

class DataStore {
  constructor(directory, legacyDirectory = null) {
    this.directory = directory;
    this.legacyDirectory = legacyDirectory;
    this.filePath = path.join(directory, 'counter-data.json');
    this.backupPath = path.join(directory, 'counter-data.backup.json');
    this.backupDirectory = path.join(directory, 'backups');
    this.state = null;
    this.recovery = null;
  }

  migrateLegacyData() {
    if (!this.legacyDirectory) return false;
    if (path.resolve(this.legacyDirectory) === path.resolve(this.directory)) return false;
    if (fs.existsSync(this.filePath)) return false;
    if (this.backupCandidates().length || (fs.existsSync(this.directory)
      && fs.readdirSync(this.directory).some(name => name.startsWith('counter-data.corrupt-')))) return false;
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
    if (!fs.existsSync(this.filePath) && !this.backupCandidates().length
      && !fs.readdirSync(this.directory).some(name => name.startsWith('counter-data.corrupt-'))) {
      this.state = defaultState();
      this.save();
      return this.state;
    }

    try {
      this.state = this.readBackup(this.filePath);
      return this.state;
    } catch (error) {
      if (error.code === 'FUTURE_SCHEMA') throw error;
      const corruptPath = fs.existsSync(this.filePath)
        ? path.join(this.directory, `counter-data.corrupt-${Date.now()}-${crypto.randomUUID()}.json`) : null;
      if (corruptPath) fs.copyFileSync(this.filePath, corruptPath);
      for (const backup of this.backupCandidates()) {
        let restored;
        try {
          restored = this.readBackup(backup.path);
        } catch (_backupError) {
          // Try the next older copy; never overwrite a valid backup with corrupt data.
          continue;
        }
        if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
        this.state = restored;
        if (backup.id !== 'previous') fs.copyFileSync(backup.path, this.backupPath);
        this.save();
        this.recovery = { source:backup.id, corruptPath, restoredAt:new Date().toISOString(), message:'Базу відновлено з резервної копії. Перевірте останні зміни: після дати копії вони могли не зберегтися.' };
        return this.state;
      }
      throw new Error(`Не вдалося прочитати базу або знайти справну копію. Дані збережено; порожня база не створюється. ${corruptPath ? `Копія для перевірки: ${corruptPath}. ` : ''}Оберіть власний JSON-бекап або закрийте ЛАД. ${error.message}`);
    }
  }

  backupCandidates() {
    const candidates = [];
    if (fs.existsSync(this.backupPath)) {
      candidates.push({ id: 'previous', path: this.backupPath });
    }
    if (fs.existsSync(this.backupDirectory)) {
      const names = fs.readdirSync(this.backupDirectory)
        .filter((name) => /^counter-data-(?:\d{4}-\d{2}-\d{2}|checkpoint-[\w-]+)\.json$/.test(name))
        .sort((a,b) => fs.statSync(path.join(this.backupDirectory,b)).mtimeMs - fs.statSync(path.join(this.backupDirectory,a)).mtimeMs || b.localeCompare(a));
      for (const name of names) candidates.push({ id: name, path: path.join(this.backupDirectory, name) });
    }
    return candidates;
  }

  readBackup(backupPath) {
    return this.parseBackup(fs.readFileSync(backupPath, 'utf8'));
  }

  parseBackup(content) {
    if (typeof content !== 'string') throw new Error('Не вдалося прочитати резервну копію.');
    let data;
    try { data = JSON.parse(content.replace(/^\uFEFF/, '')); }
    catch (_error) { throw new Error('Файл не є справною резервною копією JSON.'); }
    if (!data || !Array.isArray(data.employees) || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) {
      throw new Error('Резервна копія не містить необхідних розділів бази.');
    }
    if (Number(data.schemaVersion) > defaultState().schemaVersion) {
      const error = new Error('Цю базу створено новішою версією ЛАД. Оновіть програму; наявний файл не змінено.');
      error.code = 'FUTURE_SCHEMA'; throw error;
    }
    return normalizeState(data);
  }

  listBackups() {
    return this.backupCandidates().flatMap(({ id, path: backupPath }) => {
      try {
        const state = this.readBackup(backupPath);
        return [{ id, kind:id.includes('checkpoint-')?'checkpoint':id==='previous'?'previous':'daily', employees: state.employees.length, receipts: state.receipts.length, tasks: state.tasks.length, draws:state.draws.length,
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
    fs.writeFileSync(temporaryPath, serialized, { encoding:'utf8', mode:0o600 });
    const fd = fs.openSync(temporaryPath,'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
    for (const checkpoint of [false,true]) {
      for (const item of backups.filter(item => item.id.includes('checkpoint-') === checkpoint).slice(retention)) {
        try { fs.unlinkSync(item.path); } catch (_error) { /* A failed cleanup must not undo a successful save. */ }
      }
    }
  }

  replace(nextState) {
    const previous = this.state;
    if (fs.existsSync(this.filePath)) {
      // An import/restore checkpoint must survive the next ordinary edit.
      fs.mkdirSync(this.backupDirectory,{recursive:true});
      fs.copyFileSync(this.filePath,path.join(this.backupDirectory,`counter-data-checkpoint-${Date.now()}-${crypto.randomUUID()}.json`));
    }
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
        if (/^counter-data-(?:\d{4}-\d{2}-\d{2}|checkpoint-[\w-]+)\.json$/.test(fileName)) {
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
