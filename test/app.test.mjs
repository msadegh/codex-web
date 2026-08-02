import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { parseHTML } from "linkedom";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP = join(ROOT, "public", "app.js");
const INDEX = join(ROOT, "public", "index.html");

class FakeEventSource {
  static latest = null;

  constructor() {
    this.listeners = new Map();
    FakeEventSource.latest = this;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.listeners.clear();
    if (FakeEventSource.latest === this) FakeEventSource.latest = null;
  }

  emit(type, data) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function installDomGlobals(dom) {
  const nativeSetTimeout = globalThis.setTimeout;
  const globals = {
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    crypto: { randomUUID },
    document: dom.window.document,
    EventSource: FakeEventSource,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    setTimeout(callback, delay = 0, ...args) {
      return nativeSetTimeout(callback, delay >= 4_000 ? 0 : delay, ...args);
    },
    window: dom.window,
  };
  const originalDescriptors = new Map(
    [...Object.keys(globals), "fetch"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
  }
  dom.window.HTMLElement.prototype.scrollTo = function scrollTo(options = {}) {
    if (typeof options.top === "number") this.scrollTop = options.top;
  };
  return () => {
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

test("submitted user message stays visible while the assistant is streaming", async (t) => {
  const html = await readFile(INDEX, "utf8");
  const { window } = parseHTML(html);
  const values = new Map();
  Object.defineProperties(window, {
    cancelAnimationFrame: {
      configurable: true,
      value: clearTimeout,
    },
    close: {
      configurable: true,
      value() {},
    },
    localStorage: {
      configurable: true,
      value: {
        getItem(key) {
          return values.get(key) ?? null;
        },
        setItem(key, value) {
          values.set(key, String(value));
        },
      },
    },
    requestAnimationFrame: {
      configurable: true,
      value(callback) {
        return setTimeout(() => callback(performance.now()), 0);
      },
    },
  });
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() {
      return this.__testValue ?? this.querySelector("option")?.value ?? "";
    },
    set(value) {
      this.__testValue = String(value);
    },
  });
  Object.defineProperty(window.Node, "DOCUMENT_POSITION_FOLLOWING", {
    configurable: true,
    value: 4,
  });
  const dom = { window };
  const restoreGlobals = installDomGlobals(dom);
  t.after(() => {
    FakeEventSource.latest?.close();
    restoreGlobals();
    dom.window.close();
  });

  const now = Math.floor(Date.now() / 1000);
  const threadSummary = {
    id: "thread-1",
    name: "Regression test",
    cwd: "/workspace",
    createdAt: now,
    updatedAt: now,
    status: { type: "idle" },
  };
  const resumedThread = {
    ...threadSummary,
    turns: [
      {
        id: "turn-old",
        status: "completed",
        items: [
          {
            type: "userMessage",
            id: "user-old",
            clientId: null,
            content: [{ type: "text", text: "پیام قبلی" }],
          },
          {
            type: "reasoning",
            id: "reasoning-old",
            summary: [{ text: "بررسی خلاصه" }],
          },
          {
            type: "reasoning",
            id: "reasoning-empty",
            summary: [],
          },
          {
            type: "commandExecution",
            id: "command-old",
            command: "pwd",
            status: "completed",
            exitCode: 0,
          },
          {
            type: "agentMessage",
            id: "agent-old",
            text: "پاسخ قبلی",
          },
        ],
      },
    ],
  };
  const turnStartRequests = [];
  let resolveAcceptedTurnFailure;
  let resolveTurnStart;

  globalThis.fetch = async (path, options = {}) => {
    if (path === "/api/status") {
      return jsonResponse({ ready: true, cwd: "/workspace" });
    }
    if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);

    const { method, params } = JSON.parse(options.body);
    if (method === "model/list") return jsonResponse({ result: { data: [] } });
    if (method === "thread/list") {
      return jsonResponse({ result: { data: [threadSummary], nextCursor: null } });
    }
    if (method === "thread/resume") {
      return jsonResponse({
        result: { thread: resumedThread, cwd: "/workspace", model: "test-model" },
      });
    }
    if (method === "turn/start") {
      turnStartRequests.push(params);
      if (turnStartRequests.length === 2) {
        return jsonResponse({ error: "simulated turn/start failure" }, 500);
      }
      if (turnStartRequests.length === 3) {
        return new Promise((resolve) => {
          resolveAcceptedTurnFailure = () =>
            resolve(
              jsonResponse(
                { error: "simulated response loss after acceptance" },
                500,
              ),
            );
        });
      }
      return new Promise((resolve) => {
        resolveTurnStart = () =>
          resolve(
            jsonResponse({
              result: {
                turn: {
                  id: "turn-new",
                  status: "inProgress",
                  items: [],
                  error: null,
                },
              },
            }),
          );
      });
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  };

  await import(`${pathToFileURL(APP).href}?test=${Date.now()}`);
  await waitFor(
    () => document.querySelector("[data-thread-id='thread-1']"),
    "thread list was not rendered",
  );

  document.querySelector("[data-thread-id='thread-1']").click();
  await waitFor(
    () => document.querySelector("[data-item-id='agent-old']"),
    "thread history was not rendered",
  );
  assert.equal(document.querySelectorAll(".message-avatar").length, 0);
  assert.equal(document.querySelector("[data-item-id='reasoning-old']").hasAttribute("open"), false);
  assert.equal(document.querySelector("[data-item-id='reasoning-old'] summary").textContent, "تفکر");
  assert.equal(document.querySelector("[data-item-id='reasoning-empty']").hidden, true);
  assert.equal(document.querySelector("[data-item-id='command-old']").classList.contains("completed"), true);

  const prompt = document.querySelector("#prompt");
  prompt.value = "پیام تازه";
  prompt.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  document.querySelector("#send-message").click();

  const userRowsBeforeStream = [
    ...document.querySelectorAll(".message-row.user"),
  ];
  assert.equal(userRowsBeforeStream.length, 2);
  assert.equal(userRowsBeforeStream.at(-1).textContent.trim(), "پیام تازه");
  assert.equal(prompt.value, "");

  await waitFor(() => turnStartRequests.length, "turn/start was not requested");
  const clientId = turnStartRequests[0].clientUserMessageId;
  assert.equal(typeof clientId, "string");
  assert.notEqual(clientId, "");
  assert.notEqual(clientId, "user-from-server");
  assert.match(
    turnStartRequests[0].developerInstructions,
    /short descriptive headings, bullet lists, or numbered steps/,
  );

  FakeEventSource.latest.emit("rpc", {
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-new",
      itemId: "agent-streaming",
      delta: "پاسخ در حال استریم",
    },
  });

  const userRowsBeforeServerItem = [
    ...document.querySelectorAll(".message-row.user"),
  ];
  assert.equal(userRowsBeforeServerItem.length, 2);
  assert.equal(userRowsBeforeServerItem.at(-1), userRowsBeforeStream.at(-1));
  assert.notEqual(
    userRowsBeforeServerItem.at(-1).dataset.itemId,
    "user-from-server",
  );
  const streamingReply = document.querySelector(
    "[data-item-id='agent-streaming']",
  );
  assert.match(streamingReply.textContent, /پاسخ در حال استریم/);
  assert.equal(
    userRowsBeforeServerItem.at(-1).compareDocumentPosition(streamingReply) &
      dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
  );

  FakeEventSource.latest.emit("rpc", {
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-new",
      item: {
        type: "userMessage",
        id: "user-from-server",
        clientId,
        content: [{ type: "text", text: "پیام تازه" }],
      },
    },
  });
  const userRowsDuringStream = [
    ...document.querySelectorAll(".message-row.user"),
  ];
  assert.equal(userRowsDuringStream.length, 2);
  assert.equal(userRowsDuringStream.at(-1), userRowsBeforeStream.at(-1));
  assert.equal(
    userRowsDuringStream.at(-1).dataset.itemId,
    "user-from-server",
  );
  assert.equal(
    document.querySelectorAll("[data-item-id='user-from-server']").length,
    1,
  );

  FakeEventSource.latest.emit("rpc", {
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-new",
      item: {
        type: "userMessage",
        id: "user-from-server",
        clientId,
        content: [{ type: "text", text: "پیام تازه" }],
      },
    },
  });
  assert.equal(document.querySelectorAll(".message-row.user").length, 2);
  resolveTurnStart();
  await waitFor(
    () => document.querySelector("#stop-turn").classList.contains("hidden") === false,
    "turn/start response was not handled",
  );
  FakeEventSource.latest.emit("rpc", {
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-new",
        status: "completed",
        items: [],
        error: null,
      },
    },
  });

  prompt.value = "پیامی که ارسال نشد";
  prompt.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    document.querySelector("#send-message").click();
    assert.equal(document.querySelectorAll(".message-row.user").length, 3);

    await waitFor(
      () =>
        document.querySelectorAll(".message-row.user").length === 2 &&
        prompt.value === "پیامی که ارسال نشد",
      "failed optimistic message was not removed and restored to the draft",
    );
  } finally {
    console.error = originalConsoleError;
  }

  prompt.value = "پیام پذیرفته‌شده";
  prompt.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  let acceptedFailureLogged = false;
  console.error = () => {
    acceptedFailureLogged = true;
  };
  try {
    document.querySelector("#send-message").click();
    assert.equal(document.querySelectorAll(".message-row.user").length, 3);
    await waitFor(
      () => turnStartRequests.length === 3,
      "accepted turn/start was not requested",
    );

    const acceptedClientId = turnStartRequests[2].clientUserMessageId;
    FakeEventSource.latest.emit("rpc", {
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-accepted",
          status: "inProgress",
          items: [],
          error: null,
        },
      },
    });
    FakeEventSource.latest.emit("rpc", {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-accepted",
        item: {
          type: "userMessage",
          id: "accepted-user-from-server",
          clientId: acceptedClientId,
          content: [{ type: "text", text: "پیام پذیرفته‌شده" }],
        },
      },
    });
    resolveAcceptedTurnFailure();
    await waitFor(
      () => acceptedFailureLogged,
      "accepted response failure was not handled",
    );

    assert.equal(prompt.value, "");
    assert.equal(document.querySelectorAll(".message-row.user").length, 3);
    assert.equal(
      document.querySelectorAll(
        "[data-item-id='accepted-user-from-server']",
      ).length,
      1,
    );
    assert.equal(
      document.querySelector("#stop-turn").classList.contains("hidden"),
      false,
    );
  } finally {
    console.error = originalConsoleError;
  }
});
