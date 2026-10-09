const coinUi={question:'',resultId:'',busy:false,reveal:null,startedSequence:0};
const coinAnswer=answer=>answer==='yes'?'Так':'Ні';
function coinFigure() {
  return '<div class="coin-toss"><div class="coin-spinner"><div class="coin-face coin-front"><span>ЛАД</span><strong>ТАК</strong><small>50%</small></div><div class="coin-face coin-back"><span>ЛАД</span><strong>НІ</strong><small>50%</small></div><i class="coin-rim"></i></div></div>';
}
function renderCoinPage() {
  const history=(snapshot.coinFlips||[]).filter(item=>!coinUi.busy||item.number<=coinUi.startedSequence).slice().sort((a,b)=>b.number-a.number);
  const result=history.find(item=>item.id===coinUi.resultId)||history[0];
  return `<header class="page-header"><div><span class="page-eyebrow">Два рівні шанси</span><h1>Підкинути монетку</h1><p>Питання з відповіддю «Так» або «Ні». Шанс кожної сторони — 50%.</p></div><button class="button" data-tab="draws">Тягнути сірник →</button></header><div class="coin-tool-grid"><section class="panel"><form id="coin-form"><label class="field"><span>Ваше питання · необов’язково</span><textarea name="question" data-coin-question rows="3" maxlength="300" placeholder="Наприклад, перенести нараду на завтра?" ${coinUi.busy?'disabled':''}>${h(coinUi.question)}</textarea></label><div class="coin-idle" aria-hidden="true">${coinFigure()}</div><button class="button primary coin-submit" type="submit" ${coinUi.busy?'disabled':''}>${coinUi.busy?'Монетка в повітрі…':'Підкинути монетку'}</button><p class="muted coin-help">Відповідь збережеться до показу анімації. Історія містить останні 500 підкидань.</p></form></section><section class="panel coin-result-panel" aria-live="polite">${result?`<span class="page-eyebrow">Підкидання №${result.number}</span><h2>${h(result.question||'Питання без тексту')}</h2><div class="coin-answer coin-answer-${result.answer}">${coinAnswer(result.answer)}</div><p>${h(new Date(result.createdAt).toLocaleString('uk-UA'))}</p><small class="muted">${h(result.createdBy)}</small>`:'<span class="page-eyebrow">Мить перед відповіддю</span><h2>Так чи ні?</h2><p class="muted">Введіть питання або одразу підкиньте монетку. Тут з’явиться відповідь.</p>'}</section></div><section class="panel coin-history"><div class="rules-heading"><div><h2>Останні підкидання</h2><p>Питання, відповідь і час. Відкриття запису не підкидає монетку знову.</p></div><span class="count-pill">${history.length}</span></div>${history.slice(0,12).map(item=>`<button class="coin-history-row" data-coin-result="${h(item.id)}" ${coinUi.busy?'disabled':''}><span><strong>${h(item.question||'Питання без тексту')}</strong><small>№${item.number} · ${h(new Date(item.createdAt).toLocaleString('uk-UA'))}</small></span><b class="coin-history-answer coin-answer-${item.answer}">${coinAnswer(item.answer)}</b></button>`).join('')||'<p class="muted">Поки немає підкидань.</p>'}</section>`;
}
function finishCoinReveal({close=true,focus=true}={}) {
  const reveal=coinUi.reveal;if(!reveal)return;
  reveal.timers.forEach(timer=>clearTimeout(timer));
  document.removeEventListener('visibilitychange',reveal.onVisibility);reveal.motion.removeEventListener('change',reveal.onMotion);
  coinUi.resultId=reveal.result.id;coinUi.reveal=null;coinUi.busy=false;renderShell();
  if(close&&modalRoot.contains(reveal.dialog))closeModal(reveal.dialog);
  if(focus&&ui.tab==='coins'&&!modalRoot.childElementCount)appRoot.querySelector('#coin-form [type="submit"]')?.focus({preventScroll:true});
}
function startCoinReveal(result) {
  const motion=matchMedia('(prefers-reduced-motion:reduce)');if(motion.matches||document.hidden||(typeof LadMotion !== 'undefined' && LadMotion.level() !== 'full'))return false;
  openModal(`<header class="modal-head"><div><span class="page-eyebrow">Підкидання №${result.number}</span><h2>Так чи ні?</h2><p>${h(result.question||'Довіримося монетці')}</p></div><button class="icon-button" type="button" data-close-modal aria-label="Показати збережений результат">×</button></header><div class="modal-body coin-reveal-body"><div class="coin-stage" data-coin-phase="charge" aria-hidden="true"><div class="coin-orbit"></div><div class="coin-glow"></div><div class="coin-flash"></div><div class="coin-sparks">${Array.from({length:12},(_,i)=>`<i data-coin-spark="${i}"></i>`).join('')}</div>${coinFigure()}<div class="coin-shadow"></div></div><p class="coin-reveal-status" role="status" aria-live="polite">Збираємося підкинути…</p><div class="coin-reveal-answer" hidden></div><p class="muted coin-help">Підкидання вже збережено. Пропуск анімації покаже той самий результат.</p></div><footer class="modal-foot"><button class="button primary" type="button" data-coin-skip>Показати результат</button></footer>`,true);
  const dialog=modalRoot.querySelector('.modal'),stage=dialog.querySelector('.coin-stage'),status=dialog.querySelector('.coin-reveal-status');
  const reveal={result,dialog,motion,timers:[],onVisibility:()=>{if(document.hidden)finishCoinReveal();},onMotion:event=>{if(event.matches)finishCoinReveal();}};
  coinUi.reveal=reveal;
  stage.querySelectorAll('[data-coin-spark]').forEach((spark,i)=>spark.style.setProperty('--spark-angle',i*30+'deg'));
  document.addEventListener('visibilitychange',reveal.onVisibility);motion.addEventListener('change',reveal.onMotion);
  const later=(callback,delay)=>reveal.timers.push(setTimeout(()=>{if(coinUi.reveal===reveal&&dialog.isConnected)callback();},delay));
  later(()=>{stage.dataset.coinPhase='toss';status.textContent='Монетка злітає…';},1200);
  later(()=>{stage.dataset.coinPhase='suspense';status.textContent='Зараз дізнаємося…';},4300);
  later(()=>{stage.dataset.coinPhase='land';stage.dataset.coinAnswer=result.answer;status.textContent='Монетка приземлилася!';},6500);
  later(()=>{stage.dataset.coinPhase='complete';const answer=dialog.querySelector('.coin-reveal-answer');answer.hidden=false;answer.textContent=coinAnswer(result.answer);answer.classList.add('coin-answer-'+result.answer);status.textContent='Відповідь: '+coinAnswer(result.answer)+'.';},7100);
  later(()=>finishCoinReveal(),8600);return true;
}
async function handleCoinSubmit(event) {
  const form=event.target;if(form.id!=='coin-form')return false;if(coinUi.busy)return true;
  coinUi.question=String(new FormData(form).get('question')||'');coinUi.startedSequence=snapshot.coinSequence||0;coinUi.busy=true;renderShell();
  try {
    const result=await run(()=>window.counter.flipCoin({question:coinUi.question}),null,{undo:false});
    if(result){coinUi.resultId=result.id;if(ui.tab==='coins'&&!modalRoot.childElementCount&&startCoinReveal(result))return true;}
  }finally{if(!coinUi.reveal){coinUi.busy=false;renderShell();}}
  return true;
}
function handleCoinInput(event) {if(!event.target.matches('[data-coin-question]'))return false;coinUi.question=event.target.value;return true;}
async function handleCoinClick(event) {
  if(event.target.closest('[data-coin-skip]')){finishCoinReveal();return true;}
  const result=event.target.closest('[data-coin-result]');if(result){if(!coinUi.busy){coinUi.resultId=result.dataset.coinResult;renderShell();}return true;}
  return false;
}
