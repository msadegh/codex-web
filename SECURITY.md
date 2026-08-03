# Security policy

Codex Web is a local control surface for Codex CLI and Claude Code CLI. Anyone
who can access it may be able to read project data, answer Codex approval
prompts, and cause commands to run with the permissions of the operating-system
user that started it.

## Supported version

Security fixes are applied to the latest version on the default branch.

## Safe deployment

- Keep Codex Web bound to `127.0.0.1`.
- For remote use, enable the optional foreground Tailscale Serve mode with
  `--remote`, or connect through an authenticated SSH tunnel.
- Remote mode keeps the backend on loopback, rejects public Funnel traffic,
  and requires the Tailscale identity header to match the device owner (or the
  explicitly configured `CODEX_WEB_REMOTE_USER`) on every route. Tagged devices
  do not provide that identity and are rejected.
- If a custom control plane reports that Serve HTTPS is not implemented, remote
  mode can use private HTTP inside the encrypted tailnet. Browser secure-context
  features may be unavailable in that fallback; it does not permit LAN or
  public traffic.
- Do not expose the HTTP port directly to the LAN, use Tailscale Funnel, or put
  Codex Web behind a public reverse proxy.
- Do not expose the HTTP port directly to the internet.
- Remember that loopback does not authenticate other operating-system users
  or processes on the same host. Use a trusted single-user host or additional
  OS/network isolation.
- Treat `--yolo` / `--dangerously-bypass-approvals-and-sandbox` as equivalent
  to granting Codex broad access as the service user. These flags do not
  configure Claude.
- Claude runs through the non-interactive `--print` interface, so Codex Web
  cannot relay Claude permission prompts. This mode also skips Claude's
  workspace-trust dialog, so run it only in working directories you trust.
  Choosing a directory in the browser is not a security boundary.
- In `acceptEdits` mode, Claude can edit files and perform common filesystem
  operations in the working directory without prompting; other unapproved
  tools may fail the turn.
- `dontAsk` automatically denies tools that are not pre-approved. It is not a
  broad-access mode. `plan` is read-only.
- Treat Claude `bypassPermissions` as granting broad access as the service
  user. Use it only in a strongly isolated environment.
- Prefer a dedicated, low-privilege user, container, or VM on remote machines.
- Keep API keys and provider credentials in the server environment; never
  commit them to the repository.
- Protect both `CLAUDE_CONFIG_DIR` and `CLAUDE_WEB_DATA_DIR`. They contain
  native or normalized Claude conversation history, settings, and potentially
  credentials, source code, tool input/output, and other sensitive data.
- Concurrent Codex and Claude conversations are isolated by provider and
  thread ID, but their child processes still share the same operating-system
  user, environment, host resources, and possibly working tree.

Local access does not include a separate web login. This release accepts either
same-origin localhost requests or authenticated requests from the temporary
Tailscale Serve route created by `--remote`. Direct and public reverse-proxy
deployment remains unsupported; do not bypass the Host, Origin, loopback, or
Tailscale identity checks.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this
repository. Do not include credentials, private source code, or sensitive
screenshots in a public issue.
