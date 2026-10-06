const $ = (id) => document.getElementById(id);
let csrf = '',
  current;
let enrollmentTimer;
function clearEnrollment() {
  clearTimeout(enrollmentTimer);
  $('enrollment').hidden = true;
  $('enrollmentQr').removeAttribute('src');
  $('enrollmentUri').textContent = '';
  $('enrollCode').value = '';
  $('enrollPassword').value = '';
}
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
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function renderStatus(data) {
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
function field(labelText, value, type = 'text') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.value = value;
  label.append(input);
  return { label, input };
}
function responseRow(c) {
  const box = document.createElement('div');
  box.className = 'response';
  const row = document.createElement('div');
  row.className = 'row';
  const name = field('Command name', c.name),
    description = field('Description', c.description),
    text = field('Response', c.text, 'textarea');
  name.input.required = true;
  name.input.maxLength = 32;
  description.input.required = true;
  description.input.maxLength = 100;
  text.input.required = true;
  text.input.maxLength = 1800;
  const accessLabel = document.createElement('label');
  accessLabel.textContent = 'Who can use it';
  const access = document.createElement('select');
  for (const value of ['everyone', 'moderator', 'owner']) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = value;
    access.append(o);
  }
  access.value = c.access;
  accessLabel.append(access);
  row.append(name.label, description.label, accessLabel);
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = c.enabled;
  const toggle = document.createElement('label');
  toggle.append(enabled, 'Enabled');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'quiet';
  remove.textContent = 'Remove command';
  remove.onclick = () => {
    box.remove();
    notice('Response removed from the form. Save settings to apply.');
  };
  box.append(row, text.label, toggle, remove);
  box.read = () => ({
    name: name.input.value.trim(),
    description: description.input.value.trim(),
    text: text.input.value,
    enabled: enabled.checked,
    access: access.value,
  });
  $('responses').append(box);
}
async function load(full = false) {
  const data = await api('state');
  renderStatus(data);
  if (!full) return;
  fillNotifications(data.notifications?.settings);
  current = data.settings;
  $('builtins').replaceChildren(
    ...data.builtinNames.map((name) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = name;
      input.checked = !current.disabled.includes(name);
      label.append(input, `/${name}`);
      return label;
    }),
  );
  $('responses').replaceChildren();
  current.responses.forEach(responseRow);
  for (const key of ['moderatorUserIds', 'moderatorRoleIds'])
    $(key).value = current[key].join('\n');
  $('timeout').value = current.customTimeoutSeconds;
}
$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const result = await api('login', { password: $('password').value });
    csrf = result.csrf;
    $('password').value = '';
    await load(true);
    $('login').hidden = true;
    $('dashboard').hidden = false;
    notice('Panel unlocked.');
  } catch (e) {
    notice(e.message, 'error');
  }
};
$('settingsForm').onsubmit = async (e) => {
  e.preventDefault();
  const ids = (key) =>
    $(key)
      .value.split(/[\s,]+/)
      .filter(Boolean);
  try {
    await api('settings', {
      disabled: [...$('builtins').querySelectorAll('input')]
        .filter((i) => !i.checked)
        .map((i) => i.value),
      responses: [...$('responses').children].map((row) => row.read()),
      moderatorUserIds: ids('moderatorUserIds'),
      moderatorRoleIds: ids('moderatorRoleIds'),
      customTimeoutSeconds: Number($('timeout').value),
    });
    notice(
      'Saved. Command checks changed immediately. Sync commands to update Discord’s command list.',
    );
    await load();
  } catch (e) {
    notice(e.message, 'error');
  }
};
$('addResponse').onclick = () => {
  responseRow({ name: '', description: '', text: '', enabled: true, access: 'everyone' });
  notice('Response added to the form. Fill it in, then save settings.');
};
for (const button of document.querySelectorAll('[data-action]'))
  button.onclick = async () => {
    button.disabled = true;
    try {
      await api(button.dataset.action, {});
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
$('startEnrollment').onclick = async () => {
  const password = $('enrollPassword').value;
  clearEnrollment();
  try {
    const enrollment = await api('totp/start', { password });
    $('enrollmentQr').src = enrollment.qr;
    $('enrollmentUri').textContent = enrollment.uri;
    $('enrollment').hidden = false;
    enrollmentTimer = setTimeout(clearEnrollment, Math.max(0, enrollment.expiresAt - Date.now()));
    notice('Scan the local QR code, then confirm enrollment. Do not share the QR code or URI.');
  } catch (e) {
    notice(e.message, 'error');
  }
};
$('confirmEnrollment').onclick = async () => {
  const code = $('enrollCode').value;
  $('enrollCode').value = '';
  try {
    await api('totp/confirm', { code });
    clearEnrollment();
    await load();
    notice(
      'Authenticator enrolled. Wait for a fresh code, then use /owner-auth in a DM with the bot.',
    );
  } catch (e) {
    notice(e.message, 'error');
  }
};
$('revokeElevation').onclick = async () => {
  try {
    await api('totp/revoke', {});
    await load();
    notice('Developer session revoked.');
  } catch (e) {
    notice(e.message, 'error');
  }
};

let notificationSecretTimer;
function clearNotificationCredential() {
  clearTimeout(notificationSecretTimer);
  $('notifySecret').value = '';
  $('notifySecretBox').hidden = true;
}
function notificationMode() {
  $('notifyGuildFields').hidden = $('notifyMode').value === 'dm';
  $('notifyChannelField').hidden = $('notifyMode').value !== 'guild';
  $('notifyAgentFields').hidden = $('notifyMode').value !== 'agents';
  $('notifyDmFields').hidden = $('notifyMode').value !== 'dm';
}
function fillNotifications(s) {
  if (!s) return;
  $('notifyEnabled').checked = s.enabled;
  for (const [id, key] of [
    ['notifyMode', 'mode'],
    ['notifyGuild', 'guildId'],
    ['notifyChannel', 'channelId'],
    ['notifyCategory', 'categoryId'],
    ['notifyUser', 'userId'],
    ['notifyRate', 'perMinute'],
    ['notifyQueue', 'queueLimit'],
    ['notifyDedup', 'dedupSeconds'],
  ])
    $(id).value = s[key] ?? '';
  notificationMode();
}
function renderNotifications(n) {
  if (!n) return;
  $('notifyAgents').textContent =
    (n.agents || []).map((a) => `${a.source} → #${a.channelName} (${a.channelId})`).join('\n') ||
    'Channels appear automatically when each agent first sends a notification.';
  $('notifyCredentialState').textContent = n.credential.configured
    ? `Credential configured; last rotated ${n.credential.rotatedAt}. Existing credential cannot be displayed.`
    : 'No credential generated yet.';
  $('notifyDestination').textContent =
    `${n.destination.status}: ${n.destination.label}. ${n.destination.note || ''} Pending: ${n.pending}`;
  $('notifyHistory').textContent =
    n.history.map((h) => `${h.time} ${h.status} ${h.code || ''} ${h.id}`).join('\n') ||
    'No notifications yet.';
}
$('notifyMode').onchange = notificationMode;
$('notificationForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('notifications/settings', {
      enabled: $('notifyEnabled').checked,
      mode: $('notifyMode').value,
      guildId: $('notifyGuild').value.trim(),
      channelId: $('notifyChannel').value.trim(),
      categoryId: $('notifyCategory').value.trim(),
      userId: $('notifyUser').value.trim(),
      perMinute: Number($('notifyRate').value),
      queueLimit: Number($('notifyQueue').value),
      dedupSeconds: Number($('notifyDedup').value),
    });
    await load();
    notice('Notification settings saved. Validate or send a test to check delivery.');
  } catch (e) {
    notice(e.message, 'error');
  }
};
for (const [id, route] of [
  ['notifyValidate', 'validate'],
  ['notifyTest', 'test'],
])
  $(id).onclick = async () => {
    $(id).disabled = true;
    try {
      const r = await api('notifications/' + route, route === 'test' ? { source: $('notifyTestSource').value.trim() } : {});
      notice(route === 'test' ? `Test notification: ${r.status}.` : `Destination: ${r.label}`);
    } catch (e) {
      notice(e.message, 'error');
    } finally {
      $(id).disabled = false;
      await load().catch(() => {});
    }
  };
