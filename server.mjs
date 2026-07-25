#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(PACKAGE.version);
  process.exit(0);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Codex Web ${PACKAGE.version}

Usage:
  codex-web [CODEX_OPTIONS]

Web options:
  --no-open                 Do not open a browser automatically
  -h, --help                Show this help
  -V, --version             Show the version

Codex options translated by Codex Web:
  -p, --profile NAME        Load top-level scalar settings from the named Codex profile
  -s, --sandbox MODE        Default sandbox for new and resumed threads
  -a, --ask-for-approval P  Default approval policy for new and resumed threads
  --yolo                    Disable approvals and sandboxing (dangerous)
  --search                  Enable live web search

Global Codex configuration options such as -c, --enable, --disable, and
--strict-config are forwarded. The server always listens on 127.0.0.1.

Environment:
  CODEX_WEB_PORT            HTTP port (default: 4173)
  CODEX_WEB_CWD             Default working directory (default: current directory)
  CODEX_WEB_NO_OPEN=1       Do not open a browser automatically
  CODEX_WEB_UPLOAD_DIR      Image upload cache directory
  CODEX_BIN                 Codex executable (default: codex)`);
  process.exit(0);
}

const HOST = "127.0.0.1";
const PORT = parsePort(process.env.CODEX_WEB_PORT ?? "4173");
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const DEFAULT_CWD = process.env.CODEX_WEB_CWD || process.cwd();
const WEB_ARGS = new Set(["--no-open", "--help", "-h", "--version", "-V"]);
const RAW_CODEX_ARGS = process.argv.slice(2).filter((arg) => !WEB_ARGS.has(arg));
const { serverArgs: CODEX_ARGS, threadDefaults: CLI_THREAD_DEFAULTS } =
  prepareCodexArgs(RAW_CODEX_ARGS);
const SHOULD_OPEN = !process.argv.includes("--no-open") && process.env.CODEX_WEB_NO_OPEN !== "1";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const CACHE_HOME =
  process.env.XDG_CACHE_HOME ||
  (process.platform === "win32" && process.env.LOCALAPPDATA) ||
  join(os.homedir(), ".cache");
const UPLOAD_DIR = resolve(
  process.env.CODEX_WEB_UPLOAD_DIR || join(CACHE_HOME, "codex-web", "uploads"),
);

const IMAGE_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
  ["image/bmp", ".bmp"],
]);

const RPC_ALLOWLIST = new Set([
  "account/read",
  "account/rateLimits/read",
  "model/list",
  "thread/list",
  "thread/read",
  "thread/start",
  "thread/resume",
  "thread/archive",
  "thread/unarchive",
  "thread/setName",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
]);

const HUMAN_INTERACTION_METHODS = new Set([
  "applyPatchApproval",
  "execCommandApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const clients = new Set();
const pendingServerRequests = new Map();

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CODEX_WEB_PORT: ${value}`);
  }
  return port;
}

function stripTomlComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") return line.slice(0, index);
  }
  return line;
}

