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
const ICON = join(ROOT, "public", "icon.svg");
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
    const threadStarts = [];
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
      const { method, params } = JSON.parse(options.body);
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
        threadStarts.push(params);
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
    assert.match(
      threadStarts[0].developerInstructions,
      /short descriptive headings, bullet lists, or numbered steps/,
    );
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

test("conversation typography keeps ChatGPT-like readable dimensions", async () => {
  const styles = await readFile(STYLES, "utf8");
  const root = styles.match(/:root\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";
  const page = styles.match(/html,\s*body\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";
  const assistant =
    styles.match(/\.assistant \.message-content\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";
  const messages = styles.match(/\.messages\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";
  const composer = styles.match(/\.composer\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";
  const headings =
    styles.match(
      /\.message-content h1,\s*\.message-content h2,\s*\.message-content h3\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body || "";
  const listMarker =
    styles.match(/\.message-content li::marker\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";

  assert.match(root, /--bg:\s*#212121/);
  assert.match(root, /--text:\s*#ececec/);
  assert.match(page, /font-size:\s*16px/);
  assert.match(page, /line-height:\s*1\.75/);
  assert.match(assistant, /font-size:\s*1rem/);
  assert.match(assistant, /line-height:\s*1\.75/);
  assert.match(messages, /width:\s*min\(48rem,/);
  assert.match(composer, /width:\s*min\(48rem,/);
  assert.match(headings, /font-weight:\s*700/);
  assert.match(headings, /text-wrap:\s*pretty/);
  assert.match(listMarker, /color:\s*var\(--muted-2\)/);
  assert.doesNotMatch(listMarker, /accent|danger|warning/);
});

test("favicon and in-app marks share a palette-aware terminal logo", async () => {
  const [index, icon, styles] = await Promise.all([
    readFile(INDEX, "utf8"),
    readFile(ICON, "utf8"),
    readFile(STYLES, "utf8"),
  ]);

  assert.match(index, /rel="icon" href="\/icon\.svg\?v=2"[^>]+sizes="any"/);
  assert.equal((index.match(/class="brand-logo"/g) || []).length, 2);
  assert.match(icon, /id="neon"/);
  assert.match(icon, /#42e8ff/);
  assert.match(icon, /#9b6dff/);
  assert.doesNotMatch(icon, /#d8ff6b/);
  assert.match(styles, /\.brand-logo\s*\{[^}]*stroke:\s*currentcolor/s);
});

test("composer uses a neon palette frame and neutral ChatGPT-like stop control", async () => {
  const [index, styles] = await Promise.all([
    readFile(INDEX, "utf8"),
    readFile(STYLES, "utf8"),
  ]);
  const composer = styles.match(/\.composer\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";
  const stop =
    [...styles.matchAll(/\.stop-button\s*\{(?<body>[^}]*)\}/g)]
      .map((match) => match.groups?.body || "")
      .find((rule) => /background:/.test(rule)) || "";

  assert.match(index, /class="context-chip-icon" data-icon="settings"/);
  assert.match(index, /id="stop-turn"[^>]*>[\s\S]*?<rect[^>]+rx="1\.5"/);
  assert.match(composer, /linear-gradient\(var\(--panel-3\), var\(--panel-3\)\) padding-box/);
  assert.match(composer, /rgb\(var\(--accent-rgb\) \/ 0\.58\)/);
  assert.match(composer, /rgb\(var\(--violet-rgb\) \/ 0\.46\)/);
  assert.match(stop, /color:\s*var\(--bg\)/);
  assert.match(stop, /background:\s*var\(--text\)/);
  assert.match(stop, /border-radius:\s*50%/);
  assert.doesNotMatch(stop, /danger|warning|#4b1728/);
});

test("failed technical activity chips stay visually neutral", async () => {
  const styles = await readFile(STYLES, "utf8");
  const failedSummary =
    styles.match(/\.activity-card\.failed summary\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";
  const failedIcon =
    styles.match(/\.activity-card\.failed summary::before\s*\{(?<body>[^}]*)\}/)?.groups?.body || "";

  assert.match(failedSummary, /color:\s*var\(--muted\)/);
  assert.match(failedSummary, /background:\s*var\(--panel-2\)/);
  assert.doesNotMatch(failedSummary, /--danger/);
  assert.match(failedIcon, /color:\s*var\(--muted-2\)/);
  assert.match(failedIcon, /content:\s*"›"/);
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

test(
  "busy conversations queue, edit, remove, and automatically send prompts in order",
  { concurrency: false },
  async (t) => {
    const now = Math.floor(Date.now() / 1000);
    const thread = {
      id: "queue-thread",
      name: "Queue test",
      cwd: "/workspace",
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      turns: [],
    };
    const starts = [];
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") return jsonResponse({ ready: true, cwd: "/workspace" });
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      if (request.method === "model/list") return jsonResponse({ result: { data: [] } });
      if (request.method === "thread/list") {
        return jsonResponse({ result: { data: [thread], nextCursor: null } });
      }
      if (request.method === "thread/resume") {
        return jsonResponse({ result: { thread, cwd: thread.cwd } });
      }
      if (request.method === "turn/start") {
        starts.push(request.params);
        return jsonResponse({
          result: {
            turn: {
              id: `queue-turn-${starts.length}`,
              status: "inProgress",
              items: [],
              error: null,
            },
          },
        });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };

    const { window } = await createHarness(t, {
      fetchHandler,
      initialUrl: "http://localhost/?session=queue-thread",
    });
    const document = window.document;
    await waitFor(
      () => document.querySelector("#thread-title").textContent === "Queue test",
      "queue thread was not hydrated",
    );

    typePrompt(window, "پیام اول");
    document.querySelector("#send-message").click();
    await waitFor(() => starts.length === 1, "first prompt was not started");

    typePrompt(window, "پیام دوم با تصویر /tmp/reference.png");
    document.querySelector("#send-message").click();
    typePrompt(window, "پیام سوم");
    document.querySelector("#send-message").click();
    assert.equal(document.querySelectorAll(".prompt-queue-item").length, 2);
    assert.equal(document.querySelector("#prompt").value, "");
    assert.equal(document.querySelector("#send-message").title, "افزودن به صف");

    document
      .querySelector(".prompt-queue-item [data-queue-action='edit']")
      .click();
    assert.match(document.querySelector("#prompt").value, /reference\.png/);
    document.querySelector("#prompt").value += " ویرایش‌شده";
    document.querySelector("#prompt").dispatchEvent(new window.Event("input", { bubbles: true }));
    document.querySelector("#send-message").click();
    assert.equal(document.querySelectorAll(".prompt-queue-item").length, 2);
    document
      .querySelector(".prompt-queue-item [data-queue-action='remove']")
      .click();
    assert.equal(document.querySelectorAll(".prompt-queue-item").length, 1);

    FakeEventSource.latest.emit("rpc", {
      method: "turn/completed",
      params: {
        threadId: thread.id,
        turn: { id: "queue-turn-1", status: "completed", items: [], error: null },
      },
    });
    await waitFor(() => starts.length === 2, "queued prompt did not start automatically");
    assert.equal(starts[1].input[0].text, "پیام دوم با تصویر /tmp/reference.png ویرایش‌شده");
    assert.equal(document.querySelectorAll(".prompt-queue-item").length, 0);
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);

test(
  "assistant actions quote responses and palette previews revert or persist correctly",
  { concurrency: false },
  async (t) => {
    const now = Math.floor(Date.now() / 1000);
    const thread = {
      id: "actions-thread",
      name: "Actions test",
      cwd: "/workspace",
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      turns: [
        {
          id: "actions-turn",
          status: "completed",
          items: [
            { id: "assistant-actions", type: "agentMessage", text: "خط اول\nخط دوم" },
          ],
        },
      ],
    };
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") return jsonResponse({ ready: true, cwd: "/workspace" });
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      if (request.method === "model/list") return jsonResponse({ result: { data: [] } });
      if (request.method === "thread/list") {
        return jsonResponse({ result: { data: [thread], nextCursor: null } });
      }
      if (request.method === "thread/resume") {
        return jsonResponse({ result: { thread, cwd: thread.cwd } });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };

    const { values, window } = await createHarness(t, {
      fetchHandler,
      initialUrl: "http://localhost/?session=actions-thread",
      savedSettings: {
        cwd: "/workspace",
        modelByProvider: { codex: "", claude: "" },
        palette: "red",
        provider: "codex",
        version: 5,
      },
    });
    const document = window.document;
    await waitFor(
      () => document.querySelector("[data-item-id='assistant-actions']"),
      "assistant action response was not rendered",
    );
    document
      .querySelector("[data-item-id='assistant-actions'] [data-message-action='quote']")
      .click();
    assert.equal(document.querySelector("#prompt").value, "> خط اول\n> خط دوم\n\n");

    assert.equal(document.documentElement.dataset.palette, "red");
    document.querySelector("#open-settings").click();
    const purple = document.querySelector("input[name='accent-palette'][value='purple']");
    purple.checked = true;
    purple.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(document.documentElement.dataset.palette, "purple");
    document.querySelector("#settings-cancel").click();
    assert.equal(document.documentElement.dataset.palette, "red");

    document.querySelector("#open-settings").click();
    const green = document.querySelector("input[name='accent-palette'][value='green']");
    green.checked = true;
    green.dispatchEvent(new window.Event("change", { bubbles: true }));
    document.querySelector("#save-settings").click();
    assert.equal(document.documentElement.dataset.palette, "green");
    assert.equal(JSON.parse(values.get("codex-web-settings")).palette, "green");
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);

test(
  "Plan and Goal modes use native Codex RPC fields and expose goal controls",
  { concurrency: false },
  async (t) => {
    const requests = [];
    const turns = [];
    let objective = "";
    let goalStatus = "active";
    const thread = {
      id: "mode-thread",
      name: "Mode test",
      cwd: "/workspace",
      provider: "codex",
      status: { type: "idle" },
      turns: [],
    };
    const goal = () => ({
      createdAt: 1,
      objective,
      status: goalStatus,
      threadId: thread.id,
      timeUsedSeconds: 0,
      tokenBudget: null,
      tokensUsed: 0,
      updatedAt: 1,
    });
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") return jsonResponse({ ready: true, cwd: "/workspace" });
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.method === "model/list") {
        return jsonResponse({
          result: {
            data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", isDefault: true }],
          },
        });
      }
      if (request.method === "collaborationMode/list") {
        return jsonResponse({
          result: { data: [{ name: "Plan", mode: "plan", reasoning_effort: "medium" }] },
        });
      }
      if (request.method === "thread/list") {
        return jsonResponse({ result: { data: [], nextCursor: null } });
      }
      if (request.method === "thread/start") return jsonResponse({ result: { thread } });
      if (request.method === "thread/goal/get") {
        return jsonResponse({ result: { goal: objective ? goal() : null } });
      }
      if (request.method === "thread/goal/set") {
        if (request.params.objective) objective = request.params.objective;
        if (request.params.status) goalStatus = request.params.status;
        return jsonResponse({ result: { goal: goal() } });
      }
      if (request.method === "thread/goal/clear") {
        objective = "";
        return jsonResponse({ result: { cleared: true } });
      }
      if (request.method === "turn/start") {
        turns.push(request.params);
        return jsonResponse({
          result: {
            turn: { id: "mode-turn", status: "inProgress", items: [], error: null },
          },
        });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };

    const { window } = await createHarness(t, {
      fetchHandler,
      savedSettings: {
        cwd: "/workspace",
        modelByProvider: { codex: "", claude: "" },
        palette: "cyan",
        provider: "codex",
        version: 5,
      },
    });
    const document = window.document;
    await waitFor(
      () => requests.some((request) => request.method === "collaborationMode/list"),
      "collaboration modes were not loaded",
    );

    document.querySelector("#composer-tools").click();
    document.querySelector("#plan-mode-option").click();
    assert.equal(document.querySelector("#plan-mode-option").getAttribute("aria-checked"), "true");
    assert.equal(document.querySelector("#composer-tool-label").textContent, "Plan");

    document.querySelector("#composer-tools").click();
    document.querySelector("#goal-mode-option").click();
    assert.equal(document.querySelector("#goal-dialog").open, true);
    document.querySelector("#goal-input").value = "همهٔ تست‌ها را سبز کن";
    document
      .querySelector("#goal-form")
      .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(document.querySelector("#prompt").value, "همهٔ تست‌ها را سبز کن");
    assert.equal(document.querySelector("#goal-progress").classList.contains("hidden"), false);

    document.querySelector("#goal-edit").click();
    document.querySelector("#goal-input").value = "تمام تست‌ها را سبز کن";
    document
      .querySelector("#goal-form")
      .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(document.querySelector("#prompt").value, "تمام تست‌ها را سبز کن");

    document.querySelector("#send-message").click();
    await waitFor(() => turns.length === 1, "Plan turn was not started");
    assert.equal(turns[0].input[0].text, "تمام تست‌ها را سبز کن");
    assert.deepEqual(turns[0].collaborationMode, {
      mode: "plan",
      settings: {
        developer_instructions: null,
        model: "gpt-test",
        reasoning_effort: "medium",
      },
    });
    assert.equal(turns[0].developerInstructions, undefined);
    const threadStart = requests.find((request) => request.method === "thread/start");
    assert.equal(threadStart.params.developerInstructions, undefined);
    const methods = requests.map((request) => request.method);
    assert.equal(methods.indexOf("thread/goal/set") < methods.indexOf("turn/start"), true);

    document.querySelector("#goal-toggle").click();
    await waitFor(
      () => document.querySelector("#goal-progress").dataset.status === "paused",
      "Goal was not paused",
    );
    assert.equal(document.querySelector("#goal-progress").dataset.status, "paused");

    document.querySelector("#goal-clear").click();
    await waitFor(
      () => document.querySelector("#goal-progress").classList.contains("hidden"),
      "Goal was not cleared",
    );
    assert.equal(document.querySelector("#goal-progress").classList.contains("hidden"), true);
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);

test(
  "Dictation inserts editable Persian speech into the composer",
  { concurrency: false },
  async (t) => {
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") return jsonResponse({ ready: true, cwd: "/workspace" });
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      if (request.method === "model/list") return jsonResponse({ result: { data: [] } });
      if (request.method === "collaborationMode/list") return jsonResponse({ result: { data: [] } });
      if (request.method === "thread/list") {
        return jsonResponse({ result: { data: [], nextCursor: null } });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };
    const { window } = await createHarness(t, { fetchHandler });
    class FakeSpeechRecognition {
      static latest = null;
      constructor() {
        FakeSpeechRecognition.latest = this;
      }
      start() {}
      stop() {
        this.onend?.();
      }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    const document = window.document;
    typePrompt(window, "مقدمه");
    document.querySelector("#dictate").click();
    assert.equal(document.querySelector("#dictate").classList.contains("active"), true);
    const result = [{ transcript: "این متن با صدا نوشته شد" }];
    result.isFinal = true;
    FakeSpeechRecognition.latest.onresult({ results: [result] });
    assert.equal(
      document.querySelector("#prompt").value,
      "مقدمه این متن با صدا نوشته شد",
    );
    document.querySelector("#dictate").click();
    assert.equal(document.querySelector("#dictate").classList.contains("active"), false);
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);

test(
  "recorded voice uploads securely and starts a localAudio turn",
  { concurrency: false },
  async (t) => {
    const turns = [];
    let audioUploads = 0;
    let threadListLoaded = false;
    const thread = {
      id: "voice-thread",
      name: "Voice test",
      cwd: "/workspace",
      provider: "codex",
      status: { type: "idle" },
      turns: [],
    };
    const fetchHandler = async (path, options = {}) => {
      if (path === "/api/status") return jsonResponse({ ready: true, cwd: "/workspace" });
      if (path === "/api/uploads/audio") {
        audioUploads += 1;
        assert.equal(options.headers["Content-Type"], "audio/webm");
        return jsonResponse({ path: "C:\\voice\\message.webm", type: "audio/webm" }, 201);
      }
      if (path !== "/api/rpc") throw new Error(`Unexpected request: ${path}`);
      const request = JSON.parse(options.body);
      if (request.method === "model/list") return jsonResponse({ result: { data: [] } });
      if (request.method === "collaborationMode/list") return jsonResponse({ result: { data: [] } });
      if (request.method === "thread/list") {
        threadListLoaded = true;
        return jsonResponse({ result: { data: [], nextCursor: null } });
      }
      if (request.method === "thread/start") return jsonResponse({ result: { thread } });
      if (request.method === "thread/goal/get") return jsonResponse({ result: { goal: null } });
      if (request.method === "turn/start") {
        turns.push(request.params);
        return jsonResponse({
          result: {
            turn: { id: "voice-turn", status: "inProgress", items: [], error: null },
          },
        });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    };
    const { window } = await createHarness(t, { fetchHandler });
    let trackStopped = false;
    let microphoneRequests = 0;
    let recorderStarts = 0;
    let recorderStops = 0;
    const mediaDevices = {
      async getUserMedia() {
        microphoneRequests += 1;
        return { getTracks: () => [{ stop: () => (trackStopped = true) }] };
      },
    };
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    class FakeMediaRecorder {
      static isTypeSupported(type) {
        return type.startsWith("audio/webm");
      }
      constructor(stream, options = {}) {
        this.stream = stream;
        this.mimeType = options.mimeType || "audio/webm";
        this.state = "inactive";
      }
      start() {
        recorderStarts += 1;
        this.state = "recording";
      }
      stop() {
        recorderStops += 1;
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])], {
            type: "audio/webm",
          }),
        });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
    assert.equal(window.MediaRecorder, FakeMediaRecorder);
    const document = window.document;
    await waitFor(() => threadListLoaded, "initial thread list was not loaded");
    await new Promise((resolve) => setTimeout(resolve, 25));
    await waitFor(() => !document.querySelector("#record-voice").disabled, "voice button stayed disabled");
    document
      .querySelector("#record-voice")
      .dispatchEvent(new window.Event("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(document.querySelector("#toasts").textContent.trim(), "");
    assert.equal(microphoneRequests, 1);
    assert.equal(recorderStarts, 1);
    assert.equal(recorderStops, 0);
    assert.equal(document.querySelector("#voice-recorder").className, "voice-recorder");
    await waitFor(
      () => !document.querySelector("#voice-recorder").classList.contains("hidden"),
      "voice recorder did not open",
    );
    document.querySelector("#voice-send").click();
    await waitFor(() => turns.length === 1, "voice turn was not started");
    assert.equal(audioUploads, 1);
    assert.deepEqual(turns[0].input, [
      { type: "localAudio", path: "C:\\voice\\message.webm" },
    ]);
    assert.equal(trackStopped, true);
    assert.match(document.querySelector(".message-row.user .message-content").textContent, /پیام صوتی/);
    await new Promise((resolve) => setTimeout(resolve, 25));
  },
);
