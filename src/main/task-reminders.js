const fs = require('node:fs');
const path = require('node:path');
const planner = require('../shared/planner');
const APP_ID = 'ua.local.counterwidget';
const ACTIVATOR_ID = '{DB73CD0D-2B51-4AA4-A229-86D498482A11}';
function setupWindowsNotifications({ app, shell }, platform = process.platform) {
  if (platform !== 'win32') return { supported: true };
  try {
    app.setAppUserModelId(APP_ID);
    if (typeof app.setToastActivatorCLSID === 'function') app.setToastActivatorCLSID(ACTIVATOR_ID);
    // A portable EXE extracts its runtime; the shortcut must point at the original EXE.
    const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    if (!app.isPackaged) return { supported: true };
    const directory = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    fs.mkdirSync(directory, { recursive: true });
    const ok = shell.writeShortcutLink(path.join(directory, 'ЛАД.lnk'), 'replace', {
      target: executable, cwd: path.dirname(executable), description: 'ЛАД — Люди. Аналітика. Документи.',
      appUserModelId: APP_ID, toastActivatorClsid: ACTIVATOR_ID,
    });
    return { supported: ok, error: ok ? '' : 'Не вдалося створити ярлик для сповіщень Windows.' };
  } catch (_error) { return { supported: false, error: 'Сповіщення Windows недоступні. Нагадування залишаються в ЛАД.' }; }
}
function createReminderService({ Notification, store, broadcast, openTask, act, now = () => new Date() }) {
  const live = new Map();
  let status = { supported: Notification.isSupported(), lastError: '' };
  function check() {
    if (!store.state.settings.taskRemindersEnabled || !status.supported) return;
    const candidates = (store.state.tasks || []).map(task => planner.notificationCandidate(task, now())).filter(Boolean);
    if (!candidates.length) return;
    // Limit each tick to three, without losing the remainder or duplicating delivered reminders.
    for (const candidate of candidates.slice(0, 3)) {
      const task = store.state.tasks.find(item => item.id === candidate.taskId);
      const before = [...task.notificationKeys], beforeSnooze = task.snoozedUntil;
      task.notificationKeys = [...task.notificationKeys, candidate.key].slice(-100);
      // An expired snooze produces one reminder; suppress the corresponding deadline phase too.
      if (candidate.key.startsWith('snooze:')) {
        task.notificationKeys.push(`${candidate.kind}:${task.dueDate}:${task.dueTime}:${task.reminderMinutes}`);
        task.snoozedUntil = null;
      }
      try { store.save(); } catch (_error) { task.notificationKeys = before; task.snoozedUntil = beforeSnooze; status.lastError = 'Нагадування не надіслано: не вдалося зберегти дані.'; continue; }
      const signature = `${task.dueDate}:${task.dueTime}`, taskId = task.id;
      const stillCurrent = () => { const current = store.state.tasks.find(item => item.id === taskId); return current && planner.active(current) && `${current.dueDate}:${current.dueTime}` === signature; };
      try {
        const notice = new Notification({ title: candidate.kind === 'overdue' ? 'ЛАД · Строк минув' : 'ЛАД · Нагадування',
          body: `${task.title}\nСтрок: ${task.dueDate}${task.dueTime ? ` о ${task.dueTime}` : ' · до кінця дня'}`,
          actions: [{ type: 'button', text: 'Виконано' }, { type: 'button', text: 'Через годину' }],
          timeoutType: 'never' });
        notice.ladDeadline = signature;
        live.set(taskId, notice);
        notice.on('click', () => openTask(taskId));
        notice.on('action', (event, oldIndex) => {
          const index = event.actionIndex ?? oldIndex;
          if (!stillCurrent()) return openTask(taskId);
          try { if (index === 0) act(taskId, 'done'); else if (index === 1) act(taskId, 'snooze'); }
          catch (_error) { status.lastError = 'Не вдалося виконати дію. Відкрийте завдання в ЛАД.'; openTask(taskId); }
        });
        notice.on('failed', () => { status.lastError = 'Windows не показала сповіщення. Перевірте дозвіл у налаштуваннях Windows; завдання залишаються в ЛАД.'; broadcast(); });
        notice.show();
      } catch (_error) { status.lastError = 'Сповіщення недоступні. Нагадування залишаються в ЛАД.'; }
    }
    broadcast();
  }
  function reconcile() {
    for (const [id, notice] of live) {
      const task = store.state.tasks.find(item => item.id === id);
      if (!task || !planner.active(task) || !store.state.settings.taskRemindersEnabled || notice.ladDeadline && `${task.dueDate}:${task.dueTime}` !== notice.ladDeadline) { notice.close(); live.delete(id); }
    }
  }
  function test() {
    if (!status.supported) throw new Error('Системні сповіщення недоступні. Нагадування можна переглядати в ЛАД.');
    status.lastError = '';
    const notice = new Notification({ title: 'ЛАД · Перевірка нагадувань', body: 'Сповіщення працюють. Строки завдань також видно у «Потребує уваги».' });
    live.set('test', notice);
    notice.on('failed', () => { status.lastError = 'Windows не показала тестове сповіщення. Перевірте дозвіл для ЛАД у налаштуваннях Windows.'; broadcast(); });
    notice.show(); return { sent: true };
  }
  return { check, reconcile, test, status: () => ({ ...status }), disable: message => { status.supported = false; status.lastError = message; }, enable: () => { status.supported = Notification.isSupported(); status.lastError = ''; } };
}
module.exports = { createReminderService, setupWindowsNotifications };
