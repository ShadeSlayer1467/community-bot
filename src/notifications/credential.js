import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();
// Store only a verifier, not a recoverable bearer token. Full token is returned once.
export class NotificationCredential {
  constructor(store) {
    this.store = store;
  }
  state() {
    const r = this.store.read();
    return { configured: !!r.digest, rotatedAt: r.rotatedAt ?? null };
  }
  rotate() {
    const token = `cbnotify_${randomBytes(32).toString('hex')}`;
    this.store.save({ digest: digest(token).toString('hex'), rotatedAt: new Date().toISOString() });
    return token;
  }
  accepts(header) {
    const token = /^Bearer (cbnotify_[a-f0-9]{64})$/.exec(header ?? '')?.[1];
    const stored = this.store.read().digest;
    return (
      !!token &&
      typeof stored === 'string' &&
      /^[a-f0-9]{64}$/.test(stored) &&
      timingSafeEqual(digest(token), Buffer.from(stored, 'hex'))
    );
  }
}
export const redactNotificationTokens = (value) =>
  String(value).replace(/cbnotify_[a-f0-9]{64}/gi, '[redacted notification credential]');