$('notifyRotate').onclick = async () => {
  if (
    !confirm(
      'Generate a new notification credential? Any previous credential will stop working immediately.',
    )
  )
    return;
  clearNotificationCredential();
  try {
    const result = await api('notifications/credential', {});
    $('notifySecret').value = result.token;
    $('notifySecretBox').hidden = false;
    notificationSecretTimer = setTimeout(clearNotificationCredential, 60000);
    await load();
    notice('Credential generated. Copy it now; it cannot be retrieved later.');
  } catch (e) {
    notice(e.message, 'error');
  }
};
$('notifyClear').onclick = () => {
  clearNotificationCredential();
  notice('Credential display cleared.');
};
$('notifyCopy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('notifySecret').value);
    notice('Credential copied. Store it securely in the caller.');
  } catch {
    notice('Select and copy the credential field manually.');
  }
};
$('notifyRefresh').onclick = () =>
  load()
    .then(() => notice('Notification status refreshed.'))
    .catch((e) => notice(e.message, 'error'));
window.addEventListener('pagehide', clearNotificationCredential);
$('notifyCreateCategory').onclick = async () => {
  $('notifyCreateCategory').disabled = true;
  try {
    const result = await api('notifications/category', { guildId: $('notifyGuild').value.trim() });
    $('notifyCategory').value = result.categoryId;
    notice('Agent Notifications category created. Save notification settings to use it.');
  } catch (e) {
    notice(e.message, 'error');
  } finally {
    $('notifyCreateCategory').disabled = false;
  }
};
