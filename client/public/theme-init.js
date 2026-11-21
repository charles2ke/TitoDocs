// Applies the saved colour theme before the app loads to avoid a flash of the wrong theme.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('titodocs:theme'); } catch (e) {}
  var dark = saved === 'dark' || ((!saved || saved === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
