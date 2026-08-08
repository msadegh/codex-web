#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import os from "node:os";
import { ClaudeProvider } from "./providers/claude-provider.mjs";

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
  CODEX_BIN                 Codex executable (default: codex)
  CLAUDE_BIN                Claude Code executable (default: claude)
  CLAUDE_CONFIG_DIR         Claude Code config/session directory (default: ~/.claude)
  CLAUDE_WEB_DATA_DIR       Claude Web conversation metadata directory`);
  process.exit(0);
}

const HOST = "127.0.0.1";
const PORT = parsePort(process.env.CODEX_WEB_PORT ?? "4173");
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_CONFIG_DIR = resolve(
  process.env.CLAUDE_CONFIG_DIR ||
    process.env.CLAUDE_HOME ||
    join(os.homedir(), ".claude"),
);
const CODEX_HOME = resolve(process.env.CODEX_HOME || join(os.homedir(), ".codex"));
const CODEX_SESSIONS_DIR = join(CODEX_HOME, "sessions");
const CODEX_ARCHIVED_SESSIONS_DIR = join(CODEX_HOME, "archived_sessions");
const DEFAULT_CWD = process.env.CODEX_WEB_CWD || process.cwd();
const WEB_ARGS = new Set(["--no-open", "--help", "-h", "--version", "-V"]);
const RAW_CODEX_ARGS = process.argv.slice(2).filter((arg) => !WEB_ARGS.has(arg));
const { serverArgs: CODEX_ARGS, threadDefaults: CLI_THREAD_DEFAULTS } =
  prepareCodexArgs(RAW_CODEX_ARGS);
const SHOULD_OPEN = !process.argv.includes("--no-open") && process.env.CODEX_WEB_NO_OPEN !== "1";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_SESSION_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_SESSION_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_ASSET_BYTES = MAX_IMAGE_BYTES;
const MAX_SESSION_ASSET_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_SESSION_ASSET_COUNT = 200;
const MAX_SESSION_BUNDLE_BYTES = 200 * 1024 * 1024;
const SESSION_BUNDLE_FORMAT = "codex-web-session";
const SESSION_BUNDLE_VERSION = 2;
const LEGACY_SESSION_BUNDLE_VERSION = 1;
const SESSION_BUNDLE_MAGIC = Buffer.from("CODEXWEBSESSION2\n", "ascii");
const CODEX_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE_HOME =
  process.env.XDG_CACHE_HOME ||
  (process.platform === "win32" && process.env.LOCALAPPDATA) ||
  join(os.homedir(), ".cache");
const UPLOAD_DIR = resolve(
  process.env.CODEX_WEB_UPLOAD_DIR || join(CACHE_HOME, "codex-web", "uploads"),
);
const CLAUDE_DATA_DIR = resolve(
  process.env.CLAUDE_WEB_DATA_DIR || join(CACHE_HOME, "codex-web", "claude"),
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
  "collaborationMode/list",
  "model/list",
  "thread/list",
  "thread/read",
  "thread/start",
  "thread/resume",
  "thread/archive",
  "thread/unarchive",
  "thread/compact/start",
  "thread/setName",
  "thread/goal/set",
  "thread/goal/get",
  "thread/goal/clear",
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
  const profilePath = join(CODEX_HOME, `${profileName}.config.toml`);
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

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readLimitedBody(req, maxBytes, label) {
  const contentLength = req.headers["content-length"];
  if (contentLength !== undefined) {
    const declaredSize = Number(contentLength);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
      throw httpError("Content-Length is invalid", 400);
    }
    if (declaredSize > maxBytes) {
      throw httpError(`${label} is too large`, 413);
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(`${label} is too large`, 413);
    chunks.push(chunk);
  }
  if (size === 0) throw httpError(`${label} is empty`, 400);
  return Buffer.concat(chunks, size);
}

function pathInside(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

async function allowedRolloutPath(candidate) {
  if (typeof candidate !== "string" || !isAbsolute(candidate)) {
    throw httpError("Codex did not provide a valid session path", 409);
  }
  let resolvedPath;
  try {
    resolvedPath = await realpath(candidate);
  } catch {
    throw httpError("The Codex session file no longer exists", 404);
  }
  for (const root of [CODEX_SESSIONS_DIR, CODEX_ARCHIVED_SESSIONS_DIR]) {
    try {
      const resolvedRoot = await realpath(root);
      if (pathInside(resolvedRoot, resolvedPath)) return resolvedPath;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw httpError("Codex session path is outside CODEX_HOME", 403);
}

function validateRollout(rollout, expectedId) {
  if (typeof rollout !== "string" || Buffer.byteLength(rollout) > MAX_SESSION_FILE_BYTES) {
    throw httpError("Session history is too large", 413);
  }
  let metadata = null;
  const localImagePaths = new Set();
  for (const line of rollout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (!metadata) metadata = record;
      if (
        record?.type === "event_msg" &&
        record.payload?.type === "user_message" &&
        Array.isArray(record.payload.local_images)
      ) {
        for (const path of record.payload.local_images) {
          if (typeof path === "string" && isAbsolute(path)) localImagePaths.add(path);
        }
      }
    } catch {
      throw httpError("Session history contains invalid JSONL", 400);
    }
  }
  if (metadata?.type !== "session_meta" || !metadata.payload) {
    throw httpError("Session history is missing session metadata", 400);
  }
  const id = metadata.payload.id;
  const sessionId = metadata.payload.session_id;
  if (
    !CODEX_SESSION_ID_PATTERN.test(expectedId) ||
    (id !== undefined ? id !== expectedId : sessionId !== expectedId)
  ) {
    throw httpError("Session history id does not match the bundle", 400);
  }
  return { metadata: metadata.payload, localImagePaths: [...localImagePaths] };
}

function validateSessionManifest(bundle, expectedVersion) {
  if (
    bundle?.format !== SESSION_BUNDLE_FORMAT ||
    bundle?.version !== expectedVersion ||
    bundle?.provider !== "codex"
  ) {
    throw httpError("Session bundle format or version is not supported", 400);
  }
  if (!bundle.thread || typeof bundle.thread.id !== "string") {
    throw httpError("Session bundle is missing thread metadata", 400);
  }
  if (
    bundle.thread.name !== null &&
    bundle.thread.name !== undefined &&
    (typeof bundle.thread.name !== "string" || Buffer.byteLength(bundle.thread.name) > 4096)
  ) {
    throw httpError("Session bundle contains an invalid thread name", 400);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function imageTypeFromBytes(bytes) {
  for (const type of IMAGE_TYPES.keys()) {
    if (imageBytesMatchType(type, bytes)) return type;
  }
  return null;
}

async function collectSessionAssets(paths) {
  if (paths.length > MAX_SESSION_ASSET_COUNT) {
    throw httpError(`Session references more than ${MAX_SESSION_ASSET_COUNT} local images`, 413);
  }
  const byDigest = new Map();
  const missingAssets = [];
  let totalSize = 0;
  for (const originalPath of paths) {
    try {
      const resolvedPath = await realpath(originalPath);
      const before = await stat(resolvedPath);
      if (!before.isFile()) throw new Error("not a file");
      if (before.size > MAX_SESSION_ASSET_BYTES) throw new Error("larger than 25 MiB");
      const bytes = await readFile(resolvedPath);
      const after = await stat(resolvedPath);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ino !== after.ino
      ) {
        throw httpError(`Image changed while exporting: ${originalPath}`, 409);
      }
      const type = imageTypeFromBytes(bytes);
      if (!type) throw new Error("unsupported image data");
      const digest = sha256(bytes);
      const existing = byDigest.get(digest);
      if (existing) {
        existing.paths.push(originalPath);
        continue;
      }
      totalSize += bytes.length;
      if (totalSize > MAX_SESSION_ASSET_TOTAL_BYTES) {
        throw httpError("Images referenced by this session are larger than 128 MiB in total", 413);
      }
      byDigest.set(digest, {
        bytes,
        name: basename(originalPath).slice(0, 1024) || `image${IMAGE_TYPES.get(type)}`,
        paths: [originalPath],
        sha256: digest,
        size: bytes.length,
        type,
      });
    } catch (error) {
      if (error.status) throw error;
      missingAssets.push({ path: originalPath, reason: error.message || "unavailable" });
    }
  }
  return { assets: [...byDigest.values()], missingAssets };
}

function buildSessionBundle(manifest, rolloutBytes, assets) {
  const headerBytes = Buffer.from(JSON.stringify({
    ...manifest,
    rolloutSize: rolloutBytes.length,
    assets: assets.map(({ bytes, ...asset }) => asset),
  }));
  if (headerBytes.length > 4 * 1024 * 1024) {
    throw httpError("Session asset manifest is too large", 413);
  }
  const headerSize = Buffer.allocUnsafe(4);
  headerSize.writeUInt32BE(headerBytes.length);
  const unpacked = Buffer.concat([
    SESSION_BUNDLE_MAGIC,
    headerSize,
    headerBytes,
    rolloutBytes,
    ...assets.map((asset) => asset.bytes),
  ]);
  if (unpacked.length > MAX_SESSION_BUNDLE_BYTES) {
    throw httpError("Session bundle is too large", 413);
  }
  return gzipSync(unpacked, { level: 9 });
}

function parseBinarySessionBundle(unpacked) {
  const sizeOffset = SESSION_BUNDLE_MAGIC.length;
  if (unpacked.length < sizeOffset + 4) throw httpError("Session bundle is truncated", 400);
  const headerSize = unpacked.readUInt32BE(sizeOffset);
  if (headerSize < 2 || headerSize > 4 * 1024 * 1024) {
    throw httpError("Session bundle manifest is invalid", 400);
  }
  const headerStart = sizeOffset + 4;
  const headerEnd = headerStart + headerSize;
  if (headerEnd > unpacked.length) throw httpError("Session bundle is truncated", 400);
  let bundle;
  try {
    bundle = JSON.parse(unpacked.toString("utf8", headerStart, headerEnd));
  } catch {
    throw httpError("Session bundle manifest contains invalid JSON", 400);
  }
  validateSessionManifest(bundle, SESSION_BUNDLE_VERSION);
  if (
    !Number.isSafeInteger(bundle.rolloutSize) ||
    bundle.rolloutSize < 1 ||
    bundle.rolloutSize > MAX_SESSION_FILE_BYTES
  ) {
    throw httpError("Session bundle contains an invalid history size", 400);
  }
  if (!Array.isArray(bundle.assets) || bundle.assets.length > MAX_SESSION_ASSET_COUNT) {
    throw httpError("Session bundle contains an invalid asset list", 400);
  }
  let offset = headerEnd;
  const rolloutEnd = offset + bundle.rolloutSize;
  if (rolloutEnd > unpacked.length) throw httpError("Session history is truncated", 400);
  const rolloutBytes = unpacked.subarray(offset, rolloutEnd);
  const rollout = rolloutBytes.toString("utf8");
  const { metadata: sessionMetadata } = validateRollout(rollout, bundle.thread.id);
  offset = rolloutEnd;
  let totalAssetSize = 0;
  const sourcePaths = new Set();
  const assets = [];
  for (const metadata of bundle.assets) {
    if (
      !metadata ||
      !Array.isArray(metadata.paths) ||
      metadata.paths.length < 1 ||
      metadata.paths.some((path) => typeof path !== "string" || path.length > 4096) ||
      typeof metadata.name !== "string" ||
      metadata.name.length > 1024 ||
      !IMAGE_TYPES.has(metadata.type) ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 1 ||
      metadata.size > MAX_SESSION_ASSET_BYTES ||
      !/^[0-9a-f]{64}$/.test(metadata.sha256)
    ) {
      throw httpError("Session bundle contains invalid image metadata", 400);
    }
    for (const path of metadata.paths) {
      if (sourcePaths.has(path)) throw httpError("Session bundle contains duplicate image paths", 400);
      sourcePaths.add(path);
    }
    totalAssetSize += metadata.size;
    if (totalAssetSize > MAX_SESSION_ASSET_TOTAL_BYTES) {
      throw httpError("Session bundle images are too large", 413);
    }
    const end = offset + metadata.size;
    if (end > unpacked.length) throw httpError("Session image data is truncated", 400);
    const bytes = unpacked.subarray(offset, end);
    if (sha256(bytes) !== metadata.sha256 || !imageBytesMatchType(metadata.type, bytes)) {
      throw httpError("Session image data does not match its manifest", 400);
    }
    assets.push({ ...metadata, bytes });
    offset = end;
  }
  if (offset !== unpacked.length) throw httpError("Session bundle contains unexpected data", 400);
  const missingAssets = Array.isArray(bundle.missingAssets)
    ? bundle.missingAssets.filter(
        (asset) =>
          asset &&
          typeof asset.path === "string" &&
          typeof asset.reason === "string",
      ).slice(0, MAX_SESSION_ASSET_COUNT)
    : [];
  return { assets, bundle, missingAssets, rollout, rolloutBytes, sessionMetadata };
}

function parseLegacySessionBundle(unpacked) {
  let bundle;
  try {
    bundle = JSON.parse(unpacked.toString("utf8"));
  } catch {
    throw httpError("Session bundle contains invalid JSON", 400);
  }
  validateSessionManifest(bundle, LEGACY_SESSION_BUNDLE_VERSION);
  if (typeof bundle.rollout !== "string") {
    throw httpError("Session bundle is missing its history", 400);
  }
  const { metadata: sessionMetadata } = validateRollout(bundle.rollout, bundle.thread.id);
  return {
    assets: [],
    bundle,
    missingAssets: [],
    rollout: bundle.rollout,
    rolloutBytes: Buffer.from(bundle.rollout, "utf8"),
    sessionMetadata,
  };
}

function parseSessionBundle(bytes) {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw httpError("Session file must be a gzip-compressed .codex-session bundle", 400);
  }
  let unpacked;
  try {
    unpacked = gunzipSync(bytes, { maxOutputLength: MAX_SESSION_BUNDLE_BYTES });
  } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE") {
      throw httpError("Uncompressed session bundle is too large", 413);
    }
    throw httpError("Session file is not a valid gzip bundle", 400);
  }
  return unpacked.subarray(0, SESSION_BUNDLE_MAGIC.length).equals(SESSION_BUNDLE_MAGIC)
    ? parseBinarySessionBundle(unpacked)
    : parseLegacySessionBundle(unpacked);
}

async function findStoredSessionPath(threadId) {
  const matches = [];
  async function visit(directory, depth = 0) {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`)) {
        matches.push(path);
      }
    }
  }
  await visit(CODEX_SESSIONS_DIR);
  await visit(CODEX_ARCHIVED_SESSIONS_DIR);
  return matches[0] || null;
}

