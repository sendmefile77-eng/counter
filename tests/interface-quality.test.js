const test=require('node:test'),assert=require('node:assert/strict');
const {setup,tick,until}=require('./helpers/renderer.cjs'),{fixture}=require('./helpers/interface-fixture.cjs');
test('switching analytics and pane views preserves focus',async t=>{
 const r=await setup(t);await r.page('analytics');let b=r.w.document.querySelector('[data-result-analytics-tab="anomalies"]');b.focus();b.click();await tick();assert.equal(r.w.document.activeElement.dataset.resultAnalyticsTab,'anomalies');
 await r.page('employees');r.click(`[data-employee-profile="${r.people[0].id}"]`);await until(()=>r.w.document.querySelector('[data-pane-view]'));b=r.w.document.querySelector('[data-pane-view="tasks"]');b.focus();b.click();await tick();assert.equal(r.w.document.activeElement.dataset.paneView,'tasks');
});
test('undo and error toasts persist when a dialog opens',async t=>{
 const r=await setup(t);await r.page('journal');const timers=[],original=r.w.setTimeout;r.w.setTimeout=(cb,delay,...args)=>{timers.push(delay);return original(cb,delay,...args);};r.evaluate("showToast('Збережено',{undo:true});showToast('Не вдалося зберегти',{error:true})");assert.equal(timers.includes(5000),false);assert.equal(timers.includes(10000),false);r.click('[data-result-day]');await tick();assert.ok(r.w.document.querySelector('#toast-root [data-toast-undo]'));
});
test('quantity has one native label separate from step controls',async t=>{
 const r=await setup(t);await r.page('journal');r.click('[data-result-day]');await tick();const input=r.w.document.querySelector('.motion-stepper input');assert.equal(input.labels.length,1);assert.equal(input.labels[0].querySelector('button'),null);assert.match(input.labels[0].textContent,/Підсумкова кількість/);
});
test('missing KPI explains the reason and empty tables span the actual columns',async t=>{
 const r=await setup(t,{},fixture('empty'));await r.page('analytics');const table=r.w.document.querySelector('.result-workers');assert.equal(table.querySelector('td').colSpan,table.querySelectorAll('thead th').length);r.click('[data-experience-stat="kpi"]');await tick();const content=r.w.document.querySelector('#modal-root').textContent;assert.doesNotMatch(content,/\/\s*0\s*×/);assert.match(content,/KPI не визначено/);
});
test('tooltip has a mounted description and allows crossing the hover gap',async t=>{
 const r=await setup(t);await r.page('analytics');const owner=r.w.document.querySelector('[data-motion-tip]');assert.equal(owner.hasAttribute('aria-describedby'),false);owner.dispatchEvent(new r.w.MouseEvent('pointerover',{bubbles:true}));const tip=r.w.document.querySelector('.motion-tooltip');assert.equal(owner.getAttribute('aria-describedby'),tip.id);owner.dispatchEvent(new r.w.MouseEvent('pointerout',{bubbles:true,relatedTarget:r.w.document.body}));tip.dispatchEvent(new r.w.MouseEvent('pointerover',{bubbles:true,relatedTarget:owner}));await new Promise(resolve=>setTimeout(resolve,210));assert.ok(tip.isConnected);r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(tip.isConnected,false);assert.equal(owner.hasAttribute('aria-describedby'),false);
});
test('closing a dialog also clears its pinned tooltip',async t=>{
 const r=await setup(t);await r.page('analytics');r.click('[data-experience-stat="kpi"]');await tick();r.click('#modal-root [data-motion-tip]');assert.ok(r.w.document.querySelector('.motion-tooltip'));r.click('[data-close-modal]');await tick();assert.equal(r.w.document.querySelector('.motion-tooltip'),null);
});
test('worst fixture escapes 15 names, retains big counts and pages 1000 tasks',async t=>{
 const r=await setup(t,{},fixture('worst'));await r.page('employees');assert.match(r.w.document.body.textContent,/Олена <тест> & підтримка/);assert.equal(r.w.document.querySelector('тест'),null);r.click(`[data-employee-profile="${r.people[0].id}"]`);await until(()=>r.w.document.querySelector('[data-pane-view]'));r.click('[data-pane-view="tasks"]');await tick();assert.equal(r.w.document.querySelectorAll('.motion-profile-pane .task-row').length,20);assert.match(r.w.document.querySelector('.motion-profile-pane').textContent,/із 1000/);r.click('[data-pane-more]');await tick();assert.equal(r.w.document.querySelectorAll('.motion-profile-pane .task-row').length,40);await r.page('analytics');assert.match(r.w.document.body.textContent,/100[\s\u00a0\u202f]?000/);await r.page('journal');assert.equal(r.w.document.querySelector('.result-calendar').tabIndex,0);await r.page('weekly');assert.ok(r.w.document.querySelector('h1'));await r.page('activity');assert.ok(r.w.document.querySelector('.monitor-content'));
});
test('one person and legacy histories render without inventing completeness',async t=>{
 for(const mode of ['one','legacy']){const r=await setup(t,{},fixture(mode));await r.page('analytics');assert.ok(r.w.document.querySelector('.result-workers'));if(mode==='legacy')assert.match(r.w.document.body.textContent,/Неповна історія/);}
});
test('initials preserve a joined emoji grapheme',async t=>{
 const data=fixture('one');data.people[0].name='👩🏽‍💻 Анна';const r=await setup(t,{},data);await r.page('employees');r.click(`[data-employee-profile="${r.people[0].id}"]`);await until(()=>r.w.document.querySelector('.motion-avatar'));assert.equal(r.w.document.querySelector('.motion-avatar').textContent,'👩🏽‍💻А');
});
test('a failed activity report can retry the selected period',async t=>{
 const activity=require('../src/shared/activity'),data=fixture('one');let first=true;const r=await setup(t,{getActivityReport:async f=>{if(first){first=false;throw Error('Тестова помилка');}return activity.screenReport(data.state,f,data.now);}},data);await r.page('activity');assert.match(r.w.document.querySelector('.monitor-error').textContent,/Тестова помилка/);r.click('[data-activity-retry]');await until(()=>!r.w.document.querySelector('.monitor-error'));assert.equal(r.calls.filter(c=>c.name==='getActivityReport').length,2);
});
test('unchanged charts do not redraw and off mode schedules no animation',async t=>{
 const r=await setup(t),motions=[];r.w.HTMLElement.prototype.animate=r.w.SVGElement.prototype.animate=function(frames,options){motions.push({el:this,frames,options});return {finished:Promise.resolve(),cancel(){}};};r.w.SVGElement.prototype.getTotalLength=()=>100;await r.page('analytics');assert.equal(motions.filter(m=>m.el.matches('[data-motion-chart]')).length,3);motions.length=0;r.evaluate('renderShell()');assert.equal(motions.filter(m=>m.el.matches('[data-motion-chart]')).length,0);r.w.document.documentElement.dataset.motion='off';motions.length=0;r.click('[data-sidebar-toggle]');await tick();assert.equal(motions.length,0);
});
test('control boundary token contrast exceeds 3:1 in both themes',()=>{
 const lum=h=>h.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);const contrast=(a,b)=>{a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/renderer/quality.css'),'utf8');for(const [border,field,panel] of [['6b87a4','0e1926','162334'],['7a8ca3','ffffff','f5f7fb']]){assert.ok(css.includes('#'+border));assert.ok(contrast(border,field)>=3);assert.ok(contrast(border,panel)>=3);}
});
