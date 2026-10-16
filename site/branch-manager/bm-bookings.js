/* Branch Manager · bookings engine: branches and rooms, services, opening hours, the generated sample
 * bookings, this browser's changes (localStorage "bm-bookings-v1"), free slots, no-show figures,
 * reminders (SMS link, .eml for Outlook, .ics) and the online self-booking page.
 *
 * Shared by Bookings.html (staff) and Book.html (customers). Runs in Node for tests:
 * BMBookings.create({ BM, storage, today, nowMin, now }).
 * Everything is fictional sample data; nothing is sent anywhere.
 */
(function (root) {
  'use strict';

function create(opts) {
  opts = opts || {};
  // ── Branches and rooms (from Branch Manager) ───────────────────────────────
  var BM = opts.BM || root.StratumBM.build(opts.now);
  var BRANCHES = BM.branches.map(function (b) { return { id: b.id, country: b.country, city: b.city, street: b.street, postcode: b.postcode, address: b.address, phone: b.phone, manager: b.manager, email: b.email, live: b.live, rooms: b.rooms.map(function (r) { return r.name; }) }; });
  BRANCHES.forEach(function (b) { b.roomList = b.rooms.map(function (name, i) { return { code: 'E' + (i + 1), name: name, short: /showroom/i.test(name) ? 'SR' : 'E' + (name.match(/\d+/) || [i + 1])[0] }; }); });
  var byBranch = {}; BRANCHES.forEach(function (b) { byBranch[b.id] = b; });

  // ── Services (as listed in the branch calendar) ────────────────────
  var SERVICES = [
    { id: 'EE20', name: 'Eye Exam 20 minutes', sl: 'Pregled vida, 20 minut', hr: 'Pregled vida, 20 minuta', fee: 25, dur: 20, c: '#3F7D58', t: '#DCEBE0', k: '#24553A', w: 34 },
    { id: 'EE30', name: 'Eye Exam 30 minutes', sl: 'Pregled vida, 30 minut', hr: 'Pregled vida, 30 minuta', fee: 35, dur: 30, c: '#17869C', t: '#D7EEF2', k: '#0E5462', w: 20 },
    { id: 'SMIP', name: 'Sight measurement with intraocular pressure measurement', sl: 'Merjenje vida z merjenjem očesnega tlaka', hr: 'Mjerenje vida s mjerenjem očnog tlaka', fee: 30, dur: 20, c: '#3E5BA9', t: '#DFE5F4', k: '#2A4180', w: 12 },
    { id: 'SMCL', name: 'Sight measurement for contact lenses', sl: 'Merjenje vida za kontaktne leče', hr: 'Mjerenje vida za kontaktne leće', fee: 30, dur: 20, c: '#5A6FB4', t: '#E4E8F6', k: '#2A4180', w: 8 },
    { id: 'CLF30', name: 'Contact Lenses Fitting 30 minutes', sl: 'Prilagoditev kontaktnih leč, 30 minut', hr: 'Prilagodba kontaktnih leća, 30 minuta', fee: 40, dur: 30, c: '#B4561C', t: '#F6E3D6', k: '#7A3610', w: 7 },
    { id: 'CLC', name: 'Contact Lenses Check-up', sl: 'Kontrola kontaktnih leč', hr: 'Kontrola kontaktnih leća', fee: 15, dur: 30, c: '#5B3FE0', t: '#E6E1FB', k: '#3B2A9E', w: 6 },
    { id: 'EDC', name: 'Eye Doctor - Complex Check-up', sl: 'Celovit pregled pri okulistu', hr: 'Cjeloviti pregled kod oftalmologa', fee: 60, dur: 30, c: '#7A5CC9', t: '#EAE3F8', k: '#3B2A9E', w: 5 },
    { id: 'EPT', name: 'Eye Pressure Test', sl: 'Merjenje očesnega tlaka', hr: 'Mjerenje očnog tlaka', fee: 10, dur: 20, c: '#9A6700', t: '#F7ECD2', k: '#6B4407', w: 4 },
    { id: 'CLF60', name: 'Contact Lenses Fitting 60 minutes', sl: 'Prilagoditev kontaktnih leč, 60 minut', hr: 'Prilagodba kontaktnih leća, 60 minuta', fee: 60, dur: 60, c: '#8F3F05', t: '#F3DCCB', k: '#6B2E06', w: 3 },
    { id: 'EE60', name: 'Eye Exam 60 minutes', sl: 'Pregled vida, 60 minut', hr: 'Pregled vida, 60 minuta', fee: 50, dur: 60, c: '#0E5462', t: '#CFE7EC', k: '#0E5462', w: 1 }
  ];
  var SVC = {}; SERVICES.forEach(function (s) { SVC[s.id] = s; });
  var CUSTOM = { id: 'CUSTOM', name: 'Custom', dur: 30, c: '#6B6964', t: '#EAE8E3', k: '#0C0C0D' };
  // ── Dates ─────────────────────────────────────────────────────────────────
  var DAY = 864e5;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dow(s) { return (parse(s).getDay() + 6) % 7; } // Mon = 0
  function weekStart(s) { return addDays(s, -dow(s)); }
  function isoWeek(s) { var d = parse(s); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7); var w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / DAY - 3 + (w1.getDay() + 6) % 7) / 7); }
  function hm(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function dm(s) { var d = parse(s); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
  var TODAY = opts.today || ymd(opts.now ? new Date(opts.now) : new Date());
  function nowMin() { if (opts.nowMin != null) return opts.nowMin; var d = opts.now ? new Date(opts.now) : new Date(); return d.getHours() * 60 + d.getMinutes(); }

  // Public holidays (closed days)
  function easter(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
  var HOL_CACHE = {};
  function holidays(country, y) {
    var key = country + y; if (HOL_CACHE[key]) return HOL_CACHE[key];
    var fixed = country === 'SI'
      ? { '01-01': 'New Year', '01-02': 'New Year', '02-08': 'Prešeren Day', '04-27': 'Day of Uprising', '05-01': 'Labour Day', '05-02': 'Labour Day', '06-25': 'Statehood Day', '08-15': 'Assumption Day', '10-31': 'Reformation Day', '11-01': 'All Saints’ Day', '12-25': 'Christmas', '12-26': 'Independence Day' }
      : { '01-01': 'New Year', '01-06': 'Epiphany', '05-01': 'Labour Day', '05-30': 'Statehood Day', '06-22': 'Anti-Fascist Struggle Day', '08-05': 'Victory Day', '08-15': 'Assumption Day', '11-01': 'All Saints’ Day', '11-18': 'Remembrance Day', '12-25': 'Christmas', '12-26': 'St Stephen’s Day' };
    var out = {}; Object.keys(fixed).forEach(function (md) { out[y + '-' + md] = fixed[md]; });
    var e = easter(y), em = new Date(e); em.setDate(e.getDate() + 1); out[ymd(em)] = 'Easter Monday';
    if (country === 'HR') { var cc = new Date(e); cc.setDate(e.getDate() + 60); out[ymd(cc)] = 'Corpus Christi'; }
    return (HOL_CACHE[key] = out);
  }
  function holidayOf(branch, s) { return holidays(branch.country, +s.slice(0, 4))[s] || ''; }

  // Opening hours: Mon–Fri 08:00–19:00 (lunch 12:00–12:30), Sat 08:00–13:00, Sun closed.
  function hours(branch, s) {
    var hol = holidayOf(branch, s), d = dow(s);
    if (hol) return { closed: true, why: hol };
    if (d === 6) return { closed: true, why: 'Closed' };
    if (d === 5) return { open: 480, close: 780, breaks: [] };
    return { open: 480, close: 1140, breaks: [[720, 750]] };
  }
  // ── Sample bookings: deterministic per branch × day × room ────────────────
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = seed; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var NAMES = {
    SI: { f: ['Ana', 'Maja', 'Nina', 'Eva', 'Sara', 'Petra', 'Tina', 'Mojca', 'Katja', 'Urša', 'Neža', 'Špela', 'Barbara', 'Mateja', 'Jure', 'Luka', 'Matej', 'Rok', 'Žiga', 'Gregor', 'Miha', 'Tomaž', 'Primož', 'Klemen', 'Aleš', 'Blaž', 'Andrej', 'Janez', 'Nejc', 'Jaka'], l: ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Kovač', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Kralj', 'Božič', 'Korošec', 'Bizjak', 'Zupan', 'Hribar', 'Kavčič', 'Rozman', 'Kastelic', 'Oblak', 'Petek', 'Žagar', 'Kolar', 'Košir', 'Koren', 'Mrak', 'Vovk', 'Jereb'], tel: '+386 1', mail: 'example.si' },
    HR: { f: ['Ana', 'Ivana', 'Marija', 'Petra', 'Lucija', 'Martina', 'Maja', 'Kristina', 'Tea', 'Iva', 'Nikolina', 'Sara', 'Josipa', 'Helena', 'Luka', 'Ivan', 'Marko', 'Josip', 'Tomislav', 'Matej', 'Filip', 'Ante', 'Karlo', 'Domagoj', 'Mario', 'Nikola', 'Dario', 'Hrvoje', 'Petar', 'Bruno'], l: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Kovačić', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Kovač', 'Božić', 'Blažević', 'Grgić', 'Pavić', 'Radić', 'Perić', 'Šarić', 'Lovrić', 'Vidović', 'Perković', 'Popović', 'Bošnjak', 'Jukić', 'Barišić', 'Kolar'], tel: '+385 1', mail: 'example.hr' }
  };
  var REMARKS = ['', '', '', '', 'First visit', 'Wears contact lenses', 'Needs new prescription', 'Glasses broken', 'Follow-up after 6 months', 'Prefers morning'];
  var STAFF = { SI: ['Maja Novak', 'Tina Kos', 'Luka Kovač'], HR: ['Ivana Babić', 'Marko Jurić', 'Tea Matić'] };
  function ascii(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); }
  function pickW(r) { var tot = 0, i; for (i = 0; i < SERVICES.length; i++) tot += SERVICES[i].w; var x = r() * tot; for (i = 0; i < SERVICES.length; i++) { x -= SERVICES[i].w; if (x < 0) return SERVICES[i]; } return SERVICES[0]; }

  var GEN = {};
  function generated(branch, s) {
    var key = branch.id + '|' + s; if (GEN[key]) return GEN[key];
    var h = hours(branch, s), out = [];
    if (!h.closed && branch.live && parse(s) >= branch.live) {
      var dist = Math.round((parse(s) - parse(TODAY)) / DAY);
      var fade = dist > 40 ? Math.max(0.08, 1 - (dist - 40) / 70) : 1;
      var pool = NAMES[branch.country], staff = STAFF[branch.country];
      branch.roomList.forEach(function (room, ri) {
        var r = rng(hash(key + '|' + room.code));
        var base = (dow(s) === 5 ? 0.58 : 0.78) * [1, 0.72, 0.5][Math.min(ri, 2)] * (/showroom/i.test(room.name) ? 0.35 : 1) * fade;
        var t = h.open;
        while (t < h.close) {
          var brk = h.breaks.filter(function (b) { return t >= b[0] && t < b[1]; })[0];
          if (brk) { t = brk[1]; continue; }
          var limit = h.close; h.breaks.forEach(function (b) { if (b[0] > t && b[0] < limit) limit = b[0]; });
          if (r() < base) {
            var svc = pickW(r);
            if (t + svc.dur > limit) svc = SVC.EE20;
            if (t + svc.dur > limit) { t += 10; continue; }
            var f = pool.f[Math.floor(r() * pool.f.length)], l = pool.l[Math.floor(r() * pool.l.length)];
            var email = ascii(f) + '.' + ascii(l) + (Math.floor(r() * 90) + 10) + '@' + pool.mail;
            var phone = pool.tel + ' 000 ' + Math.floor(r() * 10) + (10 + Math.floor(r() * 90)) + ' ' + (100 + Math.floor(r() * 900)); // fictional: no real numbers start with 000
            var remark = REMARKS[Math.floor(r() * REMARKS.length)];
            var created = addDays(s, -(1 + Math.floor(r() * 21)));
            var viaApp = r() < 0.66;
            out.push({
              id: branch.id + '-' + s + '-' + room.code + '-' + t, gen: true, branch: branch.id, date: s, room: room.code, start: t, dur: svc.dur, svc: svc.id, title: '',
              first: f, last: l, email: email, phone: phone, note: remark,
              createdAt: created + ' ' + hm(480 + Math.floor(r() * 600)), createdBy: viaApp ? 'Clearfigure' : staff[Math.floor(r() * staff.length)],
              status: r() < 0.035 ? 'cancelled' : 'active', noShow: s < TODAY && r() < 0.035
            });
            t += svc.dur;
          } else t += r() < 0.5 ? 10 : 20;
        }
      });
    }
    return (GEN[key] = out);
  }

  // ── Local changes (this browser only) ─────────────────────────────────────
  var KEY = 'bm-bookings-v1';
  var storage = opts.storage !== undefined ? opts.storage : (function () { try { return root.localStorage; } catch (e) { return null; } })();
  function loadStore() { try { var v = storage && JSON.parse(storage.getItem(KEY)); if (v && v.added) { v.edited = v.edited || {}; v.deleted = v.deleted || {}; v.reminded = v.reminded || {}; return v; } } catch (e) {} return { added: {}, edited: {}, deleted: {}, reminded: {} }; }
  var store = loadStore();
  function saveStore() { try { if (!storage) throw new Error('no storage'); storage.setItem(KEY, JSON.stringify(store)); } catch (e) { if (opts.onSaveError) opts.onSaveError(e); } }
  // another tab (the online booking page) changed the bookings
  function reload() { var v = loadStore(); ['added', 'edited', 'deleted', 'reminded'].forEach(function (k) { store[k] = v[k]; }); }

  function bookingsOn(branchId, s) {
    var b = byBranch[branchId], out = [];
    generated(b, s).forEach(function (x) { if (!store.deleted[x.id] && !store.edited[x.id]) out.push(x); });
    [store.edited, store.added].forEach(function (m) { Object.keys(m).forEach(function (id) { var x = m[id]; if (x.branch === branchId && x.date === s) out.push(x); }); });
    return out.sort(function (a, c) { return a.start - c.start || a.room.localeCompare(c.room); });
  }
  function findBooking(id) {
    if (store.added[id]) return store.added[id];
    if (store.edited[id]) return store.edited[id];
    var p = id.split('-'); // branch-YYYY-MM-DD-E1-start
    var s = p[1] + '-' + p[2] + '-' + p[3];
    return generated(byBranch[p[0]], s).filter(function (x) { return x.id === id; })[0] || null;
  }
  function putBooking(x) {
    if (x.gen) store.edited[x.id] = x; else store.added[x.id] = x;
    saveStore(); GEN_free = {};
  }
  function removeBooking(x) {
    if (store.added[x.id]) delete store.added[x.id];
    else { delete store.edited[x.id]; if (x.gen) store.deleted[x.id] = true; }
    saveStore();
  }
  var GEN_free = {};
  function svcOf(x) { return x.svc === 'CUSTOM' ? Object.assign({}, CUSTOM, { name: x.title || 'Custom', c: x.color || CUSTOM.c }) : SVC[x.svc]; }
  function custName(x) { return (x.first + ' ' + x.last).trim() || '(no customer)'; }
  function roomName(branch, code) { var r = branch.roomList.filter(function (q) { return q.code === code; })[0]; return r ? r.name : code; }
  function roomShort(branch, code) { var r = branch.roomList.filter(function (q) { return q.code === code; })[0]; return r ? r.short : code; }
  // ── Free slots ────────────────────────────────────────────────────────────
  function busy(branchId, s, room, ignoreId) {
    return bookingsOn(branchId, s).filter(function (x) { return x.room === room && x.status !== 'cancelled' && x.id !== ignoreId; });
  }
  function roomFree(b, s, room, start, dur, ignoreId) {
    var h = hours(b, s);
    if (h.closed || start < h.open || start + dur > h.close) return false;
    if (h.breaks.some(function (x) { return start < x[1] && start + dur > x[0]; })) return false;
    return !busy(b.id, s, room, ignoreId).some(function (x) { return start < x.start + x.dur && start + dur > x.start; });
  }
  function freeSlots(b, s, rooms, dur) {
    var h = hours(b, s); if (h.closed) return [];
    var ends = {}; rooms.forEach(function (r) { busy(b.id, s, r).forEach(function (x) { ends[x.start + x.dur] = 1; }); });
    h.breaks.forEach(function (x) { ends[x[1]] = 1; });
    var out = [], minStart = s === TODAY ? Math.ceil((nowMin() + 5) / 10) * 10 : 0;
    if (s < TODAY) return [];
    for (var t = h.open; t + dur <= h.close; t += 10) {
      if (t < minStart) continue;
      if (t % 30 !== 0 && !ends[t]) continue;
      var room = rooms.filter(function (r) { return roomFree(b, s, r, t, dur); })[0];
      if (room) out.push({ t: t, room: room });
    }
    return out;
  }


  // ── Customers and no-shows ────────────────────────────────────────────────
  // a booking whose start time has passed (only those can be a no-show)
  function isPast(x) { return x.date < TODAY || (x.date === TODAY && x.start + x.dur <= nowMin()); }
  // no-show rate over past, not cancelled bookings of a branch, from..to (inclusive, capped at today)
  function noShowStats(branchId, from, to) {
    if (to > TODAY) to = TODAY;
    var booked = 0, noShows = 0, weeks = {}, people = {};
    for (var s = from; s <= to; s = addDays(s, 1)) {
      bookingsOn(branchId, s).forEach(function (x) {
        if (x.status === 'cancelled' || !isPast(x)) return;
        booked++;
        var wk = weekStart(s), w = weeks[wk] || (weeks[wk] = { week: wk, booked: 0, noShows: 0 });
        w.booked++;
        if (x.noShow) {
          noShows++; w.noShows++;
          var key = (x.email || custName(x)).toLowerCase(), p = people[key] || (people[key] = { name: custName(x), email: x.email, phone: x.phone, count: 0, last: '' });
          p.count++; if (s > p.last) p.last = s;
        }
      });
    }
    var byWeek = Object.keys(weeks).sort().map(function (k) { var w = weeks[k]; w.rate = w.booked ? w.noShows / w.booked : 0; return w; });
    var repeat = Object.keys(people).map(function (k) { return people[k]; }).filter(function (p) { return p.count > 1; }).sort(function (a, b) { return b.count - a.count || (a.last < b.last ? 1 : -1); });
    return { from: from, to: to, booked: booked, noShows: noShows, rate: booked ? noShows / booked : 0, byWeek: byWeek, repeat: repeat };
  }
  // this customer's history at a branch (±days around a date): visits and no-shows
  function customerHistory(branchId, email, around, days) {
    days = days || 120;
    var visits = [], noShows = 0;
    if (!email) return { visits: visits, noShows: 0 };
    for (var i = -days; i <= days; i++) bookingsOn(branchId, addDays(around, i)).forEach(function (y) {
      if (y.email !== email) return;
      visits.push(y);
      if (y.noShow) noShows++;
    });
    return { visits: visits, noShows: noShows };
  }
  function setNoShow(x, on) {
    if (on && !isPast(x)) throw new Error('A booking can only be a no-show after its time has passed.');
    var y = Object.assign({}, x, { noShow: !!on, noShowAt: on ? new Date(opts.now || Date.now()).toISOString() : null });
    putBooking(y);
    return y;
  }

  // ── Reminders: SMS link, e-mail (.eml) and calendar file (.ics) ─────────────
  // Browser-only: nothing is sent. The SMS opens the phone's messages app with the text filled in;
  // the .eml opens in Outlook as a draft (X-Unsent: 1) with the .ics attached.
  var BRAND = 'Clearfigure Optika';
  var L = {
    sl: { wd: ['ponedeljek', 'torek', 'sredo', 'četrtek', 'petek', 'soboto', 'nedeljo'], hi: 'Pozdravljeni', at: 'ob', on: 'v',
      sms: function (o) { return o.hi + ' ' + o.first + ', vaš termin »' + o.svc + '« je ' + o.on + ' ' + o.wd + ', ' + o.date + ' ' + o.at + ' ' + o.time + ' v poslovalnici ' + BRAND + ' ' + o.city + ', ' + o.street + '. Če ne morete priti, nam prosim sporočite na ' + o.phone + '.'; },
      subject: function (o) { return 'Opomnik: ' + o.svc + ', ' + o.date + ' ob ' + o.time; },
      body: function (o) { return o.hi + ' ' + o.first + ',\n\nopominjamo vas na termin:\n\n' + o.svc + '\n' + o.wdCap + ', ' + o.date + ' ob ' + o.time + ' (' + o.dur + ' min)\n' + BRAND + ' ' + o.city + ', ' + o.address + '\n\nČe termina ne morete obiskati, nam to prosim sporočite vsaj dan prej na ' + o.phone + ' ali z odgovorom na to sporočilo.\nV prilogi je termin za vaš koledar.\n\nLep pozdrav,\n' + BRAND + ' ' + o.city; } },
    hr: { wd: ['ponedjeljak', 'utorak', 'srijedu', 'četvrtak', 'petak', 'subotu', 'nedjelju'], hi: 'Poštovani', at: 'u', on: 'u',
      sms: function (o) { return o.hi + ' ' + o.first + ', vaš termin »' + o.svc + '« je ' + o.on + ' ' + o.wd + ', ' + o.date + ' ' + o.at + ' ' + o.time + ' u poslovnici ' + BRAND + ' ' + o.city + ', ' + o.street + '. Ako ne možete doći, javite nam se na ' + o.phone + '.'; },
      subject: function (o) { return 'Podsjetnik: ' + o.svc + ', ' + o.date + ' u ' + o.time; },
      body: function (o) { return o.hi + ' ' + o.first + ',\n\npodsjećamo vas na termin:\n\n' + o.svc + '\n' + o.wdCap + ', ' + o.date + ' u ' + o.time + ' (' + o.dur + ' min)\n' + BRAND + ' ' + o.city + ', ' + o.address + '\n\nAko ne možete doći, molimo javite nam se barem dan ranije na ' + o.phone + ' ili odgovorom na ovu poruku.\nU privitku je termin za vaš kalendar.\n\nLijep pozdrav,\n' + BRAND + ' ' + o.city; } },
    en: { wd: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], hi: 'Hello', at: 'at', on: 'on',
      sms: function (o) { return o.hi + ' ' + o.first + ', your appointment "' + o.svc + '" is on ' + o.wd + ', ' + o.date + ' at ' + o.time + ' at ' + BRAND + ' ' + o.city + ', ' + o.street + '. If you cannot come, please let us know on ' + o.phone + '.'; },
      subject: function (o) { return 'Reminder: ' + o.svc + ', ' + o.date + ' at ' + o.time; },
      body: function (o) { return o.hi + ' ' + o.first + ',\n\nthis is a reminder of your appointment:\n\n' + o.svc + '\n' + o.wdCap + ', ' + o.date + ' at ' + o.time + ' (' + o.dur + ' min)\n' + BRAND + ' ' + o.city + ', ' + o.address + '\n\nIf you cannot make it, please tell us at least a day before on ' + o.phone + ' or reply to this e-mail.\nThe appointment is attached for your calendar.\n\nKind regards,\n' + BRAND + ' ' + o.city; } }
  };
  function langOf(b) { return b && b.country === 'SI' ? 'sl' : b && b.country === 'HR' ? 'hr' : 'en'; }
  function siDate(s) { var d = parse(s); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); }
  function svcLabel(x, lang) { var s = svcOf(x); return (lang && s && s[lang]) || (s ? s.name : 'Appointment'); }
  function reminderParts(x, lang) {
    var b = byBranch[x.branch]; lang = lang || langOf(b);
    var T = L[lang], wd = T.wd[dow(x.date)];
    return { T: T, lang: lang, hi: T.hi, on: T.on, at: T.at, first: x.first || '', svc: svcLabel(x, lang), wd: wd, wdCap: wd.charAt(0).toUpperCase() + wd.slice(1),
      date: siDate(x.date), time: hm(x.start), dur: x.dur, city: b.city, street: b.street, address: b.address || b.street, phone: b.phone || '' };
  }
  function reminderText(x, lang) { var o = reminderParts(x, lang); return o.T.sms(o); }
  function smsHref(x, lang) {
    var num = String(x.phone || '').replace(/[^\d+]/g, '');
    if (!num) return '';
    // "?&body=" works in iOS and Android messages apps
    return 'sms:' + num + '?&body=' + encodeURIComponent(reminderText(x, lang));
  }

  // VTIMEZONE for Europe/Ljubljana and Europe/Zagreb (CET/CEST, EU summer time rules: last Sunday of
  // March 02:00 → last Sunday of October 03:00; Directive 2000/84/EC)
  function vtimezone(tz) {
    return ['BEGIN:VTIMEZONE', 'TZID:' + tz,
      'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
      'END:VTIMEZONE'];
  }
  function icsText(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function utf8(s) {
    s = String(s); var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.codePointAt(i); if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }
  function fold(line) {
    var out = [], cur = '', n = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i], code = line.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) { ch += line[i + 1]; i++; }
      var len = utf8(ch).length;
      if (n + len > 75) { out.push(cur); cur = ' '; n = 1; }
      cur += ch; n += len;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  function local(s, min) { return s.replace(/-/g, '') + 'T' + pad(Math.floor(min / 60)) + pad(min % 60) + '00'; }
  function stamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function bookingIcs(list, o) {
    o = o || {};
    list = Array.isArray(list) ? list : [list];
    var tzs = {}, ev = [];
    list.forEach(function (x) {
      var b = byBranch[x.branch], tz = b.country === 'HR' ? 'Europe/Zagreb' : 'Europe/Ljubljana', lang = o.lang || langOf(b), p = reminderParts(x, lang);
      tzs[tz] = 1;
      ev.push('BEGIN:VEVENT', 'UID:' + icsText(x.id) + '@branch-manager.stratum', 'DTSTAMP:' + stamp(o.now ? new Date(o.now) : new Date()),
        'DTSTART;TZID=' + tz + ':' + local(x.date, x.start), 'DTEND;TZID=' + tz + ':' + local(x.date, x.start + x.dur),
        'SUMMARY:' + icsText(p.svc + ' · ' + BRAND + ' ' + b.city), 'LOCATION:' + icsText(BRAND + ', ' + (b.address || b.street)),
        'DESCRIPTION:' + icsText(o.forStaff ? custName(x) + (x.phone ? ', ' + x.phone : '') + (x.note ? '\n' + x.note : '') : p.T.body(p)),
        'STATUS:' + (x.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(p.svc), 'TRIGGER:-P1D', 'END:VALARM',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(p.svc), 'TRIGGER:-PT2H', 'END:VALARM',
        'END:VEVENT');
    });
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clearfigure//Branch Manager//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    Object.keys(tzs).forEach(function (tz) { lines = lines.concat(vtimezone(tz)); });
    lines = lines.concat(ev, ['END:VCALENDAR']);
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b2 = bytes[i + 1], c = bytes[i + 2], n = a << 16 | (b2 || 0) << 8 | (c || 0);
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (b2 == null ? '=' : B64[n >> 6 & 63]) + (c == null ? '=' : B64[n & 63]);
    }
    return out.replace(/.{1,76}/g, function (m) { return m + '\r\n'; });
  }
  // RFC 2047 encoded word for non-ASCII header text
  function hdr(s) { return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(utf8(s)).replace(/\r\n/g, '') + '?='; }
  function bookingEml(x, o) {
    o = o || {};
    var b = byBranch[x.branch], p = reminderParts(x, o.lang), now = o.now ? new Date(o.now) : new Date();
    var boundary = '=_bm_' + hash(x.id + now.getTime()).toString(36);
    var to = (custName(x) ? hdr(custName(x)) + ' ' : '') + '<' + (x.email || '') + '>';
    var parts = [
      'X-Unsent: 1',
      'To: ' + to,
      'Reply-To: ' + b.email,
      'Subject: ' + hdr(p.T.subject(p)),
      'Date: ' + now.toUTCString().replace('GMT', '+0000'),
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="' + boundary + '"',
      '',
      'This is a multi-part message in MIME format.',
      '--' + boundary,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(utf8(p.T.body(p))),
      '--' + boundary,
      'Content-Type: text/calendar; charset=UTF-8; method=PUBLISH; name="termin.ics"',
      'Content-Disposition: attachment; filename="termin.ics"',
      'Content-Transfer-Encoding: base64',
      '',
      b64(utf8(bookingIcs(x, { now: now, lang: p.lang }))),
      '--' + boundary + '--',
      ''
    ];
    return parts.join('\r\n');
  }
  function markReminded(x, how) {
    var r = store.reminded[x.id] || (store.reminded[x.id] = {});
    r[how] = new Date(opts.now || Date.now()).toISOString();
    saveStore();
  }
  function reminded(x) { return store.reminded[x.id] || null; }

  // ── Online self-booking ───────────────────────────────────────────────────
  // slots for the public booking page: any room, at least `lead` minutes from now (default 60)
  function onlineSlots(branchId, svcId, s, lead) {
    var b = byBranch[branchId], sv = SVC[svcId];
    if (!b || !sv || !b.live || parse(s) < b.live) return [];
    if (s < TODAY) return [];
    var list = freeSlots(b, s, b.roomList.map(function (r) { return r.code; }), sv.dur);
    if (s === TODAY) { var min = nowMin() + (lead == null ? 60 : lead); list = list.filter(function (x) { return x.t >= min; }); }
    return list;
  }
  function bookingCode(id) { return (hash(id).toString(36).toUpperCase() + 'XXXXXX').slice(0, 6); }
  function selfBook(f) {
    var b = byBranch[f.branch], sv = SVC[f.svc];
    if (!b) throw new Error('branch');
    if (!sv) throw new Error('service');
    var first = String(f.first || '').trim(), last = String(f.last || '').trim(), email = String(f.email || '').trim(), phone = String(f.phone || '').trim();
    if (!first || !last) throw new Error('name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('email');
    if (phone.replace(/\D/g, '').length < 8) throw new Error('phone');
    var slot = onlineSlots(b.id, sv.id, f.date, f.lead).filter(function (x) { return x.t === +f.start; })[0];
    if (!slot) throw new Error('taken');
    var now = new Date(opts.now || Date.now());
    var x = { id: 'w-' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 7), gen: false, branch: b.id, date: f.date, room: slot.room, start: slot.t, dur: sv.dur, svc: sv.id,
      title: '', color: '', first: first, last: last, email: email, phone: phone, note: String(f.note || '').trim().slice(0, 1000),
      createdAt: ymd(now) + ' ' + hm(now.getHours() * 60 + now.getMinutes()), createdBy: 'Online booking', source: 'online', status: 'active', noShow: false,
      remind: { sms: !!f.remindSms, email: !!f.remindEmail }, lang: f.lang || langOf(b) };
    x.code = bookingCode(x.id);
    putBooking(x);
    return x;
  }
  function cancelOnline(id) {
    var x = store.added[id];
    if (!x || x.source !== 'online') throw new Error('not-found');
    var y = Object.assign({}, x, { status: 'cancelled', cancelledAt: new Date(opts.now || Date.now()).toISOString(), cancelledBy: 'customer' });
    putBooking(y);
    return y;
  }

  return {
    reload: reload,
    BM: BM, BRANCHES: BRANCHES, byBranch: byBranch, SERVICES: SERVICES, SVC: SVC, CUSTOM: CUSTOM, TODAY: TODAY, DAY: DAY,
    pad: pad, ymd: ymd, parse: parse, addDays: addDays, dow: dow, weekStart: weekStart, isoWeek: isoWeek, hm: hm, dm: dm, nowMin: nowMin,
    holidays: holidays, holidayOf: holidayOf, hours: hours, hash: hash, rng: rng, generated: generated,
    store: store, saveStore: saveStore, bookingsOn: bookingsOn, findBooking: findBooking, putBooking: putBooking, removeBooking: removeBooking,
    svcOf: svcOf, custName: custName, roomName: roomName, roomShort: roomShort, busy: busy, roomFree: roomFree, freeSlots: freeSlots,
    isPast: isPast, noShowStats: noShowStats, customerHistory: customerHistory, setNoShow: setNoShow,
    langOf: langOf, siDate: siDate, svcLabel: svcLabel, reminderText: reminderText, smsHref: smsHref, bookingIcs: bookingIcs, bookingEml: bookingEml, markReminded: markReminded, reminded: reminded,
    onlineSlots: onlineSlots, selfBook: selfBook, cancelOnline: cancelOnline, bookingCode: bookingCode, KEY: KEY
  };
}

  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BMBookings = api;
})(typeof window !== 'undefined' ? window : globalThis);