async function resolveImportedCwd(req, originalCwd) {
  const encoded = req.headers["x-codex-web-cwd"];
  let cwd = originalCwd;
  if (encoded !== undefined) {
    if (typeof encoded !== "string" || encoded.length > 4096) {
      throw httpError("X-Codex-Web-Cwd is invalid", 400);
    }
    try {
      cwd = decodeURIComponent(encoded);
    } catch {
      throw httpError("X-Codex-Web-Cwd must be URL-encoded", 400);
    }
  }
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    throw httpError("Choose an absolute destination working directory before importing", 400);
  }
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw httpError("The destination working directory does not exist", 400);
  }
  if (!info.isDirectory()) {
    throw httpError("The destination working directory is not a directory", 400);
  }
  return resolve(cwd);
}

function importedAssetTargets(assets) {
  const pathMap = new Map();
  const targets = assets.map((asset) => {
    const destination = join(
      UPLOAD_DIR,
      `session-${asset.sha256}${IMAGE_TYPES.get(asset.type)}`,
    );
    for (const sourcePath of asset.paths) pathMap.set(sourcePath, destination);
    return { ...asset, destination };
  });
  return { pathMap, targets };
}

function rewriteRolloutImagePaths(rollout, pathMap) {
  if (pathMap.size === 0) return { rollout, updatedPaths: 0 };
  let updatedPaths = 0;
  const pieces = rollout.split(/(\r?\n)/);
  for (let index = 0; index < pieces.length; index += 2) {
    const line = pieces[index];
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (
      record?.type !== "event_msg" ||
      record.payload?.type !== "user_message" ||
      !Array.isArray(record.payload.local_images)
    ) {
      continue;
    }
    let changed = false;
    record.payload.local_images = record.payload.local_images.map((path) => {
      const replacement = pathMap.get(path);
      if (!replacement) return path;
      changed = true;
      updatedPaths += 1;
      return replacement;
    });
    if (changed) pieces[index] = JSON.stringify(record);
  }
  return { rollout: pieces.join(""), updatedPaths };
}

