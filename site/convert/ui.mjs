// Convert: the few page helpers app.mjs needs (a selector shortcut, HTML escaping, a toast and a password dialog),
// so the app has no dependency on any other file of the site.
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let timer = 0;
function toast(message) {
  let el = $('.toast');
  if (!el) { el = Object.assign(document.createElement('div'), { className: 'toast', role: 'status' }); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.textContent = message; el.classList.add('on');
  clearTimeout(timer); timer = setTimeout(() => el.classList.remove('on'), 5000);
}

/** A small dialog with fields; resolves to { name: value } or null when cancelled. */
function formDialog({ title, note = '', fields = [], submit = 'OK' }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'cv-dialog';
    dlg.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${note ? `<p class="small muted">${esc(note)}</p>` : ''}${fields.map((f) => `<label class="field"><span>${esc(f.label)}</span><input name="${esc(f.name)}" type="${esc(f.type || 'text')}" autocomplete="${esc(f.autocomplete || 'off')}"${f.required ? ' required' : ''}></label>`).join('')}<div class="row"><button type="button" class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">${esc(submit)}</button></div></form>`;
    document.body.appendChild(dlg);
    let value = null;
    $('button[value="cancel"]', dlg).addEventListener('click', () => dlg.close());
    $('form', dlg).addEventListener('submit', () => { value = Object.fromEntries(fields.map((f) => [f.name, $(`[name="${f.name}"]`, dlg).value])); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(value); });
    dlg.showModal();
    $('input', dlg)?.focus();
  });
}

export const toolsUi = { $, esc, toast, formDialog };
