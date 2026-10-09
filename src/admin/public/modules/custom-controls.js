export function initCustomCommand({ $, api, load, notice }) {
  let enrollmentTimer;
  function clearEnrollment() {
    clearTimeout(enrollmentTimer);
    $('enrollment').hidden = true;
    $('enrollmentQr').removeAttribute('src');
    $('enrollmentUri').textContent = '';
    $('enrollCode').value = '';
    $('enrollPassword').value = '';
  }
  
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
  
  
  return { clearEnrollment };
}