function readProfileOverrides(profileName) {
  if (!/^[A-Za-z0-9_-]+$/.test(profileName)) {
    throw new Error(`Invalid Codex profile name: ${profileName}`);
  }
  const codexHome = process.env.CODEX_HOME || join(os.homedir(), ".codex");
  const profilePath = join(codexHome, `${profileName}.config.toml`);
  let content;
  try {
    content = readFileSync(profilePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read Codex profile ${profileName} at ${profilePath}: ${error.message}`);
  }

  const overrides = [];
  let insideTable = false;
  for (const sourceLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(sourceLine).trim();
    if (!line) continue;
    if (line.startsWith("[")) {
      insideTable = true;
      continue;
    }
    if (insideTable) continue;
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    overrides.push(`${assignment[1]}=${assignment[2].trim()}`);
  }
  return overrides;
}

function prepareCodexArgs(args) {
  const serverArgs = [];
  const threadDefaults = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    let profileName = null;
    if (argument === "-p" || argument === "--profile") {
      profileName = args[index + 1];
      if (!profileName) throw new Error(`${argument} requires a profile name`);
      index += 1;
    } else if (argument.startsWith("--profile=")) {
      profileName = argument.slice("--profile=".length);
    } else if (argument.startsWith("-p") && !argument.startsWith("--") && argument.length > 2) {
      profileName = argument.slice(2);
    }

    if (profileName !== null) {
      for (const override of readProfileOverrides(profileName)) {
        serverArgs.push("-c", override);
      }
    } else if (
      argument === "--yolo" ||
      argument === "--dangerously-bypass-approvals-and-sandbox"
    ) {
      threadDefaults.approvalPolicy = "never";
      threadDefaults.sandbox = "danger-full-access";
    } else if (argument === "--search") {
      serverArgs.push("-c", 'web_search="live"');
    } else if (argument === "-s" || argument === "--sandbox") {
      const sandbox = args[index + 1];
      if (!sandbox) throw new Error(`${argument} requires a sandbox mode`);
      threadDefaults.sandbox = sandbox;
      index += 1;
    } else if (argument.startsWith("--sandbox=")) {
      threadDefaults.sandbox = argument.slice("--sandbox=".length);
    } else if (argument === "-a" || argument === "--ask-for-approval") {
      const approvalPolicy = args[index + 1];
      if (!approvalPolicy) throw new Error(`${argument} requires an approval policy`);
      threadDefaults.approvalPolicy = approvalPolicy;
      index += 1;
    } else if (argument.startsWith("--ask-for-approval=")) {
      threadDefaults.approvalPolicy = argument.slice("--ask-for-approval=".length);
    } else {
      serverArgs.push(argument);
    }
  }
  return { serverArgs, threadDefaults };
}

function applyCliThreadDefaults(method, params) {
  if (method !== "thread/start" && method !== "thread/resume") return params;
  const effective = { ...params };
  if (
    CLI_THREAD_DEFAULTS.approvalPolicy &&
    !Object.hasOwn(effective, "approvalPolicy")
  ) {
    effective.approvalPolicy = CLI_THREAD_DEFAULTS.approvalPolicy;
  }
  if (CLI_THREAD_DEFAULTS.sandbox && !Object.hasOwn(effective, "sandbox")) {
    effective.sandbox = CLI_THREAD_DEFAULTS.sandbox;
  }
  return effective;
}

function idKey(id) {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function interactionThreadId(request) {
  const threadId = request?.params?.threadId ?? request?.params?.conversationId;
  return typeof threadId === "string" && threadId ? threadId : null;
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function ssePayload(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function broadcast(event, data) {
  const payload = ssePayload(event, data);
  for (const client of clients) {
    client.write(payload);
  }
}

function resolvePendingServerRequest(id, fallbackThreadId = null) {
  const key = idKey(id);
  const request = pendingServerRequests.get(key);
  if (!request) return false;

  pendingServerRequests.delete(key);
  broadcast("request-resolved", {
    id,
    threadId: interactionThreadId(request) ?? fallbackThreadId,
  });
  return true;
}

async function readJson(req) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.status = 415;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Invalid JSON");
    error.status = 400;
    throw error;
  }
}

function requestImageType(req) {
  const contentType = req.headers["content-type"] || "";
  const type = contentType.split(";", 1)[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) {
    const error = new Error("Content-Type must be a supported image type");
    error.status = 415;
    throw error;
  }
  return type;
}

function requestImageName(req) {
  const header = req.headers["x-file-name"];
  if (typeof header !== "string" || !header || header.length > 1024) {
    const error = new Error("X-File-Name header is required");
    error.status = 400;
    throw error;
  }

  let name;
  try {
    name = decodeURIComponent(header);
  } catch {
    const error = new Error("X-File-Name must be URL-encoded");
    error.status = 400;
    throw error;
  }

  const leaf = name.replaceAll("\\", "/").split("/").pop()?.trim() || "";
  if (!leaf) {
    const error = new Error("Image file name is invalid");
    error.status = 400;
    throw error;
  }
  return leaf;
}

async function readImage(req) {
  const contentLength = req.headers["content-length"];
  if (contentLength !== undefined) {
    const declaredSize = Number(contentLength);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
      const error = new Error("Content-Length is invalid");
      error.status = 400;
      throw error;
    }
    if (declaredSize > MAX_IMAGE_BYTES) {
      const error = new Error("Image is larger than 25 MiB");
      error.status = 413;
      throw error;
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) {
      const error = new Error("Image is larger than 25 MiB");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) {
    const error = new Error("Image body is empty");
    error.status = 400;
    throw error;
  }
  return Buffer.concat(chunks, size);
}

function imageBytesMatchType(type, bytes) {
  if (type === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  }
  if (type === "image/gif") {
    const signature = bytes.toString("ascii", 0, 6);
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (type === "image/avif") {
    if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
    const boxSize = bytes.readUInt32BE(0);
    const brandEnd = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length);
    for (let offset = 8; offset + 4 <= brandEnd; offset += 4) {
      if (["avif", "avis"].includes(bytes.toString("ascii", offset, offset + 4))) {
        return true;
      }
    }
    return false;
  }
  if (type === "image/bmp") {
    return bytes.length >= 2 && bytes.toString("ascii", 0, 2) === "BM";
  }
  return false;
}

function imageUploadName(originalName, type) {
  const originalExtension = extname(originalName);
  const originalStem = originalName.slice(0, originalName.length - originalExtension.length);
  const sanitizedStem = originalStem
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  let safeStem = "";
  let safeStemBytes = 0;
  for (const character of sanitizedStem) {
    const characterBytes = Buffer.byteLength(character);
    if (safeStemBytes + characterBytes > 160) break;
    safeStem += character;
    safeStemBytes += characterBytes;
  }
  return `${randomUUID()}-${safeStem || "image"}${IMAGE_TYPES.get(type)}`;
}

function isSameOrigin(req) {
  const host = req.headers.host || "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${host}`;
}

class CodexBridge {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.starting = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrTail = [];
    this.stopping = false;
  }

  async start() {
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.#start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async #start() {
    this.stopping = false;
    this.stderrTail = [];
    const proc = spawn(CODEX_BIN, [...CODEX_ARGS, "app-server", "--stdio"], {
      cwd: DEFAULT_CWD,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;

    proc.on("error", (error) => this.#handleExit(error));
    proc.on("exit", (code, signal) => {
      if (this.proc !== proc) return;
      const detail = this.stderrTail.join("\n");
      this.#handleExit(
        new Error(
          `codex app-server exited (${signal || (code ?? "unknown")})${detail ? `: ${detail}` : ""}`,
        ),
      );
    });

    createInterface({ input: proc.stdout }).on("line", (line) => {
      if (this.proc === proc) this.#handleLine(line);
    });
    createInterface({ input: proc.stderr }).on("line", (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 12) this.stderrTail.shift();
      broadcast("log", { level: "stderr", message: line });
    });

    try {
      await this.rpc("initialize", {
        clientInfo: {
          name: "codex_web",
          title: "Codex Web",
          version: PACKAGE.version,
        },
        capabilities: {
          experimentalApi: true,
        },
      });
      this.notify("initialized", {});
      this.ready = true;
      broadcast("status", { ready: true, message: "Codex app-server connected" });
    } catch (error) {
      if (this.proc === proc) {
        this.proc = null;
        proc.kill("SIGTERM");
      }
      throw error;
    }
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      broadcast("log", { level: "warning", message: `Invalid app-server JSON: ${line}` });
      return;
    }

    if (message.method === "currentTime/read" && Object.hasOwn(message, "id")) {
      this.sendResponse(message.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
      return;
    }

    if (message.method && Object.hasOwn(message, "id")) {
      if (HUMAN_INTERACTION_METHODS.has(message.method)) {
        if (!interactionThreadId(message)) {
          this.write({
            id: message.id,
            error: {
              code: -32602,
              message: "User interaction is missing threadId/conversationId",
            },
          });
          return;
        }
        pendingServerRequests.set(idKey(message.id), message);
      } else {
        this.write({
          id: message.id,
          error: {
            code: -32601,
            message: `Codex Web does not provide the client method ${message.method}`,
          },
        });
        broadcast("log", {
          level: "warning",
          message: `Unsupported app-server request rejected: ${message.method}`,
        });
        return;
      }
    }

    if (message.method === "serverRequest/resolved") {
      const requestId = message.params?.requestId;
      if (requestId !== undefined) {
        resolvePendingServerRequest(requestId, message.params?.threadId ?? null);
      }
    }

    if (Object.hasOwn(message, "id") && !message.method) {
      const key = idKey(message.id);
      const pending = this.pending.get(key);
      if (pending) {
        this.pending.delete(key);
        clearTimeout(pending.timer);
        if (message.error) {
          const error = new Error(message.error.message || "Codex RPC error");
          error.rpcError = message.error;
          pending.reject(error);
        } else {
          pending.resolve(message.result);
        }
      }
    }

    broadcast("rpc", message);
  }

  #handleExit(error) {
    if (!this.proc && !this.starting) return;
    this.ready = false;
    this.proc = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    pendingServerRequests.clear();
    broadcast("pending-interactions", { requests: [] });
    broadcast("status", { ready: false, message: error.message });
  }

  write(message) {
    if (!this.proc?.stdin?.writable) throw new Error("Codex app-server is not running");
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  rpc(method, params = {}, timeoutMs = 60_000) {
    if (!this.proc?.stdin?.writable) return Promise.reject(new Error("Codex app-server is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(idKey(id));
        reject(new Error(`Codex RPC timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(idKey(id), { resolve, reject, timer });
      this.write({ method, id, params });
    });
  }

  notify(method, params = {}) {
    this.write({ method, params });
  }

  sendResponse(id, result) {
    this.write({ id, result });
    resolvePendingServerRequest(id);
  }

  async restart() {
    this.ready = false;
    const restartError = new Error("Codex app-server is restarting");
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(restartError);
    }
    this.pending.clear();
    pendingServerRequests.clear();
    broadcast("pending-interactions", { requests: [] });
    if (this.proc) {
      const old = this.proc;
      this.proc = null;
      old.kill("SIGTERM");
    }
    await this.start();
  }

  stop() {
    this.stopping = true;
    this.proc?.kill("SIGTERM");
    this.proc = null;
    this.ready = false;
  }
}

const bridge = new CodexBridge();

async function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(requestPath);
  const filePath = resolve(PUBLIC_DIR, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  const relativePath = relative(PUBLIC_DIR, filePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return json(res, 403, { error: "Forbidden" });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": extname(filePath) === ".html" ? "no-store" : "no-cache",
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; connect-src 'self'; script-src 'self'; style-src 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    createReadStream(filePath).pipe(res);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname.startsWith("/api/") && !isSameOrigin(req)) {
      return json(res, 403, { error: "Only same-origin localhost requests are allowed" });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 1000\nevent: status\ndata: ${JSON.stringify({
        ready: bridge.ready,
        message: bridge.ready ? "connected" : "starting",
      })}\n\n`);
      res.write(
        ssePayload("pending-interactions", {
          requests: [...pendingServerRequests.values()],
        }),
      );
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, 200, {
        ready: bridge.ready,
        codexBin: CODEX_BIN,
        cwd: DEFAULT_CWD,
        port: PORT,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/uploads/images") {
      const type = requestImageType(req);
      const originalName = requestImageName(req);
      const bytes = await readImage(req);
      if (!imageBytesMatchType(type, bytes)) {
        return json(res, 415, { error: "Image bytes do not match Content-Type" });
      }

      await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
      await chmod(UPLOAD_DIR, 0o700);
      const name = imageUploadName(originalName, type);
      const path = join(UPLOAD_DIR, name);
      try {
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code !== "EEXIST") await unlink(path).catch(() => {});
        throw error;
      }
      return json(res, 201, { path, name, size: bytes.length, type });
    }

    if (req.method === "POST" && url.pathname === "/api/rpc") {
      const body = await readJson(req);
      if (!RPC_ALLOWLIST.has(body.method)) {
        return json(res, 403, { error: `RPC method is not allowed: ${body.method}` });
      }
      await bridge.start();
      const params = applyCliThreadDefaults(body.method, body.params || {});
      const result = await bridge.rpc(body.method, params);
      return json(res, 200, { result });
    }

    if (req.method === "POST" && url.pathname === "/api/respond") {
      const body = await readJson(req);
      if (!Object.hasOwn(body, "id")) {
        return json(res, 400, { error: "Interaction id is required" });
      }
      const request = pendingServerRequests.get(idKey(body.id));
      if (!request) return json(res, 404, { error: "Approval/input request is no longer pending" });
      if (!HUMAN_INTERACTION_METHODS.has(request.method)) {
        return json(res, 409, { error: "Pending request is not a user interaction" });
      }
      const requestThreadId = interactionThreadId(request);
      if (typeof body.threadId !== "string" || !body.threadId) {
        return json(res, 400, { error: "threadId is required" });
      }
      if (!requestThreadId) {
        return json(res, 409, { error: "Pending interaction has no valid threadId" });
      }
      if (body.threadId !== requestThreadId) {
        return json(res, 409, { error: "Interaction belongs to another thread" });
      }
      bridge.sendResponse(
        body.id,
        Object.hasOwn(body, "result") ? body.result : {},
      );
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/restart") {
      await readJson(req);
      await bridge.restart();
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res, url);
    }

    json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error.status || 500;
    json(res, status, {
      error: error.message || "Unexpected server error",
      details: error.rpcError || undefined,
    });
  }
});

server.on("error", (error) => {
  console.error(`Could not start Codex Web: ${error.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, async () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`Codex Web is available at ${url}`);
  console.log(`Working directory default: ${DEFAULT_CWD}`);

  bridge.start().catch((error) => {
    console.error(`Could not connect to Codex app-server: ${error.message}`);
  });

  if (SHOULD_OPEN) {
    const command =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : ["xdg-open", [url]];
    const opener = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
    opener.on("error", () => {});
    opener.unref();
  }
});

const heartbeat = setInterval(() => {
  for (const client of clients) client.write(": heartbeat\n\n");
}, 20_000);
heartbeat.unref();

function shutdown() {
  clearInterval(heartbeat);
  bridge.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
