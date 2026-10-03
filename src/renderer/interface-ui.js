const interfacePendingForms = new Map();
let interfaceDialogRevision = 0;

// Retain drafts and the caret when a background update redraws the page.
function rememberPageDrafts() {
  if (appRoot.dataset.training !== String(Boolean(snapshot.training?.active))) return [];
  return ['employee-form', 'time-off-form', 'time-off-filter-form', 'journal-range-form'].flatMap(id => {
    const form = appRoot.querySelector(`#${id}`);
    if (!form) return [];
    const controls = [...form.elements].filter(element => element.name && !element.matches('button'));
    return [{ id, controls: controls.map(element => ({ name:element.name, value:element.value, checked:element.checked })),
      focused:controls.indexOf(document.activeElement), start:document.activeElement?.selectionStart, end:document.activeElement?.selectionEnd }];
  });
}

function restorePageDrafts(drafts) {
  for (const draft of drafts) {
    const form = appRoot.querySelector(`#${draft.id}`);
    if (!form) continue;
    const controls = [...form.elements].filter(element => element.name && !element.matches('button'));
    controls.forEach((element,index) => {
      const previous = draft.controls[index];
      if (!previous || previous.name !== element.name) return;
      if (element.tagName !== 'SELECT' || [...element.options].some(option => option.value === previous.value)) element.value = previous.value;
      if (['checkbox','radio'].includes(element.type)) element.checked = previous.checked;
    });
    const focused = controls[draft.focused];
    if (focused && !focused.disabled) {
      focused.focus({preventScroll:true});
      if (draft.start != null && ['text','search','tel','url','password'].includes(focused.type)) focused.setSelectionRange(draft.start,draft.end);
    }
  }
}

function applyInterfacePendingForms() {
  for (const [id,entry] of interfacePendingForms) {
    const form = document.getElementById(id);
    if (!form) continue;
    form.setAttribute('aria-busy','true');
    for (const field of form.querySelectorAll('input,select,textarea,[data-preview-submission]')) {
      if (!entry.fields.has(field)) entry.fields.set(field,field.hasAttribute('inert'));
      field.setAttribute('inert','');
    }
    for (const button of form.querySelectorAll('button[type="submit"]')) {
      if (!entry.buttons.has(button)) entry.buttons.set(button,{disabled:button.disabled,label:button.getAttribute('aria-label')});
      button.disabled = true;
      button.dataset.formPending = '';
      button.setAttribute('aria-label',`${button.textContent.trim()} · збереження триває`);
    }
  }
}

async function submitInterfaceForm(event, callback) {
  event.preventDefault();
  const form = event.target;
  const guarded = new Set(['employee-form','time-off-form','settings-form','submission-form','employee-rename-form',
    'time-off-edit-form','receipt-correction-form','duty-copy-form','duty-rules-form','duty-schedule-form','duty-history-form','duty-day-form','task-form','task-status-form']);
  if (!guarded.has(form.id)) return callback();
  if (interfacePendingForms.has(form.id) || form.querySelector('button[type="submit"]')?.disabled) return;
  const entry = {buttons:new Map(),fields:new Map()};
  interfacePendingForms.set(form.id,entry);
  applyInterfacePendingForms();
  try { return await callback(); }
  catch (error) { showToast(error.message || String(error),{error:true}); }
  finally {
    interfacePendingForms.delete(form.id);
    form.removeAttribute('aria-busy');
    document.getElementById(form.id)?.removeAttribute('aria-busy');
    for (const [field,wasInert] of entry.fields) if (!wasInert) field.removeAttribute('inert');
    for (const [button,previous] of entry.buttons) {
      button.disabled = previous.disabled;
      delete button.dataset.formPending;
      if (previous.label == null) button.removeAttribute('aria-label'); else button.setAttribute('aria-label',previous.label);
    }
  }
}

function openInterfaceLoading(title, description) {
  openModal(`<header class="modal-head"><div><h2>${h(title)}</h2><p>${h(description)}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body interface-loading" role="status"><span class="interface-spinner" aria-hidden="true"></span>Завантаження…</div><footer class="modal-foot"><button class="button" data-close-modal>Скасувати</button></footer>`);
  return interfaceDialogRevision;
}
