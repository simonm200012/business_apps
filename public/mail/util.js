/* AM.U: escaping, formatting, seeded RNG, dialogs, toast, CSV, prefs, SMS counter */
(function () {
  const AM = window.AM = window.AM || {};
  const U = AM.U = {};
  const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ENT[c]);
  U.$ = (s, r) => (r || document).querySelector(s);
  U.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  U.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  U.sum = (a, f) => a.reduce((t, x) => t + (f ? f(x) : x), 0);
  U.DAY = 864e5; U.HOUR = 36e5; U.MIN = 6e4;
  U.now = () => (AM.E && AM.E.db ? AM.E.now() : Date.now());
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  U.MON = MON;
  U.num = n => (n == null || isNaN(n)) ? '–' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  U.eur = (n, d) => (n == null || isNaN(n)) ? '–' : '€' + Number(n).toFixed(d == null ? (Math.abs(n) >= 1000 ? 0 : 2) : d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  U.pct = (x, d) => (x == null || isNaN(x) || !isFinite(x)) ? '–' : (x * 100).toFixed(d == null ? 1 : d) + '%';
  U.p2 = n => (n < 10 ? '0' : '') + n;
  U.date = ts => { if (!ts) return '–'; const d = new Date(ts); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
  U.dshort = ts => { const d = new Date(ts); return d.getDate() + ' ' + MON[d.getMonth()]; };
  U.time = ts => { const d = new Date(ts); return U.p2(d.getHours()) + ':' + U.p2(d.getMinutes()); };
  U.dt = ts => ts ? U.date(ts) + ', ' + U.time(ts) : '–';
  U.ymd = ts => { const d = new Date(ts); return d.getFullYear() + '-' + U.p2(d.getMonth() + 1) + '-' + U.p2(d.getDate()); };
  U.local = ts => U.ymd(ts) + 'T' + U.time(ts);
  U.ago = (ts, now) => {
    now = now || U.now(); const s = (now - ts) / 1000, f = s < 0; const a = Math.abs(s);
    const t = a < 90 ? 'moments' : a < 5400 ? Math.round(a / 60) + ' min' : a < 129600 ? Math.round(a / 3600) + ' h' : a < 5184000 ? Math.round(a / 86400) + ' d' : Math.round(a / 2592000) + ' mo';
    return t === 'moments' ? (f ? 'in a moment' : 'just now') : f ? 'in ' + t : t + ' ago';
  };
  U.hash = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  U.rng = seed => {
    let a = seed >>> 0;
    const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    r.pick = arr => arr[Math.floor(r() * arr.length)];
    r.chance = p => r() < p;
    r.exp = mean => -Math.log(1 - r()) * mean;
    r.norm = (m, s) => m + s * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    r.shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
    r.w = (items, ws) => { let t = 0; ws.forEach(x => t += x); let x = r() * t; for (let i = 0; i < items.length; i++) { x -= ws[i]; if (x <= 0) return items[i]; } return items[items.length - 1]; };
    return r;
  };
  let idc = 0;
  U.uid = p => (p || 'x') + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6) + (idc++).toString(36);
  U.debounce = (f, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => f.apply(null, a), ms); }; };
  U.color = (c, fb) => /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : (fb || '#000000');
  U.opts = (list, cur) => list.map(o => { const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + U.esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + U.esc(l) + '</option>'; }).join('');
  U.copy = o => JSON.parse(JSON.stringify(o));
  U.pref = (k, v) => {
    try {
      const o = JSON.parse(localStorage.getItem('adrial-mail-ui') || '{}');
      if (v === undefined) return o[k];
      o[k] = v; localStorage.setItem('adrial-mail-ui', JSON.stringify(o));
    } catch (e) { return undefined; }
  };
  /* CSV */
  U.csv = rows => rows.map(r => r.map(c => { c = c == null ? '' : String(c); if (/^[=+@-]/.test(c) && isNaN(c)) c = "'" + c; return /[",\n;]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\n');
  U.download = (name, content, type) => {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([content], { type: type || 'text/csv;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  U.exportCsv = (name, rows) => { U.download(name, U.csv(rows)); U.toast('Exported ' + name); };
  /* SMS: GSM-7 vs UCS-2 */
  const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  const GEXT = '^{}\\[~]|€';
  U.smsInfo = text => {
    text = String(text || ''); let gsm = true, len = 0;
    for (const ch of text) { if (GSM.indexOf(ch) >= 0) len++; else if (GEXT.indexOf(ch) >= 0) len += 2; else { gsm = false; break; } }
    if (!gsm) { len = 0; for (const ch of text) len += ch.codePointAt(0) > 0xFFFF ? 2 : 1; }
    const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
    const segments = len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi);
    return { enc: gsm ? 'GSM-7' : 'UCS-2', chars: len, segments, perSeg: segments > 1 ? multi : single, left: segments <= 1 ? single - len : segments * multi - len };
  };
  /* Dialogs */
  U.dialog = (html, o) => {
    o = o || {};
    const wrap = document.createElement('div'); wrap.className = 'modal-bg';
    wrap.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + U.esc(o.title || 'Dialog') + '" tabindex="-1">' + (o.title ? '<div class="modal-h"><h3>' + U.esc(o.title) + '</h3><button class="btn ghost sm" data-close aria-label="Close">✕</button></div>' : '') + '<div class="modal-b">' + html + '</div></div>';
    const prev = document.activeElement;
    const close = v => { document.removeEventListener('keydown', key, true); wrap.remove(); if (prev && prev.focus) try { prev.focus(); } catch (e) {} if (o.onClose) o.onClose(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(wrap);
    const first = wrap.querySelector('input,select,textarea,button.primary') || wrap.querySelector('.modal'); if (first) first.focus();
    return { el: wrap, close, q: s => wrap.querySelector(s) };
  };
  U.confirm = (msg, ok, danger) => new Promise(res => {
    let val = false;
    const d = U.dialog('<p>' + U.esc(msg) + '</p><div class="row end"><button class="btn" data-close>Cancel</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-ok>' + U.esc(ok || 'OK') + '</button></div>', { title: 'Please confirm', onClose: () => res(val) });
    d.q('[data-ok]').onclick = () => { val = true; d.close(); };
  });
  U.prompt = (title, label, value) => new Promise(res => {
    let val = null;
    const d = U.dialog('<form><label class="fld"><span>' + U.esc(label) + '</span><input name="v" value="' + U.esc(value || '') + '" autocomplete="off"></label><div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">OK</button></div></form>', { title, onClose: () => res(val) });
    d.q('form').onsubmit = e => { e.preventDefault(); val = d.q('input').value.trim(); d.close(); };
  });
  U.toast = (msg, kind) => {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700);
  };
})();
