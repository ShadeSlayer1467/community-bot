# Security policy

## Supported version

Security fixes target the latest commit on the default branch.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** / private security advisory feature for this repository. Do not include active bot tokens, API keys, passwords, TOTP secrets, notification credentials, or private server details in a public issue.

If a credential may have been exposed, revoke or rotate it at its provider immediately. Removing it from the latest commit is not enough because Git history and forks may retain earlier versions.

## Local security boundary

- The control room is designed for `127.0.0.1` only. Do not port-forward or reverse-proxy it.
- `config.local.json`, `data/`, `.env*`, DPAPI files, and local CustomCommand source are ignored by Git.
- CustomCommand runs trusted local JavaScript with the host user's privileges. It is isolated for lifecycle control, not as a hostile-code sandbox.
- The notification credential can submit bounded content only; it cannot change the saved recipient, settings, or administrator state.
