# Home page looks

The home page (`site/index.html`) is built in the Microsoft 365 look. The Style menu in its top bar (and `?look=…`, and
"Style: …" in the ⌘K bar) switches `html[data-look]` between `m365` (default), `appstore`, `raycast`, `arc`, `odoo` and `classic`
(the earlier cursor.com look), remembered per device in localStorage `stratum-home-look`.

Each other look is two files here:
- `<name>.css`: every rule scoped to `:root[data-look="<name>"]`, loaded after the page's own styles, so it overrides them
  only while that look is on. Light and dark follow the shell's `html[data-stratum-mode]`.
- `<name>.js`: optional extra markup (e.g. story cards, a detail pane, a sidebar of spaces) that it adds when its look
  becomes active and removes when another is chosen. It listens to the window event `home-look` ({ look, prev }):
  when its look is left it unmounts at once; when its look is chosen it mounts a moment later (a microtask, or a
  timeout in `classic.js`), so the look being left has always restored the page (markup, search box text) before the
  next one starts, whichever script loaded first (listeners run in the order the scripts loaded). At load it calls its
  own `apply()` once, which mounts it only if its look is already active.

Loading: only the active look's two files are in the page (`index.html` writes them in while it loads, so the first
paint is already in the right style). Another look's CSS and JS load the first time it is chosen, or when the pointer
or focus rests on it in the Style menu; `HomeLook.set(name)` switches once both have loaded. `HomeLook.load(name)` returns
a promise for preloading. Bump `?v=` in `index.html` (`VER` and the two written tags) when a look's files change.

The page's features work in every look: search, ⌘K, pins, Needs you today, Quick access, all apps, groups, Install.

`sync.js` is not a look: it keeps the pinned apps and "Needs you today" the same on the phone and the computer
(see the comment at its top).
