(() => {
  const header = document.getElementById('platform-main-nav');
  const menu = document.getElementById('platform-feature-menu');

  if (!header || !menu) return;

  const root = document.documentElement;
  root.classList.add('platform-menu-enabled');

  function updateMenuOffsets() {
    root.style.setProperty(
      '--platform-header-height',
      Math.ceil(header.getBoundingClientRect().height) + 'px'
    );

    root.style.setProperty(
      '--platform-menu-height',
      Math.ceil(menu.getBoundingClientRect().height) + 'px'
    );
  }

  updateMenuOffsets();

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(updateMenuOffsets);
    observer.observe(header);
    observer.observe(menu);
  }

  window.addEventListener('resize', updateMenuOffsets);
})();