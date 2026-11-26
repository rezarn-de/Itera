(() => {
  const currentPage =
    window.location.pathname.split('/').pop() || 'index.html';

  const section = /^#[a-zA-Z0-9_-]+$/.test(window.location.hash)
    ? window.location.hash
    : '';

  const back = currentPage + section;

  document.querySelectorAll('.language-switcher a').forEach(link => {
    const flag = link.querySelector('img')?.getAttribute('src') || '';
    const originalHref = link.getAttribute('href') || '';

    let language;

    if (flag.endsWith('/gb.svg') || /english/i.test(originalHref)) {
      language = 'en';
    } else if (
      flag.endsWith('/es.svg') ||
      /spanish/i.test(originalHref)
    ) {
      language = 'es';
    }

    if (!language) return;

    const params = new URLSearchParams({
      lang: language,
      back
    });

    link.href = 'sprache-in-bearbeitung.html?' + params.toString();
  });
})();