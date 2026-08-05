import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  authorizeRequest,
  buildServeArgs,
  defaultTailscaleBinary,
  findExpectedServeUrl,
  parseTailscaleStatus,
  serveConfigUsesPort,
  TailscaleRemoteAccess,
} from "../remote-access.mjs";

const STATUS = {
  BackendState: "Running",
  Self: {
    DNSName: "workstation.example.ts.net.",
    Online: true,
    UserID: 29,
  },
  User: {
    29: {
      ID: 29,
      LoginName: "owner@example.com",
    },
  },
};

function request(headers, remoteAddress = "127.0.0.1") {
  return { headers, remoteAddress };
}

test("parses the local Tailscale device identity", () => {
  assert.deepEqual(parseTailscaleStatus(JSON.stringify(STATUS)), {
    dnsName: "workstation.example.ts.net",
    userLogin: "owner@example.com",
  });
  assert.deepEqual(
    parseTailscaleStatus(JSON.stringify(STATUS), "explicit@example.com"),
    {
      dnsName: "workstation.example.ts.net",
      userLogin: "explicit@example.com",
    },
  );
});

test("rejects disconnected, offline, and identity-less Tailscale states", () => {
  assert.throws(
    () => parseTailscaleStatus({ ...STATUS, BackendState: "Stopped" }),
    /not connected/,
  );
  assert.throws(
    () =>
      parseTailscaleStatus({
        ...STATUS,
        Self: { ...STATUS.Self, Online: false },
      }),
    /offline/,
  );
  assert.throws(
    () => parseTailscaleStatus({ ...STATUS, User: {} }),
    /REMOTE_USER/,
  );
});

test("builds a foreground-only private Serve command", () => {
  const args = buildServeArgs(4173, 44173);
  assert.deepEqual(args, [
    "serve",
    "--https=44173",
    "http://127.0.0.1:4173",
  ]);
  assert.equal(args.includes("--bg"), false);
  assert.equal(args.some((argument) => /funnel/i.test(argument)), false);
  assert.deepEqual(buildServeArgs(4173, 44173, "http"), [
    "serve",
    "--http=44173",
    "http://127.0.0.1:4173",
  ]);
});

test("detects existing Serve configuration without treating backend targets as conflicts", () => {
  const config = {
    TCP: { 443: { HTTPS: true } },
    Web: {
      "workstation.example.ts.net:443": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:4173" } },
      },
    },
  };
  assert.equal(serveConfigUsesPort(config, 443), true);
  assert.equal(serveConfigUsesPort(config, 4173), false);
  assert.equal(serveConfigUsesPort({}, 4173), false);
});

test("accepts only matching localhost or owner-authenticated remote requests", () => {
  const remote = {
    ready: true,
    dnsName: "workstation.example.ts.net",
    port: 4173,
    userLogin: "owner@example.com",
    protocol: "https",
  };

  assert.deepEqual(
    authorizeRequest(request({ host: "127.0.0.1:4173" }), remote),
    { ok: true, mode: "local" },
  );
  assert.equal(
    authorizeRequest(
      request({
        host: "127.0.0.1:4173",
        origin: "https://attacker.example",
      }),
      remote,
    ).ok,
    false,
  );
  assert.deepEqual(
    authorizeRequest(
      request({
        host: "workstation.example.ts.net:4173",
        origin: "https://workstation.example.ts.net:4173",
        "tailscale-user-login": "owner@example.com",
      }),
      remote,
    ),
    { ok: true, mode: "remote" },
  );

  for (const candidate of [
    request(
      {
        host: "workstation.example.ts.net:4173",
        "tailscale-user-login": "owner@example.com",
      },
      "192.0.2.10",
    ),
    request({
      host: "attacker.example:4173",
      "tailscale-user-login": "owner@example.com",
    }),
    request({
      host: "workstation.example.ts.net:4173",
      origin: "https://attacker.example",
      "tailscale-user-login": "owner@example.com",
    }),
    request({
      host: "workstation.example.ts.net:4173",
      "tailscale-user-login": "other@example.com",
    }),
    request({ host: "workstation.example.ts.net:4173" }),
  ]) {
    assert.equal(authorizeRequest(candidate, remote).ok, false);
  }
});

