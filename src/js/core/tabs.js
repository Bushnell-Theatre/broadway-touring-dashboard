(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function show(tabName) {
    document.querySelectorAll('.nav-tab').forEach(function (el) { el.classList.toggle('active', el.dataset.tab === tabName || el.textContent.trim().toLowerCase() === String(tabName).toLowerCase()); });
    document.querySelectorAll('.panel').forEach(function (el) { el.classList.toggle('active', el.id === 'tab-' + tabName || el.dataset.tab === tabName); });
    if (root.BTD.state && root.BTD.state.active) root.BTD.state.active.tab = tabName;
  }
  function init(options) {
    options = options || {};
    document.querySelectorAll('[data-tab]').forEach(function (el) {
      el.addEventListener('click', function () {
        show(el.dataset.tab);
        if (typeof options.onChange === 'function') options.onChange(el.dataset.tab);
      });
    });
    if (options.defaultTab) show(options.defaultTab);
  }
  root.BTD.tabs = { init: init, show: show };
})(window);
