export const template = `
<section id="notifications">
          <h2>Notifications</h2>
          <p>
            Let local applications send updates to your phone. All callers use the saved destination
            below.
          </p>
          <form id="notificationForm">
            <label><input type="checkbox" id="notifyEnabled" /> Enable notifications</label>
            <label
              >Destination type<select id="notifyMode">
                <option value="guild">Guild Channel</option>
                <option value="dm">Direct Message</option>
                <option value="agents">Agent Channels (one per source)</option>
              </select></label
            >
            <div id="notifyGuildFields" class="columns">
              <label>Notification Guild ID<input id="notifyGuild" inputmode="numeric" /></label>
              <label id="notifyChannelField"
                >Notification Channel ID<input id="notifyChannel" inputmode="numeric"
              /></label>
            </div>
            <div id="notifyAgentFields" hidden>
              <label>Agent category ID<input id="notifyCategory" inputmode="numeric" /></label>
              <button type="button" id="notifyCreateCategory" class="quiet">
                Create Agent Notifications category
              </button>
              <p>
                Enter a Guild ID above, then create a private category or enter an existing category
                ID. Save settings. Each new source creates its own channel automatically; existing
                agents reuse theirs. Limit: 25 agents per category. Use stable source names.
              </p>
              <p>
                Phone alerts: in Discord, open this server's Notifications → Notification Overrides,
                select Agent Notifications, and choose All Messages. Enable Mobile Push Notifications
                and leave individual agent channels on the category default (remove any Mentions-only
                override). This is your Discord account preference; the bot cannot set it for you.
              </p>
              <pre id="notifyAgents"></pre>
            </div>
            <div id="notifyDmFields" hidden>
              <label>Notification User ID<input id="notifyUser" inputmode="numeric" /></label>
              <p>
                Initially filled with your configured owner account. Change it here to choose
                another recipient.
              </p>
            </div>
            <div class="columns">
              <label
                >Maximum notifications per minute<input
                  id="notifyRate"
                  type="number"
                  min="1"
                  max="60"
                  required
              /></label>
              <label
                >Queue capacity (including active delivery)<input
                  id="notifyQueue"
                  type="number"
                  min="1"
                  max="100"
                  required
              /></label>
              <label
                >Duplicate suppression (seconds; 0 disables)<input
                  id="notifyDedup"
                  type="number"
                  min="0"
                  max="3600"
                  required
              /></label>
            </div>
            <button type="submit">Save notification settings</button>
          </form>
          <p id="notifyDestination" role="status"></p>
          <p>
            Validation and tests use saved settings. Save changes first. Test delivery requires
            notifications to be enabled.
          </p>
          <button type="button" id="notifyValidate" class="quiet">Validate destination</button>
          <label>Test source<input id="notifyTestSource" value="Community Bot" maxlength="80" /></label>
          <button type="button" id="notifyTest">Send Test Notification</button>
          <h3>Local API credential</h3>
          <p id="notifyCredentialState"></p>
          <button type="button" id="notifyRotate" class="quiet">
            Generate / rotate notification credential
          </button>
          <div id="notifySecretBox" hidden>
            <p>
              Copy this credential into your local caller's secret storage now. It is shown only
              once and cleared after 60 seconds. Do not include it in screenshots.
            </p>
            <input
              id="notifySecret"
              type="password"
              readonly
              autocomplete="off"
              aria-label="New notification credential"
            />
            <button type="button" id="notifyCopy">Copy notification credential</button>
            <button type="button" id="notifyClear" class="quiet">Clear credential display</button>
          </div>
          <h3>Recent notification results</h3>
          <p>
            Delivery, suppression, rejection and failure results. Message content and credentials
            are not recorded here.
          </p>
          <button type="button" id="notifyRefresh" class="quiet">
            Refresh notification status
          </button>
          <pre id="notifyHistory"></pre>
        </section>
`;
export const summary = (data) => data.notifications ? `${data.notifications.settings.enabled ? 'Enabled' : 'Disabled'} · ${data.notifications.destination.label} · ${data.notifications.history.at(-1)?.status || 'No recent deliveries'}` : 'Notification service unavailable';
