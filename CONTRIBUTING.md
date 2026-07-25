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

4. Do not commit API keys, Codex credentials, uploaded images, or private
   conversation data.

The Codex app-server protocol is experimental, so compatibility changes should
state the Codex CLI version used for testing.