async function writeImportedAssets(targets) {
  if (targets.length === 0) return;
  await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  await chmod(UPLOAD_DIR, 0o700);
  for (const asset of targets) {
    try {
      await writeFile(asset.destination, asset.bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(asset.destination);
      if (!existing.equals(asset.bytes)) {
        throw httpError("An imported image conflicts with an existing cache file", 409);
      }
    }
    await chmod(asset.destination, 0o600);
  }
}

async function exportSession(res, threadId) {
  if (!CODEX_SESSION_ID_PATTERN.test(threadId) || threadId.startsWith("claude:")) {
    throw httpError("A valid Codex thread id is required", 400);
  }
  const result = await providerRpc("thread/read", {
    threadId,
    includeTurns: true,
    provider: "codex",
  });
  const thread = result?.thread;
  if (!thread || thread.id !== threadId) throw httpError("Session was not found", 404);
  if (
    thread.status?.type === "active" ||
    (thread.turns || []).some((turn) => turn.status === "inProgress")
  ) {
    throw httpError("Wait for the current turn to finish before downloading this session", 409);
  }
  const rolloutPath = await allowedRolloutPath(thread.path);
  const before = await stat(rolloutPath);
  if (!before.isFile()) throw httpError("Codex session path is not a file", 409);
  if (before.size > MAX_SESSION_FILE_BYTES) throw httpError("Session history is too large", 413);
  const rolloutBytes = await readFile(rolloutPath);
  const after = await stat(rolloutPath);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  ) {
    throw httpError("Session changed while it was being downloaded; try again", 409);
  }
  const rollout = rolloutBytes.toString("utf8");
  const { metadata: sessionMetadata, localImagePaths } = validateRollout(rollout, threadId);
  const { assets, missingAssets } = await collectSessionAssets(localImagePaths);
  const manifest = {
    format: SESSION_BUNDLE_FORMAT,
    version: SESSION_BUNDLE_VERSION,
    provider: "codex",
    exportedAt: new Date().toISOString(),
    thread: {
      id: threadId,
      name: typeof thread.name === "string" ? thread.name : null,
      createdAt: thread.createdAt ?? null,
      updatedAt: thread.updatedAt ?? null,
      cwd: thread.cwd || sessionMetadata.cwd || null,
      model: thread.model || null,
    },
    missingAssets,
  };
  const body = buildSessionBundle(manifest, rolloutBytes, assets);
  if (body.length > MAX_SESSION_UPLOAD_BYTES) {
    throw httpError("Compressed session bundle is too large to import", 413);
  }
  res.writeHead(200, {
    "Content-Type": "application/x-codex-session",
    "Content-Disposition": `attachment; filename="codex-session-${threadId}.codex-session"`,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Codex-Session-Asset-Count": String(assets.length),
    "X-Codex-Session-Missing-Asset-Count": String(missingAssets.length),
  });
  res.end(body);
}

