// Loaded in <head> (blocking) so the theme is applied before first paint. Light by default;
// the header button switches to dark. The choice is the only thing kept in localStorage.
(function () {
  var theme = "light";
  try {
    if (localStorage.getItem("ft-theme") === "dark") theme = "dark";
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);
})();
