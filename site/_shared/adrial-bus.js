/* Adrial Apps bus: how the demo apps (ERP, CRM, Analytics) talk to each other in the browser.
 *
 * Everything stays in this browser: one IndexedDB database "adrial-bus" (same origin as every app)
 * plus a BroadcastChannel("adrial-bus") so open tabs react immediately. No network.
 *
 *   <script src="/_shared/adrial-bus.js"></script>   →   window.AdrialBus
 *
 * 1) Shared snapshots (one current value per key, written by the owning app):
 *      await AdrialBus.publish('erp.catalog', data)   // overwrite; notifies other tabs
 *      await AdrialBus.read('erp.catalog')            // → { key, from, updatedAt, data } | null
 *    Keys in use (owner → readers):
 *      erp.catalog     ERP → CRM        { products:[{sku,name,category,brand,price,vat:{SI,HR},available,
 *                                         availableByCountry:{SI,HR}}], currency:'EUR' }
 *      erp.customers   ERP → CRM        { customers:[{id,name,type:'B2B'|'B2C',country,vatId,email}] }
 *      erp.summary     ERP → Analytics  { asOf, months:[{month:'YYYY-MM',revenue,cogs,orders,invoices,
 *                                         paid,byLocation:{loc:revenue},byCategory:{cat:revenue}}],
 *                                         receivables:{notDue,d0_30,d31_60,d61_90,d90p}, stockValue,
 *                                         lowStock, openSalesOrders, openPurchaseOrders }
 *      crm.summary     CRM → Analytics  { asOf, openPipeline, weightedForecastQuarter, wonByMonth:
 *                                         [{month,value,count}], winRate90d, byStage:[{stage,count,value}],
 *                                         byOwner:[{owner,won,open,target}] }
 *
 * 2) Messages (a queue; the receiver marks them done):
 *      await AdrialBus.send('erp', 'crm.order', payload) → id
 *      await AdrialBus.inbox('erp')                       → [message…] status 'new', oldest first
 *      await AdrialBus.done(id, result)                   // status 'done' + result (or AdrialBus.fail(id, reason))
 *      AdrialBus.on(fn)        // fn({kind:'message'|'snapshot', to?, type?, key?}) for changes from ANY tab
 *    Message types:
 *      crm.order        CRM → ERP   { dealId, dealTitle, quoteNo?, customer:{name,country:'SI'|'HR',vatId?,
 *                                     email?, address?}, lines:[{sku, name, qty, unitPrice, discountPct?}],
 *                                     note? }  → ERP creates a DRAFT sales order (and the customer if new)
 *                                     and calls done(id, {orderNo, orderId}).
 *      erp.orderStatus  ERP → CRM   { dealId, orderNo, status:'Draft'|'Confirmed'|'Shipped'|'Invoiced'|
 *                                     'Cancelled', invoiceNo?, invoiceStatus?:'Unpaid'|'Partially paid'|
 *                                     'Paid'|'Overdue', amount? } — sent on every status change of an
 *                                     order that came from CRM; CRM shows it on the deal.
 *
 * Every function resolves even if storage is unavailable (private mode): reads give null/[], writes
 * are no-ops, AdrialBus.available is false — apps must keep working on their own.
 */
(function () {
  'use strict';
  if (window.AdrialBus) return;

  var DB = 'adrial-bus', VERSION = 1, chan = null, listeners = [], dbp = null;
  try { chan = new BroadcastChannel('adrial-bus'); } catch (e) {}

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(DB, VERSION); } catch (e) { return resolve(null); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('messages')) {
          var m = db.createObjectStore('messages', { keyPath: 'id' });
          m.createIndex('to_status', ['to', 'status']);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = req.onblocked = function () { resolve(null); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var t, out;
        try { t = db.transaction(store, mode); } catch (e) { return resolve(null); }
        out = fn(t.objectStore(store));
        t.oncomplete = function () { resolve(out && 'result' in out ? out.result : out); };
        t.onerror = t.onabort = function () { resolve(null); };
      });
    });
  }
  function notify(evt) { if (chan) try { chan.postMessage(evt); } catch (e) {} fire(evt); }
  function fire(evt) { listeners.forEach(function (fn) { try { fn(evt); } catch (e) { console.error(e); } }); }
  if (chan) chan.onmessage = function (e) { fire(e.data || {}); };
  function uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function app() { var m = location.pathname.match(/^\/([^/]+)\//); return m ? m[1] : 'site'; }

  var Bus = {
    available: true,
    publish: function (key, data) {
      var rec = { key: key, from: app(), updatedAt: new Date().toISOString(), data: data };
      return tx('shared', 'readwrite', function (s) { s.put(rec); return { result: true }; }).then(function (ok) {
        if (ok) notify({ kind: 'snapshot', key: key, from: rec.from });
        return !!ok;
      });
    },
    read: function (key) { return tx('shared', 'readonly', function (s) { return s.get(key); }).then(function (r) { return r || null; }); },
    send: function (to, type, payload) {
      var msg = { id: uid(), to: to, from: app(), type: type, payload: payload, status: 'new', createdAt: new Date().toISOString() };
      return tx('messages', 'readwrite', function (s) { s.put(msg); return { result: msg.id }; }).then(function (id) {
        if (id) notify({ kind: 'message', to: to, type: type, from: msg.from });
        return id || null;
      });
    },
    inbox: function (to) {
      return tx('messages', 'readonly', function (s) { return s.index('to_status').getAll([to, 'new']); }).then(function (rows) {
        return (rows || []).sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
      });
    },
    history: function (filter) {
      return tx('messages', 'readonly', function (s) { return s.getAll(); }).then(function (rows) {
        rows = rows || [];
        return filter ? rows.filter(filter) : rows;
      });
    },
    done: function (id, result) { return settle(id, 'done', { result: result }); },
    fail: function (id, reason) { return settle(id, 'failed', { error: String(reason || '') }); },
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    reset: function (prefix) {
      // Remove one app's snapshots and messages it sent or received (used by "Reset demo data").
      return Promise.all([
        tx('shared', 'readwrite', function (s) { var r = s.getAll(); r.onsuccess = function () { r.result.forEach(function (x) { if (!prefix || x.key.indexOf(prefix + '.') === 0) s.delete(x.key); }); }; }),
        tx('messages', 'readwrite', function (s) { var r = s.getAll(); r.onsuccess = function () { r.result.forEach(function (x) { if (!prefix || x.to === prefix || x.from === prefix) s.delete(x.id); }); }; })
      ]).then(function () { notify({ kind: 'snapshot', key: (prefix || '*') + '.reset' }); });
    }
  };
  function settle(id, status, extra) {
    return tx('messages', 'readwrite', function (s) {
      var r = s.get(id);
      r.onsuccess = function () { if (r.result) { var m = Object.assign(r.result, extra, { status: status, settledAt: new Date().toISOString() }); s.put(m); } };
      return { result: true };
    }).then(function (ok) { if (ok) notify({ kind: 'message', id: id, status: status }); return !!ok; });
  }
  open().then(function (db) { Bus.available = !!db; });
  window.AdrialBus = Bus;
})();
