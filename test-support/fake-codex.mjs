#!/usr/bin/env node

import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.env.FAKE_CODEX_ARGS_FILE) {
  writeFileSync(
    process.env.FAKE_CODEX_ARGS_FILE,
    JSON.stringify(process.argv.slice(2)),
  );
}

const input = createInterface({ input: process.stdin });
input.on("close", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

input.on("line", (line) => {
  if (process.env.FAKE_CODEX_MESSAGES_FILE) {
    appendFileSync(process.env.FAKE_CODEX_MESSAGES_FILE, `${line}\n`);
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!Object.hasOwn(message, "id")) return;

  let result = {};
  if (message.method === "thread/start") {
    result = {
      thread: {
        id: "test-thread",
        createdAt: Math.floor(Date.now() / 1000),
        status: { type: "idle" },
      },
    };
  } else if (message.method === "thread/list") {
    result = { data: [], nextCursor: null };
  } else if (message.method === "model/list") {
    result = { data: [] };
  }

  process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
});
