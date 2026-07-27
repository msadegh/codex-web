# Contributing

Thanks for helping improve Codex Web.

1. Open an issue for substantial behavior or protocol changes.
2. Keep the server localhost-only unless a complete authenticated remote
   threat model is included.
3. Run the checks before opening a pull request:

   ```bash
   npm run check
   npm test
   ```

4. Do not commit API keys, Codex or Claude credentials, uploaded images, or
   private conversation data.

The Codex app-server protocol and Claude Code's stream/session formats may
change, so compatibility changes should state the Codex CLI and Claude Code CLI
versions used for testing.
