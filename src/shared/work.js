(function installWork(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('node:crypto') : root.crypto,
    typeof module === 'object' && module.exports ? require('./presence') : root.LadPresence);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.LadWork = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function workFactory(crypto, presence) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const absence = presence.absent;
  const confirmed = new Set(['submitted','submitted_late','submitted_advance']);
  const labels = {...presence.labels,zkp:'ЗКП · очікує здачі роботи',working:'У роботі',planned_work:'Запланована робота',submitted:'Відпрацьовано',
    submitted_late:'Роботу зараховано',submitted_advance:'Раніше зараховано',pending:'Без позначки',
    missed:'Роботу не позначено',other_tasks:'Інша робота',personal_permission:'Особисті справи',
    sick:'Лікарняний',vacation:'Відпустка',day_off:'Відгул',holiday:'Неробочий день',weekend:'Вихідний',outside:'Поза періодом роботи'};
  const metricLabels = {calendarWorkdays:'Робочі дні',workedDays:'Дні роботи',workingDays:'У роботі',confirmedDays:'Відпрацьовано',
    otherTasks:'Інша робота',onsiteDays:'На роботі',zkpDays:'Дні на ЗКП',zkpPendingDays:'ЗКП · очікує здачі',trainingDays:'Дні навчання',arkanDays:'Дні на Аркані',missed:'Роботу не позначено',pending:'Без позначки',absent:'Відсутність',
    projectsStarted:'Призначено проєктів',projectsCompleted:'Проєкти у завершених роботах',coveragePercent:'Дні з обліком роботи',openProjects:'Проєктів залишилося зараз',dueForReview:'Перевірити строк зараз'};
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
  const dateKey = (now = new Date()) => [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  const addDays = (date, number) => {const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+number);return value.toISOString().slice(0,10);};
  function dates(from, to) {
    if (!validDate(from)||!validDate(to)||from>to) throw Error('Вкажіть коректний період роботи.');
    const length=Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000)+1;
    if(length>3660)throw Error('Період має містити не більше 3660 днів.');
    return Array.from({length},(_,i)=>addDays(from,i));
  }
  function activeOn(person,date) {
    return person.activePeriods?.length ? person.activePeriods.some(p=>date>=p.start&&(!p.end||date<p.end))
      : date>=person.createdDate&&(!person.archivedDate||date<person.archivedDate);
  }
  function trackableOn(person,date) {return activeOn(person,date)||date<person.createdDate;}
  function isWorkday(state,id,date) {
    const explicit=state.presenceRecords?.[id+'|'+date];
    if(explicit?.status==='weekend')return false;
    if(explicit&&(presence.working.has(explicit.status)||presence.learning.has(explicit.status)))return true;
    return state.settings.workdays.includes(new Date(date+'T12:00:00Z').getUTCDay())||Boolean(state.workdayOverrides?.[id+'|'+date]);
  }
  function workForDay(state,id,date,today=dateKey()) {
    const person=state.employees.find(p=>p.id===id);
    if(!person||!trackableOn(person,date)||!isWorkday(state,id,date))return [];
    return (state.workEntries||[]).filter(entry=>entry.employeeId===id&&entry.startDate<=date
      && (!entry.finishedDate||date<=entry.finishedDate));
  }
  function recordForDay(state,id,date,today=dateKey()) {
    const mark=presence.get(state,id,date);
    const person=state.employees.find(person=>person.id===id);
    const existing=state.records[id+'|'+date];
    if(mark&&mark.source!=='calendar_presence'&&person&&trackableOn(person,date)) {
      const accepted=confirmed.has(existing?.status)&&date<=today;
      const acceptedOn=existing?.recordedAt?dateKey(new Date(existing.recordedAt)):null;
      if(accepted&&(mark.status==='onsite'||mark.status==='zkp'&&acceptedOn>date&&acceptedOn<=today))
        return {...existing,presenceStatus:mark.status,presenceNote:mark.note};
      return {...mark,presenceStatus:mark.status,receiptId:mark.source==='presence'?null:mark.receiptId||null};
    }
    if(existing&&existing.source!=='automatic_close')return existing;
    const entries=workForDay(state,id,date,today);
    if(!entries.length)return existing||null;
    return {employeeId:id,date,status:date>today?'planned_work':entries.every(entry=>entry.status==='done')?'submitted':'working',
      source:'work',workEntryIds:entries.map(entry=>entry.id),note:entries.map(entry=>entry.title).join(' · '),receiptId:null};
  }
  function statusForDay(state,id,date,today=dateKey()) {
    const person=state.employees.find(p=>p.id===id),record=recordForDay(state,id,date,today);
    if(!person||(!activeOn(person,date)&&!record))return 'outside';
    if(!isWorkday(state,id,date))return 'weekend';
    return record?.status||'pending';
  }
  function estimatedEnd(state,id,start,count) {
    if(!validDate(start)||!Number.isInteger(count)||count<1||count>1000)throw Error('Орієнтир: від 1 до 1000 робочих днів.');
    let cursor=start,remaining=count;
    for(let inspected=0;inspected<3660;inspected++,cursor=addDays(cursor,1)) {
      if(isWorkday(state,id,cursor)&&!absence.has(presence.get(state,id,cursor)?.status)&&!--remaining)return cursor;
    }
    throw Error('Не вдалося визначити орієнтовний строк.');
  }
  function clean(state,input,previous=null) {
    const person=state.employees.find(p=>p.id===input.employeeId);
    if(!person||(!person.active&&!previous))throw Error('Оберіть активного працівника.');
    if(previous&&previous.employeeId!==person.id)throw Error('Для іншого працівника створіть окрему роботу.');
    const title=String(input.title||'').trim(),projectCount=Number(input.projectCount);
    if(title.length<2||title.length>160)throw Error('Опис роботи: від 2 до 160 символів.');
    if(!Number.isInteger(projectCount)||projectCount<1||projectCount>1000)throw Error('Кількість проєктів: від 1 до 1000.');
    if(!validDate(input.startDate)||!validDate(input.estimatedEndDate)||input.startDate>input.estimatedEndDate)throw Error('Орієнтовний строк має бути не раніше початку роботи.');
    dates(input.startDate,input.estimatedEndDate);
    if(!trackableOn(person,input.startDate))throw Error('Початок не входить до періоду роботи працівника.');
    if(previous&&projectCount<previous.completedProjects)throw Error('Проєктів не може бути менше, ніж уже виконано.');
    if(previous?.finishedDate&&input.startDate>previous.finishedDate)throw Error('Початок не може бути пізніше завершення.');
    return {employeeId:person.id,title,projectCount,startDate:input.startDate,estimatedEndDate:input.estimatedEndDate,note:String(input.note||'').trim().slice(0,1000)};
  }
  function validHistory(item) {
    if(!item||typeof item.id!=='string'||!item.id||typeof item.at!=='string'||!Number.isFinite(Date.parse(item.at))||typeof item.actor!=='string'||!validDate(item.date)||!item.details||typeof item.details!=='object'||Array.isArray(item.details))return false;
    const details=item.details,quantity=value=>Number.isInteger(value)&&value>=0&&value<=1000;
    if(details.reason!=null&&typeof details.reason!=='string')return false;
    if(item.type==='created')return typeof details.title==='string'&&quantity(details.projectCount)&&details.projectCount>0&&validDate(details.estimatedEndDate);
    if(item.type==='progress')return quantity(details.before)&&quantity(details.after)&&(details.after>=details.before||Boolean(details.reason?.trim()));
    if(['done','cancelled'].includes(item.type))return validDate(details.finishedDate)&&quantity(details.completedProjects)&&(item.type!=='cancelled'||Boolean(details.reason?.trim()));
    if(item.type!=='updated'||!details.changes||typeof details.changes!=='object'||Array.isArray(details.changes))return false;
    return Object.entries(details.changes).every(([key,change])=>change&&typeof change==='object'&&!Array.isArray(change)&&['before','after'].every(side=>
      key==='projectCount'?quantity(change[side])&&change[side]>0:['startDate','estimatedEndDate'].includes(key)?validDate(change[side]):['title','note'].includes(key)&&typeof change[side]==='string')
      &&(!['projectCount','startDate','estimatedEndDate'].includes(key)||Boolean(details.reason?.trim())));
  }
  function normalize(input,state) {
    if(input==null)return [];
    if(!Array.isArray(input))throw Error('Некоректний розділ обліку роботи.');
    const ids=new Set();
    return input.map(entry=>{
      if(!entry||typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||!['active','done','cancelled'].includes(entry.status))throw Error('Некоректний або дубльований запис роботи.');
      ids.add(entry.id);
      const data=clean(state,entry,entry),completedProjects=Number(entry.completedProjects);
      if(!Number.isInteger(completedProjects)||completedProjects<0||completedProjects>data.projectCount)throw Error('Некоректний прогрес роботи.');
      if(entry.status==='done'&&completedProjects!==data.projectCount)throw Error('Завершена робота містить невиконані проєкти.');
      if((entry.status==='active'&&entry.finishedDate)||entry.status!=='active'&&(!validDate(entry.finishedDate)||entry.finishedDate<data.startDate))throw Error('Некоректна дата завершення роботи.');
      if(!Number.isInteger(entry.revision)||entry.revision<1||!Array.isArray(entry.history)||!entry.history.length
        ||!['createdAt','updatedAt'].every(key=>typeof entry[key]==='string'&&Number.isFinite(Date.parse(entry[key])))
        ||entry.revision!==entry.history.length||new Set(entry.history.map(item=>item?.id)).size!==entry.history.length||entry.history.some(item=>!validHistory(item)))throw Error('Некоректна історія роботи.');
      return {...data,id:entry.id,status:entry.status,completedProjects,finishedDate:entry.finishedDate||null,createdAt:entry.createdAt,updatedAt:entry.updatedAt,
        revision:Number.isInteger(entry.revision)&&entry.revision>=0?entry.revision:0,history:Array.isArray(entry.history)?clone(entry.history):[]};
    });
  }
  function event(state,entry,type,details,now) {
    const item={id:crypto.randomUUID(),at:now.toISOString(),date:dateKey(now),actor:state.settings.operatorName||'Керівник',type,details:clone(details)};
    entry.history.push(item);entry.updatedAt=item.at;entry.revision++;
    state.audit.push({id:item.id,at:item.at,action:'work_'+type,details:{workId:entry.id,employeeId:entry.employeeId,...clone(details)}});
    state.audit=state.audit.slice(-5000);
  }
  function get(state,id,input) {
    const entry=(state.workEntries||[]).find(entry=>entry.id===id);
    if(!entry)throw Error('Роботу не знайдено. Оновіть список.');
    if(input&&(!Number.isInteger(input.expectedRevision)||input.expectedRevision!==entry.revision))throw Error('Роботу вже змінено. Відкрийте її повторно.');
    return entry;
  }
  function create(state,input,now=new Date()) {
    if(absence.has(presence.get(state,input.employeeId,input.startDate)?.status))throw Error('На дату початку працівник відсутній. Перевірте «Наявність» або оберіть іншу дату.');
    const entry={...clean(state,input),id:crypto.randomUUID(),status:'active',completedProjects:0,finishedDate:null,createdAt:now.toISOString(),updatedAt:now.toISOString(),revision:0,history:[]};
    state.workEntries||=[];state.workEntries.push(entry);event(state,entry,'created',{title:entry.title,projectCount:entry.projectCount,estimatedEndDate:entry.estimatedEndDate},now);return entry;
  }
  function update(state,id,input,now=new Date()) {
    const entry=get(state,id,input);
    if(entry.status!=='active')throw Error('Змінювати можна лише активну роботу.');
    const next=clean(state,input,entry),reason=String(input.reason||'').trim().slice(0,500);
    if((next.estimatedEndDate!==entry.estimatedEndDate||next.startDate!==entry.startDate||next.projectCount!==entry.projectCount)&&!reason)throw Error('Поясніть зміну строку або обсягу роботи.');
    if(next.startDate!==entry.startDate&&absence.has(presence.get(state,entry.employeeId,next.startDate)?.status))throw Error('На нову дату початку працівник відсутній. Перевірте «Наявність» або оберіть іншу дату.');
    const changes=Object.fromEntries(Object.keys(next).filter(key=>next[key]!==entry[key]).map(key=>[key,{before:entry[key],after:next[key]}]));
    if(!Object.keys(changes).length)return entry;
    Object.assign(entry,next);event(state,entry,'updated',{changes,reason},now);return entry;
  }
  function progress(state,id,input,now=new Date()) {
    const entry=get(state,id,input),count=Number(input.completedProjects),reason=String(input.reason||'').trim().slice(0,500);
    if(entry.status!=='active')throw Error('Роботу вже завершено або скасовано.');
    if(entry.startDate>dateKey(now))throw Error('Робота ще не почалася.');
    if(!Number.isInteger(count)||count<0||count>entry.projectCount)throw Error('Вкажіть виконану кількість у межах обсягу роботи.');
    if(count<entry.completedProjects&&!reason)throw Error('Поясніть виправлення прогресу.');
    if(count===entry.completedProjects)return entry;
    const before=entry.completedProjects;entry.completedProjects=count;event(state,entry,'progress',{before,after:count,reason},now);return entry;
  }
  function finish(state,id,input,now=new Date()) {
    const entry=get(state,id,input),status=input.status,finishedDate=input.finishedDate||dateKey(now),reason=String(input.reason||'').trim().slice(0,500);
    if(entry.status!=='active')throw Error('Роботу вже завершено або скасовано.');
    if(!['done','cancelled'].includes(status)||!validDate(finishedDate)||finishedDate<entry.startDate||finishedDate>dateKey(now))throw Error('Вкажіть фактичну дату завершення до сьогодні включно.');
    if(status==='cancelled'&&!reason)throw Error('Поясніть скасування роботи.');
    entry.status=status;entry.finishedDate=finishedDate;if(status==='done')entry.completedProjects=entry.projectCount;
    event(state,entry,status,{finishedDate,completedProjects:entry.completedProjects,reason},now);return entry;
  }
  function blank() {return Object.fromEntries(['calendarWorkdays','workedDays','workingDays','confirmedDays','onsiteDays','zkpDays','zkpPendingDays','trainingDays','arkanDays','otherTasks','missed','pending','absent','projectsStarted','projectsCompleted'].map(key=>[key,0]));}
  function finalize(row) {const expected=row.calendarWorkdays-row.absent-row.trainingDays;row.coveragePercent=expected?Math.round(row.workedDays*1000/expected)/10:null;return row;}
  function addFact(row,fact) {
    row.calendarWorkdays++;
    if(confirmed.has(fact.status)){row.confirmedDays++;row.workedDays++;}
    if(fact.status==='working'){row.workingDays++;row.workedDays++;}
    if(fact.status==='onsite'||fact.status==='arkan')row.workedDays++;
    if(fact.status==='arkan')row.arkanDays++;
    if((fact.presenceStatus||fact.status)==='onsite')row.onsiteDays++;
    if((fact.presenceStatus||fact.status)==='zkp'){row.zkpDays++;if(!confirmed.has(fact.status))row.zkpPendingDays++;}
    if(presence.learning.has(fact.status))row.trainingDays++;
    if(fact.status==='other_tasks'){row.otherTasks++;row.workedDays++;}
    if(absence.has(fact.status))row.absent++;
    if(fact.status==='pending')row.pending++;
    if(fact.status==='missed')row.missed++;
  }
  function report(state,filter,now=new Date()) {
    const allDates=dates(filter.startDate,filter.endDate),today=dateKey(now),scope=filter.scope||'active';
    if(!['active','all','archive'].includes(scope))throw Error('Невідома група працівників.');
    let people=state.employees.filter(p=>scope==='all'||(scope==='active'?p.active:!p.active));
    if(filter.employeeIds!=null){if(!Array.isArray(filter.employeeIds)||!filter.employeeIds.length||filter.employeeIds.some(id=>!people.some(p=>p.id===id)))throw Error('Оберіть працівників у вибраній групі.');people=people.filter(p=>filter.employeeIds.includes(p.id));}
    const actualDates=allDates.filter(date=>date<=today),facts=[];
    const rows=people.map(person=>{
      const row={employeeId:person.id,name:person.name,active:person.active,...blank()};
      for(const date of actualDates){const status=statusForDay(state,person.id,date,today);if(['weekend','outside'].includes(status))continue;const record=recordForDay(state,person.id,date,today);const fact={employeeId:person.id,name:person.name,date,status,presenceStatus:record?.presenceStatus||'',note:record?.note||'',source:record?.source||'',recordedAt:record?.recordedAt||'',workEntryIds:record?.workEntryIds||[]};facts.push(fact);addFact(row,fact);}
      const entries=(state.workEntries||[]).filter(entry=>entry.employeeId===person.id);
      for(const entry of entries){if(entry.startDate>=filter.startDate&&entry.startDate<=filter.endDate&&entry.startDate<=today)row.projectsStarted+=entry.projectCount;if(entry.status==='done'&&entry.finishedDate>=filter.startDate&&entry.finishedDate<=filter.endDate&&entry.finishedDate<=today)row.projectsCompleted+=entry.projectCount;}
      row.openProjects=entries.filter(entry=>entry.status==='active'&&entry.startDate<=today).reduce((sum,entry)=>sum+entry.projectCount-entry.completedProjects,0);
      row.dueForReview=entries.filter(entry=>entry.status==='active'&&entry.estimatedEndDate<today).length;
      return finalize(row);
    });
    const total={...blank(),openProjects:0,dueForReview:0};for(const row of rows)for(const key of Object.keys(total))total[key]+=row[key];finalize(total);
    const groupBy=filter.groupBy&&filter.groupBy!=='auto'?filter.groupBy:actualDates.length<=31?'day':actualDates.length<=120?'week':'month';
    if(!['day','week','month'].includes(groupBy))throw Error('Невідомий крок графіка.');
    const bucket=date=>groupBy==='month'?date.slice(0,7):groupBy==='week'?addDays(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7)):date;
    const buckets=new Map();for(const date of actualDates){const key=bucket(date);if(!buckets.has(key))buckets.set(key,{key,from:date,to:date,...blank()});else buckets.get(key).to=date;}
    if(buckets.size>124)throw Error('Для довгого періоду оберіть тижні або місяці.');
    for(const fact of facts)addFact(buckets.get(bucket(fact.date)),fact);
    const ids=new Set(people.map(p=>p.id)),entries=(state.workEntries||[]).filter(entry=>ids.has(entry.employeeId));
    for(const entry of entries){if(entry.startDate<=today&&entry.startDate>=filter.startDate&&entry.startDate<=filter.endDate)buckets.get(bucket(entry.startDate)).projectsStarted+=entry.projectCount;if(entry.status==='done'&&entry.finishedDate>=filter.startDate&&entry.finishedDate<=filter.endDate&&entry.finishedDate<=today){const row=buckets.get(bucket(entry.finishedDate));if(row)row.projectsCompleted+=entry.projectCount;}}
    const result={filter:{...filter,scope,groupBy},employeeIds:[...ids],startDate:filter.startDate,endDate:filter.endDate,asOfDate:today,rows,total,facts,trend:[...buckets.values()].map(finalize),groupBy,
      futureCalendarDays:allDates.length-actualDates.length,futureWorkdays:allDates.filter(date=>date>today).reduce((sum,date)=>sum+people.filter(p=>activeOn(p,date)&&isWorkday(state,p.id,date)).length,0),entries};
    if(filter.compare&&actualDates.length){const to=addDays(actualDates[0],-1),from=addDays(to,1-actualDates.length);const prior=report(state,{...filter,startDate:from,endDate:to,compare:false},now);result.comparison={startDate:from,endDate:to,total:prior.total,rows:prior.rows};}
    return result;
  }
  function csv(data,view='workers') {
    const keys=['calendarWorkdays','workedDays','workingDays','confirmedDays','onsiteDays','zkpDays','zkpPendingDays','trainingDays','arkanDays','absent','missed','pending','projectsCompleted'];
    const rows=view==='trend'?[['Від','До',...keys.map(key=>metricLabels[key])],...data.trend.map(row=>[row.from,row.to,...keys.map(key=>row[key])])]
      :view==='days'?[['Дата','Працівник','Статус','Робота','Підтверджено / внесено'],...data.facts.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'uk')).map(f=>[f.date,f.name,factLabel(f),f.note,f.recordedAt])]
      :[['Працівник',...keys.map(key=>metricLabels[key])],...data.rows.map(row=>[row.name,...keys.map(key=>row[key])])];
    const safe=value=>{let text=String(value??'');if(/^[=+@-]/.test(text.trimStart()))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    const meta=[['ЛАД · Облік роботи'],['Період',data.startDate,data.endDate],['Факти до',data.asOfDate],['Група',data.filter.scope],['Вибрані співробітники',...data.rows.map(row=>row.name)],['Дні — за робочим календарем і позначками; проєкти — у роботах із підтвердженим завершенням.'],[]];
    return '\uFEFF'+[...meta,...rows].map(row=>row.map(safe).join(';')).join('\r\n')+'\r\n';
  }
  function factLabel(fact){return fact.presenceStatus==='zkp'&&confirmed.has(fact.status)?'ЗКП · роботу зараховано':labels[fact.status]||fact.status;}
  return {labels,metricLabels,absence,confirmed,factLabel,dateKey,validDate,dates,addDays,activeOn,trackableOn,isWorkday,workForDay,recordForDay,statusForDay,estimatedEnd,normalize,create,update,progress,finish,report,csv};
}));