test("recognizes only the expected private Serve URL", () => {
  const identity = {
    dnsName: "workstation.example.ts.net",
    userLogin: "owner@example.com",
  };
  assert.equal(
    findExpectedServeUrl(
      "Enable Serve at https://login.tailscale.com/a-token\n",
      identity,
      4173,
    ),
    null,
  );
  assert.equal(
    findExpectedServeUrl(
      "Available within your tailnet:\nhttps://workstation.example.ts.net:4173\n",
      identity,
      4173,
    ),
    "https://workstation.example.ts.net:4173",
  );
});

test("auto-detects the Windows binary without overriding an explicit path", () => {
  assert.equal(
    defaultTailscaleBinary({
      env: { TAILSCALE_BIN: "D:\\tools\\tailscale.exe" },
      platform: "win32",
      pathExists: () => false,
    }),
    "D:\\tools\\tailscale.exe",
  );
  assert.equal(
    defaultTailscaleBinary({
      env: { ProgramFiles: "C:\\Program Files" },
      platform: "win32",
      pathExists: () => true,
    }),
    "C:\\Program Files\\Tailscale\\tailscale.exe",
  );
});

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.killedWith = [];
  }

  kill(signal) {
    this.killedWith.push(signal);
    if (this.exitCode === null) {
      this.exitCode = 0;
      queueMicrotask(() => this.emit("exit", 0, signal));
    }
    return true;
  }
}

test("starts Serve in the foreground and stops it with Codex Web", async () => {
  const calls = [];
  const child = new FakeChild();
  let unexpectedExit = null;
  const remote = new TailscaleRemoteAccess({
    localPort: 4173,
    remotePort: 4173,
    binary: "tailscale-test",
    runCommand: async (_binary, args) => {
      calls.push(args);
      return args[0] === "status" ? JSON.stringify(STATUS) : "{}";
    },
    spawnProcess: (_binary, args) => {
      calls.push(args);
      return child;
    },
    onUnexpectedExit: (error) => {
      unexpectedExit = error;
    },
  });

  const starting = remote.start();
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write(
    "Available within your tailnet:\nhttps://workstation.example.ts.net:4173\n",
  );
  assert.deepEqual(await starting, {
    enabled: true,
    ready: true,
    url: "https://workstation.example.ts.net:4173",
    protocol: "https",
    secureContext: true,
  });
  assert.deepEqual(calls, [
    ["status", "--json"],
    ["serve", "status", "--json"],
    ["serve", "--https=4173", "http://127.0.0.1:4173"],
  ]);
  assert.deepEqual(remote.authorization(), {
    ready: true,
    dnsName: "workstation.example.ts.net",
    userLogin: "owner@example.com",
    port: 4173,
    protocol: "https",
  });

  await remote.stop();
  assert.deepEqual(child.killedWith, ["SIGTERM"]);
  assert.equal(remote.status().ready, false);
  assert.equal(remote.status().protocol, null);
  assert.equal(remote.status().secureContext, false);
  assert.equal(unexpectedExit, null);
});

test("falls back to private HTTP when the control plane does not implement HTTPS", async () => {
  const calls = [];
  const children = [];
  const remote = new TailscaleRemoteAccess({
    localPort: 4173,
    remotePort: 4173,
    binary: "tailscale-test",
    runCommand: async (_binary, args) =>
      args[0] === "status" ? JSON.stringify(STATUS) : "{}",
    spawnProcess: (_binary, args) => {
      calls.push(args);
      const child = new FakeChild();
      children.push(child);
      if (args.includes("--https=4173")) {
        queueMicrotask(() => {
          child.stderr.write(
            "error enabling https feature: error 501 Not Implemented: Not implemented yet\n",
          );
          child.exitCode = 1;
          child.emit("exit", 1, null);
        });
      } else {
        queueMicrotask(() => {
          child.stdout.write(
            "Available within your tailnet:\nhttp://workstation.example.ts.net:4173/\n",
          );
        });
      }
      return child;
    },
  });

  assert.deepEqual(await remote.start(), {
    enabled: true,
    ready: true,
    url: "http://workstation.example.ts.net:4173",
    protocol: "http",
    secureContext: false,
  });
  assert.deepEqual(calls, [
    ["serve", "--https=4173", "http://127.0.0.1:4173"],
    ["serve", "--http=4173", "http://127.0.0.1:4173"],
  ]);
  assert.equal(remote.authorization().protocol, "http");
  await remote.stop();
  assert.deepEqual(children[1].killedWith, ["SIGTERM"]);
});
