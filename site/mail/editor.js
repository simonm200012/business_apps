/* Adrial Mail — block-based email editor. Drag & drop (palette → canvas, reorder) with button and
 * keyboard alternatives, rich text (bold/italic/link/alignment), styles panel, desktop/mobile preview
 * in a sandboxed iframe, generated plain-text version, undo/redo, send test (simulated), save as template. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, E = AM.E, UI = AM.UI, M = AM.Email, esc = U.esc, ic = U.ic, I = U.I;
  var Ed = AM.Editor = {};

  var PRESETS = {
    'Adrial teal': { bg: '#EFEBE4', content: '#FFFFFF', text: '#22272B', muted: '#6A6F73', link: '#0E5A63', btn: '#0E5A63', btnText: '#FFFFFF', head: '#0E5A63', headText: '#FFFFFF' },
    'Summer coral': { bg: '#F6EADF', content: '#FFFFFF', text: '#2B2420', muted: '#7A6A60', link: '#A63F21', btn: '#C2502E', btnText: '#FFFFFF', head: '#C2502E', headText: '#FFFFFF' },
    'Midnight': { bg: '#10151C', content: '#1B232D', text: '#E9EEF3', muted: '#9AA7B4', link: '#8FD3E0', btn: '#8FD3E0', btnText: '#0D1A20', head: '#0B1016', headText: '#E9EEF3' },
    'Minimal': { bg: '#F5F5F5', content: '#FFFFFF', text: '#111111', muted: '#666666', link: '#111111', btn: '#111111', btnText: '#FFFFFF', head: '#FFFFFF', headText: '#111111' }
  };
  var COLORS = [['bg', 'Page background'], ['content', 'Content background'], ['text', 'Text'], ['muted', 'Muted text'], ['link', 'Links'], ['head', 'Header background'], ['headText', 'Header text'], ['btn', 'Button'], ['btnText', 'Button text']];

  // Pre-send checks shared with the campaign wizard.
  Ed.checks = function (design, subject, preview) {
    var out = [], blocks = design.blocks || [];
    out.push(M.hasFooter(design) ? { ok: true, t: 'Footer with unsubscribe link present' } : { ok: false, t: 'Add a Footer block — every marketing email needs an unsubscribe link' });
    var noAlt = blocks.filter(function (b) { return b.type === 'image' && !String(b.alt || '').trim(); }).length;
    out.push(noAlt ? { ok: false, warn: true, t: noAlt + ' image(s) without alt text' } : { ok: true, t: 'All images have alt text' });
    var bad = 0;
    blocks.forEach(function (b) {
      if ((b.type === 'button' || b.type === 'image') && b.url && !M.safeUrl(b.url)) bad++;
      if (b.type === 'columns') (b.cells || []).forEach(function (c) { if (c.url && !M.safeUrl(c.url)) bad++; });
    });
    out.push(bad ? { ok: false, t: bad + ' link(s) are not valid https:// or mailto: URLs' } : { ok: true, t: 'All links valid' });
    var strs = []; (function walk(v) { if (typeof v === 'string') strs.push(v); else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k]); }); })(blocks);
    var txt = strs.join(' ').replace(/&quot;/g, '"') + ' ' + (subject || '') + ' ' + (preview || '');
    var bt = M.badTags(txt);
    out.push(bt.length ? { ok: false, t: 'Malformed personalization tag: ' + bt[0] } : { ok: true, t: 'Personalization tags valid' });
    if (subject != null) out.push(!String(subject).trim() ? { ok: false, t: 'Subject line is empty' } : String(subject).length > 70 ? { ok: false, warn: true, t: 'Subject is ' + subject.length + ' characters — may be cut off on mobile' } : { ok: true, t: 'Subject length OK (' + String(subject).length + ' characters)' });
    var kb = Math.round(M.render(design, { ctx: E.ctx, mode: 'export' }).length / 1024);
    out.push(kb > 102 ? { ok: false, warn: true, t: 'HTML is ' + kb + ' KB — Gmail clips messages over 102 KB' } : { ok: true, t: 'HTML size ' + kb + ' KB (under the 102 KB clipping limit)' });
    return out;
  };
  Ed.checksHtml = function (list) {
    return '<ul class="rows">' + list.map(function (c) { return '<li style="padding-left:0;padding-right:0"><span class="chip ' + (c.ok ? 'good' : c.warn ? 'warn' : 'bad') + '">' + (c.ok ? '✓' : '!') + '</span><div class="main" style="font-size:13.5px">' + esc(c.t) + '</div></li>'; }).join('') + '</ul>';
  };

  // ── Canvas mock of a block (app DOM; text sanitized, colours validated) ──
  function mock(b, s, p) {
    var f = M.FONTS[s.font].css;
    switch (b.type) {
      case 'header': return '<div class="mock" style="background:' + s.head + ';color:' + s.headText + ';text-align:' + (b.align === 'left' ? 'left' : 'center') + ';padding:18px 20px"><div style="font-family:Georgia,serif;font-size:24px;letter-spacing:1px">' + esc(b.logo || 'Adrial') + '</div>' + (b.tag ? '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.8">' + esc(b.tag) + '</div>' : '') + (b.nav ? '<div style="font-size:12.5px;margin-top:8px;opacity:.9">Eyeglasses · Sunglasses · Contact lenses</div>' : '') + '</div>';
      case 'text': return '<div class="mock" style="font-family:' + f + ';font-size:' + (b.size || s.size) + 'px;text-align:' + (['left', 'center', 'right'].indexOf(b.align) >= 0 ? b.align : 'left') + ';padding:12px ' + Math.min(s.pad, 28) + 'px">' + M.sanitize(b.html) + '</div>';
      case 'image': return '<div class="mock" style="padding:0"><img alt="' + esc(b.alt || '') + '" src="' + M.art(b.art, 600, U.clamp(U.num(b.height, 240), 80, 480), { headline: b.headline, sub: b.sub }) + '"></div>';
      case 'button': return '<div class="mock" style="text-align:' + (b.align || 'center') + '"><span class="mbtn" style="background:' + s.btn + ';color:' + s.btnText + ';font-family:' + f + (b.full ? ';display:block;text-align:center' : '') + '">' + esc(b.label) + '</span>' + (!M.safeUrl(b.url) ? '<div class="hint" style="color:#B4561C">Invalid link</div>' : '') + '</div>';
      case 'products':
        var items = M.blockProducts(b, { ctx: E.ctx, profile: p });
        return '<div class="mock" style="font-family:' + f + '">' + (b.title ? '<div style="font-weight:600;text-align:center;margin-bottom:8px">' + esc(b.title) + '</div>' : '') + (items.length ? '<div class="mgrid" style="grid-template-columns:repeat(' + items.length + ',minmax(0,1fr))">' + items.map(function (it) { return '<div class="mprod"><img alt="" src="' + M.productArt(it, 120) + '"><div style="font-weight:600">' + esc(it.name) + '</div>' + (b.price !== false ? '<div style="color:' + s.muted + '">' + esc(U.money2(it.price)) + '</div>' : '') + '</div>'; }).join('') + '</div>' : '<div style="padding:14px;text-align:center;color:' + s.muted + ';border:1px dashed ' + s.muted + '">' + (b.mode === 'static' ? 'Choose products in the panel →' : 'Dynamic: ' + esc(modeLabel(b.mode)) + ' (none for the preview profile)') + '</div>') + (b.mode !== 'static' ? '<div style="font-size:11px;color:' + s.muted + ';text-align:center;margin-top:6px">Dynamic · ' + esc(modeLabel(b.mode)) + '</div>' : '') + '</div>';
      case 'columns': return '<div class="mock" style="font-family:' + f + '"><div class="mgrid" style="grid-template-columns:repeat(' + (b.cells || []).length + ',minmax(0,1fr))">' + (b.cells || []).map(function (c) { return '<div>' + (c.art ? '<img alt="" style="border-radius:6px" src="' + M.art(c.art, 300, 160) + '">' : '') + '<div style="font-weight:600;margin-top:6px">' + esc(c.title) + '</div><div style="font-size:13px;color:' + s.muted + '">' + esc(c.text) + '</div>' + (c.label ? '<div style="font-size:13px;font-weight:600;color:' + s.link + '">' + esc(c.label) + ' →</div>' : '') + '</div>'; }).join('') + '</div></div>';
      case 'divider': return '<div class="mock" style="padding:8px 20px"><div style="border-top:' + U.clamp(U.num(b.w, 1), 1, 6) + 'px solid ' + U.color(b.color, '#E1DCD3') + '"></div></div>';
      case 'spacer': return '<div class="mock" style="padding:0;height:' + U.clamp(U.num(b.h, 24), 4, 120) + 'px;background:repeating-linear-gradient(135deg,transparent 0 6px,rgba(127,127,127,.08) 6px 12px)"></div>';
      case 'social': return '<div class="mock" style="text-align:' + (b.align === 'left' ? 'left' : 'center') + '">' + (b.items || []).map(function (n) { return '<span style="display:inline-block;margin:3px;padding:6px 12px;border-radius:999px;background:' + s.bg + ';color:' + s.text + ';font-size:12.5px">' + esc(n) + '</span>'; }).join('') + '</div>';
      case 'footer': return '<div class="mock" style="font-family:' + f + ';font-size:12px;color:' + s.muted + ';text-align:' + (b.align === 'left' ? 'left' : 'center') + ';white-space:pre-line">' + esc(b.text) + '\n<u>' + esc(b.unsub || 'Unsubscribe') + '</u>' + (b.prefs ? ' · <u>Manage preferences</u>' : '') + '</div>';
    }
    return '';
  }
  function modeLabel(m) { return { static: 'Chosen products', recommended: 'Recommended for the recipient', last_viewed: 'Last viewed by the recipient', cart: 'Abandoned cart items', reorder: 'Last purchased lenses / solutions' }[m] || m; }

  Ed.mount = function (root, o) {
    var design = o.design, st = { mode: 'edit', device: U.pref('edDevice') || 'desktop', sel: null, left: 'blocks', undo: [JSON.stringify(design)], redo: [] };
    var previewP = function () { var id = U.pref('previewP') || 1; return E.profile(id) || E.db().profiles[0]; };
    root.innerHTML = '<div class="ed"><div class="ed-bar"><div class="grp"><div class="seg" role="group" aria-label="Editor mode"><button type="button" data-mode="edit">Edit</button><button type="button" data-mode="preview">Preview</button><button type="button" data-mode="plain">Plain text</button></div>' +
      '<div class="seg" role="group" aria-label="Preview device" id="edDev"><button type="button" data-dev="desktop">Desktop</button><button type="button" data-dev="mobile">Mobile</button></div></div>' +
      '<div class="grp"><button type="button" class="btn sm icon" id="edUndo" aria-label="Undo">' + ic(I.undo) + '</button><button type="button" class="btn sm icon" id="edRedo" aria-label="Redo">' + ic(I.redo) + '</button>' +
      '<button type="button" class="btn sm" id="edTest">' + ic(I.send) + 'Send test</button>' + (o.saveAsTemplate !== false ? '<button type="button" class="btn sm" id="edTpl">' + ic(I.copy) + 'Save as template</button>' : '') + '<button type="button" class="btn sm" id="edHtml">' + ic(I.download) + 'HTML</button><span class="hint" id="edSaved" aria-live="polite">Saved</span></div></div>' +
      '<div class="ed-main"><aside class="ed-panel ed-left" aria-label="Blocks and styles"><div class="ph"><div class="seg sm" role="tablist"><button type="button" role="tab" data-left="blocks">Blocks</button><button type="button" role="tab" data-left="styles">Styles</button></div></div><div class="pb" id="edLeft"></div></aside>' +
      '<div id="edCenter" style="min-width:0"></div><aside class="ed-panel ed-props" aria-label="Properties"><div class="ph"><h3 style="margin:0;font-size:15px" id="edPropsT">Properties</h3></div><div class="pb" id="edProps"></div></aside></div></div>';
    var $ = function (s) { return root.querySelector(s); };
    var saved = $('#edSaved');
    var commit = U.debounce(function () {
      var j = JSON.stringify(design);
      if (st.undo[st.undo.length - 1] !== j) { st.undo.push(j); if (st.undo.length > 60) st.undo.shift(); st.redo = []; }
      o.onChange(design); saved.textContent = 'Saved'; syncUndo();
    }, 400);
    var changed = function () { saved.textContent = 'Saving…'; commit(); };
    var syncUndo = function () { $('#edUndo').disabled = st.undo.length < 2; $('#edRedo').disabled = !st.redo.length; };
    var restore = function (j) { var d = JSON.parse(j); design.s = d.s; design.blocks = d.blocks; o.onChange(design); if (st.sel && !find(st.sel)) st.sel = null; renderAll(); syncUndo(); };
    function find(id) { return design.blocks.filter(function (b) { return b.id === id; })[0]; }
    function idxOf(id) { for (var i = 0; i < design.blocks.length; i++) if (design.blocks[i].id === id) return i; return -1; }

    // ── Left panel ────────────────────────────────────────────────────
    function renderLeft() {
      U.$$('[data-left]', root).forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.left === st.left)); });
      var box = $('#edLeft');
      if (st.left === 'blocks') {
        box.innerHTML = '<p class="hint" style="margin:0">Drag a block onto the email, or press it to add after the selected block.</p><div class="palette">' + Object.keys(M.BLOCKS).map(function (k) { return '<button type="button" class="pal" draggable="true" data-add="' + k + '">' + ic(M.BLOCKS[k].icon) + esc(M.BLOCKS[k].label) + '</button>'; }).join('') + '</div>';
      } else {
        var s = M.styles(design);
        box.innerHTML = '<div class="field"><label for="edPreset">Theme preset</label><select class="in sm" id="edPreset"><option value="">Choose a preset…</option>' + Object.keys(PRESETS).map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('') + '</select></div>' +
          COLORS.map(function (c) { return '<label class="colorrow" for="sc_' + c[0] + '"><span>' + esc(c[1]) + '</span><input class="in" type="color" id="sc_' + c[0] + '" data-style="' + c[0] + '" value="' + s[c[0]] + '"></label>'; }).join('') +
          '<div class="field"><label for="sc_font">Font (email-safe)</label><select class="in sm" id="sc_font" data-style="font">' + Object.keys(M.FONTS).map(function (k) { return '<option value="' + k + '"' + (s.font === k ? ' selected' : '') + '>' + esc(M.FONTS[k].label) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="sc_size">Base text size: ' + s.size + 'px</label><input type="range" id="sc_size" data-style="size" min="13" max="20" value="' + s.size + '"></div>' +
          '<div class="field"><label for="sc_pad">Side padding: ' + s.pad + 'px</label><input type="range" id="sc_pad" data-style="pad" min="8" max="48" value="' + s.pad + '"></div>' +
          '<div class="field"><label for="sc_radius">Corner radius: ' + s.radius + 'px</label><input type="range" id="sc_radius" data-style="radius" min="0" max="24" value="' + s.radius + '"></div>';
      }
    }
    // ── Center ────────────────────────────────────────────────────────
    function renderCenter() {
      U.$$('[data-mode]', root).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)); });
      U.$$('[data-dev]', root).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.dev === st.device)); });
      $('#edDev').style.visibility = st.mode === 'preview' ? 'visible' : 'hidden';
      var box = $('#edCenter'), p = previewP();
      if (st.mode === 'preview') { box.innerHTML = UI.frame(UI.emailHtml(design, { profile: p, subject: o.subject && o.subject(), preview: o.preview && o.preview(), lang: p.lang }), { mobile: st.device === 'mobile', title: 'Email preview, ' + st.device }); return; }
      if (st.mode === 'plain') { box.innerHTML = '<pre class="plain" aria-label="Plain-text version">' + esc(M.plain(design, { profile: p, ctx: E.ctx })) + '</pre><p class="hint">Generated automatically from the blocks and sent as the text/plain part (simulated).</p>'; return; }
      var s = M.styles(design);
      box.innerHTML = '<div class="ed-canvas" id="edCanvas" aria-label="Email canvas"><div class="ed-sheet" style="background:' + s.bg + '"><div class="ed-paper" style="background:' + s.content + ';color:' + s.text + ';border-radius:' + s.radius + 'px;max-width:600px;margin:0 auto">' +
        (design.blocks.length ? design.blocks.map(function (b, i) { return blockHtml(b, i, s, p); }).join('') : '<div class="ed-empty">Drag blocks here from the left panel.</div>') + '</div></div></div>';
    }
    function blockHtml(b, i, s, p) {
      return '<div class="eb' + (st.sel === b.id ? ' sel' : '') + '" data-bid="' + esc(b.id) + '" tabindex="0" draggable="true" role="group" aria-label="' + esc(M.BLOCKS[b.type].label) + ' block, ' + (i + 1) + ' of ' + design.blocks.length + '. Enter to edit, Alt+arrows to move, Delete to remove.">' +
        '<span class="eb-tag">' + esc(M.BLOCKS[b.type].label) + '</span><span class="eb-tools"><button type="button" class="btn xs icon" data-bact="up" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + ic(I.up) + '</button><button type="button" class="btn xs icon" data-bact="down" aria-label="Move down"' + (i === design.blocks.length - 1 ? ' disabled' : '') + '>' + ic(I.down) + '</button><button type="button" class="btn xs icon" data-bact="dup" aria-label="Duplicate">' + ic(I.copy) + '</button><button type="button" class="btn xs icon" data-bact="del" aria-label="Delete">' + ic(I.trash) + '</button></span>' + mock(b, s, p) + '</div>';
    }
    function refreshBlock(b) {
      var el = root.querySelector('.eb[data-bid="' + b.id + '"]'); if (!el) return;
      var tmp = document.createElement('div'); tmp.innerHTML = mock(b, M.styles(design), previewP());
      var old = el.querySelector('.mock'); if (old && tmp.firstChild) el.replaceChild(tmp.firstChild, old);
    }
    // ── Properties ────────────────────────────────────────────────────
    function f(label, html, id) { return '<div class="field"><label' + (id ? ' for="' + id + '"' : '') + '>' + esc(label) + '</label>' + html + '</div>'; }
    function tx(id, prop, val, ph, type) { return '<input class="in sm" id="' + id + '" data-p="' + prop + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'; }
    function alignSeg(prop, val, opts) { return '<div class="seg sm" role="group" aria-label="Alignment">' + (opts || ['left', 'center', 'right']).map(function (a) { return '<button type="button" data-set="' + prop + ':' + a + '" aria-pressed="' + (val === a) + '">' + a + '</button>'; }).join('') + '</div>'; }
    function renderProps() {
      var box = $('#edProps'), b = st.sel ? find(st.sel) : null, p = previewP();
      if (st.mode !== 'edit' || !b) {
        $('#edPropsT').textContent = st.mode === 'edit' ? 'Email' : 'Preview';
        box.innerHTML = UI.picker('edPP', 'Preview as profile (resolves tags & dynamic products)', p.id) +
          (o.subject ? '<div class="field"><span class="lab">Subject (resolved)</span><div style="font-weight:500">' + esc(M.resolve(o.subject(), p)) + '</div>' + (o.preview && o.preview() ? '<small class="muted">' + esc(M.resolve(o.preview(), p)) + '</small>' : '') + '</div>' : '') +
          '<div><span class="label">Checks</span>' + Ed.checksHtml(Ed.checks(design, o.subject ? o.subject() : null, o.preview ? o.preview() : null)) + '</div>' +
          (st.mode === 'edit' ? '<p class="hint" style="margin:0">Select a block on the canvas to edit it. ' + U.plural(design.blocks.length, 'block') + ' in this email.</p>' : '');
        UI.wirePicker(box, 'edPP', function (pp) { U.pref('previewP', pp.id); renderCenter(); renderProps(); });
        return;
      }
      $('#edPropsT').textContent = M.BLOCKS[b.type].label;
      var h = '';
      switch (b.type) {
        case 'header': h = f('Logo text', tx('pLogo', 'logo', b.logo), 'pLogo') + f('Tagline', tx('pTag', 'tag', b.tag), 'pTag') + '<div class="field"><span class="lab">Alignment</span>' + alignSeg('align', b.align, ['left', 'center']) + '</div><label class="check"><input type="checkbox" class="chk" data-p="nav"' + (b.nav ? ' checked' : '') + '> Show navigation links</label>'; break;
        case 'text':
          h = '<div class="field"><span class="lab" id="rteL">Text</span><div class="rte-bar" role="toolbar" aria-label="Text formatting"><button type="button" class="btn xs" data-rte="bold" aria-label="Bold"><b>B</b></button><button type="button" class="btn xs" data-rte="italic" aria-label="Italic"><i>I</i></button><button type="button" class="btn xs" data-rte="underline" aria-label="Underline"><u>U</u></button><button type="button" class="btn xs" data-rte="link">Link</button><button type="button" class="btn xs" data-rte="unlink">Unlink</button>' +
            '<label class="sr" for="rteTag">Insert personalization tag</label><select class="in sm" id="rteTag" style="width:auto;min-height:28px"><option value="">+ Tag…</option>' + M.TAGS.map(function (t) { return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('') + '</select></div>' +
            '<div class="rte" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="rteL" id="rte">' + M.sanitize(b.html) + '</div><div class="row2" id="rteLink" hidden><input class="in sm" id="rteUrl" placeholder="https://…" aria-label="Link URL"><button type="button" class="btn xs pri" id="rteApply">Apply link</button></div></div>' +
            '<div class="field"><span class="lab">Alignment</span>' + alignSeg('align', b.align) + '</div>' + f('Font size (0 = base)', '<input type="range" id="pSize" data-p="size" min="0" max="28" value="' + (b.size || 0) + '">', 'pSize') +
            '<p class="hint" style="margin:0">Tags like {{ first_name|default:"there" }} are replaced per recipient.</p>'; break;
        case 'image':
          h = '<div class="field"><span class="lab">Artwork (generated, no external images)</span><div class="swatches">' + M.ARTS.map(function (a) { return '<button type="button" data-set="art:' + a[0] + '" aria-pressed="' + (b.art === a[0]) + '" aria-label="' + esc(a[1]) + '" title="' + esc(a[1]) + '"><img alt="" src="' + M.art(a[0], 160, 100) + '"></button>'; }).join('') + '</div></div>' +
            f('Headline on image', tx('pH', 'headline', b.headline), 'pH') + f('Sub-headline', tx('pS', 'sub', b.sub), 'pS') + f('Alt text', tx('pAlt', 'alt', b.alt), 'pAlt') + f('Link URL', tx('pUrl', 'url', b.url, 'https://…', 'url'), 'pUrl') + f('Height: ' + b.height + 'px', '<input type="range" id="pHt" data-p="height" min="120" max="420" step="10" value="' + b.height + '">', 'pHt'); break;
        case 'button': h = f('Label', tx('pL', 'label', b.label), 'pL') + f('Link URL', tx('pUrl', 'url', b.url, 'https://…', 'url'), 'pUrl') + '<div class="field"><span class="lab">Alignment</span>' + alignSeg('align', b.align) + '</div><label class="check"><input type="checkbox" class="chk" data-p="full"' + (b.full ? ' checked' : '') + '> Full width</label>'; break;
        case 'products':
          h = f('Title', tx('pT', 'title', b.title), 'pT') + f('Products', '<select class="in sm" id="pMode" data-p="mode">' + ['static', 'recommended', 'last_viewed', 'cart', 'reorder'].map(function (m) { return '<option value="' + m + '"' + (b.mode === m ? ' selected' : '') + '>' + esc(modeLabel(m)) + (m !== 'static' ? ' (dynamic)' : '') + '</option>'; }).join('') + '</select>', 'pMode') +
            f('How many', '<select class="in sm" id="pCnt" data-p="count">' + [1, 2, 3, 4].map(function (n) { return '<option' + (+b.count === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>', 'pCnt') +
            '<label class="check"><input type="checkbox" class="chk" data-p="price"' + (b.price !== false ? ' checked' : '') + '> Show price</label>' + f('Link label', tx('pB', 'btn', b.btn), 'pB');
          if (b.mode === 'static') h += '<div class="field"><label for="pPQ">Choose products (' + (b.skus || []).length + ' selected)</label><input class="in sm" id="pPQ" type="search" placeholder="Filter products…"><div class="prodpick" id="pPick"></div></div>';
          else h += '<p class="hint" style="margin:0">Resolved per recipient from their events at send time. Preview shows the selected preview profile.</p>';
          break;
        case 'columns':
          h = f('Columns', '<select class="in sm" id="pN" data-cols="1"><option' + ((b.cells || []).length === 2 ? ' selected' : '') + '>2</option><option' + ((b.cells || []).length === 3 ? ' selected' : '') + '>3</option></select>', 'pN') +
            (b.cells || []).map(function (c, i) { return '<fieldset style="border:1px solid var(--hair);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px"><legend class="label">Column ' + (i + 1) + '</legend>' + f('Artwork', '<select class="in sm" id="cA' + i + '" data-cell="' + i + ':art"><option value="">none</option>' + M.ARTS.map(function (a) { return '<option value="' + a[0] + '"' + (c.art === a[0] ? ' selected' : '') + '>' + esc(a[1]) + '</option>'; }).join('') + '</select>', 'cA' + i) + f('Title', '<input class="in sm" id="cT' + i + '" data-cell="' + i + ':title" value="' + esc(c.title) + '">', 'cT' + i) + f('Text', '<textarea class="in sm" id="cX' + i + '" data-cell="' + i + ':text" rows="2" style="min-height:60px">' + esc(c.text) + '</textarea>', 'cX' + i) + '<div class="row2">' + f('Link label', '<input class="in sm" id="cL' + i + '" data-cell="' + i + ':label" value="' + esc(c.label) + '">', 'cL' + i) + f('URL', '<input class="in sm" id="cU' + i + '" data-cell="' + i + ':url" value="' + esc(c.url) + '">', 'cU' + i) + '</div></fieldset>'; }).join(''); break;
        case 'divider': h = '<label class="colorrow" for="pDc"><span>Colour</span><input class="in" type="color" id="pDc" data-p="color" value="' + U.color(b.color, '#E1DCD3') + '"></label>' + f('Thickness: ' + b.w + 'px', '<input type="range" id="pDw" data-p="w" min="1" max="6" value="' + b.w + '">', 'pDw'); break;
        case 'spacer': h = f('Height: ' + b.h + 'px', '<input type="range" id="pSh" data-p="h" min="4" max="120" value="' + b.h + '">', 'pSh'); break;
        case 'social': h = '<div class="field"><span class="lab">Networks (text links)</span>' + M.SOCIAL.map(function (n) { return '<label class="check"><input type="checkbox" class="chk" data-soc="' + esc(n) + '"' + ((b.items || []).indexOf(n) >= 0 ? ' checked' : '') + '> ' + esc(n) + '</label>'; }).join('') + '</div><div class="field"><span class="lab">Alignment</span>' + alignSeg('align', b.align, ['left', 'center']) + '</div>'; break;
        case 'footer': h = f('Footer text', '<textarea class="in sm" id="pFt" data-p="text" rows="4" style="min-height:90px">' + esc(b.text) + '</textarea>', 'pFt') + f('Unsubscribe link label', tx('pUn', 'unsub', b.unsub), 'pUn') + '<label class="check"><input type="checkbox" class="chk" data-p="prefs"' + (b.prefs ? ' checked' : '') + '> "Manage preferences" link</label><div class="field"><span class="lab">Alignment</span>' + alignSeg('align', b.align, ['left', 'center']) + '</div><p class="hint" style="margin:0">The unsubscribe link is always included and cannot be removed.</p>'; break;
      }
      h += '<div class="actions" style="border-top:1px solid var(--hair);padding-top:12px"><button type="button" class="btn sm" data-bact="up">' + ic(I.up) + 'Up</button><button type="button" class="btn sm" data-bact="down">' + ic(I.down) + 'Down</button><button type="button" class="btn sm" data-bact="dup">' + ic(I.copy) + 'Duplicate</button><button type="button" class="btn sm danger-ghost" data-bact="del">' + ic(I.trash) + 'Delete</button></div>';
      box.innerHTML = h;
      if (b.type === 'products' && b.mode === 'static') drawPick(b, '');
      if (b.type === 'text') wireRte(b);
    }
    function drawPick(b, q) {
      var el = $('#pPick'); if (!el) return;
      var db = E.db();
      el.innerHTML = db.products.filter(function (x) { return (b.skus || []).indexOf(x.sku) >= 0 || U.matchQ(q, x.name + ' ' + x.category + ' ' + x.sku); }).slice(0, 80).map(function (x) { return '<label><input type="checkbox" class="chk" data-sku="' + esc(x.sku) + '"' + ((b.skus || []).indexOf(x.sku) >= 0 ? ' checked' : '') + '> <span>' + esc(x.name) + ' <span class="muted">· ' + esc(x.category) + ' · ' + esc(U.money2(x.price)) + '</span></span></label>'; }).join('') || '<div class="hint">No products match.</div>';
    }
    function wireRte(b) {
      var rte = $('#rte'), saved = null;
      var sync = function () { b.html = M.sanitize(rte.innerHTML); refreshBlock(b); changed(); };
      rte.addEventListener('input', sync);
      rte.addEventListener('drop', function (e) { e.preventDefault(); var t = e.dataTransfer && e.dataTransfer.getData('text/plain'); if (t) { rte.focus(); document.execCommand('insertText', false, t); } });
      rte.addEventListener('paste', function (e) { e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
      rte.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && /^[biu]$/i.test(e.key)) { e.preventDefault(); document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]); sync(); } });
      $('#edProps').querySelector('.rte-bar').addEventListener('mousedown', function (e) { if (e.target.closest('[data-rte]')) e.preventDefault(); });
      $('#edProps').querySelector('.rte-bar').addEventListener('click', function (e) {
        var x = e.target.closest('[data-rte]'); if (!x) return;
        var cmd = x.dataset.rte;
        if (cmd === 'link') {
          var sel = window.getSelection();
          if (!sel.rangeCount || !rte.contains(sel.anchorNode) || sel.isCollapsed) { U.toast('Select some text in the editor first.'); return; }
          saved = sel.getRangeAt(0).cloneRange(); $('#rteLink').hidden = false; $('#rteUrl').value = 'https://'; $('#rteUrl').focus(); return;
        }
        rte.focus(); document.execCommand(cmd); sync();
      });
      $('#rteApply').addEventListener('click', function () {
        var url = M.safeUrl($('#rteUrl').value);
        if (!url) { $('#rteUrl').setAttribute('aria-invalid', 'true'); U.toast('Use an https://, http:// or mailto: link.'); return; }
        rte.focus(); var sel = window.getSelection(); sel.removeAllRanges(); if (saved) sel.addRange(saved);
        document.execCommand('createLink', false, url); $('#rteLink').hidden = true; sync();
      });
      $('#rteTag').addEventListener('change', function (e) {
        var t = e.target.value; if (!t) return; e.target.value = '';
        rte.focus(); var txt = t === 'unsubscribe_url' ? '{{ unsubscribe_url }}' : '{{ ' + t + (t === 'first_name' ? '|default:"there"' : '') + ' }}';
        document.execCommand('insertText', false, txt); sync();
      });
    }
    function renderAll() { renderLeft(); renderCenter(); renderProps(); }
    function select(id, focusCanvas) {
      st.sel = id;
      U.$$('.eb', root).forEach(function (el) { el.classList.toggle('sel', el.dataset.bid === id); });
      renderProps();
      if (focusCanvas) { var el = root.querySelector('.eb[data-bid="' + id + '"]'); if (el) el.focus(); }
      if (id && window.innerWidth < 900) { var pp = $('.ed-props'); if (pp) pp.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
    function insert(type, at) {
      var b = M.block(type);
      if (type === 'products' && b.mode === 'static') b.skus = E.popular('').slice(0, 3).map(function (x) { return x.sku; });
      var i = at != null ? at : st.sel ? idxOf(st.sel) + 1 : design.blocks.length;
      design.blocks.splice(i, 0, b); st.sel = b.id; renderCenter(); renderProps(); changed();
      var el = root.querySelector('.eb[data-bid="' + b.id + '"]'); if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); }
      U.toast(M.BLOCKS[type].label + ' block added.');
    }
    function move(id, to) {
      var i = idxOf(id); if (i < 0) return;
      to = U.clamp(to, 0, design.blocks.length - 1); if (to === i) return;
      var b = design.blocks.splice(i, 1)[0]; design.blocks.splice(to, 0, b);
      renderCenter(); changed(); var el = root.querySelector('.eb[data-bid="' + id + '"]'); if (el) el.focus();
    }
    function act(a, id) {
      var i = idxOf(id); if (i < 0) return;
      if (a === 'up') move(id, i - 1);
      if (a === 'down') move(id, i + 1);
      if (a === 'dup') { var c = U.clone(design.blocks[i]); c.id = M.bid(); design.blocks.splice(i + 1, 0, c); st.sel = c.id; renderCenter(); renderProps(); changed(); }
      if (a === 'del') {
        if (design.blocks[i].type === 'footer' && design.blocks.filter(function (b) { return b.type === 'footer'; }).length === 1) U.toast('Footer removed — add one back before sending (unsubscribe link required).');
        design.blocks.splice(i, 1); st.sel = design.blocks[Math.min(i, design.blocks.length - 1)] ? design.blocks[Math.min(i, design.blocks.length - 1)].id : null;
        renderCenter(); renderProps(); changed(); if (st.sel) { var el = root.querySelector('.eb[data-bid="' + st.sel + '"]'); if (el) el.focus(); }
      }
    }

    // ── Events ────────────────────────────────────────────────────────
    root.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-mode]'))) { st.mode = t.dataset.mode; renderCenter(); renderProps(); return; }
      if ((t = e.target.closest('[data-dev]'))) { st.device = U.pref('edDevice', t.dataset.dev); renderCenter(); return; }
      if ((t = e.target.closest('[data-left]'))) { st.left = t.dataset.left; renderLeft(); return; }
      if ((t = e.target.closest('[data-add]'))) { if (st.mode !== 'edit') { st.mode = 'edit'; renderCenter(); } insert(t.dataset.add); return; }
      if ((t = e.target.closest('[data-bact]'))) { var eb = t.closest('.eb'); act(t.dataset.bact, eb ? eb.dataset.bid : st.sel); return; }
      if ((t = e.target.closest('[data-set]'))) { var b = find(st.sel); if (!b) return; var kv = t.dataset.set.split(':'); b[kv[0]] = kv[1]; refreshBlock(b); renderProps(); changed(); return; }
      if ((t = e.target.closest('.eb'))) { if (st.sel !== t.dataset.bid) select(t.dataset.bid); return; }
      if (e.target.closest('#edUndo')) { if (st.undo.length > 1) { st.redo.push(st.undo.pop()); restore(st.undo[st.undo.length - 1]); } return; }
      if (e.target.closest('#edRedo')) { if (st.redo.length) { var j = st.redo.pop(); st.undo.push(j); restore(j); } return; }
      if (e.target.closest('#edTest')) { sendTest(); return; }
      if (e.target.closest('#edTpl')) { saveTemplate(); return; }
      if (e.target.closest('#edHtml')) { U.download((o.fileName || 'adrial-mail-email') + '.html', M.render(design, { ctx: E.ctx, profile: previewP(), subject: o.subject && o.subject(), preview: o.preview && o.preview(), mode: 'export' }), 'text/html'); U.toast('HTML exported (rendered for the preview profile).'); }
    });
    root.addEventListener('keydown', function (e) {
      var eb = e.target.classList && e.target.classList.contains('eb') ? e.target : null; if (!eb) return;
      var id = eb.dataset.bid;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); var first = $('#edProps').querySelector('input,select,textarea,[contenteditable]'); if (first) first.focus(); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(id, idxOf(id) - 1); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(id, idxOf(id) + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); var n = design.blocks[idxOf(id) + (e.key === 'ArrowUp' ? -1 : 1)]; if (n) select(n.id, true); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act('del', id); }
    });
    root.addEventListener('input', function (e) {
      var t = e.target, b = find(st.sel);
      if (t.dataset.style) {
        var k = t.dataset.style; design.s = design.s || {}; design.s[k] = t.type === 'range' ? +t.value : t.value;
        if (t.type === 'range') { var lab = root.querySelector('label[for="' + t.id + '"]'); if (lab) lab.textContent = lab.textContent.replace(/\d+px/, t.value + 'px'); }
        renderCenter(); changed(); return;
      }
      if (!b) return;
      if (t.dataset.p && t.type !== 'checkbox' && t.tagName !== 'SELECT') {
        var v = t.type === 'range' || t.type === 'number' ? +t.value : t.value;
        b[t.dataset.p] = v;
        if (t.dataset.p === 'url') t.setAttribute('aria-invalid', String(!!t.value && !M.safeUrl(t.value)));
        if (t.type === 'range') { var lb = root.querySelector('label[for="' + t.id + '"]'); if (lb) lb.textContent = lb.textContent.replace(/\d+px/, t.value + 'px'); }
        refreshBlock(b); changed();
      }
      if (t.dataset.cell) { var a = t.dataset.cell.split(':'); b.cells[+a[0]][a[1]] = t.value; refreshBlock(b); changed(); }
      if (t.id === 'pPQ') drawPick(b, t.value);
    });
    root.addEventListener('change', function (e) {
      var t = e.target, b = find(st.sel);
      if (t.id === 'edPreset' && t.value) { Object.assign(design.s, PRESETS[t.value]); renderLeft(); renderCenter(); changed(); return; }
      if (t.dataset.style && t.tagName === 'SELECT') { design.s[t.dataset.style] = t.value; renderCenter(); changed(); return; }
      if (!b) return;
      if (t.dataset.p && (t.type === 'checkbox' || t.tagName === 'SELECT')) {
        b[t.dataset.p] = t.type === 'checkbox' ? t.checked : (t.dataset.p === 'count' ? +t.value : t.value);
        if (t.dataset.p === 'mode' && b.mode === 'static' && !(b.skus || []).length) b.skus = E.popular('').slice(0, 3).map(function (x) { return x.sku; });
        refreshBlock(b); if (t.tagName === 'SELECT') renderProps(); changed();
      }
      if (t.dataset.cell && t.tagName === 'SELECT') { var a = t.dataset.cell.split(':'); b.cells[+a[0]][a[1]] = t.value; refreshBlock(b); changed(); }
      if (t.dataset.cols) { var n = +t.value; while (b.cells.length < n) b.cells.push({ art: 'frames', title: 'New column', text: 'Short description.', label: 'Read more', url: 'https://moje-lece.si/' }); b.cells = b.cells.slice(0, n); refreshBlock(b); renderProps(); changed(); }
      if (t.dataset.sku) { b.skus = b.skus || []; if (t.checked) { if (b.skus.length >= 4) { t.checked = false; U.toast('Up to 4 products.'); return; } b.skus.push(t.dataset.sku); } else b.skus = b.skus.filter(function (s) { return s !== t.dataset.sku; }); b.count = Math.max(1, b.skus.length); refreshBlock(b); var lab = $('#edProps').querySelector('label[for="pPQ"]'); if (lab) lab.textContent = 'Choose products (' + b.skus.length + ' selected)'; changed(); }
      if (t.dataset.soc) { b.items = M.SOCIAL.filter(function (n) { var c = root.querySelector('[data-soc="' + n + '"]'); return c && c.checked; }); refreshBlock(b); changed(); }
    });
    // Drag & drop
    var drag = null, line = document.createElement('div'); line.className = 'drop-line';
    root.addEventListener('dragstart', function (e) {
      var pal = e.target.closest && e.target.closest('[data-add]'), eb = e.target.closest && e.target.closest('.eb');
      if (pal) drag = { add: pal.dataset.add }; else if (eb) { drag = { move: eb.dataset.bid }; eb.classList.add('dragging'); } else return;
      e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', drag.add || drag.move); } catch (x) {}
    });
    root.addEventListener('dragend', function () { drag = null; line.remove(); U.$$('.eb.dragging', root).forEach(function (x) { x.classList.remove('dragging'); }); });
    function dropIndex(y) {
      var els = U.$$('.eb', root), i;
      for (i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return { i: i, el: els[i] }; }
      return { i: els.length, el: null };
    }
    root.addEventListener('dragover', function (e) {
      if (!drag || !e.target.closest('#edCanvas')) return;
      e.preventDefault();
      var d = dropIndex(e.clientY), paper = root.querySelector('.ed-paper');
      if (d.el) paper.insertBefore(line, d.el); else paper.appendChild(line);
    });
    root.addEventListener('drop', function (e) {
      if (!drag || !e.target.closest('#edCanvas')) return;
      e.preventDefault(); line.remove();
      var d = dropIndex(e.clientY);
      if (drag.add) insert(drag.add, d.i);
      else { var from = idxOf(drag.move); var to = d.i > from ? d.i - 1 : d.i; move(drag.move, to); }
      drag = null;
    });

    function sendTest() {
      var db = E.db(), test = (db.lists.filter(function (l) { return l.name === 'Internal test list'; })[0] || db.lists[0]);
      var opts = (test ? test.members : []).map(E.profile).filter(Boolean);
      var host = U.modal({ title: 'Send test email', sub: 'Simulated — nothing is sent.', body: '<div class="field"><label for="stTo">Test recipient</label><select class="in" id="stTo">' + opts.map(function (p) { return '<option value="' + p.id + '">' + esc(E.fullName(p) + ' <' + p.email + '>') + '</option>'; }).join('') + '</select></div><label class="check"><input type="checkbox" class="chk" id="stPers" checked> Personalize with this recipient\'s data</label>',
        foot: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="stGo">' + ic(I.send) + 'Send test (simulated)</button>' });
      host.querySelector('#stGo').addEventListener('click', function () { var p = E.profile(host.querySelector('#stTo').value); U.close(host); U.toast('Test email to ' + (p ? p.email : 'test recipient') + ' simulated — nothing was sent.'); });
    }
    function saveTemplate() {
      var host = U.modal({ title: 'Save as template', body: '<div class="field"><label for="tN">Template name</label><input class="in" id="tN" value="' + esc((o.title || 'My template') + ' (template)') + '"></div><div class="field"><label for="tC">Category</label><input class="in" id="tC" value="Custom"></div>',
        foot: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="tGo">Save template</button>' });
      host.querySelector('#tGo').addEventListener('click', function () {
        var name = host.querySelector('#tN').value.trim() || 'Untitled template', db = E.db(), now = E.now();
        var t = { id: E.nextId('template'), key: 'custom', name: name, category: host.querySelector('#tC').value.trim() || 'Custom', subject: o.subject ? o.subject() : '', preview: o.preview ? o.preview() : '', builtin: false, created: now, updated: now, design: M.reid(design) };
        db.templates.push(t); AM.App.save(['templates']); U.close(host); U.toast('Saved as template "' + name + '".');
      });
    }
    renderAll(); syncUndo();
  };
})();
