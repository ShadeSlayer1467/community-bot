import { Worker } from 'node:worker_threads';
export class CustomRunner {
  constructor(log, security) {
    this.log = log;
    this.security = security;
    this.busy = false;
    this.cancel = null;
  }
  async run({ authorization, file, context, dispatch, timeoutMs = 30000 }) {
    if (!this.security) throw new Error('Developer authorization service is required.');
    const { userId, dmChannelId, remainingMs } = this.security.validateExecution(
      authorization,
      true,
    );
    context = { ...context, userId, dmChannelId };
    timeoutMs = Math.max(1, Math.min(timeoutMs, remainingMs));
    if (this.busy)
      throw new Error(
        'A custom operation is still running or draining its pending Discord requests.',
      );
    this.busy = true;
    const controller = new AbortController();
    let worker,
      timer,
      active = true,
      calls = 0,
      pending = Promise.resolve();
    this.log('info', 'CustomCommand started', { userId, guildId: context.guildId });
    try {
      return await new Promise((resolve, reject) => {
        const finish = (error, value) => {
          if (!active) return;
          active = false;
          clearTimeout(timer);
          controller.abort();
          // Keep the lock until the worker exits AND already-started API calls settle.
          Promise.resolve(worker?.terminate())
            .then(() => pending)
            .finally(() => {
              this.busy = false;
              this.cancel = null;
            });
          this.log(
            error ? 'error' : 'info',
            error ? 'CustomCommand failed' : 'CustomCommand completed',
            { userId, error: error?.message },
          );
          error ? reject(error) : resolve(value);
        };
        this.cancel = () =>
          finish(
            new Error(
              'Custom operation cancelled. Already submitted Discord actions cannot be undone.',
            ),
          );
        timer = setTimeout(
          () =>
            finish(
              new Error(
                'Custom operation timed out. Already submitted Discord actions may still complete.',
              ),
            ),
          timeoutMs,
        );
        try {
          worker = new Worker(new URL('./worker.js', import.meta.url), {
            workerData: { file, context },
            env: {},
            stdout: true,
            stderr: true,
            resourceLimits: {
              maxOldGenerationSizeMb: 64,
              maxYoungGenerationSizeMb: 16,
              stackSizeMb: 4,
            },
          });
          worker.stdout.resume();
          worker.stderr.resume();
          worker.on('message', (message) => {
            if (!active) return;
            if (message.type === 'done')
              return finish(null, String(message.value ?? 'Completed.').slice(0, 1900));
            if (message.type === 'error')
              return finish(new Error(String(message.error).slice(0, 500)));
            if (message.type !== 'call') return;
            if (++calls > 200) return finish(new Error('Custom operation exceeded 200 API calls.'));
            pending = pending.then(async () => {
              if (!active) return;
              try {
                this.security.validateExecution(authorization);
                controller.signal.throwIfAborted();
                const result = await dispatch(message.method, message.args, controller.signal);
                if (active) worker.postMessage({ id: message.id, result });
              } catch (e) {
                if (active)
                  worker.postMessage({ id: message.id, error: String(e.message).slice(0, 500) });
              }
            });
          });
          worker.on('error', (error) => finish(error));
          worker.on('exit', (code) => {
            if (active) finish(new Error(`Custom worker exited before returning (code ${code}).`));
          });
        } catch (e) {
          finish(e);
        }
      });
    } catch (error) {
      throw error;
    }
  }
}
