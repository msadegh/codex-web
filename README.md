# Codex Web

[فارسی](README.fa.md) · **English**

[![CI](https://github.com/msadegh/codex-web/actions/workflows/ci.yml/badge.svg)](https://github.com/msadegh/codex-web/actions/workflows/ci.yml)

An unofficial, local-first browser interface for the installed
[Codex CLI](https://developers.openai.com/codex/cli/). Codex still runs on your
machine—or on a server you control—while the browser provides a chat interface
that handles Persian, RTL, and mixed Persian/English text more comfortably than
many terminals.

> [!IMPORTANT]
> Codex Web is an independent community project. It is not affiliated with,
> endorsed by, or supported by OpenAI.

## Features

- Reuses the installed Codex CLI login, configuration, top-level profile
  settings, skills, MCP servers, sessions, sandbox, and approval flow.
- Runs multiple isolated Codex conversations concurrently in one browser tab.
- Routes approval prompts and user-input questions to the correct conversation.
- Streams answers, tool activity, plans, file changes, and command output.
- Uploads multiple images or accepts pasted screenshots and inserts their
  server-side paths into the prompt.
- Jumps between your own messages, keeps long streams readable, and offers a
  one-click jump to the bottom.
- Plays one completion sound for foreground and background conversations.
- Works without a database, build step, framework, or runtime npm dependency.

The interface is currently Persian-first. This README is available in English
and Persian.

## Security first

Codex Web is a control surface for a coding agent. Access to the page can become
equivalent to shell access as the operating-system user that started it,
especially when `--yolo` is enabled.

- The HTTP server deliberately listens only on `127.0.0.1`.
- It does **not** include web authentication.
- Loopback is not authentication against other users or processes on the same
  server; use a trusted single-user host or additional OS/network isolation.
- Never expose the HTTP port (`4173` by default) directly to the internet or
  change the listener to `0.0.0.0`.
- Use an authenticated SSH tunnel for remote access.
- On a remote machine, prefer a dedicated low-privilege user, container, or VM.
- `--yolo` disables the sandbox and approval prompts. Use it only in a trusted,
  externally isolated environment.

See [SECURITY.md](SECURITY.md) before running Codex Web on a server.

## Requirements

- Linux, macOS, or Windows through WSL. The current release is tested on Linux;
  native Windows is not yet verified.
- Node.js 22 or newer. Use a currently supported Node.js LTS release.
- A recent Codex CLI release with the experimental `app-server` command.
- A configured Codex login or provider profile.

The current release is tested with Codex CLI `0.145.0`; other recent versions
may work, but the experimental app-server protocol can change. The included
`.nvmrc` selects Node.js 24 for users of `nvm`.

Install Codex CLI if needed:

```bash
npm install --global @openai/codex
codex login
```

On a headless server, Codex also supports device authentication:

```bash
codex login --device-auth
```

Custom providers and environment-based credentials work as they do in the CLI;
an OpenAI login is not required when your provider configuration does not use
one.

## Install

```bash
git clone https://github.com/msadegh/codex-web.git
cd codex-web
npm install
npm install --global .
```

The last command installs the `codex-web` launcher. For a development checkout,
you can use `npm link` instead.

You can also skip the global launcher. Run this from the Codex Web checkout
and provide the target project explicitly:

```bash
CODEX_WEB_CWD=/absolute/path/to/project npm start -- --search
```

## Local use

Change to the project you want Codex to work on, then start Codex Web:

```bash
cd /path/to/your/project
codex-web
```

The browser opens at <http://127.0.0.1:4173>. Stop the process with `Ctrl+C`.

Examples:

```bash
# Recommended interactive permissions
codex-web --sandbox workspace-write --ask-for-approval on-request --search

# Use a named Codex profile
export YOUR_PROVIDER_API_KEY=...
codex-web -p work --search

# Match a fully autonomous CLI session — dangerous
codex-web -p work --yolo --search

# Start without opening a browser
codex-web --no-open
```

The child `codex app-server` inherits the environment of `codex-web`, so
provider keys should stay in the shell or service environment and must never be
committed.

### Supported CLI options

Codex Web translates these interactive CLI options:

| Option | Behavior |
| --- | --- |
| `-p`, `--profile` | Applies top-level scalar settings from `$CODEX_HOME/<name>.config.toml` |
| `-s`, `--sandbox` | Default sandbox for new and resumed conversations |
| `-a`, `--ask-for-approval` | Default approval policy for new and resumed conversations |
| `--yolo` / `--dangerously-bypass-approvals-and-sandbox` | Uses `danger-full-access` and approval policy `never` |
| `--search` | Enables live web search |
| `-c`, `--enable`, `--disable`, `--strict-config` | Compatible global Codex configuration options forwarded before `app-server` |
| `--no-open` | Does not open the browser automatically |

The Codex app-server currently has no profile flag, so Codex Web converts the
named profile's top-level scalar values to `-c` overrides. TOML tables in a
profile are currently ignored. Keep secrets in environment variables rather
than profile values because command-line overrides may be visible in the
server's process list.

Run `codex-web --help` to see the local command help.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_WEB_PORT` | `4173` | Local HTTP port |
| `CODEX_WEB_CWD` | launch directory | Default working directory |
| `CODEX_WEB_NO_OPEN` | unset | Set to `1` to suppress browser opening |
| `CODEX_WEB_UPLOAD_DIR` | Codex Web cache directory | Where uploaded images are stored |
| `XDG_CACHE_HOME` | `~/.cache` on Linux | Base cache directory |
| `CODEX_BIN` | `codex` | Path to the Codex executable |

Working directory, model, personality, sandbox, and approval settings selected
in the browser apply to newly created conversations. Reasoning effort applies
when a new turn starts. Resumed conversations keep their stored settings and
the launch-time CLI defaults.

## Slash commands

Type `/` in the composer to open the command menu, then keep typing to filter
the list or select a command with the keyboard, mouse, or touch.

| Command | Action |
| --- | --- |
| `/compact` | Natively compact the current Codex context; available only for an existing, idle conversation |
| `/new` | Start a new conversation |
| `/clear` | Clear the current view and start a fresh conversation |
| `/resume` | Open the saved-conversation list |
| `/status` | Show the current conversation status |
| `/model` | Open model settings |
| `/permissions` | Open sandbox and approval settings |
| `/settings` | Open all conversation settings |
| `/help` | Show the supported command list |

Unknown slash commands are not sent to the model. Codex Web currently supports
only the commands listed above, not every slash command available in the Codex
terminal UI.

## Parallel conversations

One Codex Web process can run multiple Codex threads concurrently. Start a
task, select **New chat**, and start another task. Conversation state, messages,
streamed events, and interactive questions are routed by Codex thread ID and do
not mix.

All conversations still share the server user, environment, CPU, memory, and
possibly the same working tree. Two agents editing the same files can therefore
conflict even though their conversation state is isolated.

Multiple browser tabs may connect to the same server. Completion audio is
deduplicated across tabs.

## Images, navigation, and completion alerts

Use the image button to select up to 20 images, or paste a screenshot directly
into the composer. PNG, JPEG, WebP, GIF, AVIF, and BMP images up to 25 MiB each
are accepted.

Browsers do not reveal a selected file's original absolute path. Codex Web
therefore copies each image to the machine running the server—normally
`~/.cache/codex-web/uploads`—and inserts that server-side absolute path into the
prompt. During remote use, images selected on your laptop or phone are uploaded
through the SSH tunnel to the server.

Uploads remain in the cache so old conversation paths continue to work. Review
and remove unused sensitive images manually. There is no automatic cleanup or
total cache quota, so long-running installations should monitor disk usage.

The up/down buttons in the conversation header jump between your messages.
Completion audio requires one click or key press on the page before browsers
allow sound.

## Run on a remote server

Codex and every command will run on the server. The browser is only the UI.

### 1. Start Codex Web on the server

Install Codex CLI and Codex Web on the server, authenticate Codex, then:

```bash
cd /path/to/server/project
codex-web --no-open --sandbox workspace-write --ask-for-approval on-request --search
```

Use `tmux`, `screen`, or a carefully configured user-level service if the
process must survive an SSH disconnect. Keep credentials outside the
repository.

If you have already created a named custom-provider profile, an optional
variant is:

```bash
export YOUR_PROVIDER_API_KEY=...
codex-web --no-open -p work --sandbox workspace-write --ask-for-approval on-request --search
```

### 2. Create a tunnel from your laptop

```bash
ssh -o ExitOnForwardFailure=yes -N \
  -L 127.0.0.1:4173:127.0.0.1:4173 USER@SERVER_IP
```

Keep that terminal open and visit <http://127.0.0.1:4173>.

If local port `4173` is busy:

```bash
ssh -o ExitOnForwardFailure=yes -N \
  -L 127.0.0.1:44173:127.0.0.1:4173 USER@SERVER_IP
```

Then visit <http://127.0.0.1:44173>.

### Connect from a phone

Use an SSH client that supports local port forwarding, such as Termius, Blink,
or Termux. Create the same mapping:

```text
local 127.0.0.1:4173 → server 127.0.0.1:4173
```

Keep the SSH tunnel active and open `http://127.0.0.1:4173` in the phone's
browser. Mobile operating systems may suspend the SSH application in the
background; allow it to remain active if necessary.

Tailscale may protect the SSH connection itself, but Codex Web should still be
reached through loopback forwarding. Direct URLs and public reverse-proxy
deployment—even with proxy authentication—are unsupported in this release;
SSH loopback forwarding is the documented remote-access method.

## Update

Stop Codex Web, then update the checkout:

```bash
cd /path/to/codex-web
git pull --ff-only
npm install
npm install --global .
```

Update Codex CLI as well if an app-server protocol change causes compatibility
errors.

## Uninstall and local data

```bash
npm uninstall --global codex-web
```

You can then remove the cloned repository. This does not delete Codex CLI
login, configuration, sessions, or the Codex Web image cache. Inspect those
locations and remove data manually only when you no longer need it.

## Troubleshooting

- **`codex` not found:** run `codex --version`, or set `CODEX_BIN` to the full
  executable path.
- **Authentication failed:** verify with `codex login status`. OpenAI-login
  users can run `codex logout`, then `codex login`; custom-provider users should
  check their profile and environment.
- **The port is busy:** start with `CODEX_WEB_PORT=4180 codex-web` and use the
  matching local URL or SSH mapping.
- **Wrong working directory:** start Codex Web inside the target project, set
  `CODEX_WEB_CWD`, or change it in the settings dialog before starting a chat.
- **The SSH tunnel disconnected:** reconnect it; the server-side process may
  still be running.
- **No completion sound:** interact with the page once and check browser audio
  permissions.
- **Image rejected:** verify the format, 25 MiB limit, and cache-directory
  permissions.
- **App-server protocol error:** update Codex CLI and Codex Web, then restart
  both. The app-server protocol is experimental.

## Development

```bash
npm run check
npm test
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

[MIT](LICENSE)
