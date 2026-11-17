const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const d = require('../../src/shared/domain');
const productivity = require('../../src/shared/productivity');
const management = require('../../src/shared/management');
const activity = require('../../src/shared/activity');
const now = new Date('2026-11-17T12:00:00Z');
const renderer = path.resolve(__dirname, '../../src/renderer');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check, message = 'renderer update') {
  for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
  throw new Error('Timed out: ' + message);
}
async function setup(t, overrides = {}, fixture = null) {
  const state = fixture?.state || d.defaultState(now);
  state.settings.onboardingSeen = true;
  const people = fixture?.people || ['Олена', 'Віктор'].map(name => d.createEmployee(state, name, new Date('2026-10-01T09:00:00Z')));
  const errors = [], calls = [];
  const dom = new JSDOM(fs.readFileSync(path.join(renderer, 'index.html'), 'utf8'), {
    url: 'http://lad.test/', runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole().on('jsdomError', error => errors.push(error))
  });
  t.after(() => { dom.window.close(); assertNoErrors(); });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.requestIdleCallback = callback => w.setTimeout(callback, 0);
  const OriginalDate = w.Date;
  w.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [now.toISOString()])); } static now() { return now.getTime(); } };
  const api = {
    getSnapshot: async () => structuredClone({ ...state, appVersion: '0.29.0', consequences: { total: 0 }, onboarding: { seen: true } }),
    getAnalyticsReport: async filter => productivity.report(state, filter, now),
    getEmployeeOverview: async filter => management.employeeOverview(state, filter, now),
    getActivityReport: async filter => activity.screenReport(state, filter, now),
    getWeeklySummary: async anchor => management.weeklySummary(state, anchor, now),
    setWindowMode: async () => true,
    onChanged: callback => { api.changed = callback; },
    onWindowModeChanged() {}, onOpenTask() {},
    ...overrides
  };
  w.counter = new Proxy(api, { get(target, name) {
    if (!(name in target)) throw new Error('Unmocked counter method: ' + String(name));
    const value = target[name];
    return typeof value === 'function' ? (...args) => { calls.push({ name, args }); return value(...args); } : value;
  } });
  for (const script of w.document.querySelectorAll('script[src]')) {
    vm.runInContext(fs.readFileSync(path.resolve(renderer, script.getAttribute('src')), 'utf8'), dom.getInternalVMContext(), { filename: script.getAttribute('src') });
  }
  const evaluate = code => vm.runInContext(code, dom.getInternalVMContext());
  await until(() => w.document.querySelector('.window-shell'), 'initial renderer');
  if (w.document.querySelector('.empty-widget h2')?.textContent.includes('Не вдалося')) throw Error(w.document.body.textContent);
  function assertNoErrors() { if (errors.length) throw new AggregateError(errors, 'Renderer errors'); }
  return { w, state, people, calls, api, evaluate, until, tick, async page(tab) {
    await evaluate(`ui.mode='dashboard';navigateToTab(${JSON.stringify(tab)})`);
    assertNoErrors();
  }, click(selector) {
    const el = w.document.querySelector(selector); if (!el) throw Error('Missing ' + selector); el.click(); return el;
  }, submit(selector) {
    const form = w.document.querySelector(selector); if (!form) throw Error('Missing ' + selector);
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  } };
}
module.exports = { setup, until, tick, now };
