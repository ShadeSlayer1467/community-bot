import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export class Store {
  constructor(file, defaults, validate = (x) => x) {
    this.file = file;
    this.validate = validate;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.value = validate(
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(defaults),
    );
  }
  read() {
    return structuredClone(this.value);
  }
  save(value) {
    const next = this.validate(structuredClone(value));
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
    this.value = next;
    return this.read();
  }
}
