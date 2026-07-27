import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

const PUBLIC_PREFIX = "claude:";
const STORE_FILE = "conversations.json";

const MODEL_OPTIONS = [
  { id: "sonnet", model: "sonnet", displayName: "Claude Sonnet" },
  { id: "opus", model: "opus", displayName: "Claude Opus" },
  { id: "haiku", model: "haiku", displayName: "Claude Haiku" },
];

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function publicId(rawId) {
  return rawId.startsWith(PUBLIC_PREFIX) ? rawId : `${PUBLIC_PREFIX}${rawId}`;
}

function rawId(value) {
  return String(value || "").startsWith(PUBLIC_PREFIX)
    ? String(value).slice(PUBLIC_PREFIX.length)
    : String(value || "");
}

function threadView(thread) {
  return {
    id: publicId(thread.id),
    provider: "claude",
    providerThreadId: thread.id,
    name: thread.name || "گفتگوی Claude",
    cwd: thread.cwd,
    model: thread.model || "",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    status: thread.status || { type: "idle" },
    archived: Boolean(thread.archived),
  };
}

function textFromInput(input) {
  return (input || [])
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      if (part?.type === "image" || part?.type === "localImage") {
        return `[تصویر: ${part.path || part.url || "image"}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;

function messageContentBlocks(content) {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  return Array.isArray(content) ? content : [];
}

function messageText(content) {
  return messageContentBlocks(content)
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n");
}

async function transcriptSummary(filePath) {
  let firstPrompt = "";
  let title = "";
  let cwd = "";
  let createdAt = 0;
  try {
    const info = await stat(filePath);
    const input = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });
    let lines = 0;
    for await (const line of input) {
      if (++lines > 120) break;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!createdAt && entry.timestamp) {
        const timestamp = Date.parse(entry.timestamp);
        if (Number.isFinite(timestamp)) createdAt = Math.floor(timestamp / 1000);
      }
      cwd ||= entry.cwd || "";
      if (entry.type === "ai-title" && entry.aiTitle) title = entry.aiTitle;
      if (!firstPrompt && entry.type === "user") {
        firstPrompt = messageText(entry.message?.content);
      }
      if (title && firstPrompt && cwd) break;
    }
    input.close();
    return {
      cwd,
      createdAt: createdAt || Math.floor(info.birthtimeMs / 1000),
      firstPrompt,
      title,
      updatedAt: Math.floor(info.mtimeMs / 1000),
    };
  } catch {
    return null;
  }
}

async function findTranscripts(root, output = []) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry.name === "subagents") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await findTranscripts(path, output);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".jsonl") &&
      SESSION_ID_PATTERN.test(basename(entry.name, ".jsonl"))
    ) {
      output.push(path);
    }
  }
  return output;
}

export class ClaudeProvider {
  constructor({ binary, cacheDir, claudeHome, emit, log }) {
    this.binary = binary;
    this.cacheDir = cacheDir;
    this.claudeHome = claudeHome;
    this.emit = emit;
    this.log = log;
    this.threads = new Map();
    this.processes = new Map();
    this.loaded = false;
    this.writeChain = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const content = await readFile(join(this.cacheDir, STORE_FILE), "utf8");
      const data = JSON.parse(content);
      for (const thread of Array.isArray(data.threads) ? data.threads : []) {
        if (thread?.id && thread?.cwd) this.threads.set(thread.id, thread);
      }
    } catch (error) {
      if (error.code !== "ENOENT") this.log(`Could not load Claude conversations: ${error.message}`);
    }
    await this.discoverNativeThreads();
  }

  async persist() {
    await this.load();
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
      await chmod(this.cacheDir, 0o700);
      const temporary = join(this.cacheDir, `${STORE_FILE}.tmp`);
      await writeFile(
        temporary,
        JSON.stringify(
          {
            version: 1,
            threads: [...this.threads.values()].filter((thread) => !thread.native),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      await rename(temporary, join(this.cacheDir, STORE_FILE));
    });
    return this.writeChain;
  }

  async status() {
    await this.load();
    return {
      ready: Boolean(this.binary),
      available: Boolean(this.binary),
      binary: this.binary,
      message: this.binary ? "Claude Code CLI آماده است" : "Claude Code CLI پیدا نشد",
    };
  }

  async rpc(method, params = {}) {
    await this.load();
    switch (method) {
      case "account/read":
        return { account: null };
      case "model/list":
        return { data: MODEL_OPTIONS, nextCursor: null };
      case "thread/list":
        return this.listThreads(params);
      case "thread/read":
      case "thread/resume":
        return this.readThread(params.threadId);
      case "thread/start":
        return this.startThread(params);
      case "thread/archive":
      case "thread/unarchive":
        return this.archiveThread(params, method === "thread/archive");
      case "thread/setName":
        return this.setName(params);
      case "turn/start":
        return this.startTurn(params);
      case "turn/interrupt":
        return this.interruptTurn(params);
      case "turn/steer":
        throw new Error("Claude Code Web هنوز steer کردن turn را پشتیبانی نمی‌کند");
      default:
        throw new Error(`Claude provider does not support ${method}`);
    }
  }

  async listThreads(params) {
    await this.discoverNativeThreads();
    const search = String(params.searchTerm || "").trim().toLowerCase();
    const data = [...this.threads.values()]
      .filter((thread) => params.archived ? thread.archived : !thread.archived)
      .filter((thread) => {
        if (!search) return true;
        return `${thread.name} ${thread.cwd}`.toLowerCase().includes(search);
      })
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, Number(params.limit) || 100)
      .map(threadView);
    return { data, nextCursor: null };
  }

  async readThread(value) {
    const thread = this.threads.get(rawId(value));
    if (!thread) throw new Error("گفتگوی Claude پیدا نشد");
    const turns = thread.native
      ? await this.readNativeTurns(thread.transcriptPath)
      : thread.turns || [];
    return { thread: { ...threadView(thread), turns } };
  }

  async discoverNativeThreads() {
    const paths = await findTranscripts(join(this.claudeHome, "projects"));
    const summaries = await Promise.all(
      paths.map(async (transcriptPath) => ({
        transcriptPath,
        summary: await transcriptSummary(transcriptPath),
      })),
    );
    for (const { transcriptPath, summary } of summaries) {
      if (!summary) continue;
      const id = basename(transcriptPath, ".jsonl");
      if (this.threads.has(id)) continue;
      this.threads.set(id, {
        id,
        native: true,
        name: summary.title || summary.firstPrompt || "گفتگوی Claude",
        cwd: summary.cwd || process.cwd(),
        model: "",
        permissionMode: "acceptEdits",
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        status: { type: "idle" },
        archived: false,
        transcriptPath,
      });
    }
  }

  async readNativeTurns(transcriptPath) {
    const turns = [];
    let currentTurn = null;
    let title = "";
    let input;
    try {
      input = createInterface({
        input: createReadStream(transcriptPath),
        crlfDelay: Infinity,
      });
      for await (const line of input) {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.isSidechain) continue;
        if (entry.type === "ai-title" && entry.aiTitle) {
          title = entry.aiTitle;
          continue;
        }
        if (entry.type === "user") {
          const content = messageContentBlocks(entry.message?.content);
          const text = messageText(content);
          const hasToolResult = content.some((part) => part?.type === "tool_result");
          if (!text || hasToolResult) continue;
          currentTurn = {
            id: entry.uuid || randomUUID(),
            status: "completed",
            items: [
              {
                id: `${entry.uuid || randomUUID()}:user`,
                type: "userMessage",
                content: [{ type: "text", text }],
              },
            ],
          };
          turns.push(currentTurn);
          continue;
        }
        if (entry.type !== "assistant" || !currentTurn) continue;
        const content = messageContentBlocks(entry.message?.content);
        for (const block of content) {
          if (block?.type === "text" && block.text) {
            currentTurn.items.push({
              id: `${entry.uuid || randomUUID()}:assistant`,
              type: "agentMessage",
              text: block.text,
            });
          } else if (block?.type === "tool_use") {
            currentTurn.items.push({
              id: `${entry.uuid || randomUUID()}:${block.id || randomUUID()}`,
              type: "commandExecution",
              command: block.name || "Claude tool",
              status: "completed",
              input: block.input || {},
            });
          }
        }
      }
      input.close();
    } catch (error) {
      this.log(`Could not read Claude transcript ${transcriptPath}: ${error.message}`);
    }
    return turns;
  }

  async startThread(params) {
    const id = params.sessionId || randomUUID();
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error("Claude session id باید UUID معتبر باشد");
    }
    const timestamp = nowSeconds();
    const thread = {
      id,
      provider: "claude",
      name: params.name || "گفتگوی Claude",
      cwd: params.cwd || process.cwd(),
      model: params.model || "",
      permissionMode: params.permissionMode || "acceptEdits",
      createdAt: timestamp,
      updatedAt: timestamp,
      status: { type: "idle" },
      archived: false,
      turns: [],
    };
    this.threads.set(id, thread);
    await this.persist();
    return { thread: { ...threadView(thread), turns: [] } };
  }

  async archiveThread(params, archived) {
    const thread = this.threads.get(rawId(params.threadId));
    if (!thread) throw new Error("گفتگوی Claude پیدا نشد");
    thread.archived = archived;
    thread.updatedAt = nowSeconds();
    await this.persist();
    return { thread: threadView(thread) };
  }

  async setName(params) {
    const thread = this.threads.get(rawId(params.threadId));
    if (!thread) throw new Error("گفتگوی Claude پیدا نشد");
    thread.name = String(params.name || params.threadName || "گفتگوی Claude").trim();
    thread.updatedAt = nowSeconds();
    await this.persist();
    this.notify("thread/name/updated", {
      threadId: publicId(thread.id),
      name: thread.name,
      threadName: thread.name,
    });
    return { thread: threadView(thread) };
  }

  async startTurn(params) {
    const thread = this.threads.get(rawId(params.threadId));
    if (!thread) throw new Error("گفتگوی Claude پیدا نشد");
    if (this.processes.has(thread.id)) throw new Error("این گفتگوی Claude در حال اجراست");
    if (!this.binary) throw new Error("Claude Code CLI پیدا نشد؛ CLAUDE_BIN را تنظیم کنید");

    const text = textFromInput(params.input);
    if (!text.trim()) throw new Error("پیام خالی است");
    const turn = {
      id: randomUUID(),
      status: "inProgress",
      items: [],
      startedAt: nowSeconds(),
    };
    const userItem = {
      id: `${turn.id}:user`,
      type: "userMessage",
      content: [{ type: "text", text }],
    };
    const assistantItem = {
      id: `${turn.id}:assistant`,
      type: "agentMessage",
      text: "",
    };
    turn.items.push(userItem, assistantItem);
    thread.turns ||= [];
    thread.turns.push(turn);
    thread.updatedAt = nowSeconds();
    thread.status = { type: "active" };
    await this.persist();

    this.notify("thread/status/changed", { threadId: publicId(thread.id), status: thread.status });
    this.notify("turn/started", {
      threadId: publicId(thread.id),
      turn: { id: turn.id, status: "inProgress" },
    });
    this.notify("item/started", {
      threadId: publicId(thread.id),
      turnId: turn.id,
      item: userItem,
    });
    this.notify("item/started", {
      threadId: publicId(thread.id),
      turnId: turn.id,
      item: assistantItem,
    });

    void this.runTurn(thread, turn, assistantItem, text, params);
    return { turn: { id: turn.id, status: "inProgress", items: turn.items } };
  }

  buildArgs(thread, params) {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--input-format",
      "text",
    ];
    const hasPreviousTurn = thread.native || (thread.turns || []).length > 1;
    if (hasPreviousTurn) args.push("--resume", thread.id);
    else args.push("--session-id", thread.id);
    const model = params.model || thread.model;
    if (model) args.push("--model", model);
    const permissionMode = params.permissionMode || thread.permissionMode;
    if (permissionMode) args.push("--permission-mode", permissionMode);
    if (permissionMode === "bypassPermissions") {
      args.push("--allow-dangerously-skip-permissions");
    }
    return args;
  }

  async runTurn(thread, turn, assistantItem, text, params) {
    let processState;
    try {
      const child = spawn(this.binary, this.buildArgs(thread, params), {
        cwd: thread.cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      processState = {
        child,
        interrupted: false,
        resultSeen: false,
        streamedText: false,
        toolItems: new Map(),
      };
      this.processes.set(thread.id, processState);
      const stderr = [];

      child.on("error", (error) => {
        this.log(`Claude Code error: ${error.message}`);
        this.finishTurn(thread, turn, assistantItem, "failed", error.message, processState);
      });
      createInterface({ input: child.stderr }).on("line", (line) => {
        stderr.push(line);
        if (stderr.length > 12) stderr.shift();
        this.log(`[claude] ${line}`);
      });
      createInterface({ input: child.stdout }).on("line", (line) => {
        this.handleLine(thread, turn, assistantItem, processState, line);
      });
      child.on("close", (code, signal) => {
        if (processState.resultSeen) return;
        if (processState.interrupted) {
          this.finishTurn(thread, turn, assistantItem, "interrupted", null, processState);
          return;
        }
        const detail = stderr.join("\n");
        this.finishTurn(
          thread,
          turn,
          assistantItem,
          code === 0 ? "completed" : "failed",
          code === 0 ? null : detail || `Claude Code exited (${signal || code})`,
          processState,
        );
      });
      child.stdin.on("error", (error) => {
        if (error.code !== "EPIPE") this.log(`Claude Code stdin error: ${error.message}`);
      });
      if (child.stdin.writable) child.stdin.end(text);
    } catch (error) {
      this.finishTurn(thread, turn, assistantItem, "failed", error.message, processState);
    }
  }

  handleLine(thread, turn, assistantItem, processState, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.log(`[claude] invalid JSON: ${line}`);
      return;
    }
    if (message.type === "stream_event") {
      const delta = message.event?.delta || {};
      if (delta.type === "text_delta" && delta.text) {
        processState.streamedText = true;
        assistantItem.text += delta.text;
        this.notify("item/agentMessage/delta", {
          threadId: publicId(thread.id),
          turnId: turn.id,
          itemId: assistantItem.id,
          delta: delta.text,
        });
      }
      return;
    }
    if (message.type === "assistant") {
      for (const block of message.message?.content || []) {
        if (block.type === "text" && block.text && !processState.streamedText) {
          processState.streamedText = true;
          assistantItem.text += block.text;
          this.notify("item/agentMessage/delta", {
            threadId: publicId(thread.id),
            turnId: turn.id,
            itemId: assistantItem.id,
            delta: block.text,
          });
        }
        if (block.type === "tool_use") this.notifyTool(thread, turn, block, processState);
      }
      return;
    }
    if (message.type === "user") {
      for (const block of message.message?.content || []) {
        if (block.type === "tool_result") {
          const toolItem = processState.toolItems.get(block.tool_use_id);
          const output =
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content || "");
          if (toolItem) {
            toolItem.status = "completed";
            toolItem.aggregatedOutput = output;
            this.notify("item/completed", {
              threadId: publicId(thread.id),
              turnId: turn.id,
              item: toolItem,
            });
            continue;
          }
          this.notify("item/commandExecution/outputDelta", {
            threadId: publicId(thread.id),
            turnId: turn.id,
            itemId: `${turn.id}:${block.tool_use_id || "tool"}`,
            delta: output,
          });
        }
      }
      return;
    }
    if (message.type === "result") {
      processState.resultSeen = true;
      if (!processState.streamedText && message.result) {
        assistantItem.text += String(message.result);
        this.notify("item/agentMessage/delta", {
          threadId: publicId(thread.id),
          turnId: turn.id,
          itemId: assistantItem.id,
          delta: String(message.result),
        });
      }
      this.finishTurn(
        thread,
        turn,
        assistantItem,
        message.is_error ? "failed" : "completed",
        message.is_error ? String(message.result || message.subtype || "Claude Code failed") : null,
        processState,
      );
    }
  }

  notifyTool(thread, turn, block, processState) {
    const toolId = block.id || randomUUID();
    const item = {
      id: `${turn.id}:${toolId}`,
      type: "commandExecution",
      command: block.name || "Claude tool",
      status: "inProgress",
      input: block.input || {},
    };
    processState.toolItems.set(toolId, item);
    turn.items.push(item);
    this.notify("item/started", {
      threadId: publicId(thread.id),
      turnId: turn.id,
      item,
    });
  }

  async finishTurn(thread, turn, assistantItem, status, errorMessage, processState) {
    if (turn.status !== "inProgress") return;
    turn.status = status;
    turn.completedAt = nowSeconds();
    if (errorMessage) turn.error = { message: errorMessage };
    thread.status = { type: "idle" };
    thread.updatedAt = nowSeconds();
    if (this.processes.get(thread.id) === processState) this.processes.delete(thread.id);
    await this.persist();
    this.notify("item/completed", {
      threadId: publicId(thread.id),
      turnId: turn.id,
      item: assistantItem,
    });
    this.notify("turn/completed", {
      threadId: publicId(thread.id),
      turn: { id: turn.id, status, error: turn.error },
    });
    this.notify("thread/status/changed", { threadId: publicId(thread.id), status: thread.status });
  }

  async interruptTurn(params) {
    const thread = this.threads.get(rawId(params.threadId));
    const processState = thread && this.processes.get(thread.id);
    if (!processState) return { turn: null };
    processState.interrupted = true;
    processState.child.kill("SIGTERM");
    return { ok: true };
  }

  notify(method, params) {
    this.emit({ method, params: { ...params, provider: "claude" } });
  }

  stop() {
    for (const processState of this.processes.values()) {
      processState.interrupted = true;
      processState.child.kill("SIGTERM");
    }
    this.processes.clear();
  }
}
