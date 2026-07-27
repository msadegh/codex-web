#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const sessionIndex = args.indexOf("--session-id");
const resumeIndex = args.indexOf("--resume");
const sessionId =
  sessionIndex >= 0
    ? args[sessionIndex + 1]
    : resumeIndex >= 0
      ? args[resumeIndex + 1]
      : "fake-session";
const logFile = process.env.FAKE_CLAUDE_LIFECYCLE_LOG;
const sessionDir = process.env.FAKE_CLAUDE_SESSION_DIR;

function log(value) {
  if (logFile) appendFileSync(logFile, `${JSON.stringify(value)}\n`);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  log({
    args,
    configDir: process.env.CLAUDE_CONFIG_DIR || "",
    event: "start",
    pid: process.pid,
    prompt,
    sessionId,
  });

  if (sessionDir) {
    mkdirSync(sessionDir, { recursive: true });
    const marker = join(sessionDir, sessionId);
    if (resumeIndex >= 0 && !existsSync(marker)) {
      emit({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: [`No conversation found with session ID: ${sessionId}`],
        session_id: sessionId,
      });
      process.exitCode = 1;
      return;
    }
    if (sessionIndex >= 0) writeFileSync(marker, "");
  }

  if (prompt.includes("__before_init_fail__")) {
    process.stderr.write("failed before session initialization\n");
    process.exitCode = 1;
    return;
  }

  emit({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model: "sonnet",
  });

  if (prompt.includes("__hold__") || prompt.includes("__ignore_term__")) {
    process.on("SIGTERM", () => {
      log({ event: "sigterm", pid: process.pid, sessionId });
      if (prompt.includes("__ignore_term__")) return;
      process.exit(0);
    });
    setInterval(() => {}, 1_000);
    return;
  }

  if (prompt.includes("__assistant_blocks__")) {
    const first = "بخش اول\n";
    const second = "بخش دوم";
    emit({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: first },
          { type: "text", text: second },
        ],
      },
      session_id: sessionId,
    });
    emit({
      type: "result",
      subtype: "success",
      is_error: false,
      result: `${first}${second}`,
      session_id: sessionId,
    });
    return;
  }

  const text = `Claude: ${prompt}`;
  emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  });
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: sessionId,
  });

  if (prompt.includes("__delay_result__")) {
    setTimeout(() => {
      log({ event: "delayed-exit", pid: process.pid, sessionId });
    }, 300);
  }
});
