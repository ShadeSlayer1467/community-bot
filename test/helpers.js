import { generate } from 'otplib';
import { DeveloperAccess } from '../src/security/developer-access.js';
export const ownerId = '100000000000000001';
export const dm = (overrides = {}) => ({
  context: 1,
  channel: { type: 1 },
  channelId: '100000000000000003',
  guildId: null,
  inGuild: () => false,
  user: { id: ownerId },
  isChatInputCommand: () => true,
  commandName: 'customcommand',
  ...overrides,
});
export function memoryVault() {
  let data = null;
  return {
    read: () => structuredClone(data),
    save: (record) => {
      data = structuredClone(record);
    },
  };
}
export async function securityFixture(elevated = false, vault = memoryVault()) {
  const clock = { value: 1800000000000, mono: 0 };
  const config = { ownerIds: [ownerId], customOwnerId: ownerId };
  const options = { config, vault, now: () => clock.value, monotonic: () => clock.mono };
  const security = new DeveloperAccess(options);
  const enrollment = security.beginEnrollment('local-session');
  const secret = new URL(enrollment.uri).searchParams.get('secret');
  const token = () =>
    generate({
      secret,
      epoch: Math.floor(clock.value / 1000),
      algorithm: 'sha1',
      digits: 6,
      period: 30,
    });
  await security.confirmEnrollment('local-session', await token());
  clock.value += 30000;
  clock.mono += 30000;
  if (elevated) await security.authenticate(dm(), await token());
  return {
    security,
    clock,
    config,
    vault,
    options,
    secret,
    token,
    grant: () => security.authorizeExecution(dm()),
  };
}
