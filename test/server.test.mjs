import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER = join(ROOT, "server.mjs");
const FAKE_CODEX = join(ROOT, "test-support", "fake-codex.mjs");

async function freePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  listener.close();
  await once(listener, "close");
  return port;
}

async function waitForReady(baseUrl, child) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Codex Web exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok && (await response.json()).ready) return;
    } catch {
      // The HTTP listener may not be ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Timed out waiting for Codex Web");
}

async function stopChild(child) {
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      if (child.exitCode === null) child.kill(signal);
    }
  };

  signalGroup("SIGTERM");
  if (child.exitCode === null) {
    let stopTimer;
    try {
      await Promise.race([
        once(child, "exit"),
        new Promise((_, reject) => {
          stopTimer = setTimeout(
            () => reject(new Error("Codex Web did not stop")),
            4_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(stopTimer);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  signalGroup("SIGKILL");
}

test("CLI exposes help and version without starting the server", async () => {
  const packageInfo = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));

  const version = spawn(process.execPath, [SERVER, "--version"]);
  let versionOutput = "";
  version.stdout.on("data", (chunk) => {
    versionOutput += chunk;
  });
  assert.equal((await once(version, "exit"))[0], 0);
  assert.equal(versionOutput.trim(), packageInfo.version);

  const help = spawn(process.execPath, [SERVER, "--help"]);
  let helpOutput = "";
  help.stdout.on("data", (chunk) => {
    helpOutput += chunk;
  });
  assert.equal((await once(help, "exit"))[0], 0);
  assert.match(helpOutput, /Usage:\s+codex-web/);
  assert.match(helpOutput, /always listens on 127\.0\.0\.1/);
});

test("server starts with a fake Codex bridge and enforces local security boundaries", async (t) => {
  const temporaryRoot = await mkdtemp(join(os.tmpdir(), "codex-web-test-"));
  const codexHome = join(temporaryRoot, "codex-home");
  const cacheHome = join(temporaryRoot, "cache");
  const argsFile = join(temporaryRoot, "args.json");
  const messagesFile = join(temporaryRoot, "messages.ndjson");
  const profilePath = join(codexHome, "test.config.toml");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await mkdir(codexHome, { recursive: true });
  await writeFile(
    profilePath,
    'model = "test-model"\nmodel_reasoning_effort = "low"\n\n[features]\nexample = true\n',
  );
  await chmod(FAKE_CODEX, 0o755);

  const child = spawn(
    process.execPath,
    [SERVER, "--no-open", "-p", "test", "--yolo", "--search"],
    {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        CODEX_BIN: FAKE_CODEX,
        CODEX_HOME: codexHome,
        CODEX_WEB_PORT: String(port),
        XDG_CACHE_HOME: cacheHome,
        FAKE_CODEX_ARGS_FILE: argsFile,
        FAKE_CODEX_MESSAGES_FILE: messagesFile,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(async () => {
    await stopChild(child);
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  await waitForReady(baseUrl, child);

  const statusResponse = await fetch(`${baseUrl}/api/status`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.ready, true);
  assert.equal(status.cwd, temporaryRoot);

  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /Codex Web/);

  const traversalResponse = await fetch(`${baseUrl}/..%2Fserver.mjs`);
  assert.equal(traversalResponse.status, 403);

  const crossOriginResponse = await fetch(`${baseUrl}/api/status`, {
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(crossOriginResponse.status, 403);

  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
  ]);
  const uploadResponse = await fetch(`${baseUrl}/api/uploads/images`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-File-Name": encodeURIComponent("نمونه.png"),
    },
    body: png,
  });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();
  assert.equal(upload.path.startsWith(join(cacheHome, "codex-web", "uploads")), true);
  assert.deepEqual(await readFile(upload.path), png);
  assert.equal((await stat(upload.path)).mode & 0o777, 0o600);

  const invalidUploadResponse = await fetch(`${baseUrl}/api/uploads/images`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-File-Name": "invalid.png",
    },
    body: Buffer.from("not a png"),
  });
  assert.equal(invalidUploadResponse.status, 415);

  const threadResponse = await fetch(`${baseUrl}/api/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "thread/start", params: { cwd: temporaryRoot } }),
  });
  assert.equal(threadResponse.status, 200);
  assert.equal((await threadResponse.json()).result.thread.id, "test-thread");

  const compactResponse = await fetch(`${baseUrl}/api/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "thread/compact/start",
      params: { threadId: "test-thread" },
    }),
  });
  assert.equal(compactResponse.status, 200);
  assert.deepEqual(await compactResponse.json(), { result: {} });

  const rejectedMethod = "thread/delete";
  const rejectedRpcResponse = await fetch(`${baseUrl}/api/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: rejectedMethod,
      params: { threadId: "test-thread" },
    }),
  });
  assert.equal(rejectedRpcResponse.status, 403);
  assert.deepEqual(await rejectedRpcResponse.json(), {
    error: `RPC method is not allowed: ${rejectedMethod}`,
  });

  const childArgs = JSON.parse(await readFile(argsFile, "utf8"));
  assert.deepEqual(childArgs.slice(-2), ["app-server", "--stdio"]);
  assert.equal(childArgs.includes('model="test-model"'), true);
  assert.equal(childArgs.includes('model_reasoning_effort="low"'), true);
  assert.equal(childArgs.includes('web_search="live"'), true);
  assert.equal(childArgs.includes("features.example=true"), false);

  const messages = (await readFile(messagesFile, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const threadStart = messages.find((message) => message.method === "thread/start");
  assert.equal(threadStart.params.approvalPolicy, "never");
  assert.equal(threadStart.params.sandbox, "danger-full-access");
  const compactStart = messages.find(
    (message) => message.method === "thread/compact/start",
  );
  assert.deepEqual(compactStart?.params, { threadId: "test-thread" });
  assert.equal(
    messages.some((message) => message.method === rejectedMethod),
    false,
  );
});
