/* Adrial Apps · Desk — board, calendar, done log, example data, backup / restore and CSV.
 * Loaded before app.js; app.js calls DeskFeatures.init(core) with its helpers.
 * Everything stays in the browser; mail and PDF text only reaches the page through textContent.
 */
(function () {
  'use strict';

  function init(core) {
    var h = core.h, icon = core.icon, state = core.state, X = core.X;
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var COLS = { todo: 'var(--ink3)', doing: 'var(--blue-dot)', waiting: 'var(--clay-dot)', done: 'var(--ok-dot)' };

    // ---------- board ----------

    function renderBoard(view) {
      var tasks = core.visibleTasks(), statuses = core.STATUSES;
      var board = h('div', { class: 'board' });
      var t0 = core.todayIso(), cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      statuses.forEach(function (s, si) {
        var items = tasks.filter(function (t) { return t.status === s.k; });
        var older = 0;
        if (s.k === 'done') {
          items.sort(function (a, b) { return (b.doneAt || '') < (a.doneAt || '') ? -1 : 1; });
          var recent = items.filter(function (t) { return (t.doneAt || t.updatedAt) >= cutoff; });
          older = items.length - recent.length;
          items = recent.slice(0, 40);
        } else items = core.sortTasks(items);
        var col = h('section', { class: 'col', 'data-status': s.k, 'aria-label': s.l + ', ' + items.length + ' tasks' }, [
          h('h2', { class: 'col-h', style: '--c:' + COLS[s.k] }, [h('i'), s.l, h('span', { class: 'c', text: String(items.length + older) })])
        ]);
        items.forEach(function (t) { col.appendChild(card(t, si, statuses)); });
        if (!items.length) col.appendChild(h('p', { class: 'more', text: s.k === 'done' ? 'Nothing finished in the last two weeks.' : 'Drag tasks here.' }));
        if (older) col.appendChild(h('button', { type: 'button', class: 'btn tiny ghost', text: older + ' older in the Done log', onclick: function () { core.setView('done'); } }));
        col.addEventListener('dragover', function (e) {
          if (Array.prototype.indexOf.call(e.dataTransfer.types || [], 'text/x-desk-task') < 0) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over');
        });
        col.addEventListener('dragleave', function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
        col.addEventListener('drop', function (e) {
          var id = e.dataTransfer.getData('text/x-desk-task');
          col.classList.remove('over');
          if (!id) return;
          e.preventDefault();
          var t = core.taskById(id);
          if (t && t.status !== s.k) move(t, s.k);
        });
        board.appendChild(col);
      });
      view.appendChild(h('p', { class: 'help', text: 'Drag a card to another column, or focus a card and use the arrow buttons (or Alt + ← / →).' }));
      view.appendChild(board);
      void t0;
    }
    function card(t, si, statuses) {
      var prev = statuses[si - 1], next = statuses[si + 1];
      var mail = t.mailId ? state.mails[t.mailId] : null;
      var meta = [];
      if (t.forWhom) meta.push(h('span', { class: 'who' }, [icon('user'), t.forWhom]));
      if (mail && core.norm(core.personLabel(mail.from)) !== core.norm(t.forWhom)) meta.push(h('span', { title: 'From e-mail' }, [icon('mail'), core.personLabel(mail.from) || 'e-mail']));
      var n = (t.checklist || []).length;
      if (n) meta.push(h('span', null, [icon('list'), (n - core.openItems(t)) + '/' + n]));
      if ((t.confirmations || []).length) meta.push(h('span', null, [icon('link'), String(t.confirmations.length)]));
      var el = h('article', { class: 'bcard', draggable: 'true', 'data-id': t.id }, [
        h('button', { type: 'button', class: 'open', text: t.title || '(untitled)', 'aria-keyshortcuts': 'Alt+ArrowLeft Alt+ArrowRight', onclick: function () { core.openTask(t.id); } }),
        meta.length ? h('div', { class: 'meta' }, meta) : null,
        h('div', { class: 'meta' }, [core.dueBadge(t), t.priority === 'high' ? h('span', { class: 'pill bad', text: 'High' }) : null, t.status === 'done' && t.confirmed ? h('span', { class: 'pill ok' }, [icon('check'), 'Confirmed']) : null]),
        h('div', { class: 'mv' }, [
          prev ? h('button', { type: 'button', class: 'btn icon tiny ghost', 'aria-label': 'Move “' + t.title + '” to ' + prev.l, title: 'Move to ' + prev.l, onclick: function () { move(t, prev.k); } }, icon('left')) : null,
          next ? h('button', { type: 'button', class: 'btn icon tiny ghost', 'aria-label': 'Move “' + t.title + '” to ' + next.l, title: 'Move to ' + next.l, onclick: function () { move(t, next.k); } }, icon('right')) : null
        ])
      ]);
      el.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/x-desk-task', t.id);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); });
      el.addEventListener('keydown', function (e) {
        if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        var to = e.key === 'ArrowLeft' ? prev : next;
        if (!to) return;
        e.preventDefault();
        move(t, to.k);
      });
      return el;
    }
    async function move(t, k) {
      var ok = await core.setStatus(t, k);
      if (!ok) return;
      core.toast('“' + t.title + '” moved to ' + core.statusOf(k).l + '.');
      var b = document.querySelector('.bcard[data-id="' + t.id + '"] .open');
      if (b) b.focus();
    }

    // ---------- calendar ----------

    function bookingsOf(tasks) {
      var out = [];
      tasks.forEach(function (t) {
        (t.confirmations || []).forEach(function (c) {
          if (!c.dateFrom) return;
          out.push({ task: t, conf: c, from: c.dateFrom, to: c.dateTo && c.dateTo >= c.dateFrom ? c.dateTo : c.dateFrom });
        });
      });
      return out;
    }
    function renderCalendar(view) {
      var t0 = core.todayIso();
      var month = /^\d{4}-\d{2}$/.test(state.calMonth || '') ? state.calMonth : t0.slice(0, 7);
      var y = +month.slice(0, 4), m = +month.slice(5, 7);
      var first = month + '-01';
      var dowFirst = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
      var start = core.addDays(first, -dowFirst);
      var daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      var last = month + '-' + (daysInMonth < 10 ? '0' : '') + daysInMonth;
      var dowLast = (new Date(last + 'T00:00:00Z').getUTCDay() + 6) % 7;
      var end = core.addDays(last, 6 - dowLast);
      var tasks = core.visibleTasks();
      var books = bookingsOf(tasks);
      if (!state.calDay || state.calDay.slice(0, 7) !== month) state.calDay = t0.slice(0, 7) === month ? t0 : first;

      function shift(n) {
        var d = new Date(Date.UTC(y, m - 1 + n, 1));
        state.calMonth = d.toISOString().slice(0, 7); state.calDay = null; core.saveUi(); core.renderMain();
        var b = document.getElementById(n < 0 ? 'cal-prev' : 'cal-next'); if (b) b.focus();
      }
      view.appendChild(h('div', { class: 'cal-head' }, [
        h('button', { type: 'button', class: 'btn icon small', id: 'cal-prev', 'aria-label': 'Previous month', onclick: function () { shift(-1); } }, icon('left')),
        h('h2', { 'aria-live': 'polite', text: MONTHS[m - 1] + ' ' + y }),
        h('button', { type: 'button', class: 'btn icon small', id: 'cal-next', 'aria-label': 'Next month', onclick: function () { shift(1); } }, icon('right')),
        h('button', { type: 'button', class: 'btn small', text: 'Today', onclick: function () { state.calMonth = t0.slice(0, 7); state.calDay = t0; core.saveUi(); core.renderMain(); } }),
        h('div', { class: 'cal-legend' }, [
          h('span', { style: '--c:var(--accent)' }, [h('i'), 'Due']),
          h('span', { style: '--c:var(--bad-dot)' }, [h('i'), 'Overdue']),
          h('span', { style: '--c:var(--teal-dot)' }, [h('i'), 'Booking dates'])
        ])
      ]));
      var grid = h('div', { class: 'cal', role: 'grid', 'aria-label': MONTHS[m - 1] + ' ' + y });
      DOW.forEach(function (d) { grid.appendChild(h('div', { class: 'dow', role: 'columnheader', text: d })); });
      var row = null;
      for (var d = start, k = 0; d <= end; d = core.addDays(d, 1), k++) {
        if (k % 7 === 0) { row = h('div', { role: 'row', style: 'display:contents' }); grid.appendChild(row); }
        row.appendChild(dayCell(d, month, t0, tasks, books));
      }
      view.appendChild(grid);
      view.appendChild(dayList(state.calDay, tasks, books, t0));
    }
    function eventsOn(day, tasks, books) {
      return {
        due: core.sortTasks(tasks.filter(function (t) { return t.due === day; })),
        book: books.filter(function (b) { return b.from <= day && day <= b.to && X.daysBetween(b.from, b.to) <= 62; })
      };
    }
    function bookLabel(b, day) {
      var name = b.conf.label || b.conf.provider || 'Booking';
      if (b.from === b.to) return name;
      if (day === b.from) return name + ' · start';
      if (day === b.to) return name + ' · end';
      return name;
    }
    function dayCell(day, month, t0, tasks, books) {
      var ev = eventsOn(day, tasks, books);
      var label = core.fmtDateWd(day) + (ev.due.length ? ', ' + core.plural(ev.due.length, 'task due', 'tasks due') : '') + (ev.book.length ? ', ' + core.plural(ev.book.length, 'booking', 'bookings') : '');
      var cell = h('button', {
        type: 'button', role: 'gridcell', class: 'day' + (day.slice(0, 7) !== month ? ' out' : '') + (day === t0 ? ' today' : ''), 'aria-pressed': String(state.calDay === day), 'aria-label': label,
        onclick: function () { state.calDay = day; core.renderMain(); var c = document.querySelector('.day[aria-pressed="true"]'); if (c) c.focus(); }
      }, [h('span', { class: 'dn', text: String(+day.slice(8)) })]);
      var chips = [], dots = h('span', { class: 'dots', 'aria-hidden': 'true' });
      ev.due.forEach(function (t) {
        var over = t.status !== 'done' && day < t0;
        chips.push(h('span', { class: 'ev due' + (over ? ' over' : '') + (t.status === 'done' ? ' done' : ''), title: t.title, text: t.title }));
        dots.appendChild(h('i', { style: '--c:' + (over ? 'var(--bad-dot)' : 'var(--accent)') }));
      });
      ev.book.forEach(function (b) {
        chips.push(h('span', { class: 'ev book', title: (b.conf.label || '') + ' · ' + b.task.title, text: bookLabel(b, day) }));
        dots.appendChild(h('i', { style: '--c:var(--teal-dot)' }));
      });
      chips.slice(0, 3).forEach(function (c) { cell.appendChild(c); });
      if (chips.length > 3) cell.appendChild(h('span', { class: 'ev more', text: '+' + (chips.length - 3) + ' more' }));
      if (chips.length) cell.appendChild(dots);
      return cell;
    }
    function dayList(day, tasks, books, t0) {
      var ev = eventsOn(day, tasks, books);
      var box = h('section', { class: 'cal-list', 'aria-live': 'polite' }, [h('h3', { text: core.fmtDateWd(day) + (day === t0 ? ' · today' : '') })]);
      if (!ev.due.length && !ev.book.length) { box.appendChild(h('p', { class: 'help', text: 'Nothing due and no bookings on this day.' })); return box; }
      if (ev.due.length) box.appendChild(core.groupEl({ title: 'Due', items: ev.due }));
      if (ev.book.length) {
        box.appendChild(h('section', { class: 'group' }, [
          h('h2', { class: 'group-h' }, ['Bookings', h('span', { class: 'c', text: String(ev.book.length) })]),
          h('ul', { class: 'tasks' }, ev.book.map(function (b) {
            var c = b.conf;
            return h('li', { class: 'row' }, [
              core.provIcon(c.kind),
              h('button', { type: 'button', class: 'rowmain', onclick: function () { core.openTask(b.task.id); } }, [
                h('span', { class: 't', text: (c.label || c.provider || 'Booking') }),
                h('span', { class: 'meta' }, [h('span', { text: b.task.title }), h('span', { text: core.fmtRange(b.from, b.to !== b.from ? b.to : '') }), c.ref ? h('span', { class: 'mono', text: c.ref }) : null])
              ]),
              h('span', { class: 'rowside' }, [day === b.from && b.to !== b.from ? h('span', { class: 'pill teal', text: 'Starts' }) : null, day === b.to && b.to !== b.from ? h('span', { class: 'pill teal', text: 'Ends' }) : null, core.statusPill(b.task)])
            ]);
          }))
        ]));
      }
      return box;
    }

    // ---------- done log ----------

    function renderDoneLog(view) {
      var done = core.visibleTasks().filter(function (t) { return t.status === 'done'; })
        .sort(function (a, b) { return (b.doneAt || b.updatedAt) < (a.doneAt || a.updatedAt) ? -1 : 1; });
      if (!done.length) { view.appendChild(h('p', { class: 'none' }, [h('b', { text: 'Nothing done yet.' }), 'Finished tasks are listed here by day, with their confirmations.'])); return; }
      var t0 = core.todayIso(), byDay = {}, order = [];
      done.slice(0, 300).forEach(function (t) {
        var d = core.isoOf(new Date(t.doneAt || t.updatedAt));
        if (!byDay[d]) { byDay[d] = []; order.push(d); }
        byDay[d].push(t);
      });
      var log = h('div', { class: 'log' });
      order.forEach(function (d) {
        var title = d === t0 ? 'Today · ' + core.fmtDate(d) : d === core.addDays(t0, -1) ? 'Yesterday · ' + core.fmtDate(d) : core.fmtDateWd(d);
        log.appendChild(h('section', { class: 'log-day' }, [
          h('h2', { class: 'group-h' }, [title, h('span', { class: 'c', text: String(byDay[d].length) })]),
          h('ul', { class: 'tasks' }, byDay[d].map(logItem))
        ]));
      });
      if (done.length > 300) log.appendChild(h('p', { class: 'help', text: 'Showing the latest 300. Use search or the All view for older tasks.' }));
      view.appendChild(log);
    }
    function logItem(t) {
      var mail = t.mailId ? state.mails[t.mailId] : null;
      var meta = [];
      if (t.forWhom) meta.push(h('span', { class: 'who' }, [icon('user'), t.forWhom]));
      if (mail) meta.push(h('span', null, [icon('mail'), core.personLabel(mail.from) || 'e-mail']));
      meta.push(t.confirmed ? h('span', { class: 'pill ok' }, [icon('check'), 'Confirmed']) : h('span', { class: 'pill', text: (t.confirmations || []).length ? 'Done' : 'Done · no confirmation' }));
      return h('li', { class: 'log-item' }, [
        h('span', { class: 'tm', text: core.fmtTime(t.doneAt || t.updatedAt) }),
        h('div', { class: 'bd' }, [
          h('button', { type: 'button', text: t.title || '(untitled)', onclick: function () { core.openTask(t.id); } }),
          h('div', { class: 'meta' }, meta),
          (t.confirmations || []).map(function (c) {
            var parts = [core.provIcon(c.kind), h('b', { style: 'font-weight:500', text: c.label || c.provider || c.fileName || 'Confirmation' })];
            if (c.ref) parts.push(h('span', { class: 'mono', text: c.ref }));
            if (c.dateFrom) parts.push(h('span', { text: core.fmtRange(c.dateFrom, c.dateTo) }));
            if (c.amount != null) parts.push(h('span', { text: core.money(+c.amount, c.currency) }));
            if (c.url) parts.push(h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open link' }));
            if (c.fileHash) parts.push(h('button', { type: 'button', text: 'Open file', onclick: function () { core.openFile(c.fileHash, c.fileName); } }));
            var el = h('div', { class: 'conf-mini' }, parts);
            el.querySelector('.prov').setAttribute('style', 'width:26px;height:26px;border-radius:8px');
            return el;
          })
        ])
      ]);
    }

    // ---------- example data (clearly fictional) ----------

    async function loadExamples() {
      var t0 = core.todayIso(), now = core.nowIso();
      function mail(subject, fromName, fromAddr, text, daysAgo) {
        var d = new Date(Date.now() - daysAgo * 86400000);
        return { id: core.uid(), key: 'example:' + core.uid(), altKey: '', messageId: '', subject: subject, from: { name: fromName, address: fromAddr }, to: [{ name: 'Office (example)', address: 'office@example.com' }], cc: [], date: d.toISOString(), text: text, htmlHash: null, links: X.findUrls(text), attachments: [], source: 'example', fileName: '', rtfOnly: false, importedAt: now };
      }
      var fair = core.addDays(t0, 13), fair2 = core.addDays(t0, 15);
      var list = [];
      var m1 = mail('RE: Hotel v Zagrebu za sejem', 'Ana Novak (example)', 'ana.novak@example.com',
        'Živjo,\n\nprosim rezerviraj hotel v Zagrebu od ' + dotted(fair) + ' do ' + dotted(fair2) + ' (2 noči), čim bližje sejmišču.\nRezervacijo potrebujem do petka.\n\nHvala,\nAna', 1);
      list.push({ mail: m1, task: { title: 'Hotel v Zagrebu za sejem', status: 'todo', due: core.addDays(t0, 2), priority: 'normal', forWhom: 'Ana Novak (example)', tags: ['travel', 'example'],
        checklist: [{ id: core.uid(), text: 'Find a hotel near the fair grounds', done: true }, { id: core.uid(), text: 'Book 2 nights', done: false }, { id: core.uid(), text: 'Send the confirmation to Ana', done: false }] } });
      var m2 = mail('FW: Flights Ljubljana – Frankfurt', 'Marko Kranjc (example)', 'marko.kranjc@example.com',
        'Hi,\n\ncould you book me a return flight to Frankfurt? Out on ' + dotted(core.addDays(t0, 9)) + ' in the morning, back the next evening. Hand luggage only.\nPlease by tomorrow.\n\nThanks, Marko', 2);
      list.push({ mail: m2, task: { title: 'Flights Ljubljana – Frankfurt', status: 'doing', due: t0, priority: 'high', forWhom: 'Marko Kranjc (example)', tags: ['travel', 'example'] } });
      list.push({ mail: null, task: { title: 'Meeting room for the Q4 review', status: 'waiting', due: core.addDays(t0, 5), priority: 'normal', forWhom: 'Management (example)', tags: ['example'], notes: 'Waiting for Petra to confirm the number of people (example).' } });
      var m4 = mail('Rent-a-car Split', 'Sales team (example)', 'sales@example.com', 'Pozdrav,\n\ntrebamo auto u Splitu od ' + dotted(core.addDays(t0, 4)) + ' do ' + dotted(core.addDays(t0, 6)) + '. Molim rezervaciju najkasnije do ' + dotted(core.addDays(t0, -1)) + '.\n\nHvala', 4);
      list.push({ mail: m4, task: { title: 'Rent-a-car Split', status: 'todo', due: core.addDays(t0, -1), priority: 'high', forWhom: 'Sales team (example)', tags: ['travel', 'example'] } });
      var conf5 = { id: core.uid(), kind: 'hotel', label: 'Hotel Lipa Example', url: 'https://hotel-lipa.example.com/reservations/EX-48213', provider: 'Hotel Lipa Example', ref: 'EX-48213', dateFrom: core.addDays(t0, 8), dateTo: core.addDays(t0, 10), amount: 238, currency: 'EUR', addedAt: now };
      var m5 = mail('Workshop Ljubljana – accommodation', 'Petra Zupan (example)', 'petra.zupan@example.com', 'Prosim za 2 noči v Ljubljani za delavnico. Hvala!', 6);
      list.push({ mail: m5, task: { title: 'Workshop Ljubljana – accommodation', status: 'done', due: core.addDays(t0, -2), forWhom: 'Petra Zupan (example)', tags: ['travel', 'example'], confirmations: [conf5], confirmed: true, confirmedWith: conf5.id, confirmedAt: new Date(Date.now() - 86400000).toISOString(), doneAt: new Date(Date.now() - 86400000).toISOString() } });
      var conf6 = { id: core.uid(), kind: 'train', label: 'Train to Vienna (example)', url: 'https://tickets.example.com/order/77120', provider: 'Example Rail', ref: '77120', dateFrom: core.addDays(t0, 14), dateTo: '', amount: 59.9, currency: 'EUR', addedAt: now };
      list.push({ mail: null, task: { title: 'Train tickets to Vienna', status: 'done', forWhom: 'Mojca Kos (example)', tags: ['example'], confirmations: [conf6], doneAt: new Date(Date.now() - 3 * 86400000).toISOString() } });

      for (var i = 0; i < list.length; i++) {
        var it = list[i], t = core.newTask(it.task);
        if (it.mail) {
          it.mail.taskId = t.id; t.mailId = it.mail.id;
          if (!t.due) t.dueSuggestions = X.suggestDue(it.mail.text, it.mail.subject, core.isoOf(new Date(it.mail.date)));
          await core.saveMail(it.mail);
        }
        await core.saveTask(t, true);
      }
      core.changed();
      core.renderMain();
      core.toast(list.length + ' example tasks added. They are fictional; remove them with Settings → Clear all data, or select and delete them.');
    }
    function dotted(iso) { return +iso.slice(8) + '.' + (+iso.slice(5, 7)) + '.' + iso.slice(0, 4); }

    // ---------- backup / restore / CSV ----------

    function stamp() { return core.todayIso(); }
    function saveBlob(blob, name) {
      var a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
    }
    function toBase64(blob) {
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).replace(/^data:[^,]*,/, '')); }; fr.onerror = rej; fr.readAsDataURL(blob); });
    }
    async function downloadBackup() {
      var refs = core.referencedFiles(), files = [], missing = 0;
      var hashes = Object.keys(refs);
      for (var i = 0; i < hashes.length; i++) {
        var r = await core.idb.get('files', hashes[i]);
        if (!r || !r.blob) { missing++; continue; }
        files.push({ hash: r.hash, name: r.name || refs[r.hash].name || '', type: r.type || r.blob.type, data: await toBase64(r.blob) });
      }
      var data = { app: 'adrial-desk', version: 1, exportedAt: core.nowIso(), tasks: state.tasks, mails: Object.keys(state.mails).map(function (k) { return state.mails[k]; }), settings: state.settings, files: files };
      saveBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'desk-backup-' + stamp() + '.json');
      core.toast('Backup downloaded: ' + core.plural(state.tasks.length, 'task', 'tasks') + ', ' + core.plural(files.length, 'file', 'files') + '.' + (missing ? ' ' + core.plural(missing, 'file is', 'files are') + ' only in your cloud copy and not included.' : ''));
    }
    async function restoreBackup(file) {
      var data;
      try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('That file is not a Desk backup (.json).'); }
      if (!data || data.app !== 'adrial-desk' || !Array.isArray(data.tasks) || !Array.isArray(data.mails)) throw new Error('That file is not a Desk backup.');
      var v = await core.ask({
        title: 'Restore this backup?',
        text: 'It has ' + core.plural(data.tasks.length, 'task', 'tasks') + ' from ' + (data.exportedAt ? core.fmtDateTime(data.exportedAt) : 'an unknown date') + '. Replace everything in Desk with it, or only add the tasks that are not here yet?',
        buttons: [{ v: 'cancel', label: 'Cancel' }, { v: 'add', label: 'Add missing tasks' }, { v: 'replace', label: 'Replace everything', primary: true }]
      });
      if (v !== 'add' && v !== 'replace') return;
      document.getElementById('settings').close();
      var files = Array.isArray(data.files) ? data.files : [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        try {
          var bin = atob(f.data || ''), u8 = new Uint8Array(bin.length);
          for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
          await core.putFile(u8, f.name, f.type);
        } catch (e) { console.warn('restore file', e); }
      }
      var added = 0;
      if (v === 'replace') { await core.replaceAll(data); added = data.tasks.length; }
      else {
        var mails = {};
        data.mails.forEach(function (m) { if (m && m.id) mails[m.id] = m; });
        for (var j = 0; j < data.tasks.length; j++) {
          var t = data.tasks[j];
          if (!t || !t.id || core.taskById(t.id)) continue;
          if (t.mailId && mails[t.mailId]) await core.saveMail(mails[t.mailId]);
          await core.saveTask(core.cleanTask(t), true);
          added++;
        }
      }
      await core.gcFiles();
      core.changed();
      core.renderMain();
      core.updateStorageLine();
      core.toast(v === 'replace' ? 'Backup restored: ' + core.plural(added, 'task', 'tasks') + '.' : core.plural(added, 'task', 'tasks') + ' added from the backup.');
    }
    function csvCell(v) {
      var s = v == null ? '' : String(v);
      return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function downloadCsv() {
      var head = ['Title', 'Status', 'Confirmed', 'Due date', 'Priority', 'For whom', 'Tags', 'Checklist done', 'Checklist total', 'E-mail subject', 'E-mail from', 'E-mail sent', 'Confirmations', 'Booking references', 'Booking dates', 'Totals', 'Created', 'Done at', 'Notes'];
      var rows = core.sortTasks(state.tasks).map(function (t) {
        var m = t.mailId ? state.mails[t.mailId] : null, cs = t.confirmations || [], n = (t.checklist || []).length;
        return [
          t.title, core.statusOf(t.status).l, t.confirmed ? 'yes' : '', t.due ? core.fmtDate(t.due) : '', t.priority, t.forWhom, (t.tags || []).join(', '),
          n ? n - core.openItems(t) : '', n || '',
          m ? m.subject : '', m ? core.personFull(m.from) : '', m && m.date ? core.fmtDateTime(m.date) : '',
          cs.map(function (c) { return c.label + (c.url ? ' <' + c.url + '>' : c.fileName ? ' [' + c.fileName + ']' : ''); }).join(' | '),
          cs.map(function (c) { return c.ref || ''; }).filter(Boolean).join(' | '),
          cs.filter(function (c) { return c.dateFrom; }).map(function (c) { return core.fmtRange(c.dateFrom, c.dateTo); }).join(' | '),
          cs.filter(function (c) { return c.amount != null; }).map(function (c) { return core.money(+c.amount, c.currency); }).join(' | '),
          core.fmtDateTime(t.createdAt), t.doneAt ? core.fmtDateTime(t.doneAt) : '', t.notes
        ];
      });
      var csv = '﻿' + [head].concat(rows).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
      saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'desk-tasks-' + stamp() + '.csv');
    }

    return { renderBoard: renderBoard, renderCalendar: renderCalendar, renderDoneLog: renderDoneLog, loadExamples: loadExamples, downloadBackup: downloadBackup, restoreBackup: restoreBackup, downloadCsv: downloadCsv };
  }

  window.DeskFeatures = { init: init };
})();
