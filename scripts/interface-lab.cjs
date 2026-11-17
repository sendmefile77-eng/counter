/* Dev-only snapshots of the actual renderer, supplied through its API boundary. */
const fs=require('node:fs'),path=require('node:path');
const {setup,until,tick}=require('../tests/helpers/renderer.cjs'),{fixture}=require('../tests/helpers/interface-fixture.cjs');
async function main(){
 const snapshots={};
 for(const mode of ['demo','worst','empty','one','legacy']){
  const cleanup=[],r=await setup({after:fn=>cleanup.push(fn)},{},fixture(mode));snapshots[mode]={};
  try{for(const tab of ['analytics','journal','employees']){
   await r.page(tab);
   if(tab==='employees'&&r.people.length){r.click(`[data-employee-profile="${r.people[0].id}"]`);await until(()=>r.w.document.querySelector('[data-pane-view]'));r.click('[data-pane-view="tasks"]');await tick();}
   const body=r.w.document.querySelector('.dashboard-content').outerHTML;
   const css=[...r.w.document.querySelectorAll('link[rel="stylesheet"]')].map(link=>fs.readFileSync(path.resolve(__dirname,'../src/renderer',link.getAttribute('href')),'utf8')).join('\n');
   snapshots[mode][tab]='<!doctype html><html lang="uk"><meta charset="utf-8"><style>'+css+'</style><body>'+body+'</body></html>';
  }}finally{for(const close of cleanup)close();}
 }
 const json=JSON.stringify(snapshots).replace(/</g,'\\u003c');
 const html=`<!doctype html><html lang="uk"><meta charset="utf-8"><title>ЛАД · крайні дані</title><style>body{margin:0;font:14px system-ui;background:#172334;color:white}header{padding:12px}iframe{display:block;width:100%;height:calc(100vh - 160px);border:0;background:#0b121c}nav{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:3px;background:#ddd;padding:4px;border-radius:12px}button,select{font:inherit;padding:8px;border:0;border-radius:8px}button[aria-pressed=true]{background:white;color:black;box-shadow:0 1px 4px #888}button{background:transparent;color:#333}label{margin:10px}</style><header><strong>ЛАД · знімки справжнього інтерфейсу</strong><p>Лише перевірка компонування. Кнопки всередині знімка не виконують робочих дій.</p><label>Екран <select id="screen"><option value="analytics">Аналітика</option><option value="journal">Облік об’єктів</option><option value="employees">Картка працівника</option></select></label><label><input type="checkbox" id="light">Світла тема</label><label><input type="checkbox" id="zoom">Масштаб ×2</label></header><iframe title="Перевірка компонування" sandbox="allow-same-origin"></iframe><nav aria-label="Тестові дані">${[['demo','Звичайні'],['worst','Крайні'],['empty','Порожньо'],['one','Одна людина'],['legacy','Стара історія']].map(([key,label])=>'<button data-mode="'+key+'">'+label+'</button>').join('')}</nav><script>const snapshots=${json},modes=Object.keys(snapshots),params=new URLSearchParams(location.search);let mode=modes.includes(params.get('data'))?params.get('data'):'demo';const frame=document.querySelector('iframe'),screen=document.getElementById('screen');function render(){document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));const url=new URL(location);url.searchParams.set('data',mode);history.replaceState(null,'',url);frame.srcdoc=snapshots[mode][screen.value];}frame.onload=()=>{const root=frame.contentDocument.documentElement;root.dataset.theme=document.getElementById('light').checked?'light':'navy';if(document.getElementById('zoom').checked){const style=frame.contentDocument.createElement('style');style.textContent='.dashboard-content{zoom:2}';root.append(style);}};document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render()});document.querySelectorAll('select,input').forEach(el=>el.onchange=render);render();</script></html>`;
 const out=path.resolve(process.argv[2]||'/tmp/lad-interface-lab.html');fs.writeFileSync(out,html);console.log(out);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
