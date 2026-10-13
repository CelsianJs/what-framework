/**
 * Auto-insert copy buttons on all <pre> code blocks in docs pages
 */
(function () {
  // A block whose first command creates a What app or installs a package.
  var INSTALL = /^\s*(\$\s*)?((npm|pnpm|yarn|bun)\s+(create|init|i|install|add)\b|(npx|bunx|pnpm\s+dlx)\s+create-)/;

  function init() {
    document.querySelectorAll('pre').forEach(function (pre) {
      var btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', function () {
        var code = pre.querySelector('code');
        var text = (code || pre).textContent;
        navigator.clipboard.writeText(text).then(function () {
          // Only the kind of block leaves the page, never its text.
          if (window.lf) window.lf('track', INSTALL.test(text) ? 'install.copy' : 'code.copy', { source: 'docs' });
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(function () {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 2000);
        });
      });
      pre.appendChild(btn);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
