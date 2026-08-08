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
  if (!dom.window.HTMLTextAreaElement.prototype.setSelectionRange) {
    dom.window.HTMLTextAreaElement.prototype.setSelectionRange =
      function setSelectionRange(start, end) {
        Object.defineProperties(this, {
          selectionEnd: {
            configurable: true,
            value: end,
            writable: true,
          },
          selectionStart: {
            configurable: true,
            value: start,
            writable: true,
          },
        });
      };
  }
  return () => {
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

function typePrompt(window, prompt, value) {
  prompt.value = value;
  prompt.setSelectionRange?.(value.length, value.length);
  prompt.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function pressKey(window, target, key, options = {}) {
  const event = new window.Event("keydown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    isComposing: {
      configurable: true,
      value: Boolean(options.isComposing),
    },
    key: {
      configurable: true,
      value: key,
    },
    shiftKey: {
      configurable: true,
      value: Boolean(options.shiftKey),
    },
  });
  target.dispatchEvent(event);
  return event;
}

test("slash commands are accessible and stay isolated from model turns", async (t) => {
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
    id: "thread-slash",
    name: "Slash command test",
    cwd: "/workspace",
    createdAt: now,
    updatedAt: now,
    status: { type: "idle" },
  };
  const resumedThread = {
    ...threadSummary,
    turns: [],
  };
  const rpcRequests = [];
  let resolveCompactResponse;

  globalThis.fetch = async (path, options = {}) => {
    if (path === "/api/status") {
      return jsonResponse({ ready: true, cwd: "/workspace" });
    }
    if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);

    const request = JSON.parse(options.body);
    rpcRequests.push(request);
    const { method } = request;
    if (method === "model/list") {
      return jsonResponse({ result: { data: [] } });
    }
    if (method === "thread/list") {
      return jsonResponse({
        result: { data: [threadSummary], nextCursor: null },
      });
    }
    if (method === "thread/resume") {
      return jsonResponse({
        result: {
          thread: resumedThread,
          cwd: "/workspace",
          model: "test-model",
        },
      });
    }
    if (method === "thread/compact/start") {
      return new Promise((resolve) => {
        resolveCompactResponse = resolve;
      });
    }
    if (method === "turn/start") {
      return jsonResponse({
        result: {
          turn: {
            id: "unexpected-turn",
            status: "inProgress",
            items: [],
            error: null,
          },
        },
      });
    }
    if (method === "thread/start") {
      return jsonResponse({
        result: {
          thread: {
            ...threadSummary,
            id: "unexpected-thread",
          },
        },
      });
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  };

  await import(
    `${pathToFileURL(APP).href}?slash-test=${Date.now()}-${randomUUID()}`
  );
  await waitFor(
    () => document.querySelector("[data-thread-id='thread-slash']"),
    "thread list was not rendered",
  );

  document.querySelector("[data-thread-id='thread-slash']").click();
  await waitFor(
    () => document.querySelector("#thread-title").textContent === "Slash command test",
    "thread was not opened",
  );

  const contextUsage = document.querySelector("#context-usage");
  assert.equal(contextUsage.classList.contains("hidden"), true);
  FakeEventSource.latest.emit("rpc", {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-slash",
      turnId: "turn-before-compact",
      tokenUsage: {
        total: { totalTokens: 700_000 },
        last: { totalTokens: 200_000 },
        modelContextWindow: 250_000,
      },
    },
  });
  assert.equal(contextUsage.classList.contains("hidden"), false);
  assert.equal(contextUsage.dataset.percent, "80");
  assert.equal(contextUsage.dataset.level, "watch");
  assert.equal(document.querySelector("#context-usage-fill").style.width, "80%");
  assert.match(contextUsage.title, /compact/);

  FakeEventSource.latest.emit("rpc", {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-slash",
      turnId: "turn-needs-compact",
      tokenUsage: {
        total: { totalTokens: 900_000 },
        last: { totalTokens: 225_000 },
        modelContextWindow: 250_000,
      },
    },
  });
  assert.equal(contextUsage.dataset.percent, "90");
  assert.equal(contextUsage.dataset.level, "compact");
  assert.match(document.querySelector("#context-usage-percent").textContent, /کامپکت/);

  const menu = document.querySelector("#slash-command-menu");
  const options = document.querySelector("#slash-command-options");
  const prompt = document.querySelector("#prompt");
  const send = document.querySelector("#send-message");

  typePrompt(window, prompt, "/");

  assert.equal(menu.getAttribute("role"), "listbox");
  assert.equal(menu.classList.contains("hidden"), false);
  assert.equal(prompt.getAttribute("role"), "combobox");
  assert.equal(prompt.getAttribute("aria-autocomplete"), "list");
  assert.equal(prompt.getAttribute("aria-controls"), menu.id);
  assert.equal(prompt.getAttribute("aria-expanded"), "true");
  assert.ok(options.children.length >= 5);
  assert.equal(options.firstElementChild.getAttribute("role"), "option");
  assert.equal(options.firstElementChild.getAttribute("aria-selected"), "true");
  assert.equal(
    prompt.getAttribute("aria-activedescendant"),
    options.firstElementChild.id,
  );
  assert.notEqual(
    document.querySelector("#slash-command-status").textContent.trim(),
    "",
  );

  typePrompt(window, prompt, "/co");

  assert.deepEqual(
    [...options.querySelectorAll("[data-slash-command]")].map(
      (option) => option.dataset.slashCommand,
    ),
    ["compact"],
  );
  assert.equal(prompt.getAttribute("aria-activedescendant"), "slash-command-compact");
  assert.equal(options.firstElementChild.getAttribute("aria-disabled"), "false");

  const userRowsBeforeCompact =
    document.querySelectorAll(".message-row.user").length;
  pressKey(window, prompt, "Enter");
  await waitFor(
    () =>
      rpcRequests.some(
        (request) => request.method === "thread/compact/start",
      ),
    "compact RPC was not requested",
  );

  assert.deepEqual(
    rpcRequests
      .filter((request) => request.method === "thread/compact/start")
      .map((request) => request.params),
    [{ threadId: "thread-slash" }],
  );
  assert.equal(
    rpcRequests.filter((request) => request.method === "turn/start").length,
    0,
  );
  assert.equal(
    document.querySelectorAll(".message-row.user").length,
    userRowsBeforeCompact,
  );

  FakeEventSource.latest.emit("rpc", {
    method: "item/started",
    params: {
      threadId: "thread-slash",
      turnId: "compact-turn",
      item: {
        id: "context-compaction-1",
        type: "contextCompaction",
        status: "inProgress",
      },
    },
  });
  resolveCompactResponse(
    jsonResponse({ error: "simulated lost compact response" }, 500),
  );
  await waitFor(() => prompt.value === "", "accepted compact command was not cleared");

  const compactionCard = document.querySelector(
    "[data-item-id='context-compaction-1']",
  );
  assert.ok(compactionCard);
  assert.notEqual(compactionCard.textContent.trim(), "");
  assert.equal(compactionCard.getAttribute("aria-busy"), "true");
  assert.equal(compactionCard.classList.contains("running"), true);
  assert.match(compactionCard.querySelector("summary").textContent, /در حال فشرده‌سازی/);
  assert.match(document.querySelector("#toasts").textContent, /شروع کرده است/);

  FakeEventSource.latest.emit("rpc", {
    method: "item/completed",
    params: {
      threadId: "thread-slash",
      turnId: "compact-turn",
      item: {
        id: "context-compaction-1",
        type: "contextCompaction",
        status: "completed",
      },
    },
  });

  assert.equal(
    document.querySelector("[data-item-id='context-compaction-1']"),
    compactionCard,
  );
  assert.notEqual(compactionCard.textContent.trim(), "");
  assert.equal(compactionCard.getAttribute("aria-busy"), "false");
  assert.equal(compactionCard.classList.contains("completed"), true);
  assert.match(compactionCard.querySelector("summary").textContent, /فشرده شد/);

  const requestCountBeforeUnknown = rpcRequests.length;
  const userRowsBeforeUnknown =
    document.querySelectorAll(".message-row.user").length;
  typePrompt(window, prompt, "/definitely-unknown");
  assert.equal(menu.classList.contains("hidden"), false);
  assert.equal(options.children.length, 0);
  pressKey(window, prompt, "Enter");

  assert.equal(prompt.value, "/definitely-unknown");
  assert.equal(rpcRequests.length, requestCountBeforeUnknown);
  assert.equal(
    document.querySelectorAll(".message-row.user").length,
    userRowsBeforeUnknown,
  );
  assert.match(document.querySelector("#toasts").textContent, /پشتیبانی نمی‌شود/);

  for (const malformedCommand of ["/compact?", "/foo_bar", "/app", "/compact\n"]) {
    const requestsBeforeMalformed = rpcRequests.length;
    typePrompt(window, prompt, malformedCommand);
    pressKey(window, prompt, "Enter");
    assert.equal(prompt.value, malformedCommand);
    assert.equal(
      rpcRequests.length,
      requestsBeforeMalformed,
      `${malformedCommand} must not reach Codex`,
    );
  }

  typePrompt(window, prompt, "/");
  pressKey(window, prompt, "Escape");
  assert.equal(menu.classList.contains("hidden"), true);
  const requestsBeforeDismissedSlash = rpcRequests.length;
  pressKey(window, prompt, "Enter");
  assert.equal(prompt.value, "/");
  assert.equal(rpcRequests.length, requestsBeforeDismissedSlash);

  assert.equal(
    document.querySelector("#stop-turn").classList.contains("hidden"),
    false,
    "the source thread should still be busy before /new",
  );
  typePrompt(window, prompt, "/new");
  assert.equal(send.disabled, false);
  pressKey(window, prompt, "Enter");
  await waitFor(
    () => document.querySelector("#thread-title").textContent === "گفتگوی تازه",
    "/new did not switch to a fresh local conversation",
  );

  assert.equal(prompt.value, "");
  assert.equal(contextUsage.classList.contains("hidden"), true);
  assert.equal(
    rpcRequests.filter((request) => request.method === "thread/start").length,
    0,
  );
  assert.equal(
    rpcRequests.filter((request) => request.method === "turn/start").length,
    0,
  );
  assert.ok(
    document
      .querySelector("[data-thread-id='thread-slash']")
      .querySelector(".thread-activity.running"),
    "the busy source thread should keep running in the sidebar",
  );

  typePrompt(window, prompt, "/tmp");
  pressKey(window, prompt, "Enter");
  await waitFor(
    () => rpcRequests.some((request) => request.method === "turn/start"),
    "an absolute path should remain a normal prompt",
  );
  const pathTurn = rpcRequests.find((request) => request.method === "turn/start");
  assert.equal(
    pathTurn.params.input[0].text,
    "/tmp",
  );
});
