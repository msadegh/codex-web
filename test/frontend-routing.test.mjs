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
const STYLES = join(ROOT, "public", "styles.css");

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
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function installHistory(window, initialUrl) {
  const entries = [{ state: null, url: new URL(initialUrl) }];
  let index = 0;
  const location = {};
  Object.defineProperty(location, "href", {
    configurable: true,
    get: () => entries[index].url.href,
  });

  function dispatchPopState() {
    const event = new window.Event("popstate");
    Object.defineProperty(event, "state", {
      configurable: true,
      value: entries[index].state,
    });
    window.dispatchEvent(event);
  }

  const history = {
    back() {
      if (index === 0) return;
      index -= 1;
      dispatchPopState();
    },
    forward() {
      if (index >= entries.length - 1) return;
      index += 1;
      dispatchPopState();
    },
    get length() {
      return entries.length;
    },
    pushState(state, _unused, value) {
      entries.splice(index + 1);
      entries.push({
        state: structuredClone(state),
        url: new URL(value, entries[index].url),
      });
      index = entries.length - 1;
    },
    replaceState(state, _unused, value) {
      entries[index] = {
        state: structuredClone(state),
        url: new URL(value, entries[index].url),
      };
    },
    get state() {
      return entries[index].state;
    },
  };
  Object.defineProperties(window, {
    history: { configurable: true, value: history },
    location: { configurable: true, value: location },
  });
  return history;
}

function installSelectValue(window) {
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() {
      const options = [...this.querySelectorAll("option")];
      if (options.some((option) => option.value === this.__testValue)) {
        return this.__testValue;
      }
      return options[0]?.value || "";
    },
    set(value) {
      const normalized = String(value);
      this.__testValue = [...this.querySelectorAll("option")].some(
        (option) => option.value === normalized,
      )
        ? normalized
        : "";
    },
  });
}

function installDialogs(window) {
  for (const dialog of window.document.querySelectorAll("dialog")) {
    Object.defineProperty(dialog, "open", {
      configurable: true,
      get() {
        return this.hasAttribute("open");
      },
    });
    dialog.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    dialog.close = function close() {
      if (!this.open) return;
      this.removeAttribute("open");
      this.dispatchEvent(new window.Event("close"));
    };
  }
}

