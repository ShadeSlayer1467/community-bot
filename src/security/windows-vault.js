import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../persistence.js';

// DPAPI CurrentUser is supplied by Windows, not application-defined encryption.
// The value travels over stdin/stdout only; never put a credential in a command line.
export function dpapi(value, decrypt = false) {
  if (process.platform !== 'win32')
    throw new Error('TOTP storage requires Windows DPAPI on this host.');
  const operation = decrypt
    ? '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))';
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $value=[Console]::In.ReadToEnd(); [Console]::Out.Write(${operation})`,
    ],
    { input: value, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 65536 },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      'Unable to access Windows-protected TOTP storage. Use the Windows account that enrolled it.',
    );
  return result.stdout;
}

export class WindowsVault {
  constructor(file) {
    this.store = new Store(file, { encrypted: null });
  }
  read() {
    const { encrypted } = this.store.read();
    if (!encrypted) return null;
    try {
      return JSON.parse(dpapi(encrypted, true));
    } catch {
      throw new Error(
        'Cannot open TOTP credential. Restore the protected file using the original Windows account.',
      );
    }
  }
  save(record) {
    this.store.save({ encrypted: dpapi(JSON.stringify(record)) });
  }
}
