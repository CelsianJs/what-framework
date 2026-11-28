/**
 * Auto-insert copy buttons on all <pre> code blocks in docs pages. A copy the
 * browser refuses (no clipboard permission, an insecure context, an iframe, no
 * clipboard API at all) shows "Copy failed" on the button.
 */
(function () {
  // A block whose first command creates a What app or installs a package.
  var INSTALL = /^\s*(\$\s*)?((npm|pnpm|yarn|bun)\s+(create|init|i|install|add)\b|(npx|bunx|pnpm\s+dlx)\s+create-)/;

  function init() {
    document.querySelectorAll('pre').forEach(function (pre) {
      var btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      var timer = null;
      function show(label, state) {
        btn.textContent = label;
        btn.classList.remove('copied', 'failed');
        btn.classList.add(state);
        clearTimeout(timer);
        timer = setTimeout(function () {
          btn.textContent = 'Copy';
          btn.classList.remove(state);
        }, 2000);
      }
      btn.addEventListener('click', function () {
        var code = pre.querySelector('code');
        var text = (code || pre).textContent;
        var write;
        try {
          write = navigator.clipboard.writeText(text);
        } catch (err) {
          write = Promise.reject(err);
        }
        write.then(function () {
          // Only the kind of block leaves the page, never its text.
          if (window.lf) window.lf('track', INSTALL.test(text) ? 'install.copy' : 'code.copy', { source: 'docs' });
          show('Copied!', 'copied');
        }, function () {
          show('Copy failed', 'failed');
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
