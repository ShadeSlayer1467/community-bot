export const template = `
<form id="customForm"><section id="custom">
            <h2>CustomCommand workspace</h2>
            <p>
              Edit <code>custom/CustomCommand.local.mjs</code> on this PC, save, then run
              <code>/owner-auth</code> in a direct message with the bot, then
              <code>/customcommand</code>
              from that DM. A new worker loads the latest code each time. Guilds, threads and group
              contexts are always rejected.
            </p>
            <p class="muted">
              Trusted local developer code. Timeout stops its worker; Discord actions already
              submitted cannot be undone. See docs/CUSTOM_COMMAND.md for the API and examples.
            </p>
            <label
              >Execution timeout (seconds)<input
                id="timeout"
                type="number"
                min="1"
                max="120"
                required /></label
            ><button type="button" data-action="cancel" class="quiet">
              Cancel current operation</button
            ><span id="customStatus"></span>
          </section><div class="savebar"><button type="submit">Save execution settings</button></div></form><section id="authenticator">
          <h2>Developer authenticator</h2>
          <p id="securityStatus"></p>
          <p>
            Developer commands require your exact configured customOwnerId, a direct message with
            this bot, and a five-minute TOTP session. Enroll Google Authenticator here on the host
            PC.
          </p>
          <label
            >Re-enter admin password for enrollment<input
              id="enrollPassword"
              type="password"
              autocomplete="off"
          /></label>
          <button type="button" id="startEnrollment">Enroll / replace authenticator</button>
          <button type="button" id="revokeElevation" class="quiet">Revoke developer session</button>
          <div id="enrollment" hidden>
            <p>
              Scan this QR code in Google Authenticator, then enter its six-digit code below.
              Replacing an existing authenticator takes effect only after confirmation. This setup
              expires in five minutes.
            </p>
            <img
              id="enrollmentQr"
              width="256"
              height="256"
              alt="Local authenticator enrollment QR code"
            />
            <details>
              <summary>Standard provisioning URI (sensitive)</summary>
              <pre id="enrollmentUri"></pre>
            </details>
            <label
              >Authenticator setup code<input
                id="enrollCode"
                inputmode="numeric"
                maxlength="6"
                autocomplete="one-time-code"
            /></label>
            <button type="button" id="confirmEnrollment">Confirm enrollment</button>
          </div>
        </section>
`;
export const summary = (data) => `${data.security.ownerId ? 'Owner configured' : 'Owner not configured'} · ${data.security.enrolled ? 'Authenticator enrolled' : 'Authenticator not enrolled'} · ${data.status.customBusy ? 'Operation running' : 'Idle'}`;
