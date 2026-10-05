function employeeRowRgb(person,index=0) {
  const color=person?.dutyColor;
  return /^#[0-9a-f]{6}$/i.test(color||'')?[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16)).join(', '):DUTY_ROW_COLORS[index%DUTY_ROW_COLORS.length];
}
function rgbHex(rgb) {return '#'+rgb.split(',').map(value=>Number(value.trim()).toString(16).padStart(2,'0')).join('');}
function updateDutyColorPreview(form) {
  const color=form.elements.color.value;
  form.querySelector('[data-duty-color-preview]').style.setProperty('--employee-row-rgb',employeeRowRgb({dutyColor:color}));
  form.querySelectorAll('[data-duty-color-swatch]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.dutyColorSwatch===color)));
}
function openDutyColorForm(id) {
  const person=employeeById(id);if(!person)return;
  const color=person.dutyColor||rgbHex(employeeRowRgb(person,Math.max(0,activeEmployees().findIndex(item=>item.id===id))));
  openModal(`<form id="duty-color-form" data-employee-id="${h(id)}"><header class="modal-head"><div><h2>Колір працівника</h2><p>${h(person.name)} · у всіх графіках чергувань</p></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body"><div class="duty-color-preview" data-duty-color-preview><i class="employee-row-marker" aria-hidden="true"></i><strong>${h(person.name)}</strong><span>Рядок чергувань</span></div><div class="duty-color-palette" role="group" aria-label="Готові кольори">${DUTY_ROW_COLORS.map(rgb=>{const value=rgbHex(rgb);return `<button type="button" data-duty-color-swatch="${value}" aria-label="Колір ${value}" aria-pressed="${value===color}"></button>`;}).join('')}</div><label class="field"><span>Власний колір</span><input type="color" name="color" value="${h(color)}" data-duty-color-input></label><p class="muted">Колір зберігається для цієї людини, навіть після зміни порядку, перезапуску або відновлення копії. Літери й цифри залишаються читабельними.</p></div><footer class="modal-foot"><button class="button" type="button" data-duty-color-reset="${h(id)}">Автоматичний колір</button><button class="button primary" type="submit">Зберегти</button></footer></form>`);
  const form=modalRoot.querySelector('#duty-color-form');
  form.querySelectorAll('[data-duty-color-swatch]').forEach(button=>button.style.backgroundColor=button.dataset.dutyColorSwatch);
  updateDutyColorPreview(form);
}
async function handleDutyColorClick(event) {
  const target=event.target,open=target.closest('[data-duty-color]');
  if(open){openDutyColorForm(open.dataset.dutyColor);return true;}
  const swatch=target.closest('[data-duty-color-swatch]');
  if(swatch){const form=swatch.closest('form');form.elements.color.value=swatch.dataset.dutyColorSwatch;updateDutyColorPreview(form);return true;}
  const reset=target.closest('[data-duty-color-reset]');
  if(reset){const form=reset.form;if(form.dataset.saving)return true;form.dataset.saving='true';form.querySelectorAll('button,input').forEach(control=>control.disabled=true);
    const result=await run(()=>window.counter.setEmployeeDutyColor(reset.dataset.dutyColorReset,null),'Повернуто автоматичний колір.');
    if(result)closeModal(form);else{delete form.dataset.saving;form.querySelectorAll('button,input').forEach(control=>control.disabled=false);}return true;}
  return false;
}
async function handleDutyColorSubmit(event) {
  const form=event.target;if(form.id!=='duty-color-form')return false;
  if(form.dataset.saving)return true;
  const color=form.elements.color.value;form.dataset.saving='true';form.querySelectorAll('button,input').forEach(control=>control.disabled=true);
  const result=await run(()=>window.counter.setEmployeeDutyColor(form.dataset.employeeId,color),'Колір працівника збережено.');
  if(result)closeModal(form);else{delete form.dataset.saving;form.querySelectorAll('button,input').forEach(control=>control.disabled=false);}return true;
}
document.addEventListener('input',event=>{if(event.target.matches('[data-duty-color-input]'))updateDutyColorPreview(event.target.form);});
