export const template = `
<section id="overview">
          <div class="section-title">
            <h2>Connection & servers</h2>
            <span id="connection" class="pill"></span>
          </div>
          <p id="statusText"></p>
          <div class="actions">
            <button data-action="connect">Connect</button
            ><button data-action="disconnect" class="quiet">Disconnect</button
            >
          </div>
          <div id="guilds" class="cards"></div>
          
        </section><section><h2>Global configuration</h2><p>Discord credentials, application and server IDs, owner IDs, admin password, local port and startup behavior are managed in config.local.json on this PC. Restart the application after changing configuration. The admin server remains bound to 127.0.0.1.</p><p>Module settings are managed on their own pages.</p></section>
`;
export const summary = (data) => `${data.status.state} · ${data.status.username || 'Not connected'} · Application uptime: ${Math.floor(data.uptimeSeconds / 60)} minutes`;
