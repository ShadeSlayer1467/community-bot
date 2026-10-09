export const template = `
<form id="commandsForm"><section id="commands">
            <div class="section-title">
              <div>
                <h2>Command library</h2>
                <p class="muted">Toggle built-in code commands. Add simple responses below.</p>
              </div>
            </div>
            <div id="builtins" class="toggles"></div>
            <h3>Response commands</h3>
            <p class="muted">
              Use {user} and {server} in a response. Responses are plain text, never executable
              code.
            </p>
            <div id="responses"></div>
            <button id="addResponse" type="button" class="quiet">+ Add response command</button>
          </section><section id="access">
            <h2>Access & permissions</h2>
            <p>
              Moderators need both an allowlist entry below and the relevant Discord permissions.
              Owner IDs are managed only in config.local.json and require a restart.
            </p>
            <div class="columns">
              <label
                >Allowed moderator user IDs<textarea
                  id="moderatorUserIds"
                  rows="3"
                  placeholder="One Discord ID per line"
                ></textarea></label
              ><label
                >Allowed moderator role IDs<textarea
                  id="moderatorRoleIds"
                  rows="3"
                  placeholder="One Discord ID per line"
                ></textarea>
              </label>
            </div>
          </section><div class="savebar"><button type="submit">Save settings</button><button type="button" data-action="sync" class="quiet">Sync commands to Discord</button></div></form><section><button type="button" data-action="registered" class="quiet">Refresh registered commands</button><details>
            <summary>Registered commands on Discord</summary>
            <p>
              Remove old Discord registrations here. Sync restores enabled commands; disable those
              in Commands first if you want them to stay removed.
            </p>
            <div id="registered"></div>
          </details></section>
`;
export const summary = (data) => `${data.status.commands?.length ?? 0} enabled commands · ${data.settings.responses.length} configured responses`;
