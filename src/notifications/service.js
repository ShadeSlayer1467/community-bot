import { createHash, randomUUID } from 'node:crypto';
import { validateNotification, NotificationError, fail } from './model.js';
import { redactNotificationTokens } from './credential.js';

export class NotificationService {
  constructor({ settings, credential, delivery, logger, now = Date.now }) {
    Object.assign(this, { settings, credential, delivery, logger, now });
    this.queue = [];
    this.active = false;
    this.closed = false;
    this.times = [];
    this.seen = new Map();
    this.history = [];
    this.revision = 0;
    this.destination = { status: 'unchecked', label: 'Not validated yet' };
  }
  status() {
    return {
      settings: this.settings.read(),
      credential: this.credential.state(),
      destination: this.destination,
      pending: this.queue.length + Number(this.active),
      history: this.history,
      agents: this.delivery.agents?.list(this.settings.read()) ?? [],
    };
  }
  record(status, id, code) {
    const entry = {
      time: new Date(this.now()).toISOString(),
      id,
      status,
      ...(code ? { code } : {}),
    };
    this.history.unshift(entry);
    this.history.length = Math.min(this.history.length, 100);
    this.logger.log(status === 'delivered' ? 'info' : 'warn', 'Notification ' + status, entry);
  }
  save(settings) {
    const result = this.settings.save(settings);
    this.revision++;
    this.destination = {
      status: 'unchecked',
      label: 'Settings changed; validate the saved destination.',
    };
    // Never reroute already queued work after a destination change.
    this.cancelQueued(
      'settings_changed',
      'Notification settings changed before delivery; submit again.',
    );
    this.logger.log('info', 'Notification settings saved');
    return result;
  }
  async validateDestination() {
    const revision = this.revision;
    try {
      const resolved = await this.delivery.resolve(this.settings.read());
      if (revision !== this.revision)
        fail('settings_changed', 'Destination changed during validation. Validate again.', 503);
      this.destination = {
        status: 'valid',
        label: this.clean(resolved.label),
        checkedAt: new Date(this.now()).toISOString(),
        note:
          resolved.mode === 'dm'
            ? 'User resolved. Send Test checks DM delivery.'
            : 'Channel and permissions checked.',
      };
      return this.destination;
    } catch (e) {
      const error = this.safeError(e);
      if (revision === this.revision)
        this.destination = {
          status: 'invalid',
          label: error.message,
          checkedAt: new Date(this.now()).toISOString(),
        };
      this.record('validation_failed', randomUUID(), error.code);
      throw error;
    }
  }
  clean(text) {
    return this.logger.redact(redactNotificationTokens(text));
  }
  safeError(e) {
    return e instanceof NotificationError
      ? e
      : new NotificationError(
          'delivery_failed',
          'Notification delivery failed. Check Discord connectivity and destination.',
          502,
        );
  }
  async submit(payload) {
    const id = randomUUID();
    try {
      const s = this.settings.read();
      if (this.closed) fail('stopping', 'Notification service is stopping.', 503);
      if (!s.enabled) fail('disabled', 'Notifications are disabled in the local panel.', 503);
      const p = validateNotification(payload, this.now());
      for (const k of ['source', 'title', 'message']) p[k] = this.clean(p[k]);
      p.context = Object.fromEntries(
        Object.entries(p.context).map(([k, v]) => [this.clean(k), this.clean(String(v))]),
      );
      const key = createHash('sha256')
        .update(
          JSON.stringify([
            s.mode,
            s.guildId,
            s.channelId,
            s.categoryId,
            s.userId,
            p.source,
            p.title,
            p.message,
            p.severity,
            Object.entries(p.context).sort(),
          ]),
        )
        .digest('hex');
      for (const [k, v] of this.seen) if (v.until <= this.now()) this.seen.delete(k);
      if (s.dedupSeconds && this.seen.has(key)) {
        const original = this.seen.get(key);
        this.record('duplicate', id);
        return {
          id,
          status: 'duplicate',
          originalId: original.id,
          originalStatus: original.status,
        };
      }
      this.times = this.times.filter((t) => t > this.now() - 60000);
      if (this.times.length >= s.perMinute)
        fail(
          'rate_limited',
          'Notification limit reached. Retry after the indicated delay.',
          429,
          Math.max(1, Math.ceil((this.times[0] + 60000 - this.now()) / 1000)),
        );
      if (this.queue.length + Number(this.active) >= s.queueLimit)
        fail('queue_full', 'Notification queue is full. Retry later.', 429, 5);
      this.times.push(this.now());
      // Bound dedup memory, including when limits are changed while running.
      if (this.seen.size >= 3600) this.seen.delete(this.seen.keys().next().value);
      if (s.dedupSeconds) this.seen.set(key, { id, status: 'pending', until: Infinity });
      const promise = new Promise((resolve, reject) =>
        this.queue.push({
          id,
          key,
          p,
          s,
          resolve,
          reject,
          queuedAt: this.now(),
          revision: this.revision,
        }),
      );
      this.record('queued', id);
      void this.drain();
      return await promise;
    } catch (e) {
      const error = this.safeError(e);
      this.record('failed', id, error.code);
      throw error;
    }
  }
  async drain() {
    if (this.active) return;
    this.active = true;
    try {
      while (this.queue.length && !this.closed) {
        const job = this.queue.shift();
        let deadline;
        const controller = new AbortController();
        this.controller = controller;
        try {
          if (this.now() - job.queuedAt > 60000)
            fail('queue_expired', 'Notification waited over 60 seconds; submit again.', 503);
          const timeout = new Promise((_, reject) => {
            deadline = setTimeout(() => {
              controller.abort();
              reject(
                new NotificationError(
                  'delivery_timeout',
                  'Discord delivery exceeded 30 seconds. Delivery may be uncertain; check history before retrying.',
                  504,
                ),
              );
            }, 30000);
          });
          const label = await Promise.race([
            this.delivery.send(job.s, job.p, controller.signal),
            timeout,
          ]);
          if (job.revision === this.revision)
            this.destination = {
              status: 'delivered',
              label: this.clean(label),
              checkedAt: new Date(this.now()).toISOString(),
            };
          if (job.s.dedupSeconds)
            this.seen.set(job.key, {
              id: job.id,
              status: 'delivered',
              until: this.now() + job.s.dedupSeconds * 1000,
            });
          this.record('delivered', job.id);
          job.resolve({ id: job.id, status: 'delivered' });
        } catch (e) {
          this.seen.delete(job.key);
          const error = this.safeError(e);
          if (job.revision === this.revision)
            this.destination = {
              status: 'failed',
              label: error.message,
              checkedAt: new Date(this.now()).toISOString(),
            };
          job.reject(error);
        } finally {
          clearTimeout(deadline);
          this.controller = null;
        }
      }
    } finally {
      this.active = false;
    }
  }
  cancelQueued(code, message) {
    for (const job of this.queue.splice(0)) {
      this.seen.delete(job.key);
      job.reject(new NotificationError(code, message, 503));
    }
  }
  close() {
    this.closed = true;
    this.controller?.abort();
    this.cancelQueued('stopping', 'Bot stopped before delivery; submit again after restart.');
  }
  test(source = 'Community Bot') {
    return this.submit({
      source,
      severity: 'info',
      title: 'Test notification',
      message: 'Your configured notification destination is working.',
    });
  }
}
