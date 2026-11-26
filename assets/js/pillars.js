(() => {
  const accordion = document.querySelector('[data-pillar-accordion]');
  if (!accordion) return;

  const panels = [...accordion.querySelectorAll('.pillar-panel')];
  const summaries = panels.map(panel => panel.querySelector('summary'));
  const hoverEnabled = window.matchMedia(
    '(hover: hover) and (pointer: fine)'
  );

  function activate(index) {
    panels.forEach((panel, panelIndex) => {
      panel.open = panelIndex === index;
    });
  }

  panels.forEach((panel, index) => {
    const summary = summaries[index];

    summary.addEventListener('click', event => {
      event.preventDefault();
      activate(index);
    });

    panel.addEventListener('pointerenter', event => {
      if (!hoverEnabled.matches || event.pointerType !== 'mouse') return;

      // Keep keyboard focus from being displaced by a hovering pointer.
      const anotherPanelHasFocus = panels.some(
        other => other !== panel && other.contains(document.activeElement)
      );

      if (!anotherPanelHasFocus) activate(index);
    });

    summary.addEventListener('keydown', event => {
      let nextIndex;

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = (index + 1) % panels.length;
          break;

        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = (index - 1 + panels.length) % panels.length;
          break;

        case 'Home':
          nextIndex = 0;
          break;

        case 'End':
          nextIndex = panels.length - 1;
          break;

        default:
          return;
      }

      event.preventDefault();
      activate(nextIndex);
      summaries[nextIndex].focus({ preventScroll: true });
    });
  });
})();