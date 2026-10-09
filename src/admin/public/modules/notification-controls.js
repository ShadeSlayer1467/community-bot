export function initNotifications({ $, api, load, notice }) {
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
  
  return { clearNotificationCredential, fillNotifications, renderNotifications };
}
