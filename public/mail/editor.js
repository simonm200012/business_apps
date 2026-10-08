/* AM.Editor: drag-and-drop block editor with undo/redo and pre-send checks */
(function () {
  const AM = window.AM = window.AM || {}, U = AM.U, M = AM.Email, esc = U.esc;
  const Ed = AM.Editor = {};
  const F = {
    header: [['logo', 'Logo text'], ['tag', 'Tagline'], ['bg', 'Background', 'color'], ['color', 'Text colour', 'color']],
    hero: [['headline', 'Headline'], ['sub', 'Subtitle', 'area'], ['btn', 'Button label'], ['url', 'Button link'], ['art', 'Artwork', 'art'], ['c1', 'Colour 1', 'color'], ['c2', 'Colour 2', 'color'], ['align', 'Alignment', 'align'], ['color', 'Text colour', 'color']],
    text: [['html', 'Content', 'html'], ['align', 'Alignment', 'align'], ['size', 'Font size (px)', 'number'], ['color', 'Text colour', 'color'], ['bg', 'Background', 'color']],
    image: [['art', 'Artwork', 'art'], ['c1', 'Colour 1', 'color'], ['c2', 'Colour 2', 'color'], ['alt', 'Alt text'], ['url', 'Link (optional)']],
    button: [['label', 'Label'], ['url', 'Link'], ['bg', 'Button colour', 'color'], ['color', 'Text colour', 'color'], ['align', 'Alignment', 'align']],
    products: [['title', 'Title'], ['items', 'Products', 'items'], ['cols', 'Columns', 'cols'], ['btn', 'Button label']],
    coupon: [['code', 'Code'], ['text', 'Offer text'], ['note', 'Small print'], ['bg', 'Background', 'color']],
    divider: [['color', 'Line colour', 'color']], spacer: [['h', 'Height (px)', 'number']],
    social: [['links', 'Links', 'links']],
    footer: [['html', 'Content', 'html'], ['color', 'Text colour', 'color'], ['bg', 'Background', 'color']]
  };
  const sum = b => { switch (b.type) { case 'header': return b.logo; case 'hero': return b.headline; case 'text': return M.strip(b.html).slice(0, 38); case 'image': return b.alt || b.art; case 'button': return b.label; case 'products': return (b.items || []).length + ' products'; case 'coupon': return b.code; case 'footer': return M.strip(b.html).slice(0, 30); case 'spacer': return b.h + ' px'; case 'social': return (b.links || []).length + ' links'; } return ''; };

  /* pre-send checks */
  Ed.checks = (d, ctx) => {
    ctx = ctx || {}; const out = [], add = (level, text) => out.push({ level, text });
    const sub = ctx.subject || '';
    if (!sub.trim()) add('error', 'Subject line is empty.');
    else if (sub.length > 60) add('warn', 'Subject is ' + sub.length + ' characters; many inboxes cut it off after about 60.');
    else add('ok', 'Subject length is fine (' + sub.length + ' characters).');
    if (!(ctx.preview || '').trim()) add('warn', 'No preview text; inboxes will show the first words of the email instead.'); else add('ok', 'Preview text is set.');
    const blocks = d.blocks || [], foot = blocks.find(b => b.type === 'footer');
    if (!foot) add('error', 'No footer block. Every marketing email needs a footer with an unsubscribe link.');
    else if (!/unsubscribe_url|unsubscribe/i.test(foot.html)) add('error', 'The footer has no unsubscribe link ({{ unsubscribe_url }}).');
    else add('ok', 'Footer with unsubscribe link found.');
    let noAlt = 0, badUrl = [];
    blocks.forEach(b => {
      if (b.type === 'image' && !String(b.alt || '').trim()) noAlt++;
      [['hero', 'url'], ['button', 'url'], ['image', 'url']].forEach(([t, k]) => { if (b.type === t && (t !== 'image' || b[k]) && !/^(https?:\/\/|mailto:|tel:)/i.test(String(b[k] || ''))) badUrl.push(M.BLOCKS[t].label); });
      (b.links || []).forEach(l => { if (!/^https?:\/\//i.test(l.url || '')) badUrl.push('Social ' + l.label); });
    });
    if (noAlt) add('warn', noAlt + ' image' + (noAlt > 1 ? 's' : '') + ' without alt text.'); else if (blocks.some(b => b.type === 'image')) add('ok', 'All images have alt text.');
    if (badUrl.length) add('error', 'Missing or invalid link URL in: ' + badUrl.join(', ') + '.'); else add('ok', 'Link URLs look valid.');
    const texts = [sub, ctx.preview].concat(blocks.map(b => [b.html, b.headline, b.sub, b.label, b.title, b.text, b.note].filter(Boolean).join(' ')));
    const bad = texts.filter(t => M.malformed(t)).length, unk = []; texts.forEach(t => M.unknownTags(t).forEach(x => unk.push(x)));
    if (bad) add('error', 'Malformed personalisation tag ({{ … }} not closed) in ' + bad + ' place(s).');
    if (unk.length) add('error', 'Unknown personalisation tag: ' + unk.filter((x, i) => unk.indexOf(x) === i).join(', ') + '.');
    if (!bad && !unk.length) add('ok', 'Personalisation tags are valid.');
    if (!blocks.some(b => b.type === 'button' || (b.type === 'hero' && b.btn) || b.type === 'products')) add('warn', 'No call-to-action button or product block.');
    if (blocks.some(b => b.type === 'text' && !M.strip(b.html))) add('warn', 'There is an empty text block.');
    const kb = M.size(d, { products: ctx.products || [] }) / 1024;
    if (kb > 102) add('error', 'HTML is ' + kb.toFixed(0) + ' KB; Gmail clips messages over 102 KB.'); else if (kb > 85) add('warn', 'HTML is ' + kb.toFixed(0) + ' KB, close to the 102 KB Gmail clipping limit.'); else add('ok', 'HTML size ' + kb.toFixed(0) + ' KB (Gmail clips at 102 KB).');
    return out;
  };
  Ed.checksHtml = list => '<ul class="checks">' + list.map(c => '<li class="' + c.level + '"><b>' + ({ ok: '✓', warn: '!', error: '✕' }[c.level]) + '</b> ' + esc(c.text) + '</li>').join('') + '</ul>';

  Ed.mount = (el, design, opts) => {
    opts = opts || {};
    let d = design, sel = d.blocks.length ? 0 : -1, hist = [JSON.stringify(d)], hi = 0, lastKey = '', lastT = 0, tm = null, mobile = false, prof = opts.profile || null, dead = false;
    const prods = () => opts.products || [];
    const changed = () => { if (opts.onChange) opts.onChange(d); };
    const snap = key => {
      const s = JSON.stringify(d); if (s === hist[hi]) return;
      const now = Date.now();
      if (key && key === lastKey && now - lastT < 900 && hi === hist.length - 1) hist[hi] = s;
      else { hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > 60) hist.shift(); hi = hist.length - 1; }
      lastKey = key || ''; lastT = now; changed();
    };
    const restore = () => { d = JSON.parse(hist[hi]); if (sel >= d.blocks.length) sel = d.blocks.length - 1; changed(); full(); };
    const undo = () => { if (hi > 0) { hi--; restore(); } }, redo = () => { if (hi < hist.length - 1) { hi++; restore(); } };
    const html = () => M.render(d, { profile: prof, products: prods(), subject: opts.subject ? opts.subject() : '', preview: opts.previewText ? opts.previewText() : '' });
    const paintPreview = () => { const f = el.querySelector('.ed-r iframe'); if (f) f.srcdoc = html(); };
    const later = () => { clearTimeout(tm); tm = setTimeout(() => { if (!dead) paintPreview(); }, 160); };
    const fld = (b, f) => {
      const [k, label, kind] = f, v = b[k], id = 'ef-' + k;
      let inp;
      switch (kind) {
        case 'color': inp = '<input type="color" id="' + id + '" data-f="' + k + '" value="' + U.color(v, '#000000').slice(0, 7) + '">'; break;
        case 'number': inp = '<input type="number" id="' + id + '" data-f="' + k + '" value="' + esc(v) + '" min="0" max="999">'; break;
        case 'area': inp = '<textarea id="' + id + '" data-f="' + k + '" rows="2">' + esc(v) + '</textarea>'; break;
        case 'align': inp = '<select id="' + id + '" data-f="' + k + '">' + U.opts([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], v) + '</select>'; break;
        case 'cols': inp = '<select id="' + id + '" data-f="' + k + '" data-num="1">' + U.opts([1, 2, 3, 4], v) + '</select>'; break;
        case 'art': inp = '<select id="' + id + '" data-f="' + k + '">' + U.opts(M.ART, v) + '</select>'; break;
        case 'html': inp = '<div class="row gap wrap tb"><button type="button" class="btn sm" data-wrap="b" title="Bold"><b>B</b></button><button type="button" class="btn sm" data-wrap="i" title="Italic"><i>I</i></button><button type="button" class="btn sm" data-wrap="a">Link</button><select data-tag aria-label="Insert tag"><option value="">Insert tag…</option>' + M.TAGS.map(t => '<option>' + t + '</option>').join('') + '</select></div><textarea id="' + id + '" data-f="' + k + '" data-html="1" rows="7">' + esc(v) + '</textarea>'; break;
        case 'items': inp = '<div class="items">' + prods().map(x => '<label class="chk"><input type="checkbox" data-item="' + esc(x.sku) + '"' + ((v || []).indexOf(x.sku) >= 0 ? ' checked' : '') + '> ' + esc(x.name) + ' <span class="muted">' + esc(x.sku) + '</span></label>').join('') + '</div>'; break;
        case 'links': inp = (v || []).map((l, i) => '<div class="row gap"><input data-lk="label" data-i="' + i + '" value="' + esc(l.label) + '" placeholder="Label"><input data-lk="url" data-i="' + i + '" value="' + esc(l.url) + '" placeholder="https://"><button type="button" class="btn ghost sm" data-ldel="' + i + '" aria-label="Remove link">✕</button></div>').join('') + '<button type="button" class="btn sm" data-ladd>+ Link</button>'; break;
        default: inp = '<input id="' + id + '" data-f="' + k + '" value="' + esc(v) + '">';
      }
      return '<div class="fld"><label for="' + id + '"><span>' + esc(label) + '</span></label>' + inp + '</div>';
    };
    const insp = () => {
      const b = d.blocks[sel]; if (!b) return '<p class="muted">Select a block to edit it, or add one from the palette.</p>';
      return '<h4>' + esc(M.BLOCKS[b.type].label) + ' block</h4>' + (F[b.type] || []).map(f => fld(b, f)).join('');
    };
    const list = () => d.blocks.map((b, i) => '<li class="ed-it' + (i === sel ? ' on' : '') + '" draggable="true" data-i="' + i + '" tabindex="0" role="button" aria-label="' + esc(M.BLOCKS[b.type].label) + ' block ' + (i + 1) + '"><span class="grip" aria-hidden="true">⋮⋮</span><span class="ic">' + M.BLOCKS[b.type].icon + '</span><span class="tx"><b>' + esc(M.BLOCKS[b.type].label) + '</b> <span class="muted">' + esc(sum(b)) + '</span></span><span class="row"><button type="button" class="btn ghost sm" data-mv="-1" title="Move up" aria-label="Move up">↑</button><button type="button" class="btn ghost sm" data-mv="1" title="Move down" aria-label="Move down">↓</button><button type="button" class="btn ghost sm" data-dup title="Duplicate" aria-label="Duplicate">⧉</button><button type="button" class="btn ghost sm" data-rm title="Delete" aria-label="Delete">✕</button></span></li>').join('') || '<li class="muted pad">No blocks yet: drag one here or click a block type.</li>';
    const full = () => {
      el.innerHTML = '<div class="ed"><div class="ed-l"><div class="row gap wrap ed-bar"><button type="button" class="btn sm" data-undo ' + (hi ? '' : 'disabled') + '>↶ Undo</button><button type="button" class="btn sm" data-redo ' + (hi < hist.length - 1 ? '' : 'disabled') + '>↷ Redo</button><label class="inl">Font <select data-df="font">' + U.opts([['sans', 'Sans'], ['serif', 'Serif']], d.font) + '</select></label><label class="inl">Page <input type="color" data-df="bg" value="' + U.color(d.bg, '#f4f1ea').slice(0, 7) + '"></label></div>' +
        '<div class="ed-pal" aria-label="Add a block">' + Object.keys(M.BLOCKS).map(t => '<button type="button" class="pal" draggable="true" data-new="' + t + '"><span>' + M.BLOCKS[t].icon + '</span> ' + M.BLOCKS[t].label + '</button>').join('') + '</div>' +
        '<ol class="ed-list" aria-label="Blocks">' + list() + '</ol><div class="ed-insp card">' + insp() + '</div></div>' +
        '<div class="ed-r"><div class="row gap wrap ed-bar"><div class="seg"><button type="button" class="btn sm' + (mobile ? '' : ' on') + '" data-view="d">Desktop</button><button type="button" class="btn sm' + (mobile ? ' on' : '') + '" data-view="m">Mobile</button></div><span class="muted">Preview as ' + (prof ? esc(prof.fn + ' ' + prof.ln) : 'sample profile (Ana Novak)') + '</span><button type="button" class="btn sm" data-pick>Change…</button>' + (prof ? '<button type="button" class="btn ghost sm" data-unpick>Reset</button>' : '') + '</div><div class="pwrap">' + AM.UI.frame(html(), { mobile, h: 640 }) + '</div></div></div>';
    };
    const addBlock = (type, at) => { const b = M.block(type); at = at == null ? (sel >= 0 ? sel + 1 : d.blocks.length) : at; d.blocks.splice(at, 0, b); sel = at; snap(); full(); };
    const idx = t => { const li = t.closest('.ed-it'); return li ? +li.dataset.i : -1; };
    el.onclick = e => {
      const t = e.target;
      if (t.closest('[data-undo]')) return undo(); if (t.closest('[data-redo]')) return redo();
      const nw = t.closest('[data-new]'); if (nw) return addBlock(nw.dataset.new);
      const mv = t.closest('[data-mv]'), i = idx(t);
      if (mv && i >= 0) { const j = i + +mv.dataset.mv; if (j >= 0 && j < d.blocks.length) { const b = d.blocks.splice(i, 1)[0]; d.blocks.splice(j, 0, b); sel = j; snap(); full(); } return; }
      if (t.closest('[data-dup]') && i >= 0) { const c = JSON.parse(JSON.stringify(d.blocks[i])); c.id = U.uid('b'); d.blocks.splice(i + 1, 0, c); sel = i + 1; snap(); return full(); }
      if (t.closest('[data-rm]') && i >= 0) { d.blocks.splice(i, 1); sel = Math.min(sel, d.blocks.length - 1); snap(); return full(); }
      if (i >= 0) { sel = i; full(); return; }
      const v = t.closest('[data-view]'); if (v) { mobile = v.dataset.view === 'm'; return full(); }
      if (t.closest('[data-pick]')) { AM.UI.pickProfile().then(p => { if (p) { prof = p; U.pref('previewP', p.id); full(); } }); return; }
      if (t.closest('[data-unpick]')) { prof = null; U.pref('previewP', null); return full(); }
      const w = t.closest('[data-wrap]'); if (w) {
        const ta = el.querySelector('textarea[data-html]'); if (!ta) return; const a = ta.selectionStart, z = ta.selectionEnd, s = ta.value.slice(a, z) || 'text';
        const apply = tag => { const open = tag === 'a' ? '<a href="https://lumina-optika.example/">' : '<' + tag + '>'; ta.setRangeText(open + s + '</' + (tag === 'a' ? 'a' : tag) + '>', a, z, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); };
        if (w.dataset.wrap === 'a') U.prompt('Insert link', 'Link URL', 'https://').then(u => { if (u) { ta.setRangeText('<a href="' + esc(u) + '">' + s + '</a>', a, z, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); } }); else apply(w.dataset.wrap);
        return;
      }
      if (t.closest('[data-ladd]')) { const b = d.blocks[sel]; b.links = (b.links || []).concat([{ label: 'Link', url: 'https://' }]); snap(); return full(); }
      const ld = t.closest('[data-ldel]'); if (ld) { d.blocks[sel].links.splice(+ld.dataset.ldel, 1); snap(); return full(); }
    };
    const onField = e => {
      const t = e.target, b = d.blocks[sel];
      if (t.dataset.df) { d[t.dataset.df] = t.value; snap('df' + t.dataset.df); return later(); }
      if (t.dataset.tag !== undefined && t.matches('select[data-tag]')) { const ta = el.querySelector('textarea[data-html]'); if (t.value && ta) { ta.setRangeText('{{ ' + t.value + (/name/.test(t.value) ? '|default:"there"' : '') + ' }}', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); } t.value = ''; return; }
      if (!b) return;
      if (t.dataset.f) { b[t.dataset.f] = (t.type === 'number' || t.dataset.num) ? +t.value : t.value; snap(b.id + t.dataset.f); later(); const li = el.querySelectorAll('.ed-it')[sel]; if (li) li.querySelector('.tx').innerHTML = '<b>' + esc(M.BLOCKS[b.type].label) + '</b> <span class="muted">' + esc(sum(b)) + '</span>'; }
      else if (t.dataset.item) { const s = new Set(b.items || []); t.checked ? s.add(t.dataset.item) : s.delete(t.dataset.item); b.items = prods().map(x => x.sku).filter(x => s.has(x)); snap(); later(); }
      else if (t.dataset.lk) { b.links[+t.dataset.i][t.dataset.lk] = t.value; snap(b.id + 'lk'); later(); }
    };
    el.oninput = onField; el.onchange = e => { onField(e); if (e.target.dataset.f === 'art' || e.target.dataset.df) later(); };
    el.onkeydown = e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); }
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ed-it')) { e.preventDefault(); sel = +e.target.dataset.i; full(); }
    };
    /* drag and drop */
    el.addEventListener('dragstart', e => { const li = e.target.closest('.ed-it'), nw = e.target.closest('[data-new]'); if (li) e.dataTransfer.setData('text/plain', 'move:' + li.dataset.i); else if (nw) e.dataTransfer.setData('text/plain', 'new:' + nw.dataset.new); e.dataTransfer.effectAllowed = 'copyMove'; });
    el.addEventListener('dragover', e => { const l = e.target.closest('.ed-list'); if (!l) return; e.preventDefault(); el.querySelectorAll('.ed-it').forEach(x => x.classList.remove('over')); const li = e.target.closest('.ed-it'); if (li) li.classList.add('over'); });
    el.addEventListener('drop', e => {
      const l = e.target.closest('.ed-list'); if (!l) return; e.preventDefault();
      const data = e.dataTransfer.getData('text/plain') || '', li = e.target.closest('.ed-it');
      let at = li ? +li.dataset.i : d.blocks.length;
      if (li) { const r = li.getBoundingClientRect(); if (e.clientY > r.top + r.height / 2) at++; }
      if (data.indexOf('new:') === 0) addBlock(data.slice(4), at);
      else if (data.indexOf('move:') === 0) { const from = +data.slice(5); if (from === at || from + 1 === at) return full(); const b = d.blocks.splice(from, 1)[0]; if (at > from) at--; d.blocks.splice(at, 0, b); sel = at; snap(); full(); }
    });
    el.addEventListener('dragend', () => el.querySelectorAll('.ed-it').forEach(x => x.classList.remove('over')));
    full();
    return { get: () => d, undo, redo, refresh: () => paintPreview(), destroy: () => { dead = true; clearTimeout(tm); el.innerHTML = ''; el.onclick = el.oninput = el.onchange = el.onkeydown = null; } };
  };
})();
