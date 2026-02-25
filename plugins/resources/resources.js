async function resolvePreferredLocale() {
  const params = new URLSearchParams(window.location.search);
  const explicit = (params.get('lang') || '').trim().toLowerCase();
  if (explicit) return explicit;

  if (window.electronAPI?.getAppConfig) {
    try {
      const cfg = await window.electronAPI.getAppConfig();
      const appLang = (cfg?.language || '').trim().toLowerCase();
      if (appLang) return appLang;
    } catch (_err) {
      // Fall through to navigator language.
    }
  }

  return (navigator.language || 'en').trim().toLowerCase();
}

function buildLocaleCandidates(locale) {
  const normalized = String(locale || '').trim().toLowerCase();
  if (!normalized) return [];
  const base = normalized.split('-')[0];
  return base && base !== normalized ? [normalized, base] : [normalized];
}

async function pageExists(pathname) {
  try {
    const head = await fetch(pathname, { method: 'HEAD' });
    if (head.ok) return true;
    if (head.status !== 405) return false;
  } catch (_err) {
    // Fall back to GET probe.
  }
  try {
    const get = await fetch(pathname, { method: 'GET' });
    return get.ok;
  } catch (_err) {
    return false;
  }
}

async function maybeRedirectLocalizedPage() {
  const pathname = window.location.pathname;
  const isBasePage = pathname.endsWith('/resources/index.html') || pathname.endsWith('/resources/');
  const isLocalizedPage = /\/resources\/index\.[a-z-]+\.html$/.test(pathname);
  if (!isBasePage || isLocalizedPage) return false;

  const locale = await resolvePreferredLocale();
  const candidates = buildLocaleCandidates(locale);
  for (const candidate of candidates) {
    if (candidate === 'en') continue;
    const localizedPath = `index.${candidate}.html`;
    if (await pageExists(localizedPath)) {
      const query = window.location.search || '';
      const hash = window.location.hash || '';
      window.location.replace(`${localizedPath}${query}${hash}`);
      return true;
    }
  }
  return false;
}

document.addEventListener("DOMContentLoaded", async () => {
  const redirected = await maybeRedirectLocalizedPage();
  if (redirected) return;

  const tabs = document.querySelectorAll("#tabs button");
  const sections = document.querySelectorAll(".tab");

  const show = id => {
    // Show the matching section
    sections.forEach(s => s.classList.add("hidden"));
    document.getElementById(`tab-${id}`).classList.remove("hidden");

    // Update active button styling
    tabs.forEach(btn =>
      btn.classList.toggle("active", btn.dataset.tab === id)
    );
  };

  // Click handling
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      show(btn.dataset.tab);
    });
  });

  // Default tab
  show("about");

  // External link triggers
  document.querySelectorAll("[data-href]").forEach(btn => {
    btn.addEventListener("click", () => {
      window.electronAPI.openExternalURL(btn.dataset.href);
    });
  });
});
