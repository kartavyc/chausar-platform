/* Sets the theme before the first paint, from the computer's setting, and follows it when it changes.
   A separate file because the page's policy allows no inline script. */
(function () {
  var root = document.documentElement;
  try {
    var query = window.matchMedia('(prefers-color-scheme: dark)');
    var apply = function () { root.setAttribute('data-theme', query.matches ? 'dark' : 'light'); };
    apply();
    if (query.addEventListener) query.addEventListener('change', apply);
  } catch (error) {
    root.setAttribute('data-theme', 'light');
  }
})();
