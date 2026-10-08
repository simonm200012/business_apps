/* Adrial Mail — email designs: block model, email-safe HTML renderer, plain text, personalization,
 * rich-text sanitizer, generated SVG artwork (no external images) and the template library.
 * A design is JSON: { s: {styles}, blocks: [{id, type, ...props}] }. Rendered HTML is only ever shown
 * inside a sandboxed <iframe srcdoc>, never injected into the app DOM. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, esc = U.esc;
  var M = AM.Email = {};

  M.FONTS = {
    helvetica: { label: 'Helvetica / Arial', css: "Helvetica, Arial, sans-serif" },
    georgia: { label: 'Georgia (serif)', css: "Georgia, 'Times New Roman', serif" },
    verdana: { label: 'Verdana', css: "Verdana, Geneva, sans-serif" },
    trebuchet: { label: 'Trebuchet MS', css: "'Trebuchet MS', Helvetica, sans-serif" },
    tahoma: { label: 'Tahoma', css: "Tahoma, Verdana, sans-serif" }
  };
  M.STYLE_DEFAULT = { bg: '#EFEBE4', content: '#FFFFFF', text: '#22272B', muted: '#6A6F73', link: '#0E5A63', btn: '#0E5A63', btnText: '#FFFFFF', head: '#0E5A63', headText: '#FFFFFF', font: 'helvetica', size: 16, pad: 28, radius: 10 };
  M.ARTS = [['frames', 'Eyeglass frames'], ['sunglasses', 'Sunglasses at sunset'], ['lenses', 'Contact lenses'], ['eye', 'Eye exam'], ['box', 'Parcel / back in stock'], ['sale', 'Sale badge'], ['cart', 'Shopping bag'], ['heart', 'Heart'], ['pattern', 'Abstract waves'], ['store', 'Store front']];

  M.BLOCKS = {
    header: { label: 'Header / logo', icon: '<path d="M4 6h16M4 12h10"/><circle cx="18" cy="15" r="3"/>', def: function () { return { logo: 'Adrial', tag: 'Optika · moje-lece.si', align: 'center', nav: false }; } },
    text: { label: 'Text', icon: '<path d="M5 6h14M12 6v13M9 19h6"/>', def: function () { return { html: '<p>Write something your subscribers will want to read.</p>', align: 'left', size: 0 }; } },
    image: { label: 'Image', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="9" r="1.5"/>', def: function () { return { art: 'frames', headline: '', sub: '', alt: 'Illustration', url: 'https://moje-lece.si/', height: 240 }; } },
    button: { label: 'Button', icon: '<rect x="3" y="8" width="18" height="8" rx="4"/>', def: function () { return { label: 'Shop now', url: 'https://moje-lece.si/', align: 'center', full: false }; } },
    products: { label: 'Products', icon: '<rect x="3" y="4" width="8" height="8" rx="1.5"/><rect x="13" y="4" width="8" height="8" rx="1.5"/><path d="M3 16h8M13 16h8M3 20h5M13 20h5"/>', def: function () { return { title: 'Picked for you', mode: 'recommended', skus: [], count: 3, price: true, btn: 'View' }; } },
    columns: { label: 'Columns', icon: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>', def: function () { return { cells: [{ art: 'eye', title: 'Free eye exam', text: 'Book online in two minutes.', label: 'Book now', url: 'https://moje-lece.si/' }, { art: 'box', title: 'Free delivery', text: 'On orders over €49.', label: 'Shop', url: 'https://moje-lece.si/' }] }; } },
    divider: { label: 'Divider', icon: '<path d="M3 12h18"/>', def: function () { return { color: '', w: 1 }; } },
    spacer: { label: 'Spacer', icon: '<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>', def: function () { return { h: 24 }; } },
    social: { label: 'Social links', icon: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/>', def: function () { return { items: ['Facebook', 'Instagram', 'TikTok', 'YouTube'], align: 'center' }; } },
    footer: { label: 'Footer + unsubscribe', icon: '<path d="M4 16h16M4 20h10"/><rect x="3" y="4" width="18" height="8" rx="2"/>', def: function () { return { text: 'Adrial d.o.o. · Demo street 1, 1000 Ljubljana, Slovenia\nYou are receiving this because you subscribed at moje-lece.si or adrialece.hr.', unsub: 'Unsubscribe', prefs: true, align: 'center' }; } }
  };
  M.SOCIAL = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'Pinterest', 'LinkedIn'];

  var seq = 0;
  M.bid = function () { return 'b' + (Date.now() % 1e6).toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 5); };
  M.block = function (type, props) { var b = Object.assign({ id: M.bid(), type: type }, M.BLOCKS[type].def(), props || {}); return b; };
  M.newDesign = function () { return { s: Object.assign({}, M.STYLE_DEFAULT), blocks: [M.block('header'), M.block('text'), M.block('button'), M.block('footer')] }; };
  M.reid = function (design) { var d = U.clone(design); d.blocks.forEach(function (b) { b.id = M.bid(); }); return d; };
  M.linkBlocks = function (design) { return (design && design.blocks || []).filter(function (b) { return ['image', 'button', 'products', 'columns', 'header'].indexOf(b.type) >= 0 || (b.type === 'text' && /<a\s/i.test(b.html || '')); }); };
  M.hasFooter = function (design) { return (design.blocks || []).some(function (b) { return b.type === 'footer'; }); };

  // ── Rich-text sanitizer (inert parse; whitelist tags; href http(s)/mailto/tags only) ──
  var ALLOWED = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, A: 1, BR: 1, P: 1, DIV: 1, SPAN: 1, UL: 1, OL: 1, LI: 1 };
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, TEMPLATE: 1, NOSCRIPT: 1, SVG: 1, MATH: 1, LINK: 1, META: 1, IMG: 1, VIDEO: 1, AUDIO: 1, FORM: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, BUTTON: 1 };
  M.safeUrl = function (u) {
    u = String(u || '').trim();
    if (/^\{\{[^}]+\}\}$/.test(u)) return u;
    if (/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(u)) return u;
    if (u === '#' || /^#[\w-]+$/.test(u)) return u;
    return '';
  };
  M.sanitize = function (html) {
    var doc = document.implementation.createHTMLDocument('');
    var box = doc.createElement('div'); box.innerHTML = String(html || '');
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) return;
        if (n.nodeType !== 1) { n.remove(); return; }
        var tag = n.tagName.toUpperCase();
        if (DROP[tag]) { n.remove(); return; }
        walk(n);
        if (!ALLOWED[tag]) { while (n.firstChild) node.insertBefore(n.firstChild, n); n.remove(); return; }
        var href = tag === 'A' ? M.safeUrl(n.getAttribute('href')) : '';
        Array.prototype.slice.call(n.attributes).forEach(function (a) { n.removeAttribute(a.name); });
        if (tag === 'A') { if (href) n.setAttribute('href', href); else { while (n.firstChild) node.insertBefore(n.firstChild, n); n.remove(); } }
      });
    })(box);
    return box.innerHTML.replace(/<div><br><\/div>/g, '<p><br></p>').replace(/<div>/g, '<p>').replace(/<\/div>/g, '</p>');
  };
  M.htmlToText = function (html) {
    return String(html || '')
      .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (m, h, t) { var tt = t.replace(/<[^>]+>/g, ''); return h && h !== tt ? tt + ' (' + h + ')' : tt; })
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n').trim();
  };

  // ── Personalization: {{ first_name|default:"there" }} ─────────────────
  M.TAGS = [
    ['first_name', 'First name'], ['last_name', 'Last name'], ['full_name', 'Full name'], ['email', 'Email'], ['city', 'City'], ['country', 'Country'],
    ['properties.preferred_store', 'Preferred store'], ['properties.lens_supply_days', 'Lens supply (days)'], ['properties.lens_brand', 'Lens brand'], ['unsubscribe_url', 'Unsubscribe link']
  ];
  var COUNTRY = { SI: 'Slovenia', HR: 'Croatia' };
  M.tagValue = function (name, p) {
    if (!p) return null;
    switch (name) {
      case 'first_name': return p.first; case 'last_name': return p.last; case 'full_name': return p.first + ' ' + p.last;
      case 'email': return p.email; case 'phone_number': case 'phone': return p.phone; case 'city': return p.city;
      case 'country': return COUNTRY[p.country] || p.country; case 'language': return p.lang;
      case 'unsubscribe_url': return '#unsubscribe-demo'; case 'manage_preferences_url': return '#preferences-demo';
    }
    if (name.indexOf('properties.') === 0) { var v = p.props && p.props[name.slice(11)]; return v == null || v === '' ? null : String(v); }
    return null;
  };
  var TAG_RE = /\{\{\s*([a-zA-Z_][\w.]*)\s*(?:\|\s*default\s*:\s*(?:"([^"]*)"|&quot;([\s\S]*?)&quot;|'([^']*)'|&#39;([\s\S]*?)&#39;))?\s*\}\}/g;
  // html=true → values are HTML-escaped (input is already HTML). keep=true → unresolved tags stay visible.
  M.resolve = function (str, p, html, keep) {
    return String(str == null ? '' : str).replace(TAG_RE, function (m, name, d1, d2, d3, d4) {
      var def = d1 != null ? d1 : d2 != null ? d2 : d3 != null ? d3 : d4;
      if (name === 'unsubscribe_url' || name === 'manage_preferences_url') return M.tagValue(name, p || {});
      var v = M.tagValue(name, p);
      if (v == null || v === '') {
        if (def != null) return def; // in html mode the default comes from already-sanitized HTML
        return keep && !p ? m : '';
      }
      return html ? esc(v) : v;
    });
  };
  M.tagsIn = function (str) { var out = [], m; TAG_RE.lastIndex = 0; while ((m = TAG_RE.exec(String(str || '')))) out.push(m[1]); return out; };
  M.badTags = function (str) {
    var raw = String(str || '').match(/\{\{[\s\S]*?\}\}/g) || [];
    return raw.filter(function (t) { TAG_RE.lastIndex = 0; var m = TAG_RE.exec(t); return !m || m[0] !== t; });
  };

  // ── Artwork: generated SVG data URIs ───────────────────────────────────
  function svgUri(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
  function xmlText(s) { return esc(s); }
  M.art = function (kind, w, h, o) {
    o = o || {};
    var c1 = U.color(o.c1, '#0E5A63'), c2 = U.color(o.c2, '#F2C14E');
    var bgA = { frames: ['#E9E4DA', '#D8CFC0'], sunglasses: ['#F7B267', '#F25C54'], lenses: ['#D8EEF0', '#A9D6DC'], eye: ['#E3ECF4', '#C3D5E8'], box: ['#EFE6D8', '#E0CDAE'], sale: ['#0E5A63', '#0A3F46'], cart: ['#F1E3E0', '#E2C3BC'], heart: ['#F6DDE1', '#EBB8C1'], pattern: ['#0E5A63', '#147A84'], store: ['#E7E3DA', '#CFC6B5'] }[kind] || ['#E9E4DA', '#D8CFC0'];
    var dark = kind === 'sale' || kind === 'pattern';
    var cx = w / 2, cy = h / 2 - (o.headline ? h * 0.08 : 0), s = Math.min(w, h) / 240;
    var g = '';
    function T(x, y, sc) { return '<g transform="translate(' + x + ' ' + y + ') scale(' + sc + ')">'; }
    switch (kind) {
      case 'frames':
        g = T(cx, cy, s) + '<g fill="none" stroke="#2A2A2A" stroke-width="7" stroke-linecap="round"><rect x="-108" y="-30" width="90" height="62" rx="24"/><rect x="18" y="-30" width="90" height="62" rx="24"/><path d="M-18 -8q18-14 36 0M-108 -18l-36-10M108 -18l36-10"/></g><rect x="-100" y="-22" width="74" height="46" rx="18" fill="#fff" opacity=".35"/><rect x="26" y="-22" width="74" height="46" rx="18" fill="#fff" opacity=".35"/></g>'; break;
      case 'sunglasses':
        g = '<circle cx="' + (w * 0.72) + '" cy="' + (h * 0.32) + '" r="' + (Math.min(w, h) * 0.2) + '" fill="#FFE29A" opacity=".9"/><path d="M0 ' + (h * 0.78) + ' Q ' + (w * 0.25) + ' ' + (h * 0.7) + ' ' + (w * 0.5) + ' ' + (h * 0.78) + ' T ' + w + ' ' + (h * 0.76) + ' V ' + h + ' H 0 Z" fill="#1B4965" opacity=".55"/>' +
          T(cx * 0.82, cy, s) + '<path d="M-112 -26h92q4 0 4 6q-2 46-48 46q-44 0-50-46q0-6 2-6zM20 -26h92q4 0 2 6q-6 46-50 46q-46 0-48-46q0-6 4-6z" fill="#161616"/><path d="M-16 -16q16-10 32 0" stroke="#161616" stroke-width="7" fill="none"/><path d="M-96 -16l30 0M36 -16l30 0" stroke="#fff" stroke-width="4" opacity=".35" stroke-linecap="round"/></g>'; break;
      case 'lenses':
        g = T(cx, cy, s) + '<g fill="none" stroke="#2C7A86" stroke-width="5"><path d="M-110 10a48 48 0 0 1 96 0" /><path d="M14 10a48 48 0 0 1 96 0"/></g><path d="M-110 10a48 48 0 0 1 96 0q-48-22-96 0zM14 10a48 48 0 0 1 96 0q-48-22-96 0z" fill="#fff" opacity=".6"/><circle cx="0" cy="-58" r="9" fill="#2C7A86" opacity=".5"/><circle cx="-130" cy="-40" r="6" fill="#2C7A86" opacity=".35"/><circle cx="128" cy="-46" r="7" fill="#2C7A86" opacity=".4"/></g>'; break;
      case 'eye':
        g = T(cx, cy, s) + '<path d="M-120 0Q0 -90 120 0Q0 90 -120 0z" fill="#fff"/><circle r="40" fill="#3E6FA8"/><circle r="18" fill="#10233A"/><circle cx="12" cy="-12" r="7" fill="#fff"/><path d="M-120 0Q0 -90 120 0Q0 90 -120 0z" fill="none" stroke="#10233A" stroke-width="6"/></g>'; break;
      case 'box':
        g = T(cx, cy, s) + '<path d="M-80 -40l80-30 80 30v80l-80 30-80-30z" fill="#C79A5A"/><path d="M-80 -40l80 30 80-30M0 -10v100" stroke="#8A6332" stroke-width="5" fill="none"/><path d="M-40 -55l80 30" stroke="#F4E3C3" stroke-width="12"/></g>'; break;
      case 'sale':
        g = T(cx, cy, s) + '<circle r="78" fill="' + c2 + '"/><text y="20" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="64" font-weight="700" fill="#0A3F46">%</text></g>'; break;
      case 'cart':
        g = T(cx, cy, s) + '<path d="M-60 -30h120l-12 100h-96z" fill="#B5544B"/><path d="M-30 -30v-18a30 30 0 0 1 60 0v18" fill="none" stroke="#7E3029" stroke-width="8"/></g>'; break;
      case 'heart':
        g = T(cx, cy, s) + '<path d="M0 60C-90 0-80-70-30-70c18 0 30 12 30 24 0-12 12-24 30-24 50 0 60 70-30 130z" fill="#C2405A"/></g>'; break;
      case 'pattern':
        g = '<g fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2">' + [0, 1, 2, 3, 4, 5, 6].map(function (i) { var y = h * 0.15 + i * h * 0.12; return '<path d="M0 ' + y + ' Q ' + (w * 0.25) + ' ' + (y - 30) + ' ' + (w * 0.5) + ' ' + y + ' T ' + w + ' ' + y + '"/>'; }).join('') + '</g>'; break;
      case 'store':
        g = T(cx, cy, s) + '<rect x="-110" y="-40" width="220" height="110" fill="#fff"/><path d="M-120 -40h240l-14-34h-212z" fill="#0E5A63"/><rect x="-90" y="-10" width="70" height="80" fill="#BFD6DA"/><rect x="10" y="-10" width="80" height="44" fill="#BFD6DA"/></g>'; break;
    }
    var txt = '';
    if (o.headline) {
      var fs = Math.round(Math.min(44, w / 14)), y = h - (o.sub ? fs * 1.9 : fs * 1.1);
      txt = '<text x="' + cx + '" y="' + y + '" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="' + fs + '" font-weight="700" fill="' + (dark || kind === 'sunglasses' ? '#FFFFFF' : '#1E2A2E') + '">' + xmlText(o.headline) + '</text>' +
        (o.sub ? '<text x="' + cx + '" y="' + (y + fs * 0.95) + '" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="' + Math.round(fs * 0.48) + '" fill="' + (dark || kind === 'sunglasses' ? '#FFFFFF' : '#3A4448') + '" opacity=".9">' + xmlText(o.sub) + '</text>' : '');
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + bgA[0] + '"/><stop offset="1" stop-color="' + bgA[1] + '"/></linearGradient></defs><rect width="' + w + '" height="' + h + '" fill="url(#g)"/>' + g + txt + '</svg>';
    return svgUri(svg);
  };
  M.productArt = function (p, size) {
    size = size || 160;
    var hue = U.hash(p.sku || p.name) % 360, col = 'hsl(' + hue + ',38%,42%)', bg = 'hsl(' + hue + ',30%,93%)';
    var cat = p.category || '', g;
    if (/sun/i.test(cat)) g = '<path d="M28 66h40q3 0 2 5-3 24-22 24-19 0-22-24 0-5 2-5zM92 66h40q3 0 2 5-3 24-22 24-19 0-22-24 0-5 2-5z" fill="#1B1B1B"/><path d="M70 70q10-6 20 0" stroke="#1B1B1B" stroke-width="4" fill="none"/><path d="M36 72h14" stroke="' + col + '" stroke-width="3"/>';
    else if (/contact/i.test(cat)) g = '<rect x="40" y="44" width="80" height="72" rx="8" fill="#fff" stroke="' + col + '" stroke-width="4"/><circle cx="80" cy="80" r="20" fill="none" stroke="' + col + '" stroke-width="4"/><rect x="40" y="44" width="80" height="16" rx="6" fill="' + col + '"/>';
    else if (/solution/i.test(cat)) g = '<rect x="58" y="40" width="44" height="84" rx="12" fill="#fff" stroke="' + col + '" stroke-width="4"/><rect x="68" y="28" width="24" height="14" rx="3" fill="' + col + '"/><rect x="64" y="70" width="32" height="24" rx="4" fill="' + col + '" opacity=".35"/>';
    else if (/optical/i.test(cat)) g = '<circle cx="80" cy="80" r="36" fill="#fff" stroke="' + col + '" stroke-width="4"/><path d="M58 70q22-18 44 0" stroke="' + col + '" stroke-width="3" fill="none" opacity=".6"/>';
    else if (/access/i.test(cat)) g = '<rect x="30" y="58" width="100" height="44" rx="22" fill="' + col + '"/><path d="M40 80h80" stroke="#fff" stroke-width="2" opacity=".5"/>';
    else g = '<g fill="none" stroke="' + col + '" stroke-width="5"><rect x="26" y="62" width="48" height="34" rx="12"/><rect x="86" y="62" width="48" height="34" rx="12"/><path d="M74 72q6-6 12 0M26 68l-12-6M134 68l12-6"/></g>';
    return svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 160 160"><rect width="160" height="160" rx="12" fill="' + bg + '"/>' + g + '</svg>');
  };

  // ── Render to email-safe HTML ──────────────────────────────────────────
  M.styles = function (d) { var s = Object.assign({}, M.STYLE_DEFAULT, d && d.s || {}); ['bg', 'content', 'text', 'muted', 'link', 'btn', 'btnText', 'head', 'headText'].forEach(function (k) { s[k] = U.color(s[k], M.STYLE_DEFAULT[k]); }); s.size = U.clamp(U.num(s.size, 16), 12, 22); s.pad = U.clamp(U.num(s.pad, 28), 8, 56); s.radius = U.clamp(U.num(s.radius, 10), 0, 30); if (!M.FONTS[s.font]) s.font = 'helvetica'; return s; };

  // Resolve products for a block (static or dynamic) via ctx (provided by the engine).
  M.blockProducts = function (b, o) {
    var ctx = o.ctx || {}, n = U.clamp(U.num(b.count, 3), 1, 6);
    if (b.mode === 'static') return (b.skus || []).map(function (s) { return ctx.product ? ctx.product(s) : null; }).filter(Boolean).slice(0, n);
    return ctx.dynamic ? ctx.dynamic(b.mode, o.profile, n) : [];
  };

  function btnHtml(label, url, s, o, align, full, bid) {
    var href = M.safeUrl(M.resolve(url, o.profile)) || '#';
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="' + align + '" style="margin:0 ' + (align === 'center' ? 'auto' : '0') + (full ? ';width:100%' : '') + '"><tr><td style="border-radius:' + Math.min(s.radius * 3, 999) + 'px;background:' + s.btn + '" align="center"><a href="' + esc(href) + '" data-b="' + esc(bid) + '" style="display:inline-block;padding:14px 28px;font-family:' + M.FONTS[s.font].css + ';font-size:' + (s.size) + 'px;font-weight:bold;color:' + s.btnText + ';text-decoration:none;border-radius:' + Math.min(s.radius * 3, 999) + 'px">' + esc(M.resolve(label, o.profile)) + '</a></td></tr></table>';
  }
  function cell(content, s, extra) { return '<tr><td class="px" style="padding:' + (extra || ('12px ' + s.pad + 'px')) + '">' + content + '</td></tr>'; }

  M.renderBlock = function (b, s, o) {
    var f = M.FONTS[s.font].css, p = o.profile, out = '';
    var base = 'font-family:' + f + ';color:' + s.text + ';';
    switch (b.type) {
      case 'header':
        out = '<tr><td style="background:' + s.head + ';padding:22px ' + s.pad + 'px;text-align:' + (b.align === 'left' ? 'left' : 'center') + ';border-radius:' + s.radius + 'px ' + s.radius + 'px 0 0">' +
          '<a href="https://moje-lece.si/" data-b="' + esc(b.id) + '" style="text-decoration:none;font-family:Georgia,serif;font-size:28px;letter-spacing:1px;color:' + s.headText + '">' + esc(b.logo || 'Adrial') + '</a>' +
          (b.tag ? '<div style="font-family:' + f + ';font-size:12px;letter-spacing:2px;text-transform:uppercase;color:' + s.headText + ';opacity:.8;margin-top:4px">' + esc(b.tag) + '</div>' : '') +
          (b.nav ? '<div style="margin-top:12px;font-family:' + f + ';font-size:13px"><a href="https://moje-lece.si/" style="color:' + s.headText + ';text-decoration:none;margin:0 8px">Eyeglasses</a><a href="https://moje-lece.si/" style="color:' + s.headText + ';text-decoration:none;margin:0 8px">Sunglasses</a><a href="https://moje-lece.si/" style="color:' + s.headText + ';text-decoration:none;margin:0 8px">Contact lenses</a></div>' : '') +
          '</td></tr>';
        break;
      case 'text':
        var html = M.resolve(M.sanitize(b.html), p, true, o.keepTags);
        html = html.replace(/<a href="/g, '<a style="color:' + s.link + ';text-decoration:underline" data-b="' + esc(b.id) + '" href="').replace(/<p>/g, '<p style="margin:0 0 12px">');
        out = cell('<div style="' + base + 'font-size:' + (b.size || s.size) + 'px;line-height:1.55;text-align:' + (['left', 'center', 'right'].indexOf(b.align) >= 0 ? b.align : 'left') + '">' + html + '</div>', s);
        break;
      case 'image':
        var hh = U.clamp(U.num(b.height, 240), 80, 480);
        var img = '<img src="' + M.art(b.art, 1200, hh * 2, { headline: M.resolve(b.headline, p), sub: M.resolve(b.sub, p) }) + '" width="600" alt="' + esc(b.alt || '') + '" style="display:block;width:100%;max-width:600px;height:auto;border:0">';
        var u = M.safeUrl(b.url);
        out = '<tr><td style="padding:0">' + (u ? '<a href="' + esc(u) + '" data-b="' + esc(b.id) + '">' + img + '</a>' : img) + '</td></tr>';
        break;
      case 'button':
        out = cell(btnHtml(b.label, b.url, s, o, b.align === 'left' ? 'left' : b.align === 'right' ? 'right' : 'center', b.full, b.id), s, '14px ' + s.pad + 'px');
        break;
      case 'products':
        var items = M.blockProducts(b, o);
        if (!items.length) { out = cell('<div style="' + base + 'font-size:14px;color:' + s.muted + ';text-align:center;padding:16px;border:1px dashed ' + s.muted + '">' + (b.mode === 'static' ? 'Choose products for this block.' : 'Dynamic products appear here for each recipient (none for this preview profile).') + '</div>', s); break;
        }
        var w = Math.floor(100 / items.length);
        out = (b.title ? cell('<div style="' + base + 'font-size:' + (s.size + 4) + 'px;font-weight:bold;text-align:center">' + esc(M.resolve(b.title, p)) + '</div>', s, '18px ' + s.pad + 'px 4px') : '') +
          cell('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + items.map(function (it) {
            return '<td class="col" valign="top" width="' + w + '%" style="width:' + w + '%;padding:6px;text-align:center">' +
              '<a href="https://moje-lece.si/p/' + encodeURIComponent(it.sku) + '" data-b="' + esc(b.id) + '"><img src="' + M.productArt(it) + '" width="160" alt="' + esc(it.name) + '" style="display:block;width:100%;max-width:180px;height:auto;margin:0 auto;border-radius:' + s.radius + 'px"></a>' +
              '<div style="' + base + 'font-size:14px;font-weight:bold;margin-top:8px">' + esc(it.name) + '</div>' +
              (b.price !== false ? '<div style="' + base + 'font-size:14px;color:' + s.muted + ';margin:2px 0 8px">' + esc(U.money2(it.price)) + '</div>' : '') +
              (b.btn ? '<a href="https://moje-lece.si/p/' + encodeURIComponent(it.sku) + '" data-b="' + esc(b.id) + '" style="font-family:' + f + ';font-size:13px;color:' + s.link + ';font-weight:bold">' + esc(b.btn) + ' →</a>' : '') + '</td>';
          }).join('') + '</tr></table>', s, '8px ' + Math.max(8, s.pad - 8) + 'px');
        break;
      case 'columns':
        var cells = (b.cells || []).slice(0, 3), cw = Math.floor(100 / Math.max(1, cells.length));
        out = cell('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + cells.map(function (c) {
          var cu = M.safeUrl(c.url);
          return '<td class="col" valign="top" width="' + cw + '%" style="width:' + cw + '%;padding:8px">' +
            (c.art ? '<img src="' + M.art(c.art, 400, 220) + '" width="260" alt="" style="display:block;width:100%;height:auto;border-radius:' + s.radius + 'px">' : '') +
            '<div style="' + base + 'font-size:' + (s.size + 1) + 'px;font-weight:bold;margin:10px 0 4px">' + esc(M.resolve(c.title, p)) + '</div>' +
            '<div style="' + base + 'font-size:14px;line-height:1.5;color:' + s.muted + '">' + esc(M.resolve(c.text, p)) + '</div>' +
            (c.label && cu ? '<div style="margin-top:8px"><a href="' + esc(cu) + '" data-b="' + esc(b.id) + '" style="font-family:' + f + ';font-size:14px;font-weight:bold;color:' + s.link + '">' + esc(c.label) + ' →</a></div>' : '') + '</td>';
        }).join('') + '</tr></table>', s, '8px ' + Math.max(8, s.pad - 8) + 'px');
        break;
      case 'divider':
        out = cell('<div style="border-top:' + U.clamp(U.num(b.w, 1), 1, 6) + 'px solid ' + U.color(b.color, '#E1DCD3') + ';font-size:0;line-height:0">&nbsp;</div>', s, '10px ' + s.pad + 'px');
        break;
      case 'spacer':
        out = '<tr><td style="height:' + U.clamp(U.num(b.h, 24), 4, 120) + 'px;font-size:0;line-height:0">&nbsp;</td></tr>';
        break;
      case 'social':
        out = cell('<div style="text-align:' + (b.align === 'left' ? 'left' : 'center') + '">' + (b.items || []).map(function (n) {
          return '<a href="https://example.com/' + encodeURIComponent(n.toLowerCase()) + '" data-b="' + esc(b.id) + '" style="display:inline-block;margin:4px;padding:8px 14px;border-radius:999px;background:' + s.bg + ';color:' + s.text + ';font-family:' + f + ';font-size:13px;text-decoration:none">' + esc(n) + '</a>';
        }).join('') + '</div>', s);
        break;
      case 'footer':
        out = cell('<div style="font-family:' + f + ';font-size:12px;line-height:1.6;color:' + s.muted + ';text-align:' + (b.align === 'left' ? 'left' : 'center') + '">' + esc(M.resolve(b.text, p)).replace(/\n/g, '<br>') +
          '<br><a href="' + esc(M.tagValue('unsubscribe_url', p || {})) + '" style="color:' + s.muted + ';text-decoration:underline">' + esc(b.unsub || 'Unsubscribe') + '</a>' +
          (b.prefs ? ' · <a href="#preferences-demo" style="color:' + s.muted + ';text-decoration:underline">Manage preferences</a>' : '') + '</div>', s, '22px ' + s.pad + 'px 28px');
        break;
    }
    if (o.heat && out) {
      var hc = o.heat[b.id] || 0, tot = o.heatTotal || 0;
      if (M.linkBlocks({ blocks: [b] }).length) {
        var share = tot ? hc / tot : 0, a = 0.12 + share * 0.75;
        out = '<tr><td style="padding:0;position:relative;outline:3px solid rgba(91,63,224,' + a.toFixed(2) + ');outline-offset:-3px"><div style="position:absolute;right:8px;top:8px;z-index:2;background:#5B3FE0;color:#fff;font:600 12px Helvetica,Arial,sans-serif;padding:4px 9px;border-radius:999px">' + U.n(hc) + ' clicks · ' + U.pct(share) + '</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + out + '</table></td></tr>';
      }
    }
    return out;
  };

  M.render = function (design, o) {
    o = o || {};
    var s = M.styles(design);
    var pre = M.resolve(o.preview || '', o.profile);
    var body = (design.blocks || []).map(function (b) { return M.renderBlock(b, s, o); }).join('');
    return '<!doctype html><html lang="' + esc(o.lang || 'en') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">' +
      '<title>' + esc(M.resolve(o.subject || '', o.profile)) + '</title><style>body{margin:0;padding:0;-webkit-text-size-adjust:100%}img{border:0;outline:none}table{border-collapse:collapse}p:last-child{margin-bottom:0!important}' +
      '@media only screen and (max-width:620px){.wrap{width:100%!important}.col{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box}.px{padding-left:16px!important;padding-right:16px!important}}' +
      (o.mode !== 'export' ? 'a{pointer-events:none;cursor:default}' : '') + '</style></head>' +
      '<body style="margin:0;padding:0;background:' + s.bg + '">' +
      (pre ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc(pre) + '</div>' : '') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + s.bg + '"><tr><td align="center" style="padding:24px 10px">' +
      '<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:' + s.content + ';border-radius:' + s.radius + 'px">' +
      body + '</table></td></tr></table></body></html>';
  };

  M.plain = function (design, o) {
    o = o || {}; var p = o.profile, lines = [];
    (design.blocks || []).forEach(function (b) {
      switch (b.type) {
        case 'header': lines.push((b.logo || 'Adrial').toUpperCase() + (b.tag ? ' — ' + b.tag : '')); break;
        case 'text': lines.push(M.htmlToText(M.resolve(M.sanitize(b.html), p, true, false))); break;
        case 'image': if (b.headline) lines.push(M.resolve(b.headline, p).toUpperCase() + (b.sub ? '\n' + M.resolve(b.sub, p) : '')); break;
        case 'button': lines.push(M.resolve(b.label, p) + ': ' + (M.safeUrl(M.resolve(b.url, p)) || '')); break;
        case 'products':
          var items = M.blockProducts(b, o);
          if (b.title) lines.push(M.resolve(b.title, p));
          items.forEach(function (it) { lines.push('• ' + it.name + (b.price !== false ? ' — ' + U.money2(it.price) : '') + '\n  https://moje-lece.si/p/' + it.sku); });
          break;
        case 'columns': (b.cells || []).forEach(function (c) { lines.push(M.resolve(c.title, p) + '\n' + M.resolve(c.text, p) + (c.label ? '\n' + c.label + ': ' + (M.safeUrl(c.url) || '') : '')); }); break;
        case 'divider': lines.push('————————————————————'); break;
        case 'social': lines.push((b.items || []).join(' · ')); break;
        case 'footer': lines.push(M.resolve(b.text, p) + '\n' + (b.unsub || 'Unsubscribe') + ': ' + M.tagValue('unsubscribe_url', p || {})); break;
      }
    });
    return lines.filter(function (l) { return l && l.trim(); }).join('\n\n');
  };

  // ── Template library ───────────────────────────────────────────────────
  function d(blocks, s) { return { s: Object.assign({}, M.STYLE_DEFAULT, s || {}), blocks: blocks }; }
  var B = M.block;
  var HI = '<p>Hi {{ first_name|default:"there" }},</p>';
  M.TEMPLATES = [
    { key: 'welcome', name: 'Welcome', category: 'Onboarding', subject: 'Welcome to Adrial, {{ first_name|default:"friend" }} 👓', preview: 'Here is 10% off your first order.', design: function () { return d([
      B('header'), B('image', { art: 'frames', headline: 'Welcome to Adrial', sub: 'Eyewear, lenses and expert eye care' }),
      B('text', { html: HI + '<p>Thanks for joining us! As a welcome gift, here is <b>10% off</b> your first order with code <b>WELCOME10</b>.</p><p>Our opticians in Slovenia and Croatia are here to help you see — and look — your best.</p>' }),
      B('button', { label: 'Start shopping', url: 'https://moje-lece.si/' }),
      B('columns', { cells: [{ art: 'eye', title: 'Free eye exam', text: 'With every pair of prescription glasses.', label: 'Book', url: 'https://moje-lece.si/eye-exam' }, { art: 'box', title: 'Free delivery', text: 'On all orders over €49.', label: 'Shop', url: 'https://moje-lece.si/' }, { art: 'store', title: '20+ stores', text: 'Across Slovenia and Croatia.', label: 'Find a store', url: 'https://moje-lece.si/stores' }] }),
      B('products', { title: 'Popular right now', mode: 'recommended', count: 3 }), B('social'), B('footer')]); } },
    { key: 'cart', name: 'Abandoned cart', category: 'Cart recovery', subject: '{{ first_name|default:"Hi" }}, you left something in your cart', preview: 'Your items are saved — complete your order in one click.', design: function () { return d([
      B('header'), B('text', { html: '<p style="font-size:22px"><b>Still thinking it over?</b></p>' + HI + '<p>We saved the items in your cart. They are popular, so we can only hold them for a little while.</p>', align: 'center' }),
      B('products', { title: 'Your cart', mode: 'cart', count: 3, btn: 'Complete order' }), B('button', { label: 'Return to my cart', url: 'https://moje-lece.si/cart' }),
      B('text', { html: '<p>Not sure which frame suits you? Reply to this email or <a href="https://moje-lece.si/help">ask an optician</a> — we are happy to help.</p>', align: 'center', size: 14 }), B('footer')]); } },
    { key: 'bis', name: 'Back in stock', category: 'Catalogue', subject: 'Good news — it is back in stock', preview: 'The item you were waiting for is available again.', design: function () { return d([
      B('header'), B('image', { art: 'box', headline: 'It is back!', sub: 'Available again — while stocks last' }),
      B('text', { html: HI + '<p>The item you asked us to watch is back in stock. Order now before it sells out again.</p>', align: 'center' }),
      B('products', { title: '', mode: 'last_viewed', count: 1, btn: 'Order now' }), B('button', { label: 'Shop now', url: 'https://moje-lece.si/' }), B('footer')]); } },
    { key: 'lens', name: 'Contact-lens reorder reminder', category: 'Replenishment', subject: 'Time for fresh lenses, {{ first_name|default:"there" }}', preview: 'Your supply is running low — reorder in one click.', design: function () { return d([
      B('header'), B('image', { art: 'lenses', headline: 'Running low on lenses?', sub: 'Reorder now and never run out' }),
      B('text', { html: HI + '<p>Based on your last order, your {{ properties.lens_supply_days|default:"90" }}-day supply of contact lenses is about to run out. Reorder today and get them delivered in 1–2 days.</p>' }),
      B('products', { title: 'Your lenses', mode: 'reorder', count: 2, btn: 'Reorder' }), B('button', { label: 'Reorder my lenses', url: 'https://moje-lece.si/reorder' }),
      B('text', { html: '<p>Tip: replace your lens case every three months and always use fresh solution.</p>', size: 14, align: 'center' }), B('footer')], { head: '#1F6F7A', btn: '#1F6F7A', link: '#1F6F7A' }); } },
    { key: 'summer', name: 'Summer sunglasses sale', category: 'Promotion', subject: 'Summer sale: up to 30% off sunglasses ☀️', preview: 'UV400 protection, polarised lenses and this season\'s shapes.', design: function () { return d([
      B('header', { nav: true }), B('image', { art: 'sunglasses', headline: 'Summer sale −30%', sub: 'On selected sunglasses until Sunday' }),
      B('text', { html: HI + '<p>Sunny days call for proper protection. All our sunglasses block 100% UV — and for one week selected styles are up to <b>30% off</b>.</p>', align: 'center' }),
      B('products', { title: 'Bestsellers', mode: 'static', skus: [], count: 3, btn: 'Shop' }), B('button', { label: 'Shop the sale', url: 'https://moje-lece.si/sale' }),
      B('divider'), B('text', { html: '<p>Offer valid while stocks last. Cannot be combined with other discounts.</p>', size: 12, align: 'center' }), B('footer')], { head: '#C2502E', btn: '#C2502E', link: '#A63F21', bg: '#F6EADF' }); } },
    { key: 'exam', name: 'Eye-exam reminder', category: 'Service', subject: 'It has been a year — time for an eye exam', preview: 'Book a free 20-minute check-up at your nearest store.', design: function () { return d([
      B('header'), B('image', { art: 'eye', headline: 'Your eyes deserve a check-up', sub: 'Free with any prescription glasses' }),
      B('text', { html: HI + '<p>Opticians recommend an eye exam every 12–24 months. Book a free 20-minute appointment at {{ properties.preferred_store|default:"your nearest store" }}.</p>' }),
      B('button', { label: 'Book an eye exam', url: 'https://moje-lece.si/eye-exam' }),
      B('columns', { cells: [{ art: 'store', title: 'Slovenia', text: 'Ljubljana, Maribor, Celje, Koper and more.', label: 'Stores in SI', url: 'https://moje-lece.si/stores' }, { art: 'store', title: 'Croatia', text: 'Zagreb, Split, Rijeka and more.', label: 'Stores in HR', url: 'https://adrialece.hr/stores' }] }), B('footer')]); } },
    { key: 'winback', name: 'Win-back', category: 'Retention', subject: 'We miss you, {{ first_name|default:"friend" }} — here is 15% off', preview: 'Come back and save 15% on your next order.', design: function () { return d([
      B('header'), B('image', { art: 'heart', headline: 'We miss you', sub: '15% off your next order' }),
      B('text', { html: HI + '<p>It has been a while! Use code <b>COMEBACK15</b> for 15% off anything in store or online — valid for 14 days.</p>', align: 'center' }),
      B('button', { label: 'Redeem 15% off', url: 'https://moje-lece.si/' }), B('products', { title: 'New since your last visit', mode: 'recommended', count: 3 }), B('footer')]); } },
    { key: 'news', name: 'Newsletter', category: 'Newsletter', subject: 'This month at Adrial: new frames and lens care tips', preview: 'New arrivals, expert tips and an event near you.', design: function () { return d([
      B('header', { nav: true }), B('image', { art: 'pattern', headline: 'This month at Adrial', sub: 'New arrivals · tips · events', height: 200 }),
      B('text', { html: HI + '<p>Autumn is here, and so is our new collection of frames. Plus: how to keep your lenses comfortable when the heating comes on.</p>' }),
      B('columns', { cells: [{ art: 'lenses', title: 'Dry eyes in autumn?', text: 'Five optician tips for comfortable lenses all day.', label: 'Read more', url: 'https://moje-lece.si/blog/dry-eyes' }, { art: 'frames', title: 'Frames for your face shape', text: 'Round, square or oval — find the shape that suits you.', label: 'Take the quiz', url: 'https://moje-lece.si/blog/face-shape' }] }),
      B('divider'), B('products', { title: 'New arrivals', mode: 'recommended', count: 3 }), B('social'), B('footer')]); } }
  ];
  M.templateByKey = function (k) { return M.TEMPLATES.filter(function (t) { return t.key === k; })[0]; };
})();
