import { initWorkout } from './modules/workout-controls.js';
import { initCommands } from './modules/command-controls.js';
import { initCustomCommand } from './modules/custom-controls.js';
import { initNotifications } from './modules/notification-controls.js';
import { mountShell, showPage, renderDashboard } from './shell.js';
await mountShell();
const $ = (id) => document.getElementById(id);
let csrf = '',
  current;
let toastTimer;
const toast = (text, kind = 'success') => {
  clearTimeout(toastTimer);
  $('actionToast').textContent =
    `${kind === 'error' ? '⚠' : kind === 'progress' ? '◌' : '✓'} ${text}`;
  $('actionToast').dataset.kind = kind;
  $('actionToast').hidden = false;
  if (kind !== 'progress')
    toastTimer = setTimeout(
      () => {
        $('actionToast').hidden = true;
      },
      kind === 'error' ? 9000 : 6000,
    );
};
const notice = (text, kind = 'success') => {
  $('notice').textContent = text;
  toast(text, kind);
};
document.addEventListener(
  'click',
  (e) => {
    const button = e.target.closest('button');
    if (!button || button.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    button.animate(
      [
        { transform: 'scale(0.97)', boxShadow: '0 0 0 3px #81e2ba88' },
        { transform: 'scale(1)', boxShadow: '0 0 0 0px #81e2ba00' },
      ],
      { duration: 350 },
    );
  },
  true,
);
async function api(route, body) {
  if (body !== undefined) toast('Working…', 'progress');
  const response = await fetch(`/api/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (response.status === 401 && route !== 'login') lockPanel();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function renderStatus(data) {
  renderDashboard(data);
  renderNotifications(data.notifications);
  const s = data.status;
  $('connection').textContent = s.state.toUpperCase();
  $('statusText').textContent = [s.username || 'Not connected', ...s.issues, s.lastError]
    .filter(Boolean)
    .join(' · ');
  $('guilds').replaceChildren(
    ...s.guilds.map((g) => {
      const p = document.createElement('p');
      p.textContent = `${g.name} · ${g.members} members · ${g.id}${g.configured ? '' : ' (not configured)'}`;
      return p;
    }),
  );
  $('registered').replaceChildren();
  if (!s.registered.length)
    $('registered').textContent = 'Refresh after connecting to read Discord’s registered commands.';
  for (const group of s.registered) {
    const scope = group.guildId ? `Server ${group.guildId}` : 'Global (all servers / DMs)';
    const heading = document.createElement('h3');
    heading.textContent = scope;
    $('registered').append(heading);
    for (const command of group.commands) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('span');
      label.textContent = `${command.type === 1 ? '/' : ''}${command.name ?? command}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quiet';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${command.name ?? command} from ${scope}`);
      remove.disabled = !command.id;
      remove.onclick = async () => {
        if (
          !confirm(
            `Remove ${command.name} from ${scope}? Sync restores it if it is still enabled in this bot.`,
          )
        )
          return;
        remove.disabled = true;
        try {
          await api('registered/remove', { commandId: command.id, guildId: group.guildId ?? null });
          await load();
          notice(`Removed ${command.name} from ${scope}. Discord may take a moment to update.`);
        } catch (e) {
          notice(e.message, 'error');
          remove.disabled = false;
        }
      };
      row.append(label, remove);
      $('registered').append(row);
    }
  }
  $('customStatus').textContent = s.customBusy ? ' Operation running / draining' : ' Ready';
  const security = data.security;
  $('securityStatus').textContent = security?.ownerId
    ? `Developer owner: ${security.ownerId} · ${security.enrolled ? 'Authenticator enrolled' : 'Not enrolled'} · ${security.elevatedUntil ? 'Elevated until ' + new Date(security.elevatedUntil).toLocaleTimeString() : 'Locked'}`
    : 'Set customOwnerId in config.local.json (also listed in ownerIds), then restart before enrolling.';
  $('logText').textContent = data.logs
    .slice()
    .reverse()
    .map((l) => `${l.time} [${l.level}] ${l.message} ${l.details}`)
    .join('\n');
}
async function load(full = false) {
  const data = await api('state');
  renderStatus(data);
  if (!full) return;
  fillNotifications(data.notifications?.settings);
  current = data.settings;
  fillCommands(data);
  $('timeout').value = current.customTimeoutSeconds;
}
initWorkout({ $, api, notice, load });
const { fillCommands } = initCommands({ $, notice, saveModuleSettings });
const { clearEnrollment } = initCustomCommand({ $, api, load, notice });
const { clearNotificationCredential, fillNotifications, renderNotifications } = initNotifications({
  $,
  api,
  load,
  notice,
});
$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const result = await api('login', { password: $('password').value });
    csrf = result.csrf;
    $('password').value = '';
    await load(true);
    const next = new URLSearchParams(location.search).get('next');
    if (next && /^\/[a-z/-]+$/.test(next)) history.replaceState({}, '', next);
    showPage();
    $('login').hidden = true;
    $('dashboard').hidden = false;
    notice('Panel unlocked.');
  } catch (e) {
    notice(e.message, 'error');
  }
};
function saveModuleSettings(formId, readPatch) {
  $(formId).onsubmit = async (e) => {
    e.preventDefault();
    try {
      current = await api('settings', { ...current, ...readPatch() });
      await load();
      notice(
        'Saved. Command checks changed immediately. Sync commands to update Discord’s command list.',
      );
    } catch (e) {
      notice(e.message, 'error');
    }
  };
}
saveModuleSettings('customForm', () => ({ customTimeoutSeconds: Number($('timeout').value) }));
for (const button of document.querySelectorAll('[data-action]'))
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (button.dataset.action !== 'refresh-state') await api(button.dataset.action, {});
      await load();
      notice(`${button.textContent}: complete.`);
    } catch (e) {
      notice(e.message, 'error');
    } finally {
      button.disabled = false;
    }
  };
$('refresh').onclick = () =>
  load()
    .then(() => notice('Status and logs refreshed.'))
    .catch((e) => notice(e.message, 'error'));
$('logout').onclick = async () => {
  try {
    await api('logout', {});
  } finally {
    clearEnrollment();
    clearNotificationCredential();
    csrf = '';
    $('dashboard').hidden = true;
    $('login').hidden = false;
    notice('Signed out.');
  }
};

function lockPanel() {
  clearEnrollment();
  clearNotificationCredential();
  csrf = '';
  $('dashboard').hidden = true;
  $('login').hidden = false;
}
document.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (
    !link ||
    link.origin !== location.origin ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  clearEnrollment();
  clearNotificationCredential();
  history.pushState({}, '', link.pathname);
  showPage(true);
});
window.addEventListener('popstate', () => {
  clearEnrollment();
  clearNotificationCredential();
  showPage(true);
});

try {
  const session = await api('session');
  csrf = session.csrf;
  await load(true);
  showPage();
  $('login').hidden = true;
  $('dashboard').hidden = false;
} catch {
  lockPanel();
}
