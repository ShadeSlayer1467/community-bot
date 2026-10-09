import { adminModules } from './registry.js';
const $ = (id) => document.getElementById(id);
export async function mountShell() {
  for (const module of adminModules) {
    const { template, summary } = await import(`./modules/${module.id}.js`);
    module.summary = summary;
    const page = document.createElement('div');
    page.id = `page-${module.id}`;
    page.hidden = true;
    page.innerHTML = template;
    $('pages').append(page);
    const link = document.createElement('a');
    link.href = module.route;
    link.textContent = module.name;
    link.dataset.module = module.id;
    $('navigation').append(link);
  }
}
export function showPage(focus = false) {
  const module = adminModules.find(
    (m) => m.route === location.pathname || m.pages?.some((p) => p.route === location.pathname),
  );
  for (const m of adminModules) {
    $(`page-${m.id}`).hidden = m !== module;
    const link = document.querySelector(`[data-module="${m.id}"]`);
    if (m === module) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('pageTitle').textContent = module?.name || 'Page not found';
  $('pageDescription').textContent = module?.description || 'Choose a page from the navigation.';
  document.title = `${module?.name || 'Page not found'} · Community Bot`;
  if (focus) $('pageTitle').focus();
  document.dispatchEvent(
    new CustomEvent('admin:navigate', { detail: { module, path: location.pathname } }),
  );
}
export function renderDashboard(data) {
  $('summaries').replaceChildren();
  for (const module of adminModules) {
    const text = module.summary?.(data);
    if (!text) continue;
    const card = document.createElement('article');
    card.className = 'summary-card';
    const link = document.createElement('a');
    link.href = module.route;
    link.textContent = module.id === 'settings' ? 'Community Bot' : module.name;
    const status = document.createElement('p');
    status.textContent = text;
    card.append(link, status);
    $('summaries').append(card);
  }
  $('recentActivity').textContent =
    data.logs
      .slice(-5)
      .reverse()
      .map((l) => `${l.time} [${l.level}] ${l.message}`)
      .join('\n') || 'No recent activity.';
}