async function createHarness(t, {
  fetchHandler,
  initialUrl = "http://localhost/",
  savedSettings = null,
}) {
  const html = await readFile(INDEX, "utf8");
  const { window } = parseHTML(html);
  const values = new Map();
  if (savedSettings) {
    values.set("codex-web-settings", JSON.stringify(savedSettings));
  }
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
  installSelectValue(window);
  installDialogs(window);
  const history = installHistory(window, initialUrl);
  window.HTMLElement.prototype.scrollTo = function scrollTo(options = {}) {
    if (typeof options.top === "number") this.scrollTop = options.top;
  };
  if (!window.HTMLTextAreaElement.prototype.setSelectionRange) {
    window.HTMLTextAreaElement.prototype.setSelectionRange =
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

  const nativeSetTimeout = globalThis.setTimeout;
  const globals = {
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    crypto: { randomUUID },
    document: window.document,
    EventSource: FakeEventSource,
    fetch: fetchHandler,
    localStorage: window.localStorage,
    navigator: window.navigator,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    setTimeout(callback, delay = 0, ...args) {
      return nativeSetTimeout(callback, delay >= 4_000 ? 0 : delay, ...args);
    },
    window,
  };
  const originals = new Map(
    Object.keys(globals).map((name) => [
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
  t.after(() => {
    FakeEventSource.latest?.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    window.close();
  });

  await import(`${pathToFileURL(APP).href}?frontend-routing=${randomUUID()}`);
  return { history, values, window };
}

function typePrompt(window, value) {
  const prompt = window.document.querySelector("#prompt");
  prompt.value = value;
  prompt.dispatchEvent(new window.Event("input", { bubbles: true }));
  return prompt;
}

test(
  "deep links hydrate independently and use readiness of the opened thread provider",
  { concurrency: false },
  async (t) => {
    const now = Math.floor(Date.now() / 1000);
    const thread = {
      id: "codex-deep-link",
      name: "Codex deep link",
      cwd: "/workspace",
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      turns: [],
    };
    let resolveClaudeModels;
    let claudeModelsResolved = false;
    const requests = [];
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") {
        return jsonResponse({
          cwd: "/workspace",
          providers: {
            claude: { message: "Claude unavailable", ready: false },
            codex: { ready: true },
          },
          ready: true,
        });
      }
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.method === "model/list" && request.params.provider === "claude") {
        return new Promise((resolve) => {
          resolveClaudeModels = () => {
            claudeModelsResolved = true;
            resolve(jsonResponse({ result: { data: [] } }));
          };
        });
      }
      if (request.method === "thread/list") {
        return jsonResponse({ result: { data: [thread], nextCursor: null } });
      }
      if (request.method === "thread/resume") {
        return jsonResponse({ result: { thread, cwd: thread.cwd } });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };

    const { history, window } = await createHarness(t, {
      fetchHandler,
      initialUrl:
        "http://localhost/?view=compact&thread=codex-deep-link#latest-message",
      savedSettings: {
        cwd: "/workspace",
        modelByProvider: { claude: "", codex: "" },
        provider: "claude",
        version: 4,
      },
    });

    await waitFor(
      () => window.document.querySelector("#thread-title").textContent === "Codex deep link",
      "deep-linked Codex thread waited for the unavailable default Claude provider",
    );
    assert.equal(claudeModelsResolved, false);
    assert.equal(
      requests.some(
        (request) =>
          request.method === "thread/resume" &&
          request.params.threadId === "codex-deep-link",
      ),
      true,
    );
    const canonicalUrl = new URL(window.location.href);
    assert.equal(canonicalUrl.searchParams.get("session"), "codex-deep-link");
    assert.equal(canonicalUrl.searchParams.get("thread"), null);
    assert.equal(canonicalUrl.searchParams.get("view"), "compact");
    assert.equal(canonicalUrl.hash, "#latest-message");
    assert.equal(history.length, 1);
    assert.equal(
      window.document.querySelector("#connection-label").textContent,
      "Codex متصل است",
    );

    FakeEventSource.latest.emit("status", {
      provider: "claude",
      ready: false,
      message: "Claude still unavailable",
    });
    assert.equal(
      window.document.querySelector("#connection-label").textContent,
      "Codex متصل است",
    );
    FakeEventSource.latest.emit("status", {
      ready: false,
      message: "Codex stopped",
    });
    assert.equal(
      window.document.querySelector("#connection-label").textContent,
      "Codex stopped",
    );
    resolveClaudeModels();
    await waitFor(() => claudeModelsResolved, "pending Claude model request did not settle");
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);

test(
  "session takes precedence over a legacy thread parameter and canonicalization preserves the URL",
  { concurrency: false },
  async (t) => {
    const now = Math.floor(Date.now() / 1000);
    const threads = new Map(
      [
        ["preferred-session", "Preferred session"],
        ["legacy-thread", "Legacy thread"],
      ].map(([id, name]) => [
        id,
        {
          id,
          name,
          cwd: "/workspace",
          createdAt: now,
          updatedAt: now,
          status: { type: "idle" },
          turns: [],
        },
      ]),
    );
    const resumed = [];
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") {
        return jsonResponse({
          cwd: "/workspace",
          providers: {
            claude: { ready: true },
            codex: { ready: true },
          },
          ready: true,
        });
      }
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      if (request.method === "model/list") {
        return jsonResponse({ result: { data: [] } });
      }
      if (request.method === "thread/list") {
        return jsonResponse({
          result: { data: [...threads.values()], nextCursor: null },
        });
      }
      if (request.method === "thread/resume") {
        resumed.push(request.params.threadId);
        const thread = threads.get(request.params.threadId);
        return jsonResponse({ result: { thread, cwd: thread.cwd } });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };

    const { history, window } = await createHarness(t, {
      fetchHandler,
      initialUrl:
        "http://localhost/?thread=legacy-thread&filter=active&session=preferred-session#turn",
    });

    await waitFor(
      () =>
        window.document.querySelector("#thread-title").textContent ===
        "Preferred session",
      "the canonical session parameter did not take precedence",
    );
    assert.deepEqual(resumed, ["preferred-session"]);
    const canonicalUrl = new URL(window.location.href);
    assert.equal(canonicalUrl.searchParams.get("session"), "preferred-session");
    assert.equal(canonicalUrl.searchParams.get("thread"), null);
    assert.equal(canonicalUrl.searchParams.get("filter"), "active");
    assert.equal(canonicalUrl.hash, "#turn");
    assert.equal(history.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);

test(
  "new sessions replace their draft URL and Back/Forward restore the matching draft",
  { concurrency: false },
  async (t) => {
    const now = Math.floor(Date.now() / 1000);
    const oldSummary = {
      id: "old-thread",
      name: "Old thread",
      cwd: "/workspace",
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
    };
    const newThread = {
      ...oldSummary,
      id: "new-thread",
      name: "New thread",
      turns: [],
    };
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") {
        return jsonResponse({
          cwd: "/workspace",
          providers: {
            claude: { ready: true },
            codex: { ready: true },
          },
          ready: true,
        });
      }
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const { method } = JSON.parse(options.body);
      if (method === "model/list") return jsonResponse({ result: { data: [] } });
      if (method === "thread/list") {
        return jsonResponse({ result: { data: [oldSummary], nextCursor: null } });
      }
      if (method === "thread/resume") {
        return jsonResponse({
          result: { thread: { ...oldSummary, turns: [] }, cwd: "/workspace" },
        });
      }
      if (method === "thread/start") {
        return jsonResponse({ result: { thread: newThread, cwd: "/workspace" } });
      }
      if (method === "turn/start") {
        return jsonResponse({
          result: {
            turn: { id: "new-turn", items: [], status: "inProgress" },
          },
        });
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    };

    const { history, window } = await createHarness(t, {
      fetchHandler,
      initialUrl: "http://localhost/?layout=wide#composer",
    });
    await waitFor(
      () => typeof history.state?.draftId === "string",
      "initial draft history state was not installed",
    );
    const draftId = history.state.draftId;
    const prompt = typePrompt(window, "پیش‌نویس حفظ‌شونده");

    await waitFor(
      () => window.document.querySelector("[data-thread-id='old-thread']"),
      "old thread was not listed",
    );
    window.document.querySelector("[data-thread-id='old-thread']").click();
    await waitFor(
      () => new URL(window.location.href).searchParams.get("session") === "old-thread",
      "opening an existing session did not push its URL",
    );
    history.back();
    await waitFor(
      () =>
        new URL(window.location.href).searchParams.get("session") === null &&
        prompt.value === "پیش‌نویس حفظ‌شونده",
      "browser Back did not restore the draft belonging to its history entry",
    );
    assert.equal(history.state.draftId, draftId);
    history.forward();
    await waitFor(
      () =>
        new URL(window.location.href).searchParams.get("session") === "old-thread" &&
        window.document.querySelector("#thread-title").textContent === "Old thread",
      "browser Forward did not restore the existing session",
    );
    history.back();
    await waitFor(
      () =>
        new URL(window.location.href).searchParams.get("session") === null &&
        prompt.value === "پیش‌نویس حفظ‌شونده",
      "browser Back did not restore the draft after a Forward navigation",
    );

    window.document.querySelector("#send-message").click();
    await waitFor(
      () => new URL(window.location.href).searchParams.get("session") === "new-thread",
      "the first message did not replace the draft URL with the created session",
    );
    assert.deepEqual(history.state, { threadId: "new-thread" });
    const finalUrl = new URL(window.location.href);
    assert.equal(finalUrl.searchParams.get("thread"), null);
    assert.equal(finalUrl.searchParams.get("layout"), "wide");
    assert.equal(finalUrl.hash, "#composer");
  },
);

test(
  "popstate and SSE hydration share one resume flight and keep the newest history target",
  { concurrency: false },
  async (t) => {
    const now = Math.floor(Date.now() / 1000);
    const threads = new Map(
      ["race-a", "race-b"].map((id) => [
        id,
        {
          id,
          name: id === "race-a" ? "Race A" : "Race B",
          cwd: "/workspace",
          createdAt: now,
          updatedAt: now,
          status: { type: "idle" },
          turns: [],
        },
      ]),
    );
    const resumeCounts = new Map();
    const resumeResolvers = new Map();
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") {
        return jsonResponse({
          cwd: "/workspace",
          providers: {
            claude: { ready: true },
            codex: { ready: true },
          },
          ready: true,
        });
      }
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      if (request.method === "model/list") return jsonResponse({ result: { data: [] } });
      if (request.method === "thread/list") {
        return jsonResponse({
          result: { data: [...threads.values()], nextCursor: null },
        });
      }
      if (request.method === "thread/resume") {
        const threadId = request.params.threadId;
        resumeCounts.set(threadId, (resumeCounts.get(threadId) || 0) + 1);
        return new Promise((resolve) => {
          resumeResolvers.set(threadId, () =>
            resolve(
              jsonResponse({
                result: { thread: threads.get(threadId), cwd: "/workspace" },
              }),
            ),
          );
        });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };

    const { history, window } = await createHarness(t, { fetchHandler });
    await waitFor(
      () => typeof history.state?.draftId === "string",
      "initial hydration did not finish",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    function navigateTo(threadId) {
      history.pushState({ threadId }, "", `/?session=${threadId}`);
      const event = new window.Event("popstate");
      Object.defineProperty(event, "state", {
        configurable: true,
        value: { threadId },
      });
      window.dispatchEvent(event);
    }

    navigateTo("race-a");
    await waitFor(
      () => resumeCounts.get("race-a") === 1,
      "first popstate did not start its resume",
    );
    FakeEventSource.latest.emit("status", {
      message: "Codex status refreshed",
      provider: "codex",
      ready: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(resumeCounts.get("race-a"), 1);

    navigateTo("race-b");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(resumeCounts.get("race-b") || 0, 0);
    resumeResolvers.get("race-a")();
    await waitFor(
      () => resumeCounts.get("race-b") === 1,
      "latest popstate target was not resumed after the stale request settled",
    );
    resumeResolvers.get("race-b")();
    await waitFor(
      () => window.document.querySelector("#thread-title").textContent === "Race B",
      "stale hydration won over the newest history target",
    );
    assert.equal(resumeCounts.get("race-a"), 1);
    assert.equal(resumeCounts.get("race-b"), 1);
    assert.equal(
      new URL(window.location.href).searchParams.get("session"),
      "race-b",
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);

test("plan step text can shrink and wrap unbroken paths on narrow viewports", async () => {
  const [app, styles] = await Promise.all([
    readFile(APP, "utf8"),
    readFile(STYLES, "utf8"),
  ]);
  assert.match(app, /text\.className = "plan-step-text"/);
  const rule = styles.match(/\.plan-step-text\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";
  assert.match(rule, /min-width:\s*0/);
  assert.match(rule, /flex:\s*1 1 auto/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
});

test(
  "cancelling a provider switch restores model options and provider-specific safety UI",
  { concurrency: false },
  async (t) => {
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") {
        return jsonResponse({
          cwd: "/workspace",
          providers: {
            claude: { ready: true },
            codex: { ready: true },
          },
          ready: true,
        });
      }
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      if (request.method === "thread/list") {
        return jsonResponse({ result: { data: [], nextCursor: null } });
      }
      if (request.method === "model/list") {
        const data =
          request.params.provider === "claude"
            ? [{ displayName: "Claude Sonnet", id: "sonnet", model: "sonnet" }]
            : [{ displayName: "Codex Test", id: "codex-test", model: "codex-test" }];
        return jsonResponse({ result: { data } });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };

    const { window } = await createHarness(t, {
      fetchHandler,
      savedSettings: {
        cwd: "/workspace",
        effort: "ultra",
        modelByProvider: { claude: "sonnet", codex: "codex-test" },
        provider: "codex",
        version: 4,
      },
    });
    const document = window.document;
    await waitFor(
      () => document.querySelector("#model-select option[value='codex-test']"),
      "Codex models were not loaded",
    );
    document.querySelector("#open-settings").click();

    const provider = document.querySelector("#provider-select");
    provider.value = "claude";
    provider.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitFor(
      () => document.querySelector("#model-select option[value='sonnet']"),
      "Claude models were not loaded after switching provider",
    );
    assert.equal(document.querySelector("#settings-dialog").dataset.provider, "claude");
    assert.equal(document.querySelector("#default-model-option").textContent, "پیش‌فرض Claude");
    assert.equal(document.querySelector("#effort-select option[value='ultra']").disabled, true);
    assert.equal(document.querySelector("#effort-select option[value='ultra']").hidden, true);

    const permission = document.querySelector("#claude-permission-mode");
    permission.value = "bypassPermissions";
    permission.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(document.querySelector("#full-access-warning").classList.contains("visible"), true);
    const sandbox = document.querySelector("#sandbox-select");
    sandbox.value = "workspace-write";
    sandbox.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(document.querySelector("#full-access-warning").classList.contains("visible"), true);

    document.querySelector("#settings-cancel").click();
    document.querySelector("#open-settings").click();
    assert.equal(provider.value, "codex");
    assert.ok(document.querySelector("#model-select option[value='codex-test']"));
    assert.equal(document.querySelector("#model-select option[value='sonnet']"), null);
    assert.equal(document.querySelector("#default-model-option").textContent, "پیش‌فرض Codex");
    assert.equal(document.querySelector("#effort-select option[value='ultra']").disabled, false);
    assert.equal(document.querySelector("#effort-select option[value='ultra']").hidden, false);
  },
);

test(
  "Claude conversations keep unsupported compact commands out of RPC",
  { concurrency: false },
  async (t) => {
    const now = Math.floor(Date.now() / 1000);
    const thread = {
      id: "claude:slash-thread",
      provider: "claude",
      name: "Claude slash",
      cwd: "/workspace",
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      turns: [],
    };
    const requests = [];
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") {
        return jsonResponse({
          cwd: "/workspace",
          providers: {
            claude: { ready: true },
            codex: { ready: true },
          },
          ready: true,
        });
      }
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.method === "model/list") return jsonResponse({ result: { data: [] } });
      if (request.method === "thread/list") {
        return jsonResponse({ result: { data: [thread], nextCursor: null } });
      }
      if (request.method === "thread/resume") {
        return jsonResponse({ result: { thread, cwd: thread.cwd } });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };

    const { window } = await createHarness(t, {
      fetchHandler,
      initialUrl: "http://localhost/?session=claude%3Aslash-thread",
    });
    await waitFor(
      () => window.document.querySelector("#thread-title").textContent === "Claude slash",
      "Claude thread was not hydrated",
    );
    const prompt = typePrompt(window, "/compact");
    assert.equal(window.document.querySelector("#send-message").disabled, true);
    const enter = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperties(enter, {
      isComposing: { configurable: true, value: false },
      key: { configurable: true, value: "Enter" },
      shiftKey: { configurable: true, value: false },
    });
    prompt.dispatchEvent(enter);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      requests.some((request) => request.method === "thread/compact/start"),
      false,
    );
    assert.equal(prompt.value, "/compact");
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);
