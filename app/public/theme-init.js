(function () {
  try {
    var t = localStorage.getItem("shadow-theme");
    if (t === "light") document.documentElement.classList.add("light");
  } catch (_) {
    // localStorage may be unavailable in certain browser contexts
  }
})();
