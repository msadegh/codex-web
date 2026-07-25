# Security policy

Codex Web is a local control surface for Codex CLI. Anyone who can access it
may be able to read project data, answer approval prompts, and cause commands
to run with the permissions of the operating-system user that started it.

## Supported version

Security fixes are applied to the latest version on the default branch.

## Safe deployment

- Keep Codex Web bound to `127.0.0.1`.
- For remote use, connect through an authenticated SSH tunnel.
- Do not expose the HTTP port directly to the internet.
- Remember that loopback does not authenticate other operating-system users
  or processes on the same host. Use a trusted single-user host or additional
  OS/network isolation.
- Treat `--yolo` / `--dangerously-bypass-approvals-and-sandbox` as equivalent
  to granting the agent broad access as the service user.
- Prefer a dedicated, low-privilege user, container, or VM on remote machines.
- Keep API keys and provider credentials in the server environment; never
  commit them to the repository.

Codex Web does not currently include web authentication, and this release
rejects non-local Host/Origin values. Direct or public reverse-proxy deployment
is unsupported; do not bypass these checks. SSH loopback forwarding is the
documented remote-access method.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this
repository. Do not include credentials, private source code, or sensitive
screenshots in a public issue.
