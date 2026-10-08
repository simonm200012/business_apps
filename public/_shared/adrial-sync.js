/* AdrialSync: optional cloud copy. This static (Cloudflare Pages) build has no sync server, so it stays 'off':
   attach() returns an inert controller and the shell's account button stays hidden. */
(function () {
  function noop() {}
  window.AdrialSync = {
    available: false,
    attach: function () { return { state: 'off', changed: noop, now: noop, mountPanel: function (el) { if (el) el.innerHTML = '<div style="font-size:12px;opacity:.7">Cloud sync is not set up. Your data stays in this browser.</div>'; }, destroy: noop }; }
  };
})();
