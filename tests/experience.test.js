const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, tick, until } = require('./helpers/renderer.cjs');
test('real renderer opens analytics, period segments, explanations and keeps sidebar preference', async t => {
  const r = await setup(t); await r.page('analytics');
  assert.equal(r.w.document.querySelectorAll('.motion-stat').length, 3);
  assert.equal(r.w.document.querySelectorAll('.motion-segment-indicator').length, 2);
  r.evaluate('LadExperience.afterRender()');
  assert.equal(r.w.document.querySelectorAll('.motion-segment-indicator').length, 2);
  r.click('[data-sidebar-toggle]'); await tick();
  assert.equal(r.w.localStorage.getItem('lad.sidebar.collapsed'), 'true');
  r.click('[data-analytics-preset="week"]'); await until(() => r.w.document.querySelector('[data-analytics-preset="week"][aria-pressed="true"]'));
  assert.equal(r.w.document.querySelector('.dashboard-layout').dataset.sidebarCollapsed, 'true');
  const owner = r.click('[data-motion-tip]'); await until(() => r.w.document.querySelector('.motion-tooltip'));
  assert.match(r.w.document.querySelector('.motion-tooltip').textContent, /1.5/);
  owner.dispatchEvent(new r.w.KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  assert.equal(r.w.document.querySelector('.motion-tooltip'), null);
});
test('command palette has sections, employees and tasks, and keyboard opens the chosen section', async t => {
  const r = await setup(t); await r.page('journal');
  r.w.dispatchEvent(new r.w.KeyboardEvent('keydown', {key:'k',ctrlKey:true,bubbles:true}));
  assert.ok(r.w.document.querySelector('.motion-command-palette'));
  assert.ok(r.w.document.querySelector('[data-quick-type="tab"]'));
  assert.ok(r.w.document.querySelector('[data-quick-type="employee"]'));
  const input = r.w.document.querySelector('[data-quick-query]');
  input.value='Працівники';input.dispatchEvent(new r.w.Event('input',{bubbles:true}));
  input.dispatchEvent(new r.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(r.w.document.activeElement.dataset.quickId, 'employees');
  assert.ok(r.w.document.querySelector('.motion-quick-highlight'));
  r.w.document.activeElement.click();
  await until(()=>r.evaluate("ui.tab==='employees'"));
});

test('employee side pane keeps an unfinished name, shows profile/tasks/duties and closes to the same row', async t => {
  const r = await setup(t);
  r.people[0].profile = { fullName: 'Олена Тестова', position: 'Аналітик', department: 'Відділ', birthDate: '1990-05-12' };
  await r.evaluate('refresh({analytics:false,duties:false})');
  await r.page('employees');
  r.w.document.querySelector('#employee-form input[name="name"]').value='Чернетка';
  r.click(`[data-employee-profile="${r.people[0].id}"]`);
  await until(()=>r.w.document.querySelector('.motion-profile-pane [data-pane-view]'));
  assert.match(r.w.document.querySelector('.motion-profile-pane').textContent, /Аналітик/);
  assert.equal(r.w.document.querySelector('#employee-form input[name="name"]').value,'Чернетка');
  assert.equal(r.w.document.querySelector('#modal-root').childElementCount,0);
  r.click('[data-pane-view="tasks"]'); await tick();
  assert.match(r.w.document.querySelector('.motion-profile-pane').textContent,/Завдань немає/);
  r.click('[data-pane-view="duties"]'); await tick();
  assert.match(r.w.document.querySelector('.motion-profile-pane').textContent,/Чергувань немає/);
  r.click('[data-pane-close]'); await tick();
  assert.equal(r.w.document.querySelector('.motion-profile-pane'),null);
  assert.equal(r.w.document.activeElement.dataset.employeeProfile,r.people[0].id);
});

test('employee pane ignores a late response for a different employee', async t => {
  const pending = [];
  const r = await setup(t, { getEmployeeOverview: input => new Promise(resolve => pending.push({ input, resolve })) });
  await r.page('employees');
  r.click(`[data-employee-profile="${r.people[0].id}"]`); await tick();
  r.click(`[data-employee-profile="${r.people[1].id}"]`); await tick();
  const m = require('../src/shared/management');
  pending[1].resolve(m.employeeOverview(r.state,pending[1].input,require('./helpers/renderer.cjs').now));
  await until(()=>r.w.document.querySelector('.motion-profile-pane [data-pane-view]'));
  pending[0].resolve(m.employeeOverview(r.state,pending[0].input,require('./helpers/renderer.cjs').now));
  await tick();
  assert.equal(r.w.document.querySelector('.motion-profile-pane h2').textContent,'Віктор');
});

test('object stepper never auto-saves, respects bounds and one submit commits once', async t => {
  let save, writes = 0;
  const r = await setup(t,{setObjectResult: input => {writes++; return new Promise(resolve=>{save=()=>{require('../src/shared/productivity').setObjects(r.state,input,require('./helpers/renderer.cjs').now);resolve(true);};});}});
  await r.page('journal');
  r.click(`[data-result-day="${r.people[0].id}"][data-date="2026-11-17"]`); await tick();
  let input=r.w.document.querySelector('.motion-stepper input');
  assert.equal(r.w.document.querySelector('[data-count-step="-1"]').disabled,true);
  r.click('[data-count-step="1"]'); await tick();
  r.click('[data-count-step="1"]'); await tick();
  assert.equal(input.value,'2'); assert.equal(writes,0);
  input.value='100000';input.dispatchEvent(new r.w.Event('input',{bubbles:true}));
  assert.equal(r.w.document.querySelector('[data-count-step="1"]').disabled,true);
  input.value='2';input.dispatchEvent(new r.w.Event('input',{bubbles:true}));
  r.w.document.querySelector('[name="reason"]').value='Прийнято звіт';
  r.submit('#result-day-form');r.submit('#result-day-form');await until(()=>writes===1);
  assert.ok(r.w.document.querySelector('#result-day-form [data-form-pending]'));
  save(); await until(()=>!r.w.document.querySelector('#result-day-form'));
  assert.equal(require('../src/shared/productivity').report(r.state,{startDate:'2026-11-17',endDate:'2026-11-17'},require('./helpers/renderer.cjs').now).total.objectsReceived,2);
  assert.equal(writes,1);
});

test('tooltip Escape leaves the statistics dialog open, second Escape closes it', async t => {
  const r=await setup(t);await r.page('analytics');
  r.click('[data-experience-stat="kpi"]');await tick();
  const button=r.click('#modal-root [data-motion-tip]'); await tick();
  button.dispatchEvent(new r.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(r.w.document.querySelector('.motion-tooltip'),null);
  assert.ok(r.w.document.querySelector('#modal-root [role="dialog"]'));
  button.dispatchEvent(new r.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(r.w.document.querySelector('#modal-root').childElementCount,0);
});

test('notification stack expands accessibly and only the latest change has an enabled undo', async t => {
  let undos=0;
  const r=await setup(t,{undo:async()=>{undos++;return true;}});await r.page('journal');
  r.evaluate("showToast('Перша зміна',{undo:true});showToast('Друга зміна',{undo:true})");await tick();
  let messages=[...r.w.document.querySelectorAll('.toast')];
  assert.equal(messages.length,2);
  assert.equal(messages[0].getAttribute('aria-hidden'),'true');
  assert.equal(messages[0].querySelector('[data-toast-undo]').disabled,true);
  assert.equal(messages[1].querySelector('[data-toast-undo]').disabled,false);
  r.click('[data-toast-stack]'); await tick();
  assert.equal(r.w.document.querySelector('#toast-root').dataset.expanded,'true');
  assert.equal(messages[0].getAttribute('aria-hidden'),'false');
  messages[1].querySelector('[data-toast-undo]').click(); await until(()=>undos===1);await tick();
  assert.ok(r.w.document.querySelector('#toast-root').textContent.includes('скасовано'));
});

test('activity drop dispatches once; stages remain pending until a real save, then report refreshes', async t => {
  const activity=require('../src/shared/activity');
  let prepared, previewDone, saveDone, writes=0;
  const r=await setup(t,{
    previewActivityImport:files=>new Promise(resolve=>{previewDone=()=>{prepared=activity.previewImports(r.state,files.map(file=>({...file,bytes:Buffer.from(file.bytes)})));resolve({...prepared.report,token:'preview'});};}),
    importActivity:input=>{writes++;return new Promise(resolve=>{saveDone=()=>resolve(activity.applyImports(r.state,prepared,input,require('./helpers/renderer.cjs').now));});}
  });
  await r.page('activity');
  const bytes=Buffer.from('URL,Visit Time,Visit Duration,Web Browser,Browser Profile\nhttps://example.test,17.11.2026 09:00:00,00:10:00,Chrome,PC');
  const zone=r.w.document.querySelector('.motion-drop');
  const file={name:'history.csv',size:bytes.length,arrayBuffer:async()=>bytes};
  const drop=new r.w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{types:['Files'],files:[file]}});zone.dispatchEvent(drop);
  await until(()=>previewDone);
  assert.equal(r.calls.filter(c=>c.name==='previewActivityImport').length,1);
  assert.ok(r.w.document.querySelector('[data-import-status="activity"] [aria-current="step"]'));
  assert.equal(r.w.document.querySelector('.motion-import.is-done'),null);
  previewDone();await until(()=>r.w.document.querySelector('#activity-import-form'));
  r.submit('#activity-import-form');r.submit('#activity-import-form');await until(()=>saveDone);
  assert.equal(writes,1);assert.equal(r.w.document.querySelector('.motion-import.is-done'),null);
  saveDone();await until(()=>r.w.document.querySelector('.motion-import.is-done'));
  assert.match(r.w.document.querySelector('.motion-import.is-done').textContent,/Збережено 1/);
  await until(()=>!r.w.document.querySelector('#activity-import-form'));
  assert.equal(r.state.activity.visits.length,1);
});

test('failed activity preview never shows success and preserves imported history', async t => {
  const r=await setup(t,{previewActivityImport:async()=>{throw Error('Некоректний файл');}});await r.page('activity');
  const before=structuredClone(r.state.activity);
  await r.evaluate("importActivityFiles([{name:'broken.csv',size:5,arrayBuffer:async()=>new Uint8Array(5)}])");
  assert.ok(r.w.document.querySelector('[data-import-status="activity"].has-error'));
  assert.equal(r.w.document.querySelector('.motion-import.is-done'),null);
  assert.deepEqual(r.state.activity,before);
});

test('document text, matching, preview and save show stages, and a failed save stays failed', async t => {
  const imp=require('../src/shared/document-import');let input,preview,writes=0;
  const r=await setup(t,{
    parseDocuments:async value=>imp.parseBlocks(r.state,value.blocks,value.source,value.shortRule),
    previewDocuments:async value=>{input=value;preview=imp.preview(r.state,value,require('./helpers/renderer.cjs').now);return {...preview,token:'verified'};},
    applyDocuments:async()=>{writes++;throw Error('Диск недоступний');}
  });
  await r.page('employees');r.click('[data-document-paste]');await tick();
  r.w.document.querySelector('#document-text-form [name="source"]').value='Тестовий список';
  r.w.document.querySelector('#document-text-form textarea').value='ПІБ\tПосада\nОлена\tАналітик';
  r.submit('#document-text-form');await until(()=>r.w.document.querySelector('#document-rows-form'));
  assert.ok(r.w.document.querySelector('#document-rows-form [data-import-status="documents"]'));
  r.submit('#document-rows-form');await until(()=>r.w.document.querySelector('[data-document-apply]'));
  assert.equal(preview.canApply,true);
  assert.equal(r.w.document.querySelector('[data-document-apply]').disabled,false);
  r.click('[data-document-apply]');await until(()=>r.w.document.querySelector('[data-import-status="documents"].has-error'));
  assert.equal(writes,1);assert.equal(r.w.document.querySelector('.motion-import.is-done'),null);
  assert.equal(r.people[0].profile.position,'');
});

test('light theme and motion off keep exact numbers and functional period tabs', async t => {
  const r=await setup(t);r.state.settings.interfaceTheme='light';r.state.settings.interfaceMotion='off';
  await r.evaluate('refresh({analytics:false,duties:false})');await r.page('analytics');
  let animated=0;r.w.HTMLElement.prototype.animate=()=>{animated++;throw Error('Motion must stay off');};
  r.evaluate('LadExperience.beforeRender();LadExperience.afterRender()');
  assert.equal(r.w.document.documentElement.dataset.theme,'light');assert.equal(animated,0);
  assert.equal(r.w.document.querySelector('[data-motion-number="analytics-workedDays"]').textContent,'24');
  await r.page('activity');r.click('[data-activity-period="week"]');
  await until(()=>r.w.document.querySelector('[data-activity-period="week"][aria-pressed="true"]'));
  r.click('[data-activity-view="flags"]');await tick();
  assert.equal(r.w.document.querySelector('[data-activity-view="flags"]').getAttribute('aria-pressed'),'true');
});

test('document read and confirmed save publish success only after committed profile data', async t => {
  const imp=require('../src/shared/document-import');let input,preview,readDone;
  const r=await setup(t,{
    readDocuments:()=>new Promise(resolve=>{readDone=()=>resolve({blocks:[{name:'staff.txt',text:'ПІБ\tПосада\nОлена\tАналітик',ocr:false}],errors:[]});}),
    parseDocuments:async value=>imp.parseBlocks(r.state,value.blocks,value.source,value.shortRule),
    previewDocuments:async value=>{input=value;preview=imp.preview(r.state,value,require('./helpers/renderer.cjs').now);return {...preview,token:'verified'};},
    applyDocuments:async()=>imp.apply(r.state,input,preview.expectedToken,require('./helpers/renderer.cjs').now)
  });
  await r.page('employees');
  const reading=r.evaluate("readDocumentSelection([{name:'staff.txt',size:5,arrayBuffer:async()=>new Uint8Array(5)}])");
  await until(()=>readDone);
  assert.ok(r.w.document.querySelector('#modal-root [data-import-status="documents"] [aria-current="step"]'));
  readDone();await reading;
  r.submit('#document-text-form');await until(()=>r.w.document.querySelector('#document-rows-form'));
  r.submit('#document-rows-form');await until(()=>r.w.document.querySelector('[data-document-apply]:not(:disabled)'));
  r.click('[data-document-apply]');await until(()=>!r.w.document.querySelector('[data-document-apply]'));
  assert.equal(r.state.employees[0].profile.position,'Аналітик');
  assert.match(r.w.document.querySelector('[data-import-status="documents"].is-done').textContent,/Збережено 1/);
});


test('contextual monitor actions remain in their own section when tabs are enhanced', async t => {
  const r=await setup(t);await r.page('activity');
  const section=r.w.document.querySelector('.monitor-content');
  section.insertAdjacentHTML('beforeend','<div data-context-action><button data-activity-view="flags">Перевірити прапорці</button></div>');
  const action=section.querySelector('[data-context-action]');
  r.evaluate('LadExperience.afterRender()');
  assert.equal(action.querySelector('button').parentElement,action);
  assert.equal(r.w.document.querySelector('.monitor-simple-tabs').querySelectorAll('[data-activity-view="flags"]').length,1);
});
