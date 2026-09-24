import { generateSecret, generateURI, verify } from 'otplib';
import { ChannelType, InteractionContextType } from 'discord.js';
import { snowflake } from '../config.js';

export const ELEVATION_MS = 5 * 60 * 1000;
const LOCKOUT_MS = 5 * 60 * 1000;
const otpOptions = { algorithm: 'sha1', digits: 6, period: 30, epochTolerance: 30 };

export class DeveloperAccess {
  #credential;
  #pending = null;
  #session = null;
  #tickets = new WeakMap();
  #busy = false;
  #revision = 0;
  constructor({ config, vault, now = Date.now, monotonic = () => performance.now() }) {
    this.config = config;
    this.vault = vault;
    this.now = now;
    this.monotonic = monotonic;
    this.#credential = vault.read();
    this.onRevoke = () => {};
  }
  configuredOwner() {
    const id = this.config.customOwnerId;
    if (!snowflake(id) || !this.config.ownerIds.includes(id))
      throw new Error(
        'Configure customOwnerId as one exact ID also listed in ownerIds, then restart.',
      );
    return id;
  }
  requireOwnerDm(i) {
    if (
      i.context !== InteractionContextType.BotDM ||
      i.guildId != null ||
      i.inGuild() ||
      i.channel?.type !== ChannelType.DM
    )
      throw new Error('Developer commands are allowed only in a direct message with this bot.');
    if (i.user?.id !== this.configuredOwner())
      throw new Error('Only the configured developer owner can use this feature.');
  }
  #isElevated() {
    return (
      this.#session &&
      this.#session.ownerId === this.config.customOwnerId &&
      this.now() < this.#session.until &&
      this.monotonic() < this.#session.deadline
    );
  }
  status() {
    return {
      ownerId: this.config.customOwnerId || null,
      enrolled: !!this.#credential && this.#credential.ownerId === this.config.customOwnerId,
      elevatedUntil: this.#isElevated() ? this.#session.until : null,
      durationSeconds: ELEVATION_MS / 1000,
    };
  }
  redact(value) {
    let text = String(value);
    for (const secret of [this.#credential?.secret, this.#pending?.secret])
      if (secret) text = text.split(secret).join('[redacted]');
    return text.replace(/otpauth:\/\/\S+/gi, '[redacted provisioning URI]');
  }
  revoke() {
    this.#revision++;
    this.#session = null;
    this.#tickets = new WeakMap();
    this.onRevoke();
  }
  cancelEnrollment(sessionId) {
    if (this.#pending?.sessionId === sessionId) this.#pending = null;
  }
  beginEnrollment(sessionId) {
    const ownerId = this.configuredOwner();
    if (this.#busy) throw new Error('Authentication is busy; try again.');
    const secret = generateSecret();
    this.#pending = { ownerId, secret, sessionId, until: this.now() + ELEVATION_MS, attempts: 0 };
    return {
      uri: generateURI({
        issuer: 'Community Bot',
        label: ownerId,
        secret,
        algorithm: 'sha1',
        digits: 6,
        period: 30,
      }),
      expiresAt: this.#pending.until,
    };
  }
  async confirmEnrollment(sessionId, token) {
    if (this.#busy) throw new Error('Authentication is busy; try again.');
    const pending = this.#pending;
    if (
      !pending ||
      pending.sessionId !== sessionId ||
      pending.until <= this.now() ||
      pending.ownerId !== this.configuredOwner()
    )
      throw new Error('Enrollment expired. Start a new local enrollment.');
    this.#busy = true;
    try {
      pending.attempts++;
      const result =
        typeof token === 'string' && /^\d{6}$/.test(token)
          ? await verify({
              ...otpOptions,
              secret: pending.secret,
              token,
              epoch: Math.floor(this.now() / 1000),
            })
          : { valid: false };
      if (this.#pending !== pending || pending.until <= this.now())
        throw new Error('Enrollment expired. Start a new local enrollment.');
      if (!result.valid) {
        if (pending.attempts >= 5) this.#pending = null;
        throw new Error('Invalid authenticator code. Check automatic time synchronization.');
      }
      // Do not elevate via the admin panel. Consume the enrollment step as well.
      const credential = {
        ownerId: pending.ownerId,
        secret: pending.secret,
        lastStep: result.timeStep,
        failures: 0,
        blockedUntil: 0,
      };
      this.vault.save(credential);
      this.#credential = credential;
      this.#pending = null;
      this.revoke();
      return this.status();
    } finally {
      this.#busy = false;
    }
  }
  async authenticate(i, token) {
    this.requireOwnerDm(i);
    if (this.#busy) throw new Error('Authentication is busy; try again.');
    const credential = this.#credential;
    if (!credential || credential.ownerId !== this.configuredOwner())
      throw new Error('Enroll an authenticator in the local admin panel first.');
    if (credential.blockedUntil > this.now())
      throw new Error('Too many failed codes. Wait five minutes before retrying.');
    if (credential.lastStep > Math.floor(this.now() / 30000) + 1)
      throw new Error('Host clock moved backwards. Correct Windows time before authenticating.');
    const revision = this.#revision;
    this.#busy = true;
    try {
      const result =
        typeof token === 'string' && /^\d{6}$/.test(token)
          ? await verify({
              ...otpOptions,
              secret: credential.secret,
              token,
              epoch: Math.floor(this.now() / 1000),
              afterTimeStep: credential.lastStep,
            })
          : { valid: false };
      if (revision !== this.#revision) throw new Error('Authentication was revoked. Try again.');
      if (!result.valid) {
        const failures = credential.failures + 1;
        const next = {
          ...credential,
          failures: failures >= 5 ? 0 : failures,
          blockedUntil: failures >= 5 ? this.now() + LOCKOUT_MS : 0,
        };
        this.vault.save(next);
        this.#credential = next;
        throw new Error('Invalid or already-used authenticator code. Use a fresh code.');
      }
      const next = { ...credential, lastStep: result.timeStep, failures: 0, blockedUntil: 0 };
      // Persist anti-replay state BEFORE granting access; disk failures deny elevation.
      this.vault.save(next);
      this.#credential = next;
      this.revoke();
      this.#session = {
        ownerId: i.user.id,
        until: this.now() + ELEVATION_MS,
        deadline: this.monotonic() + ELEVATION_MS,
      };
      return this.#session.until;
    } finally {
      this.#busy = false;
    }
  }
  authorizeExecution(i) {
    this.requireOwnerDm(i);
    if (!i.isChatInputCommand() || i.commandName !== 'customcommand')
      throw new Error('Only the dedicated CustomCommand interaction can execute developer code.');
    if (!this.#isElevated())
      throw new Error('TOTP elevation required. Use /owner-auth in this DM first.');
    const ticket = Object.freeze({});
    this.#tickets.set(ticket, {
      userId: i.user.id,
      dmChannelId: i.channelId,
      session: this.#session,
      started: false,
    });
    return ticket;
  }
  validateExecution(ticket, begin = false) {
    const entry = this.#tickets.get(ticket);
    if (
      !entry ||
      !this.#isElevated() ||
      entry.session !== this.#session ||
      entry.userId !== this.configuredOwner()
    )
      throw new Error(
        'Developer authorization is missing, expired, or revoked. Authenticate again.',
      );
    if (begin && entry.started)
      throw new Error('This execution authorization has already been used.');
    if (begin) entry.started = true;
    return {
      userId: entry.userId,
      dmChannelId: entry.dmChannelId,
      remainingMs: Math.min(
        entry.session.until - this.now(),
        entry.session.deadline - this.monotonic(),
      ),
    };
  }
}
