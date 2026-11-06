/* Sets the theme before the first paint, from the computer's setting, and follows it when it changes.
   A separate file because the page's policy allows no inline script. When the computer flips between light and dark
   later, the flip cross-fades once inside a view transition (one-shot C3), unless the computer asks for reduced motion
   or the owner turned animations off (<html data-motion="off">); the first paint never moves. */
(function () {
  var root = document.documentElement;
  try {
    var query = window.matchMedia('(prefers-color-scheme: dark)');
    var apply = function () { root.setAttribute('data-theme', query.matches ? 'dark' : 'light'); };
    var still = function () {
      try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true; } catch (error) { return true; }
      return root.getAttribute('data-motion') === 'off';
    };
    var flip = function () {
      if (typeof document.startViewTransition !== 'function' || still()) { apply(); return; }
      root.setAttribute('data-swap', 'window');
      var done = function () { if (root.getAttribute('data-swap') === 'window') root.removeAttribute('data-swap'); };
      var transition = document.startViewTransition(apply);
      if (transition && transition.finished) transition.finished.then(done, done); else done();
    };
    apply();
    if (query.addEventListener) query.addEventListener('change', flip);
  } catch (error) {
    root.setAttribute('data-theme', 'light');
  }
})();
