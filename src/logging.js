import fs from 'node:fs';
import path from 'node:path';
export function createLogger(directory, secrets = [], sanitize = (value) => value) {
  fs.mkdirSync(directory, { recursive: true });
  const recent = [];
  const redact = (value) => {
    let text = sanitize(String(value));
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[redacted]');
    return text
      .replace(/[A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}/g, '[redacted]')
      .slice(0, 1500);
  };
  const log = (level, message, details = {}) => {
    const entry = {
      time: new Date().toISOString(),
      level,
      message: redact(message),
      details: redact(JSON.stringify(details)),
    };
    recent.push(entry);
    if (recent.length > 300) recent.shift();
    const file = path.join(directory, 'events.jsonl');
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 5_000_000)
        fs.renameSync(file, `${file}.previous`);
      fs.appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch {
      console.error('Could not write the event log. Check disk space and permissions.');
    }
    console.log(`${entry.time} ${level}: ${entry.message}`);
  };
  return { log, recent, redact };
}
