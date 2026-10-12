'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {app}=require('electron');
const {DataStore}=require('./store');
const {createTrainingState}=require('../shared/training');
const options=require('./runtime-options');
// Synthetic SQLite ZIP: two Chrome visits, one Firefox visit (WAL header), one empty profile.
const sqliteZipFixture='UEsDBBQAAAgIAAAAAADpuXeVjAEAAAAwAAAgAAAAUEMtU0VMRiBDaHJvbWUgaGlzdG9yeS9hX0hpc3Rvcnnt17tKw1AcBvD/SaWXwUbQUorLGRWKQZ1UBKsEKa2iNaBOEm3EQHoxORF1axF9gOLm4uIbCHVwcnQ5HXyAzr6ENMFLHbxMgnw/SMj5OH/4yJnOxnrRFhbfr7kVU/BpGiLGaIFzIooSUYTeKUQ08GHN6HtRmrh8HOwNJ7ukniW7P5gBAAAAAAAA+L0GV2LpTIY1R4W561hHtmcLL3xHlkp6ztC5kVss6jzMxuwyz68a+rJe4mul/EqutM0L+nbWd53XPBvs3BF2xfoUlX3XFHat+hYL16x6dl+079YqO8H212j8lMXSqRRrbAYNfdfxeo/S166XfNXN0LeMrLCFY4WfYaG9ml8V721O6la5PxsP7ubqOakP6vlfHxUAAAAAAADA/zanRGmmkIgfCFH3ZjXNOjYrdceaEJYntCl5LdvyvtOUt52mbHcu5L1syzseBI1Oc459MTz5zXB4/38i9Vl9+uu/AAAAAAAAAAC/MKLEiEUH4nGFtBu/6kuKtC5omMUo0UtJuzmcb10F4QtQSwMEFAAACAgAAAAAACl4DMZuAQAAADAAACEAAABQQy1TRUxGIEZpcmVmb3ggaGlzdG9yeS9iX0hpc3Rvcnnt179OwkAcB/Bfi6kwAG6sxyYJoTFO6iKahhDQaG2iTKRCCU1a29BDxY0uPoEPwEOY4MBEmFjK7EvwCAaI1Ij/BhOW72f63ffau9/lprs4L5vcYA2nZeuc7dIWiSIdMkZEIhFFKDQbb3wYC/Q7kXJP4/isSIwoeZcY/eEfAAAAAAAAgK91ZXEzJcuCH+f6tWXYzkO1aXrcaXVuTc/k3koQOVaVvKYwLX9UVtjK9LZZZ8VTTSkoKjtTiyd5tcJKSiXrWnrNqIaT2fnn1brOjU8R77hh1Gg5dnWev0eZriRsptJpoXu57Hi+uBdW4kqPi/y75toti2nKlZblJreMRblopua0b5ZbZ2etLVfIzN7mQnJIyeG6LxEAAAAAAAAAfnAgSLRXikWbnLveviwb97rtWkaOGx6Xd4Je0A8GEz94nvhBf/IYDIJ+8MLmQXfiL97/U0pO130MAAAAAAAAAPgvCUGimBSLklR4HfeI3gBQSwMEFAAACAgAAAAAAAe+5aYSAQAAADAAACQAAABQQy1TRUxGIENocm9tZSBoaXN0b3J5L2VtcHR5X0hpc3Rvcnnt101KAzEcBfB/pkJX1m5KKW6ybGFw4wUcJUixio4B7aqMTgqB+ZBMRtBdxSt4Kk/Rm0hmaOu48GMhgrwfJCSPBB5klcuLibaKz3OTRpbvU5cYowPOicgjohZtuP3Wuz2jr3m09/K67RadJe08d5bfuAMAAAAAAADwcwvutfuDAXvatdFNou51oW1Rz62jUARScBkcTgSvs6GO+fhMimMR8vNwfBqEU34ipn5pklXuVydnVqfqQxSXJrI6z9axNVFW6EY0N3k6q46votEja/d7Pba4qhqWJinc8BrtXPJZNymupW+1TVS9rAvd5mVmN20e7lTczEbub07dv34kAAAAAAAAAPhN+P8DAAAAAAAA/H9vUEsBAhQAFAAACAgAAAAAAOm5d5WMAQAAADAAACAAAAAAAAAAAAAAAAAAAAAAAFBDLVNFTEYgQ2hyb21lIGhpc3RvcnkvYV9IaXN0b3J5UEsBAhQAFAAACAgAAAAAACl4DMZuAQAAADAAACEAAAAAAAAAAAAAAAAAygEAAFBDLVNFTEYgRmlyZWZveCBoaXN0b3J5L2JfSGlzdG9yeVBLAQIUABQAAAgIAAAAAAAHvuWmEgEAAAAwAAAkAAAAAAAAAAAAAAAAAHcDAABQQy1TRUxGIENocm9tZSBoaXN0b3J5L2VtcHR5X0hpc3RvcnlQSwUGAAAAAAMAAwDvAAAAywQAAAAA';
async function waitFor(check,timeout=20000) {
  const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Не отримано очікуваний стан вікна ЛАД.');
}
async function run(reportPath) {
  const report={version:app.getVersion(),platform:process.platform,startedAt:new Date().toISOString(),status:'running',checks:[],manualChecks:['native-file-picker','notification-delivery','second-launch','visual-inspection','tray-hide-show-exit','global-shortcut-and-collision','widget-edge-snap-and-lock']};
  let directory=null,timer,finished=false;
  const finish=(error)=>{
    if(finished)return;finished=true;
    clearTimeout(timer);report.finishedAt=new Date().toISOString();report.status=error?'failed':'passed';if(error)report.error=error.stack || String(error);
    try{fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));}catch(writeError){console.error(writeError);app.exit(1);return;}
    if(directory){try{fs.rmSync(directory,{recursive:true,force:true});}catch(_error){/* Windows may keep the isolated Electron profile open until exit. */}}
    app.exit(error?1:0);
  };
  try {
    if(!path.isAbsolute(reportPath))throw new Error('Для звіту самоперевірки потрібен абсолютний шлях.');
    directory=fs.mkdtempSync(path.join(os.tmpdir(),'lad-packaged-test-'));
    report.temporaryDirectory=directory;
    const userData=path.join(directory,'electron');fs.mkdirSync(userData);app.setPath('userData',userData);
    options.selfTestDirectory=path.join(directory,'Counter-data');
    const seed=createTrainingState(),seedStore=new DataStore(options.selfTestDirectory);seedStore.state=seed.state;seedStore.save();
    timer=setTimeout(()=>finish(new Error('Самоперевірка не завершилася за 90 секунд.')),90000);
    const main=require('./main');await app.whenReady();await waitFor(()=>Boolean(main.getMainWindow()));
    const window=main.getMainWindow();await waitFor(()=>window.webContents.executeJavaScript('Boolean(document.querySelector(".widget-circle"))'));
    report.checks.push('packaged-startup-and-production-preload');
    const result=await window.webContents.executeJavaScript(`(async()=>{
      const checks=[],scenario=${JSON.stringify(seed.scenario)},api=window.counter;
      await api.setWindowMode('dashboard');ui.mode='dashboard';renderShell();
      const before=await api.getSnapshot(),scheduleId=before.activeDutyScheduleId;
      const report=await api.getDutyReplacements({scheduleId,date:scenario.date,employeeId:scenario.employeeId});
      const swap=report.plans.find(plan=>plan.kind==='swap'&&plan.candidateId===scenario.candidateId);if(!swap)throw Error('Не знайдено допустимого обміну.');
      await api.applyDutyReplacement({query:report.query,expectedToken:report.token,proposalId:swap.id,reason:'Самоперевірка: погоджений обмін',acknowledgeWarnings:true});
      let saved=await api.getSnapshot();if(saved.duties.assignments[scenario.date].employeeIds[0]!==scenario.candidateId||saved.duties.assignments[scenario.swapDate].employeeIds[0]!==scenario.employeeId)throw Error('Обмін не застосовано до обох дат.');
      checks.push('production-ipc-atomic-swap-and-reason');
      await openDutyDayModal(scenario.date);if(!document.querySelector('.replacement-proof'))throw Error('Немає збереженого пояснення в UI.');closeModal();checks.push('saved-explanation-in-renderer');
      await api.undo();saved=await api.getSnapshot();if(saved.duties.assignments[scenario.date].employeeIds[0]!==scenario.employeeId)throw Error('Не скасовано обмін.');checks.push('production-ipc-undo');
      const presence=await api.previewPresence({employeeIds:[scenario.employeeId],startDate:scenario.date,status:'zkp',reason:'Самоперевірка ЗКП'});
      await api.applyPresence({change:presence.change,expectedToken:presence.token});saved=await api.getSnapshot();if(saved.presenceRecords[scenario.employeeId+'|'+scenario.date].status!=='zkp'||!saved.duties.assignments[scenario.date].employeeIds.includes(scenario.employeeId))throw Error('ЗКП змінив доступність для чергування.');
      await navigateToTab('presence');if(!document.querySelector('.presence-table'))throw Error('Не відкрито «Наявність».');
      const sick=await api.previewPresence({employeeIds:[scenario.employeeId],startDate:scenario.date,status:'sick',reason:'Самоперевірка пріоритету наявності'});if(!sick.duties.length||!sick.tasks.length)throw Error('Наявність не врахувала графік або завдання.');
      await api.applyPresence({change:sick.change,expectedToken:sick.token});saved=await api.getSnapshot();if(saved.duties.assignments[scenario.date].employeeIds.includes(scenario.employeeId)||LadWork.recordForDay(saved,scenario.employeeId,scenario.date).status!=='sick')throw Error('Відсутність не стала головною позначкою.');
      await api.undo();await api.undo();checks.push('presence-zkp-absence-priority-and-atomic-undo');
      const change=await api.previewStaffChange({employeeId:scenario.employeeId,startDate:scenario.date,status:'sick',reason:'Самоперевірка лікарняного'});if(change.tasks.length!==1)throw Error('Не знайдено зачеплене завдання.');
      await api.applyStaffChange({change:change.change,expectedToken:change.token});saved=await api.getSnapshot();if(!saved.consequences.issues.some(issue=>issue.kind==='vacancy'))throw Error('Не показано вільне місце.');await api.undo();checks.push('availability-and-consequences');
      const batch={cells:[{employeeId:scenario.employeeId,date:scenario.date}],action:'status',status:'vacation',note:'Самоперевірка масового табеля',includeWeekends:true,replaceExisting:true};
      const preview=await api.previewJournalBatch(batch);if(!preview.canApply||!preview.duties.length)throw Error('Немає спільної перевірки табеля.');await api.applyJournalBatch({...batch,expectedToken:preview.token});await api.undo();checks.push('unified-journal-availability-and-undo');
      await startLadGuide('tour');if(!document.querySelector('.guide-card'))throw Error('Навчання не відкривається.');await finishLadGuide();checks.push('guided-onboarding');
      await navigateToTab('employees');let input=document.querySelector('#employee-form [name="name"]');input.value='Незбережена чернетка';input.focus();input.setSelectionRange(3,8);await refresh();input=document.querySelector('#employee-form [name="name"]');if(input.value!=='Незбережена чернетка'||document.activeElement!==input||input.selectionStart!==3||input.selectionEnd!==8)throw Error('Фонове оновлення втратило чернетку або курсор.');input.value='';checks.push('page-draft-and-caret-preservation');
      openQuickSearch();const footer=document.querySelector('.modal-foot').getBoundingClientRect(),dialog=document.querySelector('.modal').getBoundingClientRect();if(footer.bottom>dialog.bottom+1||footer.bottom>innerHeight)throw Error('Нижню підказку пошуку обрізано.');closeModal();checks.push('quick-search-footer-layout');
      await navigateToTab('draws');const countBefore=snapshot.draws.length,drawForm=document.querySelector('#draw-form');drawForm.elements.title.value='Самоперевірка сірників';await handleDrawSubmit({target:drawForm});const drawId=drawUi.resultId,protocol=JSON.stringify(drawById(drawId));if(!drawId||(await api.getSnapshot()).draws.length!==countBefore+1)throw Error('Протокол не збережено до показу.');if(drawUi.reveal)await handleDrawClick({target:document.querySelector('[data-draw-reveal-skip]')});if(drawUi.busy||drawUi.reveal||!document.querySelector('.draw-result')||JSON.stringify((await api.getSnapshot()).draws.find(item=>item.id===drawId))!==protocol)throw Error('Пропуск показу змінив або приховав результат.');checks.push('saved-draw-and-animation-skip');
      const workBefore=(await api.getSnapshot()).workEntries.length,today=localDateKey();
      let work=await api.createWork({employeeId:scenario.employeeId,title:'Самоперевірка обліку роботи',projectCount:5,startDate:today,estimatedEndDate:LadWork.addDays(today,7)});
      work=await api.updateWorkProgress(work.id,{completedProjects:2,expectedRevision:work.revision});
      work=await api.updateWork(work.id,{...work,estimatedEndDate:LadWork.addDays(today,10),reason:'Складні проєкти',expectedRevision:work.revision});
      work=await api.finishWork(work.id,{status:'done',finishedDate:today,expectedRevision:work.revision});
      if(work.completedProjects!==5||work.history.length!==4||work.status!=='done')throw Error('Облік роботи не зберіг прогрес, пояснення та завершення.');
      const workReport=await api.getAnalyticsReport({startDate:today,endDate:today,scope:'all'});if(workReport.total.projectsCompleted<5)throw Error('Завершені проєкти не потрапили до статистики.');
      for(let undo=0;undo<4;undo++)await api.undo();if((await api.getSnapshot()).workEntries.length!==workBefore)throw Error('Облік роботи не скасовано.');checks.push('work-through-preload-progress-reason-completion-analytics-undo');
      const intakeBefore=JSON.stringify((await api.getSnapshot()).workIntakes);
      await api.savePresence({employeeId:scenario.employeeId,date:today,status:'onsite'});
      for(let click=0;click<3;click++)await api.receiveWorkObjects({id:crypto.randomUUID(),employeeId:scenario.employeeId,date:today,objectCount:1});
      const intakeSaved=await api.getSnapshot();if(LadWork.intakeSummary(intakeSaved,scenario.employeeId,today).objectCount!==3||!LadWork.confirmed.has(intakeSaved.records[scenario.employeeId+'|'+today]?.status))throw Error('Віджет не зберіг кількість об’єктів і закритий день.');
      for(let undo=0;undo<4;undo++)await api.undo();if(JSON.stringify((await api.getSnapshot()).workIntakes)!==intakeBefore)throw Error('Скасування не відновило облік об’єктів.');checks.push('widget-objects-through-preload-quantity-day-and-undo');
      const widgetSettings=(await api.getSnapshot()).settings;
      await api.updateWidgetPreferences({widgetShape:'panel',widgetMode:'tasks',widgetLocked:true});await api.setWindowMode('widget');ui.mode='widget';await refresh();
      if(!document.querySelector('.widget-panel')||!document.querySelector('[data-widget-mode="tasks"][aria-pressed="true"]')||document.querySelector('[data-widget-resize]')||await api.resizeWidget(500,true)!==null)throw Error('Налаштування панелі або фіксація не працюють.');
      await api.updateWidgetPreferences({widgetShape:widgetSettings.widgetShape,widgetMode:widgetSettings.widgetMode,widgetLocked:widgetSettings.widgetLocked});
      await api.setWindowMode('dashboard');ui.mode='dashboard';await refresh();checks.push('native-panel-persistent-mode-and-resize-lock');
      const activityBefore=JSON.stringify((await api.getSnapshot()).activity);
      const history='URL,Title,Visit Time,Visit Duration,Web Browser,Browser Profile,Record ID\\r\\nhttps://example.test/,Самоперевірка,04.09.2026 09:00:00,00:15:00,Chrome,PC-TEST Chrome history,1\\r\\nhttps://example.test/two,Самоперевірка,04.09.2026 14:00:00,,Firefox,PC-TEST Firefox history,2';
      const file={name:'activity-self-test.csv',bytes:new TextEncoder().encode(history)};
      const activityPreview=await api.previewActivityImport([file,{...file,name:'renamed.csv'}]);
      if(activityPreview.newCount!==2||!activityPreview.files[1].duplicateFile)throw Error('Повтор CSV не розпізнано.');
      const assignments=Object.fromEntries(activityPreview.sources.map(source=>[source.id,scenario.employeeId]));
      await api.importActivity({token:activityPreview.token,assignments});
      const activityReport=await api.getActivityReport({startDate:'2026-09-04',endDate:'2026-09-04'});
      if(activityReport.journal.length!==2||activityReport.rows[0].expectedMs!==480*60000||activityReport.rows[0].missingCount!==1)throw Error('Моніторинг через preload не узгоджений.');
      await navigateToTab('activity');activityUi.view='days';renderShell();if(!document.querySelector('[data-activity-drop]')||!document.querySelector('.activity-table'))throw Error('Екран моніторингу не відкрився.');
      const activityDetail=await api.getActivityDay({date:'2026-09-04',groupKey:scenario.employeeId});if(activityDetail.journal.length!==2)throw Error('Деталі дня не знайдено.');
      await api.setActivityCategory({domain:'example.test',employeeId:scenario.employeeId,category:'personal'});
      const personalReport=await api.getActivityReport({startDate:'2026-09-04',endDate:'2026-09-04',employeeId:scenario.employeeId,includeAnalytics:true});
      if(personalReport.analysis.people[0].summary.personalMs!==16*60000||personalReport.folders.find(folder=>folder.employeeId===scenario.employeeId).fileCount!==1)throw Error('Особиста статистика або папка працівника не узгоджені.');
      await api.undo();
      await api.undo();await refresh();if(JSON.stringify((await api.getSnapshot()).activity)!==activityBefore)throw Error('Імпорт активності не скасовано.');
      checks.push('activity-multiple-csv-through-production-preload-dedup-report-render-and-undo');
      checks.push('activity-employee-folder-categories-personal-statistics-and-undo');
      const zipFile={name:'activity-self-test.zip',bytes:Uint8Array.from(atob(${JSON.stringify(sqliteZipFixture)}),char=>char.charCodeAt(0))};
      const zipPreview=await api.previewActivityImport([zipFile]);
      if(zipPreview.newCount!==3||zipPreview.sources.length!==2||zipPreview.files[0].databases.filter(db=>db.status==='empty').length!==1)throw Error('SQLite ZIP у зібраній програмі не прочитано.');
      await api.importActivity({token:zipPreview.token,assignments:Object.fromEntries(zipPreview.sources.map(source=>[source.id,scenario.employeeId]))});
      const zipReport=await api.getActivityReport({startDate:'2026-01-08',endDate:'2026-01-08'});
      if(zipReport.journal.length!==3||zipReport.rows[0].first!=='09:00:00'||zipReport.rows[0].missingCount!==1)throw Error('SQLite час Києва або тривалість Firefox не узгоджені.');
      const zipRepeat=await api.previewActivityImport([{...zipFile,name:'renamed.zip'}]);if(zipRepeat.newCount||!zipRepeat.files[0].duplicateFile)throw Error('Повтор ZIP не розпізнано.');
      await api.undo();await refresh();if(JSON.stringify((await api.getSnapshot()).activity)!==activityBefore)throw Error('Імпорт ZIP не скасовано.');
      checks.push('activity-sqlite-zip-worker-kyiv-firefox-empty-profile-dedup-and-undo');
      return checks;
    })()`);
    report.checks.push(...result);
    const original=main.getStore(),bytes=fs.readFileSync(original.filePath,'utf8');
    await window.webContents.executeJavaScript('(async()=>{await startLadGuide("practice");if(!snapshot.training?.active)throw Error("Навчальна база не відкрилася");await finishLadGuide();if(snapshot.training?.active)throw Error("Навчальна база не закрилася");})()');
    assert.equal(fs.readFileSync(original.filePath,'utf8'),bytes);report.checks.push('training-isolation-and-return');
    await window.webContents.executeJavaScript(`(async()=>{
      const api=window.counter,settings=(await api.getSnapshot()).settings;
      await api.updateSettings({confirmDestructiveActions:false});
      try {
        await navigateToTab('data');
        const copy=await api.getSnapshot(),id=copy.employees[0].id;
        copy.employees[0].name='Самоперевірка імпорту файла';
        await importBackupFiles([new File([JSON.stringify(copy)],'self-test.json',{type:'application/json'})]);
        const saved=await api.getSnapshot();
        if(ui.dataImportPending||ui.dataImportError||saved.employees.find(person=>person.id===id)?.name!==copy.employees[0].name)throw Error('Файловий імпорт через preload не завершився.');
        await api.undo();await refresh();
        if(snapshot.employees.find(person=>person.id===id)?.name===copy.employees[0].name)throw Error('Імпорт файла не скасовано.');
      } finally { await api.updateSettings({confirmDestructiveActions:settings.confirmDestructiveActions}); }
    })()`);
    report.checks.push('selected-file-import-through-preload-and-undo');
    const restored=new DataStore(options.selfTestDirectory);restored.load();assert.deepEqual(restored.state.duties.assignments,original.state.duties.assignments);report.checks.push('database-reload');
    const reportVersion=await window.webContents.executeJavaScript('snapshot.appVersion');assert.equal(reportVersion,app.getVersion());report.checks.push('packaged-version');
    finish();
  }catch(error){finish(error);}
}
module.exports={run};
