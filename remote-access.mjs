import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 as win32Path } from "node:path";

const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;
const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
]);

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function headerValue(headers, name) {
  const direct = headers?.[name];
  if (typeof direct === "string") return direct;
  const entry = Object.entries(headers || {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return typeof entry?.[1] === "string" ? entry[1] : "";
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function expectedRemoteOrigin(dnsName, port, protocol = "https") {
  const defaultPort = protocol === "https" ? 443 : 80;
  return `${protocol}://${dnsName}${port === defaultPort ? "" : `:${port}`}`;
}

function isValidDnsName(value) {
  return (
    value.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) &&
    value.includes(".")
  );
}

function validatePort(port, name) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name}: ${port}`);
  }
}

export function defaultTailscaleBinary({
  env = process.env,
  platform = process.platform,
  pathExists = existsSync,
} = {}) {
  if (env.TAILSCALE_BIN) return env.TAILSCALE_BIN;
  if (platform === "win32") {
    const candidate = win32Path.join(
      env.ProgramFiles || "C:\\Program Files",
      "Tailscale",
      "tailscale.exe",
    );
    if (pathExists(candidate)) return candidate;
  }
  return "tailscale";
}

export function parseTailscaleStatus(text, expectedUser = "") {
  const status = typeof text === "string" ? parseJson(text, "tailscale status") : text;
  if (!status || typeof status !== "object") {
    throw new Error("tailscale status did not return an object");
  }
  if (status.BackendState !== "Running") {
    throw new Error("Tailscale is not connected");
  }
  if (!status.Self || status.Self.Online === false) {
    throw new Error("This Tailscale device is offline");
  }

  const dnsName = String(status.Self.DNSName || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  if (!isValidDnsName(dnsName)) {
    throw new Error("Tailscale did not report a valid DNS name for this device");
  }

  const selfUserId = String(status.Self.UserID ?? "");
  const owner =
    status.User?.[selfUserId] ||
    Object.values(status.User || {}).find(
      (user) => String(user?.ID ?? "") === selfUserId,
    );
  const userLogin = String(expectedUser || owner?.LoginName || "").trim();
  if (!userLogin || /[\r\n]/.test(userLogin)) {
    throw new Error(
      "Tailscale did not report the device owner's login; set CODEX_WEB_REMOTE_USER explicitly",
    );
  }

  return { dnsName, userLogin };
}

export function buildServeArgs(localPort, remotePort, protocol = "https") {
  validatePort(localPort, "local port");
  validatePort(remotePort, "remote port");
  if (protocol !== "https" && protocol !== "http") {
    throw new Error(`Invalid remote protocol: ${protocol}`);
  }
  return [
    "serve",
    `--${protocol}=${remotePort}`,
    `http://127.0.0.1:${localPort}`,
  ];
}

export function serveConfigUsesPort(text, port) {
  validatePort(port, "remote port");
  const config = typeof text === "string" ? parseJson(text, "tailscale serve status") : text;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("tailscale serve status did not return an object");
  }

  const portText = String(port);
  const keyUsesPort = (key) =>
    key === portText ||
    key.endsWith(`:${portText}`) ||
    key.endsWith(`:${portText}/`);
  const visit = (value) => {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(
      ([key, child]) => keyUsesPort(key) || visit(child),
    );
  };
  return visit(config);
}

export function findExpectedServeUrl(
  text,
  identity,
  remotePort,
  protocol = "https",
) {
  const expectedOrigin = expectedRemoteOrigin(
    identity.dnsName,
    remotePort,
    protocol,
  );
  const cleaned = String(text).replace(/\u001b\[[0-9;]*m/g, "");
  for (const match of cleaned.matchAll(/https?:\/\/[^\s|]+/gi)) {
    const candidate = match[0].replace(/[),.;\]]+$/, "");
    try {
      const url = new URL(candidate);
      if (url.origin === expectedOrigin) return expectedOrigin;
    } catch {
      // Ignore consent or malformed URLs and keep waiting for the Serve URL.
    }
  }
  return null;
}

export function authorizeRequest(request, remote = null) {
  const remoteAddress = request?.remoteAddress || request?.socket?.remoteAddress || "";
  if (!LOOPBACK_ADDRESSES.has(remoteAddress)) {
    return { ok: false, reason: "Requests must arrive through loopback" };
  }

  const host = headerValue(request?.headers, "host");
  const origin = headerValue(request?.headers, "origin");
  if (LOCAL_HOST_PATTERN.test(host)) {
    const expectedOrigin = normalizeOrigin(`http://${host}`);
    if (!origin || normalizeOrigin(origin) === expectedOrigin) {
      return { ok: true, mode: "local" };
    }
    return { ok: false, reason: "Local request origin does not match its host" };
  }

  if (!remote?.ready) {
    return { ok: false, reason: "Remote access is not enabled" };
  }
  const expectedOrigin = expectedRemoteOrigin(
    remote.dnsName,
    remote.port,
    remote.protocol || "https",
  );
  const expectedHost = new URL(expectedOrigin).host;
  if (host.toLowerCase() !== expectedHost.toLowerCase()) {
    return { ok: false, reason: "Remote request host is not allowed" };
  }
  if (origin && normalizeOrigin(origin) !== expectedOrigin) {
    return { ok: false, reason: "Remote request origin does not match its host" };
  }
  if (headerValue(request?.headers, "tailscale-user-login") !== remote.userLogin) {
    return { ok: false, reason: "Remote Tailscale identity is not allowed" };
  }
  return { ok: true, mode: "remote" };
}

