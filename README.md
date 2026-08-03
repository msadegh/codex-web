# Codex Web

[فارسی](README.fa.md) · **English**

[![CI](https://github.com/msadegh/codex-web/actions/workflows/ci.yml/badge.svg)](https://github.com/msadegh/codex-web/actions/workflows/ci.yml)

An unofficial, local-first browser interface for the installed
[Codex CLI](https://developers.openai.com/codex/cli/) and
[Claude Code CLI](https://code.claude.com/docs/en/overview). Codex or Claude
still runs on your
machine—or on a server you control—while the browser provides a chat interface
that handles Persian, RTL, and mixed Persian/English text more comfortably than
many terminals.

> [!IMPORTANT]
> Codex Web is an independent community project. It is not affiliated with,
> endorsed by, or supported by OpenAI or Anthropic.

## Features

- Reuses the installed Codex CLI login, configuration, top-level profile
  settings, skills, MCP servers, sessions, sandbox, and approval flow.
- Connects to Claude Code CLI sessions with streaming output, model selection,
  local conversation history, and Claude permission modes.
- Runs multiple isolated Codex and Claude conversations concurrently in one
  browser tab.
- Routes Codex approval prompts and user-input questions to the correct
  conversation. Claude runs non-interactively and follows its configured
  permission mode and permission rules.
- Streams answers, tool activity, plans, file changes, and command output.
- Supports native Codex Plan mode and persistent Goal mode, including goal
  pause, resume, edit, clear, and progress state.
- Offers browser dictation that turns speech into editable prompt text.
- Adaptively structures multi-part Codex answers with semantic Markdown
  headings and real lists while keeping simple answers compact and preserving
  the existing Codex Web visual theme.
- Uploads multiple images or accepts pasted screenshots and inserts their
  server-side paths into the prompt.
- Queues follow-up prompts while a turn is running and can quote a selected
  part of an assistant response back into the composer.
- Lets you collapse the conversation-history sidebar and remembers that simple
  workspace preference.
- Jumps between your own messages, keeps long streams readable, and offers a
  one-click jump to the bottom.
- Plays one completion sound for foreground and background conversations.
- Works without a database, build step, framework, or runtime npm dependency.

The interface is currently Persian-first. This README is available in English
and Persian.

## Security first

Codex Web is a control surface for a coding agent. Access to the page can become
equivalent to shell access as the operating-system user that started it,
especially when Codex `--yolo` or Claude `bypassPermissions` is enabled.

- The HTTP server deliberately listens only on `127.0.0.1`.
- It does **not** include web authentication.
- Loopback is not authentication against other users or processes on the same
  server; use a trusted single-user host or additional OS/network isolation.
- Never expose the HTTP port (`4173` by default) directly to the internet or
  change the listener to `0.0.0.0`.
- Use an authenticated SSH tunnel for remote access.
- On a remote machine, prefer a dedicated low-privilege user, container, or VM.
- Codex `--yolo` disables the Codex sandbox and approval prompts; it does not
  configure Claude.
- Claude's non-interactive `--print` mode skips the workspace-trust dialog.
  Start Claude conversations only in working directories you trust.
- Codex Web initially selects Claude's `acceptEdits` mode for a new Claude
  conversation; it allows file edits in the working directory without
  prompting. `bypassPermissions` grants much broader access. Review this
  selection before starting a conversation.

See [SECURITY.md](SECURITY.md) before running Codex Web on a server.

## Requirements

- Linux, macOS, or Windows through WSL. The current release is tested on Linux;
  native Windows is not yet verified.
- Node.js 22 or newer. Use a currently supported Node.js LTS release.
- A recent Codex CLI release with the experimental `app-server` command if you
  use the Codex provider.
- A recent Claude Code CLI release if you use the Claude provider.
- A configured login, provider profile, or environment-based credentials for
  each provider you plan to use.

The current release is tested with Codex CLI `0.145.0`; other recent versions
may work, but the experimental app-server protocol can change. The Claude
authentication commands and CLI flags documented here were verified against
Claude Code `2.1.220`. The integration also depends on Claude Code's
non-interactive stream format and local session layout, so keep Claude Code
current when using that provider. The included `.nvmrc` selects Node.js 24 for
users of `nvm`.

Install and authenticate the providers you need:

```bash
# Codex
npm install --global @openai/codex
codex login

# Claude Code — follow the official setup guide before this step
claude --version
claude auth login
```

See the [Claude Code setup guide](https://code.claude.com/docs/en/setup) for
current installation methods.

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

Claude Code is started with `--print --output-format stream-json`. This mode
skips Claude's workspace-trust dialog and cannot show interactive permission
prompts in Codex Web, so use only a trusted working directory. `acceptEdits`
automatically permits edits and common file operations there, while other
unapproved tools may fail the turn. `dontAsk` automatically denies tools that
are not pre-approved, `plan` is read-only, and `bypassPermissions` skips most
permission checks and is dangerous. Existing Claude `permissions.allow` and
`permissions.deny` rules still apply. Claude authentication and environment
configuration are reused; API keys are never sent to the browser or stored in
browser settings. See
[Claude Code permissions](https://code.claude.com/docs/en/permissions) for the
upstream semantics and rule syntax.

### Supported Codex CLI options

Codex Web translates these options for the Codex provider:

| Option | Behavior |
| --- | --- |
| `-p`, `--profile` | Applies top-level scalar settings from `$CODEX_HOME/<name>.config.toml` |
| `-s`, `--sandbox` | Default sandbox for new and resumed Codex conversations |
| `-a`, `--ask-for-approval` | Default approval policy for new and resumed Codex conversations |
| `--yolo` / `--dangerously-bypass-approvals-and-sandbox` | Uses `danger-full-access` and approval policy `never` |
| `--search` | Enables live web search |
| `-c`, `--enable`, `--disable`, `--strict-config` | Compatible global Codex configuration options forwarded before `app-server` |
| `--no-open` | Does not open the browser automatically |

The Codex app-server currently has no profile flag, so Codex Web converts the
named profile's top-level scalar values to `-c` overrides. TOML tables in a
profile are currently ignored. Keep secrets in environment variables rather
than profile values because command-line overrides may be visible in the
server's process list. These Codex options do not change Claude's permission
mode; choose that separately in the browser settings.

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
| `CLAUDE_BIN` | `claude` | Path to the Claude Code executable |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code settings, credentials, plugins, and native sessions |
| `CLAUDE_WEB_DATA_DIR` | `~/.cache/codex-web/claude` | Claude conversation metadata and history |

For compatibility with early development builds, Codex Web accepts
`CLAUDE_HOME` as a fallback only when `CLAUDE_CONFIG_DIR` is unset. New
configurations should use Claude Code's official `CLAUDE_CONFIG_DIR` variable.

### Provider-specific browser settings

| Setting | Codex | Claude |
| --- | --- | --- |
| Working directory and model | Applied to new conversations | Applied to new conversations |
| Reasoning effort | Available values depend on the Codex model | `low`, `medium`, `high`, `xhigh`, or `max`; `ultra` is not sent |
| Sandbox, approval policy, and personality | Applied | Hidden and not sent to Claude |
| Claude permission mode | Not used | Applied to new web-created conversations |

Web-created conversations retain their stored provider and session settings.
Native Claude sessions without an explicit Codex Web override use Claude
Code's own permission default when resumed.

Claude conversations created in Codex Web are stored as local metadata and
normalized history under `CLAUDE_WEB_DATA_DIR`. Existing Claude Code sessions
are discovered from `CLAUDE_CONFIG_DIR/projects` and resumed through their
original session IDs. Discovery does not modify those transcripts, but resuming
a conversation causes Claude Code itself to append to its native history.
Protect both directories because conversation history may contain source code,
tool input/output, or other sensitive content.

## Slash commands

Type `/` in the composer to open the command menu, then keep typing to filter
the list or select a command with the keyboard, mouse, or touch.

| Command | Action |
| --- | --- |
| `/goal` | Create or edit a persistent goal for the current Codex conversation |
| `/plan` | Toggle native Plan mode for subsequent Codex turns; `Shift+Tab` does the same in the composer |
| `/compact` | Natively compact the current Codex context; available only for an existing, idle conversation |
| `/new` | Start a new conversation |
| `/clear` | Clear the current view and start a fresh conversation |
| `/resume` | Open the saved-conversation list |
| `/status` | Show the current conversation status |
| `/model` | Open model settings |
| `/permissions` | Open the permission settings for the selected provider |
| `/settings` | Open all conversation settings |
| `/help` | Show the supported command list |

Unknown slash commands are not sent to the model. Codex Web currently supports
only the commands listed above, not every slash command available in the Codex
or Claude terminal interfaces. These commands are handled by Codex Web rather
than passed through to the selected provider.

## Parallel conversations

One Codex Web process can run multiple Codex and Claude conversations
concurrently. Start a task, select **New chat**, and start another task.
Conversation state, messages, and streamed events are routed by provider and
thread ID and do not mix. Interactive approval and input questions apply to
Codex conversations; Claude's non-interactive permission behavior is described
above.

Codex Web maintains one Codex app-server process and routes its threads. Each
active Claude turn runs in its own non-interactive Claude CLI child process;
this does not open visible terminal tabs. Work in separate conversations can
therefore proceed in parallel.

All conversations still share the server user, environment, CPU, memory, and
possibly the same working tree. Two agents editing the same files can therefore
conflict even though their conversation state is isolated.

Multiple browser tabs may connect to the same server. Completion audio is
deduplicated across tabs.

## Images, dictation, navigation, and completion alerts

Use the image button to select up to 20 images, or paste a screenshot directly
into the composer. PNG, JPEG, WebP, GIF, AVIF, and BMP images up to 25 MiB each
are accepted.

Browsers do not reveal a selected file's original absolute path. Codex Web
therefore copies each image to the machine running the server—normally
`~/.cache/codex-web/uploads`—and inserts that server-side absolute path into the
prompt. During remote use, images selected on your laptop or phone are uploaded
through the SSH tunnel to the server.

Uploads remain in the cache so old conversation paths continue to work. Review
and remove unused sensitive images manually. There is no
automatic cleanup or total cache quota, so long-running installations should
monitor disk usage.

The microphone button uses the browser's speech-recognition support to place a
dictated transcript in the composer for review before sending. Availability and
whether speech is processed locally or by a browser service depend on the
browser. Dictation requires microphone permission.

The up/down buttons in the conversation header jump between your messages.
Completion audio requires one click or key press on the page before browsers
allow sound.

Opening a conversation stores its ID in the user-facing `?session=` URL.
Refreshing the page or using browser Back and Forward restores that selection.
Legacy `?thread=` links remain valid and are automatically replaced with the
new parameter. The value maps to the provider conversation—called a thread
inside the Codex app-server—and is not an authentication token or a way around
the localhost-only server boundary.

## Run on a remote server

Codex or Claude and every command will run on the server. The browser is only
the UI.

### 1. Start Codex Web on the server

Install Codex Web and whichever provider CLIs you intend to use on the server,
then authenticate those providers. For example, to start with conservative
Codex defaults:

```bash
cd /path/to/server/project
codex-web --no-open --sandbox workspace-write --ask-for-approval on-request --search
```

Those command-line sandbox and approval options configure Codex only. Select a
Claude permission mode separately in the browser before starting a Claude
conversation.

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

Update Codex CLI or Claude Code CLI as well if a provider protocol or output
format change causes compatibility errors.

## Uninstall and local data

```bash
npm uninstall --global codex-web
```

You can then remove the cloned repository. This does not delete:

- Codex CLI login, configuration, or sessions;
- Claude Code settings, credentials, plugins, or native sessions under
  `CLAUDE_CONFIG_DIR` (normally `~/.claude`);
- normalized Claude history under `CLAUDE_WEB_DATA_DIR` (normally
  `~/.cache/codex-web/claude`); or
- uploaded images under the Codex Web cache (normally
  `~/.cache/codex-web/uploads`).

Inspect these locations and remove data manually only when you no longer need
it. Deleting `CLAUDE_CONFIG_DIR` affects Claude Code itself, not just Codex Web.

## Troubleshooting

- **`codex` not found:** run `codex --version`, or set `CODEX_BIN` to the full
  executable path.
- **`claude` not found:** run `claude --version`, or set `CLAUDE_BIN` to the
  full executable path.
- **Authentication failed:** verify with `codex login status`. OpenAI-login
  users can run `codex logout`, then `codex login`; custom-provider users should
  check their profile and environment.
- **Claude authentication failed:** run `claude auth status`, then
  `claude auth login` if needed.
- **Claude sessions are missing:** verify `CLAUDE_CONFIG_DIR`; it must point to
  the same configuration directory used by the Claude CLI process.
- **A Claude tool was denied:** Claude runs non-interactively. Adjust its
  permission mode or pre-approve only the required tools in Claude's permission
  rules; do not use `bypassPermissions` merely to hide a configuration error.
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
- **Provider protocol error:** update Codex CLI or Claude Code CLI and Codex
  Web, then restart them. The Codex app-server protocol and Claude stream
  format can change.

## Development

```bash
npm run check
npm test
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

[MIT](LICENSE)
