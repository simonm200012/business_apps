/* AM.Email: block model, email-safe HTML renderer, plain text, {{ tags }}, sanitiser, generated SVG art, template library */
(function () {
  const AM = window.AM = window.AM || {}, U = AM.U, esc = U.esc;
  const M = AM.Email = {};
  M.BRAND = 'Lumina Optika';
  M.TAGS = ['first_name', 'last_name', 'full_name', 'email', 'city', 'country', 'brand', 'unsubscribe_url', 'preferences_url'];
  M.SAMPLE = { fn: 'Ana', ln: 'Novak', em: 'ana.novak@example.si', city: 'Ljubljana', cc: 'SI' };
  const FONTS = { sans: 'Helvetica,Arial,sans-serif', serif: 'Georgia,"Times New Roman",serif' };
  M.url = u => { u = String(u || '').trim(); return (/^(https?:\/\/|mailto:|tel:|#|\{\{)/i.test(u)) ? u : '#'; };
  const TAG_RE = /\{\{\s*([a-z_]+)\s*(?:\|\s*default:\s*(?:"|&quot;)([^"&]*)(?:"|&quot;)\s*)?\}\}/g;
  M.resolve = (text, p, o) => {
    o = o || {}; const q = p || M.SAMPLE;
    return String(text == null ? '' : text).replace(TAG_RE, (all, tag, def) => {
      let v;
      switch (tag) {
        case 'first_name': v = q.fn; break; case 'last_name': v = q.ln; break;
        case 'full_name': v = q.fn && q.ln ? q.fn + ' ' + q.ln : ''; break;
        case 'email': v = q.em; break; case 'city': v = q.city; break;
        case 'country': v = q.cc === 'HR' ? 'Croatia' : 'Slovenia'; break;
        case 'brand': v = M.BRAND; break;
        case 'unsubscribe_url': return o.raw ? 'https://lumina-optika.example/unsubscribe' : '#unsubscribe';
        case 'preferences_url': return o.raw ? 'https://lumina-optika.example/preferences' : '#preferences';
        default: return all;
      }
      if (!v) v = def || '';
      return o.raw ? v : esc(v);
    });
  };
  M.unknownTags = text => { const bad = []; String(text || '').replace(/\{\{\s*([^}|]*?)\s*(?:\|[^}]*)?\}\}/g, (a, t) => { if (M.TAGS.indexOf(t) < 0) bad.push(t); }); return bad; };
  M.malformed = text => { const s = String(text || ''); const open = (s.match(/\{\{/g) || []).length, close = (s.match(/\}\}/g) || []).length; return open !== close || /\{\{[^}]*$/.test(s) || /\{\{\s*\}\}/.test(s); };
  M.sanitize = html => {
    const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
    const OK = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, A: 1, BR: 1, P: 1, UL: 1, OL: 1, LI: 1, H1: 1, H2: 1, H3: 1 };
    const DROP = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|FORM|INPUT|LINK|META|SVG|MATH)$/;
    const walk = n => {
      let out = '';
      n.childNodes.forEach(c => {
        if (c.nodeType === 3) out += esc(c.nodeValue);
        else if (c.nodeType === 1) {
          const t = c.tagName;
          if (t === 'BR') out += '<br>';
          else if (OK[t]) { const lt = t.toLowerCase(); out += '<' + lt + (t === 'A' ? ' href="' + esc(M.url(c.getAttribute('href'))) + '"' : '') + '>' + walk(c) + '</' + lt + '>'; }
          else if (!DROP.test(t)) out += walk(c);
        }
      });
      return out;
    };
    return walk(doc.body);
  };
  M.strip = html => { const d = new DOMParser().parseFromString('<body>' + String(html || '').replace(/<\/(p|h\d|li|div)>/gi, '$&\n').replace(/<br\s*\/?>/gi, '\n') + '</body>', 'text/html'); return (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };

  /* Generated SVG art (no external images) */
  M.art = (kind, c1, c2, w, h) => {
    w = w || 600; h = h || 240; c1 = U.color(c1, '#2f5d62'); c2 = U.color(c2, '#e8d5b7');
    let g = '';
    const cx = w / 2, cy = h / 2, s = h / 240;
    switch (kind) {
      case 'frames': case 'sun':
        g = '<g fill="' + (kind === 'sun' ? '#1b1b1b' : 'none') + '" fill-opacity="' + (kind === 'sun' ? '.82' : '1') + '" stroke="#fff" stroke-width="' + 7 * s + '"><rect x="' + (cx - 150 * s) + '" y="' + (cy - 45 * s) + '" width="' + 120 * s + '" height="' + 90 * s + '" rx="' + 38 * s + '"/><rect x="' + (cx + 30 * s) + '" y="' + (cy - 45 * s) + '" width="' + 120 * s + '" height="' + 90 * s + '" rx="' + 38 * s + '"/><path d="M' + (cx - 30 * s) + ' ' + (cy - 10 * s) + ' q' + 30 * s + ' ' + -20 * s + ' ' + 60 * s + ' 0" fill="none"/><path d="M' + (cx - 150 * s) + ' ' + (cy - 20 * s) + ' l' + -34 * s + ' ' + -12 * s + ' M' + (cx + 150 * s) + ' ' + (cy - 20 * s) + ' l' + 34 * s + ' ' + -12 * s + '" fill="none"/></g>'; break;
      case 'lens': g = '<circle cx="' + cx + '" cy="' + cy + '" r="' + 78 * s + '" fill="#fff" fill-opacity=".22" stroke="#fff" stroke-width="' + 5 * s + '"/><circle cx="' + cx + '" cy="' + cy + '" r="' + 46 * s + '" fill="' + c1 + '" fill-opacity=".55"/><circle cx="' + cx + '" cy="' + cy + '" r="' + 20 * s + '" fill="#111"/>'; break;
      case 'eye': g = '<path d="M' + (cx - 130 * s) + ' ' + cy + ' q' + 130 * s + ' ' + -100 * s + ' ' + 260 * s + ' 0 q' + -130 * s + ' ' + 100 * s + ' ' + -260 * s + ' 0z" fill="#fff" fill-opacity=".9"/><circle cx="' + cx + '" cy="' + cy + '" r="' + 38 * s + '" fill="' + c1 + '"/><circle cx="' + cx + '" cy="' + cy + '" r="' + 16 * s + '" fill="#111"/>'; break;
      case 'sale': for (let i = -4; i < 14; i++) g += '<path d="M' + (i * 60 * s) + ' ' + h + ' l' + 120 * s + ' ' + -h + '" stroke="#fff" stroke-opacity=".16" stroke-width="' + 22 * s + '"/>'; g += '<text x="' + cx + '" y="' + (cy + 28 * s) + '" font-family="Georgia,serif" font-size="' + 84 * s + '" fill="#fff" text-anchor="middle" font-weight="700">–30%</text>'; break;
      case 'gift': g = '<rect x="' + (cx - 70 * s) + '" y="' + (cy - 20 * s) + '" width="' + 140 * s + '" height="' + 90 * s + '" fill="#fff"/><rect x="' + (cx - 80 * s) + '" y="' + (cy - 50 * s) + '" width="' + 160 * s + '" height="' + 36 * s + '" fill="#fff" fill-opacity=".85"/><rect x="' + (cx - 8 * s) + '" y="' + (cy - 50 * s) + '" width="' + 16 * s + '" height="' + 120 * s + '" fill="' + c1 + '"/>'; break;
      default: g = '<circle cx="' + cx + '" cy="' + cy + '" r="' + 60 * s + '" fill="#fff" fill-opacity=".3"/>';
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs><rect width="' + w + '" height="' + h + '" fill="url(#g)"/>' + g + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
  M.ART = ['frames', 'sun', 'lens', 'eye', 'sale', 'gift', 'plain'];

  /* Block model */
  const L = 'https://lumina-optika.example/';
  M.BLOCKS = {
    header: { label: 'Header', icon: '▭', def: () => ({ logo: 'LUMINA', tag: 'OPTIKA', bg: '#ffffff', color: '#1d2433' }) },
    hero: { label: 'Hero', icon: '▣', def: () => ({ art: 'frames', c1: '#2f5d62', c2: '#d9b98a', headline: 'New season frames', sub: 'Light, bold and made for everyday wear.', btn: 'Shop now', url: L + 'new', align: 'center', color: '#ffffff' }) },
    text: { label: 'Text', icon: '¶', def: () => ({ html: '<p>Hi {{ first_name|default:"there" }},</p><p>Write your message here.</p>', align: 'left', size: 16, color: '#333333', bg: '#ffffff' }) },
    image: { label: 'Image', icon: '▨', def: () => ({ art: 'sun', c1: '#3b4a6b', c2: '#e6a57e', alt: 'Image description', url: '' }) },
    button: { label: 'Button', icon: '▬', def: () => ({ label: 'Shop now', url: L, bg: '#2f5d62', color: '#ffffff', align: 'center' }) },
    products: { label: 'Products', icon: '▦', def: () => ({ title: 'Picked for you', items: ['FR-101', 'FR-102', 'SG-201'], cols: 3, btn: 'View' }) },
    coupon: { label: 'Coupon', icon: '✂', def: () => ({ code: 'WELCOME10', text: '10% off your first order', note: 'Valid for 14 days', bg: '#f3efe6' }) },
    divider: { label: 'Divider', icon: '—', def: () => ({ color: '#dddddd' }) },
    spacer: { label: 'Spacer', icon: '↕', def: () => ({ h: 24 }) },
    social: { label: 'Social', icon: '☺', def: () => ({ links: [{ label: 'Instagram', url: 'https://instagram.com/' }, { label: 'Facebook', url: 'https://facebook.com/' }] }) },
    footer: { label: 'Footer', icon: '▁', def: () => ({ html: '<p>{{ brand }} · Slovenska cesta 12, 1000 Ljubljana</p><p>You are receiving this email because you subscribed to our newsletter. <a href="{{ unsubscribe_url }}">Unsubscribe</a> · <a href="{{ preferences_url }}">Preferences</a></p>', color: '#777777', bg: '#f4f1ea' }) }
  };
  M.block = type => Object.assign({ id: U.uid('b'), type }, M.BLOCKS[type].def());
  M.newDesign = () => ({ bg: '#f4f1ea', font: 'sans', blocks: [M.block('header'), M.block('hero'), M.block('text'), M.block('button'), M.block('footer')] });
  M.linkBlocks = d => (d.blocks || []).filter(b => ['hero', 'button', 'products', 'image', 'coupon'].indexOf(b.type) >= 0 && (b.type === 'products' || b.type === 'coupon' || b.url || b.type === 'button'));
  M.links = d => {
    const out = [];
    (d.blocks || []).forEach(b => {
      if (b.type === 'hero' && b.btn) out.push({ id: b.id, label: b.btn + ' (hero)', url: b.url });
      else if (b.type === 'button') out.push({ id: b.id, label: b.label, url: b.url });
      else if (b.type === 'image' && b.url) out.push({ id: b.id, label: 'Image: ' + (b.alt || ''), url: b.url });
      else if (b.type === 'products') (b.items || []).forEach(s => out.push({ id: b.id + ':' + s, label: 'Product ' + s, url: L + 'p/' + s }));
      else if (b.type === 'text') (String(b.html).match(/href="[^"]+"/g) || []).forEach((h, i) => { const u = h.slice(6, -1); if (u.indexOf('{{') < 0) out.push({ id: b.id + '#' + i, label: 'Text link', url: u }); });
      else if (b.type === 'social') (b.links || []).forEach((l, i) => out.push({ id: b.id + '#' + i, label: l.label, url: l.url }));
    });
    return out;
  };
  const al = a => a === 'left' || a === 'right' ? a : 'center';
  M.render = (d, ctx) => {
    ctx = ctx || {}; const p = ctx.profile, prods = ctx.products || [];
    const R = t => M.resolve(t, p), RH = h => M.resolve(M.sanitize(h), p);
    const font = FONTS[d.font] || FONTS.sans, bg = U.color(d.bg, '#f4f1ea');
    const A = (b, href, st, inner) => '<a href="' + esc(M.url(R(href))) + '" data-b="' + esc(b) + '" style="' + st + '">' + inner + '</a>';
    const rows = (d.blocks || []).map(b => {
      const pad = 'padding:';
      switch (b.type) {
        case 'header': return '<tr><td align="center" style="background:' + U.color(b.bg, '#fff') + ';padding:22px 24px"><div style="font:700 26px ' + font + ';letter-spacing:.28em;color:' + U.color(b.color, '#1d2433') + '">' + esc(b.logo) + '</div><div style="font:11px ' + font + ';letter-spacing:.4em;color:' + U.color(b.color, '#1d2433') + ';opacity:.7">' + esc(b.tag) + '</div></td></tr>';
        case 'hero': return '<tr><td align="' + al(b.align) + '" style="background-color:' + U.color(b.c1) + ';padding:0 0 32px;color:' + U.color(b.color, '#fff') + '"><img src="' + M.art(b.art, b.c1, b.c2, 600, 260) + '" alt="" width="600" style="display:block;width:100%;height:auto;border:0;margin:0 0 22px"><div style="padding:0 32px;font:700 30px/1.2 ' + font + '">' + esc(R(b.headline)) + '</div><div style="padding:0 32px;font:16px/1.5 ' + font + ';margin:10px 0 20px;opacity:.95">' + esc(R(b.sub)) + '</div>' + (b.btn ? A(b.id, b.url, 'display:inline-block;background:#fff;color:#1d2433;font:700 15px ' + font + ';padding:12px 26px;border-radius:4px;text-decoration:none', esc(R(b.btn))) : '') + '</td></tr>';
        case 'text': return '<tr><td style="background:' + U.color(b.bg, '#fff') + ';padding:20px 32px;font:' + (+b.size || 16) + 'px/1.55 ' + font + ';color:' + U.color(b.color, '#333') + ';text-align:' + (b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : 'left') + '">' + RH(b.html) + '</td></tr>';
        case 'image': { const im = '<img src="' + M.art(b.art, b.c1, b.c2, 600, 240) + '" alt="' + esc(b.alt) + '" width="600" style="display:block;width:100%;height:auto;border:0">'; return '<tr><td style="background:#fff;padding:0">' + (b.url ? A(b.id, b.url, 'display:block', im) : im) + '</td></tr>'; }
        case 'button': return '<tr><td align="' + al(b.align) + '" style="background:#fff;padding:14px 32px">' + A(b.id, b.url, 'display:inline-block;background:' + U.color(b.bg, '#2f5d62') + ';color:' + U.color(b.color, '#fff') + ';font:700 15px ' + font + ';padding:13px 30px;border-radius:4px;text-decoration:none', esc(R(b.label))) + '</td></tr>';
        case 'products': {
          let items = (b.items || []).map(s => prods.find(x => x.sku === s)).filter(Boolean); if (!items.length) items = prods.slice(0, (b.items || []).length || 3);
          const cols = U.clamp(+b.cols || 3, 1, 4), w = Math.floor(100 / cols); let cells = '';
          items.forEach((x, i) => {
            if (i % cols === 0) cells += (i ? '</tr>' : '') + '<tr>';
            cells += '<td width="' + w + '%" valign="top" align="center" style="padding:8px"><img src="' + M.art(x.art || 'frames', x.c1, x.c2, 240, 180) + '" alt="' + esc(x.name) + '" width="100%" style="display:block;width:100%;height:auto;border:0;border-radius:4px"><div style="font:600 14px ' + font + ';margin:8px 0 2px;color:#222">' + esc(x.name) + '</div><div style="font:14px ' + font + ';color:#666">' + U.eur(x.price, 2) + '</div>' + A(b.id + ':' + x.sku, L + 'p/' + x.sku, 'display:inline-block;margin-top:6px;font:700 13px ' + font + ';color:#2f5d62', esc(b.btn || 'View')) + '</td>';
          });
          return '<tr><td style="background:#fff;padding:12px 24px">' + (b.title ? '<div style="font:700 20px ' + font + ';text-align:center;margin:6px 0 10px;color:#1d2433">' + esc(R(b.title)) + '</div>' : '') + '<table width="100%" cellpadding="0" cellspacing="0" role="presentation">' + cells + '</tr></table></td></tr>';
        }
        case 'coupon': return '<tr><td align="center" style="background:#fff;padding:14px 32px"><div style="background:' + U.color(b.bg, '#f3efe6') + ';border:2px dashed #b9a98a;border-radius:6px;padding:18px"><div style="font:15px ' + font + ';color:#333">' + esc(R(b.text)) + '</div><div style="font:700 28px ' + font + ';letter-spacing:.2em;margin:6px 0;color:#1d2433">' + esc(b.code) + '</div><div style="font:12px ' + font + ';color:#777">' + esc(R(b.note)) + '</div></div></td></tr>';
        case 'divider': return '<tr><td style="background:#fff;padding:8px 32px"><div style="border-top:1px solid ' + U.color(b.color, '#ddd') + ';font-size:0;line-height:0">&nbsp;</div></td></tr>';
        case 'spacer': return '<tr><td style="background:#fff;height:' + U.clamp(+b.h || 24, 4, 120) + 'px;font-size:0;line-height:0">&nbsp;</td></tr>';
        case 'social': return '<tr><td align="center" style="background:#fff;padding:12px 32px;font:14px ' + font + '">' + (b.links || []).map((l, i) => A(b.id + '#' + i, l.url, 'color:#2f5d62;margin:0 8px;text-decoration:underline', esc(l.label))).join(' ') + '</td></tr>';
        case 'footer': return '<tr><td align="center" style="background:' + U.color(b.bg, '#f4f1ea') + ';padding:22px 32px;font:12px/1.6 ' + font + ';color:' + U.color(b.color, '#777') + '">' + RH(b.html) + '</td></tr>';
      }
      return '';
    }).join('');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(ctx.subject || '') + '</title></head><body style="margin:0;padding:0;background:' + bg + '"><div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc(M.resolve(ctx.preview || '', p, { raw: true })) + '</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + bg + '"><tr><td align="center" style="padding:16px 8px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-radius:6px;overflow:hidden">' + rows + '</table></td></tr></table></body></html>';
  };
  M.plain = (d, ctx) => {
    ctx = ctx || {}; const p = ctx.profile, R = t => M.resolve(t, p, { raw: true }), out = [];
    (d.blocks || []).forEach(b => {
      switch (b.type) {
        case 'header': out.push(b.logo); break;
        case 'hero': out.push(R(b.headline) + '\n' + R(b.sub) + (b.btn ? '\n' + R(b.btn) + ': ' + R(b.url) : '')); break;
        case 'text': case 'footer': out.push(R(M.strip(b.html))); break;
        case 'button': out.push(R(b.label) + ': ' + R(b.url)); break;
        case 'coupon': out.push(R(b.text) + ' - code ' + b.code); break;
        case 'products': out.push((b.title ? R(b.title) + '\n' : '') + (b.items || []).join(', ')); break;
        case 'image': if (b.alt) out.push('[' + b.alt + ']'); break;
        case 'social': out.push((b.links || []).map(l => l.label + ': ' + l.url).join('\n')); break;
      }
    });
    return out.join('\n\n');
  };
  M.size = (d, ctx) => new Blob([M.render(d, ctx)]).size;

  /* Template library */
  const B = (type, o) => Object.assign({ type }, M.BLOCKS[type].def(), o || {});
  const D = (blocks, o) => { blocks.forEach((b, i) => { b.id = 'b' + i; }); return Object.assign({ bg: '#f4f1ea', font: 'sans', blocks }, o || {}); };
  const foot = () => B('footer');
  M.TEMPLATES = [
    { key: 'welcome', name: 'Welcome', category: 'Flows', subject: 'Welcome to Lumina, {{ first_name|default:"friend" }}', preview: 'Here is 10% off your first pair.', design: () => D([B('header'), B('hero', { art: 'eye', c1: '#2f5d62', c2: '#9fb8ad', headline: 'Welcome to Lumina', sub: 'Eyewear made with care in Ljubljana.', btn: 'Browse frames' }), B('text', { html: '<p>Hi {{ first_name|default:"there" }},</p><p>Thank you for joining us. Every frame is fitted and adjusted in our stores, and your first order comes with a free lens upgrade.</p>' }), B('coupon'), B('products', { title: 'Bestsellers' }), foot()]) },
    { key: 'newsletter', name: 'Monthly newsletter', category: 'Campaigns', subject: 'Your October at Lumina', preview: 'New frames, eye-care tips and store news.', design: () => D([B('header'), B('hero', { art: 'frames', c1: '#3b4a6b', c2: '#d9b98a', headline: 'This month at Lumina', sub: 'New arrivals and a few tips for tired eyes.', btn: 'Read more' }), B('text', { html: '<h2>Hello {{ first_name|default:"there" }}</h2><p>Autumn light is lower, screens are brighter: here is how to keep your eyes comfortable and our favourite new frames.</p>' }), B('products', { title: 'New arrivals', items: ['FR-101', 'FR-103', 'FR-104'] }), B('divider'), B('text', { html: '<h3>Eye-care tip</h3><p>Follow the 20-20-20 rule: every 20 minutes look at something 20 feet away for 20 seconds.</p>' }), B('button', { label: 'Book an eye exam', url: L + 'exam' }), B('social'), foot()]) },
    { key: 'arrivals', name: 'New collection', category: 'Campaigns', subject: 'The new collection has landed', preview: 'Be the first to try them on.', design: () => D([B('header'), B('hero', { art: 'sun', c1: '#7a3b2e', c2: '#e6a57e', headline: 'Autumn collection', sub: 'Warm tones, soft shapes.', btn: 'Discover' }), B('products', { title: 'Just in', items: ['FR-102', 'FR-103', 'SG-201', 'SG-202'], cols: 2 }), B('button', { label: 'See everything' }), foot()]) },
    { key: 'sale', name: 'Seasonal sale', category: 'Campaigns', subject: '{{ first_name|default:"Hello" }}, up to 30% off this weekend', preview: 'Selected frames and sunglasses.', design: () => D([B('header'), B('image', { art: 'sale', c1: '#b3392f', c2: '#e8a05c', alt: 'Sale up to 30 percent', url: L + 'sale' }), B('text', { html: '<p style="">Our weekend sale is on: selected frames and sunglasses at up to 30% off, in all stores and online.</p>', align: 'center' }), B('products', { title: 'Sale favourites', items: ['FR-101', 'SG-202', 'AC-501'] }), B('button', { label: 'Shop the sale', bg: '#b3392f' }), foot()]) },
    { key: 'cart', name: 'Cart reminder', category: 'Flows', subject: 'Still thinking it over?', preview: 'Your frames are waiting.', design: () => D([B('header'), B('text', { html: '<h2>You left something behind</h2><p>Hi {{ first_name|default:"there" }}, the pair you looked at is still available. Free returns within 30 days.</p>', align: 'center' }), B('products', { title: '', items: ['FR-102'], cols: 1, btn: 'Back to cart' }), B('button', { label: 'Complete your order' }), foot()]) },
    { key: 'refill', name: 'Lens refill', category: 'Flows', subject: 'Time to restock your lenses', preview: 'Reorder in two clicks.', design: () => D([B('header'), B('hero', { art: 'lens', c1: '#1f6f8b', c2: '#99c2d0', headline: 'Running low on lenses?', sub: 'Reorder now and get free delivery.', btn: 'Reorder' }), B('products', { title: 'Your usual', items: ['CL-301', 'CL-302', 'SO-401'] }), foot()]) },
    { key: 'exam', name: 'Eye exam reminder', category: 'Flows', subject: 'It has been a while: book your eye exam', preview: 'A quick check takes 20 minutes.', design: () => D([B('header'), B('hero', { art: 'eye', c1: '#4a3b6b', c2: '#b9a6d9', headline: 'Time for an eye exam', sub: 'We recommend one every two years.', btn: 'Book now', url: L + 'exam' }), B('text', { html: '<p>Hi {{ first_name|default:"there" }}, your last exam was a while ago. Book a free check in your nearest store.</p>' }), foot()]) },
    { key: 'birthday', name: 'Birthday gift', category: 'Flows', subject: 'Happy birthday, {{ first_name|default:"friend" }}!', preview: 'A little gift from us.', design: () => D([B('header'), B('hero', { art: 'gift', c1: '#a8456b', c2: '#f0b8c9', headline: 'Happy birthday!', sub: 'We have a small gift for you.', btn: 'Claim it' }), B('coupon', { code: 'BDAY15', text: '15% off anything you like', note: 'Valid this month' }), foot()]) }
  ];
})();