export function runTailscaleCommand(
  binary,
  args,
  { spawnProcess = spawn } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => reject(error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new Error(
          `tailscale ${args.join(" ")} failed (${signal || code || "unknown"})${
            detail ? `: ${detail}` : ""
          }`,
        ),
      );
    });
  });
}

export class TailscaleRemoteAccess {
  constructor({
    localPort,
    remotePort = localPort,
    binary = defaultTailscaleBinary(),
    expectedUser = "",
    runCommand = runTailscaleCommand,
    spawnProcess = spawn,
    readyTimeoutMs = 60_000,
    onOutput = () => {},
    onUnexpectedExit = () => {},
  }) {
    validatePort(localPort, "local port");
    validatePort(remotePort, "remote port");
    this.localPort = localPort;
    this.remotePort = remotePort;
    this.binary = binary;
    this.expectedUser = expectedUser;
    this.runCommand = runCommand;
    this.spawnProcess = spawnProcess;
    this.readyTimeoutMs = readyTimeoutMs;
    this.onOutput = onOutput;
    this.onUnexpectedExit = onUnexpectedExit;
    this.proc = null;
    this.identity = null;
    this.url = null;
    this.protocol = null;
    this.ready = false;
    this.stopping = false;
  }

  status() {
    return {
      enabled: true,
      ready: this.ready,
      url: this.url,
      protocol: this.protocol,
      secureContext: this.protocol === "https",
    };
  }

  authorization() {
    if (!this.identity) return { ready: false };
    return {
      ready: this.ready,
      dnsName: this.identity.dnsName,
      userLogin: this.identity.userLogin,
      port: this.remotePort,
      protocol: this.protocol,
    };
  }

  async start() {
    if (this.ready) return this.status();
    if (this.proc) throw new Error("Tailscale remote access is already starting");

    const [statusText, serveStatusText] = await Promise.all([
      this.runCommand(this.binary, ["status", "--json"]),
      this.runCommand(this.binary, ["serve", "status", "--json"]),
    ]);
    this.identity = parseTailscaleStatus(statusText, this.expectedUser);
    if (serveConfigUsesPort(serveStatusText, this.remotePort)) {
      throw new Error(
        `Tailscale Serve port ${this.remotePort} is already configured; choose CODEX_WEB_REMOTE_PORT without changing the existing Serve configuration`,
      );
    }

    try {
      return await this.startServe("https");
    } catch (error) {
      const httpsUnsupported =
        /error enabling https feature:[\s\S]*\b501\b[\s\S]*not implemented/i.test(
          error.output || "",
        );
      if (!httpsUnsupported) throw error;
      this.onOutput(
        "Tailscale HTTPS is unavailable; using private HTTP inside the encrypted tailnet.\n",
        "stderr",
      );
      return this.startServe("http");
    }
  }

  startServe(protocol) {
    this.stopping = false;
    const child = this.spawnProcess(
      this.binary,
      buildServeArgs(this.localPort, this.remotePort, protocol),
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.proc = child;

    return new Promise((resolve, reject) => {
      let output = "";
      let startSettled = false;
      const timer = setTimeout(() => {
        if (startSettled) return;
        startSettled = true;
        this.proc = null;
        child.kill("SIGTERM");
        reject(
          new Error(
            "Tailscale Serve did not become ready; complete any HTTPS/Serve consent shown above and retry",
          ),
        );
      }, this.readyTimeoutMs);
      timer.unref?.();

      const consume = (chunk, stream) => {
        const text = chunk.toString("utf8");
        this.onOutput(text, stream);
        output = `${output}${text}`.slice(-16_384);
        if (startSettled) return;
        const url = findExpectedServeUrl(
          output,
          this.identity,
          this.remotePort,
          protocol,
        );
        if (!url) return;
        startSettled = true;
        clearTimeout(timer);
        this.ready = true;
        this.url = url;
        this.protocol = protocol;
        resolve(this.status());
      };
      child.stdout?.on("data", (chunk) => consume(chunk, "stdout"));
      child.stderr?.on("data", (chunk) => consume(chunk, "stderr"));
      child.once("error", (error) => {
        if (!startSettled) {
          startSettled = true;
          clearTimeout(timer);
          this.proc = null;
          error.output = output;
          reject(error);
        }
      });
      child.once("exit", (code, signal) => {
        const wasReady = this.ready;
        this.proc = null;
        this.ready = false;
        if (!startSettled) {
          startSettled = true;
          clearTimeout(timer);
          const error = new Error(
            `Tailscale Serve exited before it was ready (${signal || code || "unknown"})`,
          );
          error.output = output;
          reject(error);
          return;
        }
        if (wasReady && !this.stopping) {
          this.url = null;
          this.protocol = null;
          this.onUnexpectedExit(
            new Error(`Tailscale Serve stopped (${signal || code || "unknown"})`),
          );
        }
      });
    });
  }

  async stop() {
    this.stopping = true;
    this.ready = false;
    const child = this.proc;
    if (!child) return;

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 1_500);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
    if (this.proc === child) this.proc = null;
    this.url = null;
    this.protocol = null;
  }
}
