import test from 'node:test';
import assert from 'node:assert/strict';
import { adminModules } from '../src/admin/public/registry.js';

test('admin registration has unique IDs/routes, owned templates and optional real summaries', async () => {
  assert.equal(new Set(adminModules.map(m => m.id)).size, adminModules.length);
  assert.equal(new Set(adminModules.map(m => m.route)).size, adminModules.length);
  assert.equal(adminModules[0].route, '/');
  for (const module of adminModules) {
    assert.ok(module.name && module.description);
    const page = await import(`../src/admin/public/modules/${module.id}.js`);
    assert.equal(typeof page.template, 'string');
    if (['kingshot'].includes(module.id)) {
      assert.match(page.template, /not implemented yet/);
      assert.equal(page.summary, undefined);
    }
  }
  const notifications = await import('../src/admin/public/modules/notifications.js');
  assert.match(notifications.summary({ notifications: null }), /unavailable/);
  assert.match(notifications.summary({ notifications: {
    settings: { enabled: true }, destination: { label: 'Test destination' }, history: [{ status: 'delivered' }],
  } }), /Enabled · Test destination · delivered/);
});