async function importSession(req) {
  const contentType = (req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (
    ![
      "application/x-codex-session",
      "application/gzip",
      "application/octet-stream",
    ].includes(contentType)
  ) {
    throw httpError("Content-Type must be a Codex session or gzip file", 415);
  }
  const bytes = await readLimitedBody(req, MAX_SESSION_UPLOAD_BYTES, "Session upload");
  const {
    assets,
    bundle,
    missingAssets,
    rollout,
    rolloutBytes: originalRolloutBytes,
    sessionMetadata,
  } = parseSessionBundle(bytes);
  const cwd = await resolveImportedCwd(req, bundle.thread.cwd || sessionMetadata.cwd);
  const { pathMap, targets } = importedAssetTargets(assets);
  const rewritten = rewriteRolloutImagePaths(rollout, pathMap);
  const rolloutBytes = Buffer.from(rewritten.rollout, "utf8");
  const existingPath = await findStoredSessionPath(bundle.thread.id);
  if (existingPath) {
    const existing = await readFile(existingPath);
    const matchesOriginal = existing.equals(originalRolloutBytes);
    const matchesRewritten = existing.equals(rolloutBytes);
    if (!matchesOriginal && !matchesRewritten) {
      throw httpError("A different session with this id already exists", 409);
    }
    if (matchesRewritten) await writeImportedAssets(targets);
    return {
      status: 200,
      result: {
        threadId: bundle.thread.id,
        name: bundle.thread.name || null,
        cwd,
        alreadyExists: true,
        assetsImported: matchesRewritten ? assets.length : 0,
        assetPathsUpdated: matchesRewritten ? rewritten.updatedPaths : 0,
        missingAssets: missingAssets.length,
      },
    };
  }

  const now = new Date();
  const directory = join(
    CODEX_SESSIONS_DIR,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeImportedAssets(targets);
  const timestamp = now.toISOString().replaceAll(":", "-");
  const destination = join(directory, `rollout-${timestamp}-${bundle.thread.id}.jsonl`);
  try {
    await writeFile(destination, rolloutBytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") throw httpError("Session destination already exists", 409);
    await unlink(destination).catch(() => {});
    throw error;
  }
  return {
    status: 201,
    result: {
      threadId: bundle.thread.id,
      name: bundle.thread.name || null,
      cwd,
      alreadyExists: false,
      assetsImported: assets.length,
      assetPathsUpdated: rewritten.updatedPaths,
      missingAssets: missingAssets.length,
    },
  };
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
      broadcast("status", {
        ready: true,
        message: "Codex app-server connected",
        provider: "codex",
      });
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
    broadcast("status", {
      ready: false,
      message: error.message,
      provider: "codex",
    });
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
const claudeProvider = new ClaudeProvider({
  binary: CLAUDE_BIN,
  cacheDir: CLAUDE_DATA_DIR,
  claudeConfigDir: CLAUDE_CONFIG_DIR,
  emit: (message) => broadcast("rpc", message),
  log: (message) => broadcast("log", { level: "stderr", message }),
});

function providerForRequest(method, params = {}) {
  if (params.provider === "claude") return "claude";
  if (params.provider === "codex") return "codex";
  if (typeof params.threadId === "string" && params.threadId.startsWith("claude:")) {
    return "claude";
  }
  return method === "thread/list" ? "all" : "codex";
}

function withoutProvider(params = {}) {
  const copy = { ...params };
  delete copy.provider;
  return copy;
}

async function providerRpc(method, params = {}) {
  const provider = providerForRequest(method, params);
  if (provider === "claude") {
    return claudeProvider.rpc(method, withoutProvider(params));
  }
  await bridge.start();
  return bridge.rpc(method, applyCliThreadDefaults(method, withoutProvider(params)));
}

async function listAllThreads(params = {}) {
  const results = await Promise.allSettled([
    providerRpc("thread/list", { ...params, provider: "codex" }),
    claudeProvider.rpc("thread/list", withoutProvider(params)),
  ]);
  const codex = results[0].status === "fulfilled" ? results[0].value : { data: [] };
  const claude = results[1].status === "fulfilled" ? results[1].value : { data: [] };
  if (results.every((result) => result.status === "rejected")) {
    throw results[0].reason || results[1].reason;
  }
  return {
    data: [
      ...(codex.data || []).map((thread) => ({
        ...thread,
        provider: thread.provider || "codex",
        providerThreadId: thread.providerThreadId || thread.id,
      })),
      ...(claude.data || []),
    ].sort(
      (left, right) => (right.updatedAt || 0) - (left.updatedAt || 0),
    ),
    nextCursor: null,
  };
}

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
      const claudeStatus = await claudeProvider.status();
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 1000\nevent: status\ndata: ${JSON.stringify({
        ready: bridge.ready,
        message: bridge.ready ? "connected" : "starting",
        providers: {
          codex: { ready: bridge.ready, binary: CODEX_BIN },
          claude: claudeStatus,
        },
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
      const claudeStatus = await claudeProvider.status();
      return json(res, 200, {
        ready: bridge.ready,
        codexBin: CODEX_BIN,
        claudeBin: CLAUDE_BIN,
        providers: {
          codex: { ready: bridge.ready, binary: CODEX_BIN },
          claude: claudeStatus,
        },
        cwd: DEFAULT_CWD,
        port: PORT,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/sessions/export") {
      await exportSession(res, url.searchParams.get("threadId") || "");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions/import") {
      const imported = await importSession(req);
      return json(res, imported.status, imported.result);
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
      const params = applyCliThreadDefaults(body.method, body.params || {});
      const provider = providerForRequest(body.method, params);
      const result =
        body.method === "thread/list" && provider === "all"
          ? await listAllThreads(params)
          : await providerRpc(body.method, params);
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

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  const forceExit = setTimeout(() => process.exit(0), 3_500);
  forceExit.unref();
  const serverClosed = new Promise((resolveClosed) => {
    server.close(resolveClosed);
  });
  for (const client of clients) client.end();
  clients.clear();
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  bridge.stop();
  await claudeProvider.stop();
  await serverClosed;
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
