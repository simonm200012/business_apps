// Branch Manager: Escape closes the open side panel or dialog, the same as its Close button.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  var open = [].slice.call(document.querySelectorAll('[role="dialog"]')).filter(function (d) { return d.offsetParent !== null; });
  var top = open[open.length - 1];
  var close = top && top.querySelector('[aria-label="Close panel"], [aria-label="Close dialog"]');
  if (close) { e.preventDefault(); close.click(); }
});
