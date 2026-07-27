import { escapeHtml, markdown } from "./markdown.js";

const $ = (selector) => document.querySelector(selector);
const BASE_DOCUMENT_TITLE = "Codex Web";
const NEW_THREAD_DRAFT_PREFIX = "__new_thread__";
const OPTIMISTIC_USER_MESSAGE_PREFIX = "__optimistic_user_message__";
const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_IMAGES_PER_BATCH = 20;
const IMAGE_EXTENSIONS = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const SLASH_COMMANDS = [
  {
    name: "compact",
    label: "فشرده‌سازی گفتگو",
    description: "خلاصه‌کردن context فعلی و آزادکردن فضای گفتگو",
  },
  {
    name: "new",
    label: "گفتگوی تازه",
    description: "شروع یک گفتگوی مستقل جدید",
  },
  {
    name: "clear",
    label: "پاک‌کردن و شروع دوباره",
    description: "نام دیگر /new برای آغاز یک گفتگوی تازه",
  },
  {
    name: "resume",
    label: "ادامهٔ یک گفتگو",
    description: "رفتن به فهرست گفتگوهای ذخیره‌شده",
  },
  {
    name: "status",
    label: "وضعیت گفتگو",
    description: "نمایش شناسه، مدل، دسترسی و مصرف context",
  },
  {
    name: "model",
    label: "انتخاب مدل",
    description: "بازکردن تنظیمات مدل گفتگوهای تازه",
  },
  {
    name: "permissions",
    label: "تنظیم دسترسی‌ها",
    description: "بازکردن تنظیمات sandbox و approval",
  },
  {
    name: "settings",
    label: "تنظیمات",
    description: "بازکردن همهٔ تنظیمات Codex Web",
  },
  {
    name: "help",
    label: "راهنمای فرمان‌ها",
    description: "نمایش فهرست فرمان‌هایی که این رابط پشتیبانی می‌کند",
  },
].map((command) => ({ ...command, token: `/${command.name}` }));

const COMMON_ABSOLUTE_PATH_ROOTS = new Set([
  "Applications",
  "Library",
  "System",
  "Users",
  "Volumes",
  "app",
  "bin",
  "boot",
  "dev",
  "etc",
  "home",
  "lib",
  "lib64",
  "media",
  "mnt",
  "nix",
  "opt",
  "private",
  "proc",
  "root",
  "run",
  "sbin",
  "snap",
  "srv",
  "sys",
  "tmp",
  "usr",
  "var",
  "workspace",
]);

const KNOWN_CODEX_COMMAND_NAMES = new Set([
  ...SLASH_COMMANDS.map((command) => command.name),
  "agent",
  "app",
  "apps",
  "approve",
  "archive",
  "btw",
  "clean",
  "cloud",
  "cloud-environment",
  "copy",
  "debug-config",
  "delete",
  "diff",
  "exit",
  "experimental",
  "fast",
  "feedback",
  "fork",
  "goal",
  "hooks",
  "ide",
  "ide-context",
  "import",
  "init",
  "keymap",
  "local",
  "logout",
  "mcp",
  "memories",
  "mention",
  "personality",
  "pet",
  "pets",
  "plan",
  "plugins",
  "project",
  "ps",
  "quit",
  "raw",
  "reasoning",
  "rename",
  "review",
  "sandbox-add-read-dir",
  "setup-default-sandbox",
  "side",
  "skills",
  "statusline",
  "stop",
  "subagents",
  "theme",
  "title",
  "usage",
  "vim",
  "worktree",
]);

const elements = {
  addImages: $("#add-images"),
  approvalAccept: $("#approval-accept"),
  approvalCancel: $("#approval-cancel"),
  approvalContext: $("#approval-context"),
  approvalDecline: $("#approval-decline"),
  approvalDetail: $("#approval-detail"),
  approvalDialog: $("#approval-dialog"),
  approvalLater: $("#approval-later"),
  approvalReason: $("#approval-reason"),
  approvalSession: $("#approval-session"),
  approvalTitle: $("#approval-title"),
  approvalSelect: $("#approval-select"),
  connectionLabel: $("#connection-label"),
  conversation: $("#conversation"),
  cwdChip: $("#cwd-chip"),
  cwdInput: $("#cwd-input"),
  cwdLabel: $("#cwd-label"),
  effortSelect: $("#effort-select"),
  fullAccessWarning: $("#full-access-warning"),
  headerSettings: $("#header-settings"),
  imageInput: $("#image-input"),
  inputDialog: $("#input-dialog"),
  inputForm: $("#input-request-form"),
  inputContext: $("#input-context"),
  inputCancel: $("#input-cancel"),
  inputDecline: $("#input-decline"),
  inputLater: $("#input-later"),
  inputQuestions: $("#input-questions"),
  inputSubmit: $("#input-submit"),
  menuButton: $("#menu-button"),
  messages: $("#messages"),
  mobileScrim: $("#mobile-scrim"),
  modelLabel: $("#model-label"),
  modelSelect: $("#model-select"),
  newChat: $("#new-chat"),
  nextUserMessage: $("#next-user-message"),
  openSettings: $("#open-settings"),
  personalitySelect: $("#personality-select"),
  providerSelect: $("#provider-select"),
  claudePermissionField: $("#claude-permission-field"),
  claudePermissionMode: $("#claude-permission-mode"),
  previousUserMessage: $("#previous-user-message"),
  prompt: $("#prompt"),
  sandboxSelect: $("#sandbox-select"),
  saveSettings: $("#save-settings"),
  scrollBottom: $("#scroll-bottom"),
  sendMessage: $("#send-message"),
  settingsCancel: $("#settings-cancel"),
  settingsClose: $("#settings-close"),
  settingsDialog: $("#settings-dialog"),
  settingsForm: $("#settings-form"),
  sidebarClose: $("#sidebar-close"),
  slashCommandEmpty: $("#slash-command-empty"),
  slashCommandMenu: $("#slash-command-menu"),
  slashCommandOptions: $("#slash-command-options"),
  slashCommandStatus: $("#slash-command-status"),
  statusDot: $("#status-dot"),
  stopTurn: $("#stop-turn"),
  threadList: $("#thread-list"),
  threadMeta: $("#thread-meta"),
  threadSearch: $("#thread-search"),
  threadTitle: $("#thread-title"),
  toasts: $("#toasts"),
  uploadStatus: $("#upload-status"),
  userMessageNavigationStatus: $("#user-message-navigation-status"),
  welcome: $("#welcome"),
};

const defaultSettings = {
  approvalPolicy: "",
  claudePermissionMode: "acceptEdits",
  cwd: "",
  effort: "",
  modelByProvider: { codex: "", claude: "" },
  personality: "",
  provider: "codex",
  sandbox: "",
};

const SETTINGS_VERSION = 4;

const state = {
  activeInteractionKey: null,
  busy: false,
  completedTurns: new Set(),
  compactPendingThreads: new Set(),
  connected: false,
  currentThread: null,
  currentThreadId: null,
  currentTurnId: null,
  drafts: new Map(),
  eventSource: null,
  followOutput: true,
  itemViews: new Map(),
  navigationVersion: 0,
  models: [],
  modelsByProvider: { codex: [], claude: [] },
  navigating: false,
  openingThreadId: null,
  newDraftId: crypto.randomUUID(),
  notifiedTurns: new Set(),
  optimisticUserMessages: new Map(),
  pendingInteractions: new Map(),
  postponedInteractions: new Set(),
  forceNextScroll: false,
  imageUploadsByDraft: new Map(),
  interactionSubmitting: false,
  scrollFrame: null,
  scrollingToBottom: false,
  settings: loadSettings(),
  slashActiveIndex: 0,
  slashCommandExecuting: false,
  slashDismissedValue: null,
  slashFilteredCommands: [],
  threadActivity: new Map(),
  threadEventBacklog: new Map(),
  threadRuntime: new Map(),
  threadTokenUsage: new Map(),
  threads: [],
  threadsRefreshVersion: 0,
  urlHydrated: false,
  userMessageHighlightTimer: null,
  userMessageNavigationFrame: null,
  userNavigationItemId: null,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("codex-web-settings") || "{}");
    const { model: legacyModel, modelByProvider: storedModels, ...savedSettings } = saved;
    const modelByProvider = {
      ...defaultSettings.modelByProvider,
      ...(storedModels || {}),
    };
    if (!modelByProvider.codex && legacyModel) modelByProvider.codex = legacyModel;
    return {
      ...defaultSettings,
      ...savedSettings,
      claudePermissionMode:
        savedSettings.claudePermissionMode || defaultSettings.claudePermissionMode,
      modelByProvider,
      provider: savedSettings.provider === "claude" ? "claude" : defaultSettings.provider,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function persistSettings() {
  const { model, ...settings } = state.settings;
  localStorage.setItem(
    "codex-web-settings",
    JSON.stringify({ ...settings, version: SETTINGS_VERSION }),
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.details = data.details;
    error.status = response.status;
    throw error;
  }
  return data;
}

function providerForThread(threadId) {
  return typeof threadId === "string" && threadId.startsWith("claude:")
    ? "claude"
    : "codex";
}

async function rpc(method, params = {}) {
  const response = await api("/api/rpc", {
    method: "POST",
    body: JSON.stringify({ method, params }),
  });
  return response.result;
}

function toast(message, kind = "", options = {}) {
  const actionable = typeof options.onClick === "function";
  const node = document.createElement(actionable ? "button" : "div");
  if (actionable) node.type = "button";
  node.className = `toast ${kind} ${actionable ? "actionable" : ""}`.trim();
  node.textContent = message;
  elements.toasts.append(node);
  const timer = setTimeout(() => node.remove(), options.duration || 4500);
  if (actionable) {
    node.addEventListener("click", () => {
      clearTimeout(timer);
      node.remove();
      options.onClick();
    });
  }
}

function showError(error, context = "") {
  console.error(context, error);
  const detail = error.details?.message || error.message || String(error);
  toast(`${context ? `${context}: ` : ""}${detail}`, "error");
}

function slashCommandByName(name) {
  return SLASH_COMMANDS.find((command) => command.name === name) || null;
}

function parseSlashCommand(text) {
  const raw = String(text || "");
  const candidate = raw.trimStart();
  if (!candidate.startsWith("/")) return null;
  const token = candidate.match(/^\/\S*/)?.[0] || "/";
  const singlePathPart = token.slice(1);
  const commandNameMatch = singlePathPart.match(/^([a-z][a-z0-9-]*)$/i);
  const knownCodexCommand = Boolean(
    commandNameMatch && KNOWN_CODEX_COMMAND_NAMES.has(commandNameMatch[1].toLowerCase()),
  );
  const pathLike =
    !knownCodexCommand &&
    (token.slice(1).includes("/") ||
      token.includes("\\") ||
      /^\/[^/\\\s]*\.[^/\\\s]+$/.test(token) ||
      COMMON_ABSOLUTE_PATH_ROOTS.has(singlePathPart) ||
      /^[A-Z][A-Za-z0-9._-]*$/.test(singlePathPart));
  if (pathLike) return null;
  const match = token.match(/^\/([a-z][a-z0-9-]*)$/i);
  return {
    arguments: candidate.slice(token.length).trim(),
    command: match ? slashCommandByName(match[1].toLowerCase()) : null,
    multiline: /[\r\n]/.test(raw),
    token,
  };
}

function slashCommandAvailability(command) {
  if (state.navigating) return { available: false, reason: "تا پایان بازشدن گفتگو صبر کنید." };
  if (state.slashCommandExecuting && command.name === "compact") {
    return { available: false, reason: "یک فرمان دیگر در حال اجراست." };
  }
  if (command.name === "compact") {
    if (!state.connected) return { available: false, reason: "Codex هنوز متصل نیست." };
    if (!state.currentThreadId) {
      return { available: false, reason: "ابتدا یک گفتگو را شروع یا باز کنید." };
    }
    if (state.busy || state.compactPendingThreads.has(state.currentThreadId)) {
      return { available: false, reason: "پس از پایان کار فعلی دوباره امتحان کنید." };
    }
    if (imageUploadsForDraft() > 0) {
      return { available: false, reason: "تا پایان افزودن تصویرها صبر کنید." };
    }
  }
  if (
    (command.name === "new" || command.name === "clear") &&
    !state.currentThreadId &&
    imageUploadsForDraft() > 0
  ) {
    return { available: false, reason: "تا پایان افزودن تصویرها صبر کنید." };
  }
  return { available: true, reason: "" };
}

function slashComposerQuery() {
  const value = elements.prompt.value;
  if (state.navigating || state.slashDismissedValue === value) return null;
  if (!/^\/[a-z0-9-]*$/i.test(value)) return null;
  const { start, end } = promptSelection();
  if (start !== value.length || end !== value.length) return null;
  return value.slice(1).toLowerCase();
}

function closeSlashCommandMenu(dismiss = false) {
  if (dismiss) state.slashDismissedValue = elements.prompt.value;
  state.slashFilteredCommands = [];
  state.slashActiveIndex = 0;
  elements.slashCommandMenu.classList.add("hidden");
  elements.prompt.setAttribute("aria-expanded", "false");
  elements.prompt.removeAttribute("aria-activedescendant");
  elements.slashCommandStatus.textContent = "";
}

function updateSlashCommandMenu({ keepActiveCommand = true } = {}) {
  const query = slashComposerQuery();
  if (query === null) {
    closeSlashCommandMenu();
    return;
  }

  const previousActive = keepActiveCommand
    ? state.slashFilteredCommands[state.slashActiveIndex]?.name
    : null;
  state.slashFilteredCommands = SLASH_COMMANDS.filter((command) =>
    command.name.includes(query),
  );
  const previousIndex = previousActive
    ? state.slashFilteredCommands.findIndex((command) => command.name === previousActive)
    : -1;
  state.slashActiveIndex =
    previousIndex >= 0
      ? previousIndex
      : Math.min(state.slashActiveIndex, Math.max(0, state.slashFilteredCommands.length - 1));

  elements.slashCommandOptions.replaceChildren();
  state.slashFilteredCommands.forEach((command, index) => {
    const availability = slashCommandAvailability(command);
    const option = document.createElement("button");
    option.type = "button";
    option.id = `slash-command-${command.name}`;
    option.className = `slash-command-option${index === state.slashActiveIndex ? " active" : ""}`;
    option.dataset.slashCommand = command.name;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === state.slashActiveIndex));
    option.setAttribute("aria-disabled", String(!availability.available));

    const name = document.createElement("bdi");
    name.className = "slash-command-name";
    name.dir = "ltr";
    name.textContent = command.token;
    const copy = document.createElement("span");
    copy.className = "slash-command-copy";
    const label = document.createElement("strong");
    label.textContent = command.label;
    const description = document.createElement("small");
    description.textContent = availability.available
      ? command.description
      : `${command.description} — ${availability.reason}`;
    copy.append(label, description);
    option.append(name, copy);
    elements.slashCommandOptions.append(option);
  });

  const hasCommands = state.slashFilteredCommands.length > 0;
  elements.slashCommandEmpty.classList.toggle("hidden", hasCommands);
  elements.slashCommandMenu.classList.remove("hidden");
  elements.prompt.setAttribute("aria-expanded", "true");
  if (hasCommands) {
    const active = state.slashFilteredCommands[state.slashActiveIndex];
    elements.prompt.setAttribute("aria-activedescendant", `slash-command-${active.name}`);
  } else {
    elements.prompt.removeAttribute("aria-activedescendant");
  }
  elements.slashCommandStatus.textContent = hasCommands
    ? `${state.slashFilteredCommands.length.toLocaleString("fa-IR")} فرمان`
    : "فرمانی پیدا نشد";
}

function moveSlashCommandSelection(direction) {
  const count = state.slashFilteredCommands.length;
  if (!count) return;
  state.slashActiveIndex = (state.slashActiveIndex + direction + count) % count;
  updateSlashCommandMenu({ keepActiveCommand: false });
  const active = elements.slashCommandOptions.querySelector(".slash-command-option.active");
  active?.scrollIntoView?.({ block: "nearest" });
}

function replacePromptWithSlashCommand(command) {
  elements.prompt.value = command.token;
  elements.prompt.setSelectionRange(command.token.length, command.token.length);
  state.slashDismissedValue = null;
  saveCurrentDraft();
  resizePrompt();
  updateSlashCommandMenu({ keepActiveCommand: false });
}

async function activateHighlightedSlashCommand() {
  const command = state.slashFilteredCommands[state.slashActiveIndex];
  if (!command || elements.slashCommandMenu.classList.contains("hidden")) return false;
  replacePromptWithSlashCommand(command);
  await executeSlashCommand(command);
  return true;
}

function clearSlashCommandText(expectedToken, targetDraftKey = draftKey()) {
  const stored = state.drafts.get(targetDraftKey);
  if (typeof stored === "string" && stored.trim().toLowerCase() === expectedToken.toLowerCase()) {
    state.drafts.set(targetDraftKey, "");
  }
  if (draftKey() !== targetDraftKey) return;
  if (elements.prompt.value.trim().toLowerCase() !== expectedToken.toLowerCase()) return;
  elements.prompt.value = "";
  state.drafts.set(targetDraftKey, "");
  resizePrompt();
  state.slashDismissedValue = null;
  closeSlashCommandMenu();
}

function renderLocalCommandCard(title) {
  const card = document.createElement("section");
  card.className = "local-command-card";
  card.setAttribute("aria-label", title);
  const heading = document.createElement("h3");
  heading.textContent = title;
  card.append(heading);
  elements.messages.append(card);
  elements.welcome.classList.add("hidden");
  scheduleScrollToBottom();
  return card;
}

function readableSandbox(value) {
  if (!value) return "پیش‌فرض Codex";
  if (typeof value === "string") return value;
  const names = {
    dangerFullAccess: "دسترسی کامل",
    externalSandbox: "sandbox خارجی",
    readOnly: "فقط خواندن",
    workspaceWrite: "خواندن و نوشتن در workspace",
  };
  return names[value.type] || value.type || "نامشخص";
}

function readableApproval(value) {
  if (!value) return "پیش‌فرض Codex";
  if (typeof value === "string") return value;
  return value.granular ? "granular" : "نامشخص";
}

function contextUsageText(usage) {
  const total = usage?.total?.totalTokens;
  const windowSize = usage?.modelContextWindow;
  if (!Number.isFinite(total)) return "هنوز گزارش نشده";
  const totalText = total.toLocaleString("fa-IR");
  if (!Number.isFinite(windowSize) || windowSize <= 0) return `${totalText} توکن`;
  const percent = Math.min(100, Math.max(0, (total / windowSize) * 100));
  return `${totalText} از ${windowSize.toLocaleString("fa-IR")} توکن (${percent.toLocaleString(
    "fa-IR",
    { maximumFractionDigits: 1 },
  )}٪)`;
}

function showSlashStatus() {
  const threadId = state.currentThreadId;
  const runtime = threadId ? state.threadRuntime.get(threadId) || {} : {};
  const thread = state.currentThread;
  const usage = threadId ? state.threadTokenUsage.get(threadId) : null;
  const rows = [
    ["اتصال", state.connected ? "متصل" : "قطع"],
    ["وضعیت", state.busy ? "در حال اجرا" : threadId ? "آماده" : "گفتگوی تازه"],
    ["شناسهٔ گفتگو", threadId || "هنوز ساخته نشده"],
    ["پوشهٔ کاری", runtime.cwd || thread?.cwd || state.settings.cwd || "نامشخص"],
    ["مدل", runtime.model || thread?.model || state.settings.model || "پیش‌فرض Codex"],
    ["Sandbox", readableSandbox(runtime.sandbox || state.settings.sandbox)],
    ["Approval", readableApproval(runtime.approvalPolicy || state.settings.approvalPolicy)],
    ["Context", contextUsageText(usage)],
  ];
  const card = renderLocalCommandCard("وضعیت Codex");
  const list = document.createElement("dl");
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    list.append(term, detail);
  }
  card.append(list);
}

function showSlashHelp() {
  const card = renderLocalCommandCard("فرمان‌های پشتیبانی‌شده");
  const list = document.createElement("ul");
  list.className = "local-command-help";
  for (const command of SLASH_COMMANDS) {
    const item = document.createElement("li");
    const token = document.createElement("code");
    token.textContent = command.token;
    const description = document.createElement("span");
    description.textContent = command.description;
    item.append(token, description);
    list.append(item);
  }
  card.append(list);
}

async function runCompactSlashCommand(command) {
  const threadId = state.currentThreadId;
  const targetDraftKey = draftKey(threadId);
  saveCurrentDraft();
  state.slashCommandExecuting = true;
  state.compactPendingThreads.add(threadId);
  updateThreadActivity(threadId, {
    phase: "running",
    terminalPhase: null,
    turnId: null,
    unread: false,
  });
  if (state.currentThreadId === threadId) setBusy(true);
  updateSlashCommandMenu();
  updateComposerControls();

  try {
    await rpc("thread/compact/start", { threadId });
    clearSlashCommandText(command.token, targetDraftKey);
    toast("درخواست فشرده‌سازی گفتگو ثبت شد.", "success");
  } catch (error) {
    const requestHadNotStarted = state.compactPendingThreads.delete(threadId);
    if (requestHadNotStarted) {
      const activity = ensureThreadActivity(threadId);
      activity.phase = "idle";
      activity.terminalPhase = null;
      activity.turnId = null;
      activity.unread = false;
      if (state.currentThreadId === threadId) setBusy(false);
      renderThreadList();
      updateAttentionUi();
    } else {
      clearSlashCommandText(command.token, targetDraftKey);
      toast(
        "Codex فشرده‌سازی را شروع کرده است، اما پاسخ تأیید آن به رابط نرسید.",
        "warning",
        { duration: 7000 },
      );
      return;
    }
    const unsupported =
      error.details?.code === -32601 ||
      /method not found|does not provide|not supported/i.test(error.message || "");
    if (unsupported) {
      toast(
        "این نسخهٔ Codex از فشرده‌سازی بومی پشتیبانی نمی‌کند؛ Codex CLI را به‌روز کنید.",
        "error",
        { duration: 7000 },
      );
    } else {
      showError(error, "فشرده‌سازی گفتگو");
    }
  } finally {
    state.slashCommandExecuting = false;
    updateSlashCommandMenu();
    updateComposerControls();
  }
}

async function executeSlashCommand(command) {
  const availability = slashCommandAvailability(command);
  if (!availability.available) {
    toast(availability.reason, "warning");
    updateSlashCommandMenu();
    return;
  }

  const targetDraftKey = draftKey();
  switch (command.name) {
    case "compact":
      await runCompactSlashCommand(command);
      return;
    case "new":
    case "clear":
      clearSlashCommandText(command.token, targetDraftKey);
      newChat();
      return;
    case "resume":
      clearSlashCommandText(command.token, targetDraftKey);
      openSidebar();
      setTimeout(() => {
        elements.threadSearch.focus();
        elements.threadSearch.select();
      }, 0);
      return;
    case "status":
      clearSlashCommandText(command.token, targetDraftKey);
      showSlashStatus();
      return;
    case "model":
      clearSlashCommandText(command.token, targetDraftKey);
      openSettings();
      setTimeout(() => elements.modelSelect.focus(), 0);
      return;
    case "permissions":
      clearSlashCommandText(command.token, targetDraftKey);
      openSettings();
      setTimeout(() => elements.sandboxSelect.focus(), 0);
      return;
    case "settings":
      clearSlashCommandText(command.token, targetDraftKey);
      openSettings();
      return;
    case "help":
      clearSlashCommandText(command.token, targetDraftKey);
      showSlashHelp();
      return;
  }
}

async function handleSlashCommand(text) {
  const parsed = parseSlashCommand(text);
  if (!parsed) return false;
  if (!parsed.command) {
    toast(
      `فرمان ${parsed.token} در Codex Web پشتیبانی نمی‌شود؛ برای دیدن فهرست فقط / را تایپ کنید.`,
      "warning",
      { duration: 6500 },
    );
    updateSlashCommandMenu();
    return true;
  }
  if (parsed.multiline) {
    toast("فرمان اسلش باید به‌تنهایی در یک خط نوشته شود.", "warning");
    return true;
  }
  if (parsed.arguments) {
    toast(`${parsed.command.token} در این رابط آرگومان نمی‌پذیرد.`, "warning");
    return true;
  }
  await executeSlashCommand(parsed.command);
  return true;
}

function promptSelection() {
  const fallback = elements.prompt.value.length;
  return {
    end: Number.isInteger(elements.prompt.selectionEnd)
      ? elements.prompt.selectionEnd
      : fallback,
    start: Number.isInteger(elements.prompt.selectionStart)
      ? elements.prompt.selectionStart
      : fallback,
  };
}

function insertPromptText(text) {
  if (!text) return;
  const { start, end } = promptSelection();
  elements.prompt.setRangeText(text, start, end, "end");
  saveCurrentDraft();
  resizePrompt();
}

function appendImagePaths(value, paths) {
  const pathText = paths.join("\n");
  if (!value) return pathText;
  return `${value}${value.endsWith("\n") ? "" : "\n"}${pathText}`;
}

function insertImagePaths(paths, targetDraftKey) {
  if (!paths.length) return;
  if (draftKey() !== targetDraftKey) {
    state.drafts.set(
      targetDraftKey,
      appendImagePaths(state.drafts.get(targetDraftKey) || "", paths),
    );
    toast("مسیر تصویر به پیش‌نویس گفتگوی مربوط اضافه شد.", "success");
    return;
  }

  elements.prompt.value = appendImagePaths(elements.prompt.value, paths);
  elements.prompt.setSelectionRange(
    elements.prompt.value.length,
    elements.prompt.value.length,
  );
  saveCurrentDraft();
  resizePrompt();
  elements.prompt.focus();
}

async function uploadImage(file) {
  const type = String(file.type || "").toLowerCase();
  if (!Object.hasOwn(IMAGE_EXTENSIONS, type)) {
    throw new Error("فرمت این تصویر پشتیبانی نمی‌شود.");
  }
  if (!file.size) throw new Error("فایل تصویر خالی است.");
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("حجم هر تصویر باید حداکثر ۲۵ مگابایت باشد.");
  }

  const fallbackName = `clipboard-${Date.now()}.${IMAGE_EXTENSIONS[type]}`;
  const response = await fetch("/api/uploads/images", {
    method: "POST",
    headers: {
      "Content-Type": type,
      "X-File-Name": encodeURIComponent(file.name || fallbackName),
    },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  if (
    typeof data.path !== "string" ||
    (!data.path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(data.path))
  ) {
    throw new Error("سرور مسیر معتبری برای تصویر برنگرداند.");
  }
  return data.path;
}

async function uploadImages(files, targetDraftKey = draftKey()) {
  const selectedImages = [...files].filter(Boolean);
  const images = selectedImages.slice(0, MAX_IMAGES_PER_BATCH);
  if (!images.length) return;
  if (selectedImages.length > MAX_IMAGES_PER_BATCH) {
    toast(
      `در هر نوبت حداکثر ${MAX_IMAGES_PER_BATCH.toLocaleString("fa-IR")} تصویر اضافه می‌شود.`,
      "warning",
      { duration: 7000 },
    );
  }

  state.imageUploadsByDraft.set(
    targetDraftKey,
    imageUploadsForDraft(targetDraftKey) + images.length,
  );
  updateComposerControls();
  try {
    const results = [];
    for (const image of images) {
      try {
        results.push({ status: "fulfilled", value: await uploadImage(image) });
      } catch (reason) {
        results.push({ reason, status: "rejected" });
      }
    }
    const paths = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const failures = results.filter((result) => result.status === "rejected");
    insertImagePaths(paths, targetDraftKey);
    if (paths.length > 1) {
      toast(`${paths.length.toLocaleString("fa-IR")} تصویر اضافه شد.`, "success");
    }
    if (failures.length) {
      const firstError = failures[0].reason?.message || "خطای نامشخص";
      const count = failures.length.toLocaleString("fa-IR");
      toast(
        failures.length === 1
          ? `افزودن تصویر انجام نشد: ${firstError}`
          : `افزودن ${count} تصویر انجام نشد: ${firstError}`,
        "error",
        { duration: 7000 },
      );
    }
  } finally {
    const remaining = Math.max(0, imageUploadsForDraft(targetDraftKey) - images.length);
    if (remaining) state.imageUploadsByDraft.set(targetDraftKey, remaining);
    else state.imageUploadsByDraft.delete(targetDraftKey);
    updateComposerControls();
  }
}

function handlePromptPaste(event) {
  const items = [...(event.clipboardData?.items || [])];
  const images = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!images.length) return;

  event.preventDefault();
  const targetDraftKey = draftKey();
  const plainText = event.clipboardData.getData("text/plain");
  if (plainText) insertPromptText(plainText);
  void uploadImages(images, targetDraftKey);
}

function imageUploadsForDraft(key = draftKey()) {
  return state.imageUploadsByDraft.get(key) || 0;
}

function updateComposerControls() {
  const uploadingImages = imageUploadsForDraft();
  const uploading = uploadingImages > 0;
  const text = elements.prompt.value.trim();
  const slash = parseSlashCommand(elements.prompt.value);
  const slashCanRun =
    slash &&
    (slash.command
      ? slashCommandAvailability(slash.command).available
      : !state.navigating && !state.slashCommandExecuting);
  elements.sendMessage.disabled = slash
    ? !slashCanRun
    : !state.connected || state.busy || state.navigating || uploading || !text;
  elements.addImages.disabled = state.navigating || uploading;
  elements.imageInput.disabled = state.navigating || uploading;
  elements.uploadStatus.textContent =
    uploadingImages > 1
      ? `در حال افزودن ${uploadingImages.toLocaleString("fa-IR")} تصویر…`
      : "در حال افزودن تصویر…";
  elements.uploadStatus.classList.toggle("hidden", !uploading);
  updateSlashCommandMenu();
}

function updateConnection(ready, message = "") {
  state.connected = ready;
  elements.statusDot.className = `status-dot ${ready ? "ready" : "starting"}`;
  const providerLabel = state.settings.provider === "claude" ? "Claude" : "Codex";
  elements.connectionLabel.textContent = ready
    ? `${providerLabel} متصل است`
    : message || `در حال اتصال به ${providerLabel}…`;
  updateComposerControls();
}

function setBusy(busy, turnId = null) {
  state.busy = busy;
  state.currentTurnId = busy ? turnId : null;
  elements.stopTurn.classList.toggle("hidden", !busy || !state.currentTurnId);
  updateComposerControls();
}

function setNavigating(navigating) {
  state.navigating = navigating;
  if (navigating) closeSlashCommandMenu();
  elements.prompt.disabled = navigating;
  updateComposerControls();
  resizePrompt();
}

function updateSettingsUi() {
  state.models = state.modelsByProvider[state.settings.provider] || state.models;
  const selectedModel = state.settings.modelByProvider[state.settings.provider] || "";
  elements.cwdInput.value = state.settings.cwd;
  elements.cwdLabel.textContent = shortPath(state.settings.cwd, 38);
  elements.cwdLabel.title = state.settings.cwd;
  elements.providerSelect.value = state.settings.provider;
  elements.modelSelect.value = selectedModel;
  elements.effortSelect.value = state.settings.effort;
  elements.sandboxSelect.value = state.settings.sandbox;
  elements.approvalSelect.value = state.settings.approvalPolicy;
  elements.personalitySelect.value = state.settings.personality;
  elements.claudePermissionMode.value = state.settings.claudePermissionMode;
  elements.claudePermissionField.classList.toggle("hidden", state.settings.provider !== "claude");
  elements.fullAccessWarning.classList.toggle(
    "visible",
    state.settings.sandbox === "danger-full-access" ||
      (state.settings.provider === "claude" &&
        state.settings.claudePermissionMode === "bypassPermissions"),
  );
  const model = state.models.find(
    (candidate) =>
      candidate.id === selectedModel || candidate.model === selectedModel,
  );
  elements.modelLabel.textContent = model?.displayName || selectedModel || "مدل پیش‌فرض";
}

function shortPath(path, length = 30) {
  if (!path) return "";
  if (path.length <= length) return path;
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return `…${path.slice(-(length - 1))}`;
  return `…/${parts.slice(-2).join("/")}`;
}

function openSettings() {
  updateSettingsUi();
  elements.settingsDialog.showModal();
  setTimeout(() => elements.cwdInput.focus(), 0);
}

function saveSettings() {
  const cwd = elements.cwdInput.value.trim();
  if (!cwd.startsWith("/")) {
    toast("پوشه کاری باید با / شروع شود.", "error");
    return;
  }
  const provider = elements.providerSelect.value;
  state.settings = {
    approvalPolicy: elements.approvalSelect.value,
    claudePermissionMode: elements.claudePermissionMode.value,
    cwd,
    effort: elements.effortSelect.value,
    modelByProvider: {
      ...state.settings.modelByProvider,
      [provider]: elements.modelSelect.value,
    },
    personality: elements.personalitySelect.value,
    provider,
    sandbox: elements.sandboxSelect.value,
  };
  persistSettings();
  state.models = state.modelsByProvider[provider] || [];
  updateSettingsUi();
  void loadModels();
  void refreshThreads();
  void refreshProviderStatus();
  elements.settingsDialog.close();
}

function formatRelativeTime(seconds) {
  if (!seconds) return "";
  const elapsed = Math.max(0, Date.now() - seconds * 1000);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "اکنون";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} دقیقه`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} ساعت`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)} روز`;
  return new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric" }).format(
    seconds * 1000,
  );
}

function threadDisplayTitle(thread) {
  const name = thread.name?.trim();
  if (name) return name;
  const preview = thread.preview?.trim();
  if (preview) return preview.replace(/\s+/g, " ").slice(0, 70);
  return "گفتگوی بدون عنوان";
}

function threadById(threadId) {
  return state.threads.find((thread) => thread.id === threadId) || null;
}

function threadTitleById(threadId) {
  const thread = threadById(threadId);
  return thread ? threadDisplayTitle(thread) : "گفتگو";
}

function ensureThreadActivity(threadId) {
  if (!state.threadActivity.has(threadId)) {
    state.threadActivity.set(threadId, {
      phase: "idle",
      terminalPhase: null,
      turnId: null,
      unread: false,
    });
  }
  return state.threadActivity.get(threadId);
}

function phaseFromThreadStatus(status) {
  if (status?.type !== "active") return "idle";
  const flags = status.activeFlags || [];
  return flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput")
    ? "needs-input"
    : "running";
}

function syncThreadActivity(thread) {
  const activity = ensureThreadActivity(thread.id);
  if (hasPendingInteractionForThread(thread.id)) {
    activity.phase = "needs-input";
    return;
  }
  const phase = phaseFromThreadStatus(thread.status);
  if (phase !== "idle") {
    activity.phase = phase;
  } else if (activity.unread) {
    activity.phase = activity.terminalPhase || "completed";
  } else if (!activity.unread) {
    activity.phase = "idle";
    activity.terminalPhase = null;
    activity.turnId = null;
  }
}

function updateAttentionUi() {
  const count = [...state.threadActivity.values()].filter(
    (activity) => activity.unread || activity.phase === "needs-input",
  ).length;
  document.title = count ? `(${count}) ${BASE_DOCUMENT_TITLE}` : BASE_DOCUMENT_TITLE;
}

function updateThreadActivity(threadId, patch) {
  if (!threadId) return;
  Object.assign(ensureThreadActivity(threadId), patch);
  renderThreadList();
  updateAttentionUi();
}

function markThreadSeen(threadId) {
  if (!threadId) return;
  const activity = ensureThreadActivity(threadId);
  activity.unread = false;
  if (["completed", "failed", "interrupted"].includes(activity.phase)) {
    activity.phase = "idle";
    activity.terminalPhase = null;
    activity.turnId = null;
  }
  updateAttentionUi();
}

function threadActivityPresentation(threadId) {
  const activity = state.threadActivity.get(threadId);
  if (!activity) return null;
  if (activity.phase === "needs-input") {
    return { className: "needs-input", label: "پاسخ لازم" };
  }
  if (activity.phase === "running") {
    return { className: "running", label: "در حال کار" };
  }
  if (!activity.unread) return null;
  if (activity.phase === "failed") {
    return { className: "failed", label: "خطا" };
  }
  if (activity.phase === "interrupted") {
    return { className: "interrupted", label: "متوقف شد" };
  }
  return { className: "completed", label: "تمام شد" };
}

let completionAudioContext = null;
let completionAudioUnavailable = false;
let completionAudioPrimed = false;
const COMPLETION_AUDIO_HISTORY_KEY = "codex-web-completion-audio-history";

function primeCompletionAudio(event) {
  if (event) completionAudioPrimed = true;
  if (completionAudioUnavailable) return null;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    completionAudioUnavailable = true;
    return null;
  }
  try {
    completionAudioContext ||= new AudioContextConstructor();
    if (completionAudioContext.state === "suspended") {
      completionAudioContext.resume().catch(() => {});
    }
    return completionAudioContext;
  } catch (error) {
    completionAudioUnavailable = true;
    console.warn("Could not initialize completion audio", error);
    return null;
  }
}

async function playCompletionSound(status) {
  const context = completionAudioContext;
  if (!completionAudioPrimed || !context) return;
  try {
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return;

    const notes =
      status === "failed"
        ? [
            [330, 0, 0.18],
            [220, 0.13, 0.24],
          ]
        : status === "interrupted" || status === "cancelled"
          ? [
              [440, 0, 0.16],
              [349.23, 0.12, 0.2],
            ]
          : [
              [659.25, 0, 0.15],
              [880, 0.11, 0.22],
            ];
    const start = context.currentTime + 0.015;
    for (const [frequency, offset, duration] of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = start + offset;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.065, noteStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + duration + 0.02);
      oscillator.addEventListener(
        "ended",
        () => {
          oscillator.disconnect();
          gain.disconnect();
        },
        { once: true },
      );
    }
  } catch (error) {
    console.warn("Could not play completion audio", error);
  }
}

function claimCompletionAudio(turnKey) {
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  let history = [];
  try {
    const saved = JSON.parse(localStorage.getItem(COMPLETION_AUDIO_HISTORY_KEY) || "[]");
    if (Array.isArray(saved)) {
      history = saved.filter(
        (entry) =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          Number.isFinite(entry[1]) &&
          entry[1] >= cutoff,
      );
    }
    if (history.some(([key]) => key === turnKey)) return false;
    history.unshift([turnKey, now]);
    localStorage.setItem(
      COMPLETION_AUDIO_HISTORY_KEY,
      JSON.stringify(history.slice(0, 200)),
    );
  } catch (error) {
    console.warn("Could not coordinate completion audio between tabs", error);
  }
  return true;
}

async function playCompletionSoundOnce(turnKey, status) {
  if (!completionAudioPrimed || !completionAudioContext) return;
  const claimAndPlay = async () => {
    if (!claimCompletionAudio(turnKey)) return;
    await playCompletionSound(status);
  };
  if (navigator.locks?.request) {
    try {
      await navigator.locks.request(
        `codex-web-completion-audio:${turnKey}`,
        claimAndPlay,
      );
      return;
    } catch (error) {
      console.warn("Could not acquire the completion audio lock", error);
    }
  }
  await claimAndPlay();
}

function announceThreadCompletion(threadId, status) {
  const title = threadTitleById(threadId);
  const detail =
    status === "failed"
      ? `کار «${title}» با خطا تمام شد — نمایش`
      : status === "interrupted"
        ? `کار «${title}» متوقف شد — نمایش`
        : `کار «${title}» تمام شد — نمایش`;
  const kind =
    status === "failed" ? "error" : status === "interrupted" ? "warning" : "success";
  toast(detail, kind, {
    duration: 8000,
    onClick: () => openThread(threadId),
  });

  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    const notification = new Notification(BASE_DOCUMENT_TITLE, {
      body: detail.replace(" — نمایش", ""),
      tag: `codex-web-${threadId}`,
    });
    notification.onclick = () => {
      window.focus();
      openThread(threadId);
      notification.close();
    };
  }
}

function renderThreadList() {
  elements.threadList.replaceChildren();
  if (!state.threads.length) {
    const empty = document.createElement("div");
    empty.className = "thread-empty";
    empty.textContent = "هنوز گفتگویی پیدا نشد.";
    elements.threadList.append(empty);
    return;
  }

  for (const thread of state.threads) {
    const button = document.createElement("button");
    button.className = `thread-item ${thread.id === state.currentThreadId ? "active" : ""}`;
    button.dataset.threadId = thread.id;

    const title = document.createElement("span");
    title.className = "thread-item-title";
    title.dir = "auto";
    title.textContent = threadDisplayTitle(thread);

    const provider = document.createElement("span");
    provider.className = "thread-provider";
    provider.textContent = thread.provider === "claude" ? "Claude" : "Codex";
    provider.title = thread.provider === "claude" ? "Claude Code CLI" : "Codex CLI";

    const heading = document.createElement("span");
    heading.className = "thread-item-heading";
    heading.append(title, provider);
    const presentation = threadActivityPresentation(thread.id);
    if (presentation) {
      const activity = document.createElement("span");
      activity.className = `thread-activity ${presentation.className}`;
      activity.textContent = presentation.label;
      activity.setAttribute("aria-label", presentation.label);
      heading.append(activity);
    }

    const meta = document.createElement("span");
    meta.className = "thread-item-meta";
    const cwd = document.createElement("span");
    cwd.className = "thread-item-cwd";
    cwd.textContent = shortPath(thread.cwd, 23);
    cwd.title = thread.cwd || "";
    const time = document.createElement("span");
    time.textContent = formatRelativeTime(thread.updatedAt || thread.createdAt);
    meta.append(cwd, time);

    button.append(heading, meta);
    elements.threadList.append(button);
  }
}

async function refreshThreads(searchTerm = elements.threadSearch.value.trim()) {
  const refreshVersion = ++state.threadsRefreshVersion;
  try {
    const result = await rpc("thread/list", {
      archived: false,
      limit: 100,
      searchTerm: searchTerm || null,
      sortDirection: "desc",
      sortKey: "updated_at",
    });
    if (refreshVersion !== state.threadsRefreshVersion) return;
    state.threads = result.data || [];
    for (const thread of state.threads) syncThreadActivity(thread);
    renderThreadList();
    updateAttentionUi();
  } catch (error) {
    if (refreshVersion !== state.threadsRefreshVersion) return;
    showError(error, "دریافت فهرست گفتگوها");
  }
}

function clearConversation() {
  closeSlashCommandMenu();
  resetScrollFollowing();
  if (state.userMessageNavigationFrame !== null) {
    cancelAnimationFrame(state.userMessageNavigationFrame);
    state.userMessageNavigationFrame = null;
  }
  clearTimeout(state.userMessageHighlightTimer);
  state.userNavigationItemId = null;
  elements.previousUserMessage.disabled = true;
  elements.nextUserMessage.disabled = true;
  elements.userMessageNavigationStatus.textContent = "";
  state.itemViews.clear();
  elements.messages.replaceChildren();
}

function draftKey(threadId = state.currentThreadId) {
  return threadId || `${NEW_THREAD_DRAFT_PREFIX}:${state.newDraftId}`;
}

function saveCurrentDraft() {
  state.drafts.set(draftKey(), elements.prompt.value);
}

function restoreDraft(threadId = state.currentThreadId) {
  elements.prompt.value = state.drafts.get(draftKey(threadId)) || "";
  state.slashDismissedValue = null;
  resizePrompt();
}

function threadIdFromUrl() {
  if (!window.location?.href) return "";
  return new URL(window.location.href).searchParams.get("thread") || "";
}

function updateThreadUrl(threadId, mode = "push") {
  if (mode === "none") return;
  if (!window.location?.href || !window.history) return;
  const url = new URL(window.location.href);
  const current = url.searchParams.get("thread") || "";
  if (threadId) url.searchParams.set("thread", threadId);
  else url.searchParams.delete("thread");
  if (current === (threadId || "")) return;
  const stateValue = threadId ? { threadId } : {};
  const method = mode === "replace" ? "replaceState" : "pushState";
  if (typeof window.history[method] !== "function") return;
  window.history[method](stateValue, "", `${url.pathname}${url.search}${url.hash}`);
}

async function hydrateThreadFromUrl() {
  if (state.urlHydrated) return;
  state.urlHydrated = true;
  const threadId = threadIdFromUrl();
  if (threadId) await openThread(threadId, { historyMode: "none" });
}

function newChat({ historyMode = "push" } = {}) {
  if (!state.currentThreadId && imageUploadsForDraft() > 0) {
    toast("برای حفظ تصاویر این پیش‌نویس، تا پایان افزودن آن‌ها صبر کنید.", "warning");
    return;
  }
  saveCurrentDraft();
  state.navigationVersion += 1;
  closeInteractionDialogs();
  state.currentThread = null;
  state.currentThreadId = null;
  state.currentTurnId = null;
  state.newDraftId = crypto.randomUUID();
  setNavigating(false);
  setBusy(false);
  clearConversation();
  elements.welcome.classList.remove("hidden");
  elements.threadTitle.textContent = "گفتگوی تازه";
  elements.threadMeta.textContent = "";
  updateThreadUrl(null, historyMode);
  restoreDraft(null);
  renderThreadList();
  updateAttentionUi();
  closeSidebar();
  elements.prompt.focus();
}

function setCurrentThread(thread, metadata = {}) {
  if (state.currentThreadId !== thread.id) closeInteractionDialogs();
  state.currentThread = thread;
  state.currentThreadId = thread.id;
  const runtime = { ...(state.threadRuntime.get(thread.id) || {}) };
  if (metadata.approvalPolicy !== undefined) runtime.approvalPolicy = metadata.approvalPolicy;
  if (metadata.reasoningEffort !== undefined) runtime.reasoningEffort = metadata.reasoningEffort;
  if (metadata.sandbox !== undefined) runtime.sandbox = metadata.sandbox;
  if (metadata.cwd || thread.cwd) runtime.cwd = metadata.cwd || thread.cwd;
  if (metadata.model || thread.model) runtime.model = metadata.model || thread.model;
  state.threadRuntime.set(thread.id, runtime);
  syncThreadActivity(thread);
  markThreadSeen(thread.id);
  elements.threadTitle.textContent = threadDisplayTitle(thread);
  const cwd = metadata.cwd || thread.cwd || state.settings.cwd;
  const model = metadata.model || thread.model || "";
  elements.threadMeta.textContent = [cwd, model].filter(Boolean).join("  ·  ");
  elements.welcome.classList.add("hidden");
  restoreDraft(thread.id);
  renderThreadList();
  activateThreadInteractions(thread.id);
}

function itemText(item) {
  if (item.type === "userMessage") {
    return (item.content || [])
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "image" || part.type === "localImage") return `[تصویر: ${part.path || part.url}]`;
        if (part.type === "audio" || part.type === "localAudio") return `[صدا: ${part.path || part.url}]`;
        if (part.type === "skill") return `$${part.name}`;
        if (part.type === "mention") return `@${part.name}`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (item.type === "agentMessage" || item.type === "plan") return item.text || "";
  return "";
}

function createMessageView(item) {
  const role = item.type === "userMessage" ? "user" : "assistant";
  const row = document.createElement("article");
  row.className = `message-row ${role}`;
  row.dataset.itemId = item.id;

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "C";
    row.append(avatar);
  }

  const body = document.createElement("div");
  body.className = "message-body";
  const content = document.createElement("div");
  content.className = "message-content";
  content.dir = "auto";
  body.append(content);
  row.append(body);
  elements.messages.append(row);
  if (role === "user") scheduleUserMessageNavigationUpdate();
  return { content, element: row, text: "", type: item.type };
}

function activityTitle(item) {
  const titles = {
    collabAgentToolCall: "فعالیت agent فرعی",
    commandExecution: "اجرای فرمان",
    contextCompaction: "فشرده‌سازی context",
    dynamicToolCall: `ابزار: ${item.tool || ""}`,
    enteredReviewMode: "ورود به حالت review",
    exitedReviewMode: "پایان حالت review",
    fileChange: "تغییر فایل‌ها",
    hookPrompt: "اجرای hook",
    imageGeneration: "ساخت تصویر",
    imageView: "مشاهده تصویر",
    mcpToolCall: `MCP: ${item.server || ""} / ${item.tool || ""}`,
    plan: "برنامه کار",
    reasoning: "روند بررسی",
    sleep: "انتظار",
    subAgentActivity: "فعالیت agent فرعی",
    webSearch: `جستجوی وب: ${item.query || ""}`,
  };
  return titles[item.type] || item.type || "فعالیت";
}

function createActivityView(item) {
  const details = document.createElement("details");
  details.className = "activity-card";
  details.dataset.itemId = item.id;
  const summary = document.createElement("summary");
  summary.textContent = activityTitle(item);
  summary.addEventListener("click", (event) => {
    if (
      details.classList.contains("reasoning-status") ||
      details.classList.contains("compaction-status")
    ) {
      event.preventDefault();
    }
  });
  const content = document.createElement("div");
  content.className = "activity-content";
  details.append(summary, content);
  elements.messages.append(details);
  return { content, element: details, summary, text: "", type: item.type };
}

function formatChanges(changes) {
  if (!changes) return "";
  if (Array.isArray(changes)) {
    return changes
      .map((change) => {
        const header = `${change.kind || change.type || "change"} ${change.path || ""}`.trim();
        return [header, change.diff || change.unifiedDiff || change.unified_diff || ""]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }
  return Object.entries(changes)
    .map(([path, value]) => {
      const detail =
        typeof value === "string"
          ? value
          : value.unified_diff || value.diff || value.content || JSON.stringify(value, null, 2);
      return `${path}\n${detail}`;
    })
    .join("\n\n");
}

function reasoningPartsText(parts) {
  if (Array.isArray(parts)) {
    return parts
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return typeof parts === "string" ? parts : "";
}

function reasoningItemText(item) {
  const summary = reasoningPartsText(item.summary);
  return summary.trim() ? summary : reasoningPartsText(item.content);
}

function setReasoningStatusLabel(view, label, thinking = false) {
  const text = document.createElement("span");
  text.textContent = label;
  view.summary.replaceChildren(text);
  if (!thinking) return;

  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) {
    dots.append(document.createElement("span"));
  }
  view.summary.append(dots);
}

function updateReasoning(view, item = {}, phase = "completed", outcome = "completed") {
  const incomingText = reasoningItemText(item);
  if (incomingText.trim()) view.text = incomingText;

  const running = phase !== "completed";
  const hasText = Boolean(view.text.trim());
  view.element.classList.add("reasoning-card");
  view.element.classList.toggle("running", running);
  view.element.setAttribute("aria-busy", String(running));

  if (hasText) {
    view.element.classList.remove(
      "reasoning-status",
      "reasoning-complete",
      "reasoning-stopped",
    );
    view.summary.removeAttribute("aria-disabled");
    view.summary.textContent = "روند بررسی";
    view.content.hidden = false;
    view.content.className = "activity-content";
    view.content.textContent = view.text;
    if (running) view.element.open = true;
    return;
  }

  const stopped = !running && outcome === "stopped";
  view.element.classList.add("reasoning-status");
  view.element.classList.toggle("reasoning-complete", !running && !stopped);
  view.element.classList.toggle("reasoning-stopped", stopped);
  view.element.open = false;
  view.summary.setAttribute("aria-disabled", "true");
  view.content.hidden = true;
  view.content.replaceChildren();
  setReasoningStatusLabel(
    view,
    running ? "در حال بررسی" : stopped ? "بررسی متوقف شد" : "بررسی انجام شد",
    running,
  );
}

function updateCompaction(view, phase) {
  const running = phase !== "completed";
  view.element.classList.add("compaction-status");
  view.element.classList.toggle("running", running);
  view.element.classList.toggle("completed", !running);
  view.element.open = false;
  view.element.setAttribute("aria-busy", String(running));
  view.summary.setAttribute("aria-disabled", "true");
  view.summary.textContent = running
    ? "در حال فشرده‌سازی زمینهٔ گفتگو…"
    : "زمینهٔ گفتگو فشرده شد";
  view.content.hidden = true;
  view.content.replaceChildren();
}

function updateActivity(view, item, phase) {
  if (item.type === "reasoning") {
    updateReasoning(view, item, phase);
    return;
  }
  if (item.type === "contextCompaction") {
    updateCompaction(view, phase);
    return;
  }

  const running = phase !== "completed" && ["inProgress", "running"].includes(item.status);
  view.element.classList.toggle("running", running);
  if (running) view.element.open = true;

  if (item.type === "commandExecution") {
    view.content.className = "activity-sections";
    const command = escapeHtml(item.command || "");
    const output = escapeHtml(item.aggregatedOutput || view.output || "");
    const status = [item.status, item.exitCode == null ? "" : `exit ${item.exitCode}`]
      .filter(Boolean)
      .join(" · ");
    view.content.innerHTML =
      `<div><b>COMMAND</b><pre class="activity-content command">${command}</pre></div>` +
      (output
        ? `<div><b>OUTPUT</b><pre class="activity-content output">${output}</pre></div>`
        : "") +
      (status ? `<div><b>STATUS</b><span dir="ltr">${escapeHtml(status)}</span></div>` : "");
    return;
  }

  if (item.type === "fileChange") {
    view.content.className = "activity-content diff";
    view.text = formatChanges(item.changes) || view.text || "";
    view.content.textContent = view.text;
    return;
  }

  if (item.type === "plan") {
    view.content.textContent = item.text || view.text;
    return;
  }

  const generic = {
    ...item,
    id: undefined,
    type: undefined,
  };
  view.content.textContent = JSON.stringify(generic, null, 2).replace(
    /{\s*"[^"]+": undefined\s*}/g,
    "",
  );
}

function reconcileOptimisticUserMessage(item, existingView) {
  const optimistic = state.optimisticUserMessages.get(item.clientId);
  if (!optimistic) return existingView;
  optimistic.accepted = true;
  if (optimistic.rpcSettled) {
    state.optimisticUserMessages.delete(item.clientId);
  }

  const optimisticId = optimistic.itemId;
  const optimisticView = state.itemViews.get(optimisticId);
  if (!optimisticView) return existingView;
  state.itemViews.delete(optimisticId);
  if (state.userNavigationItemId === optimisticId) {
    state.userNavigationItemId = item.id;
  }

  if (existingView && existingView !== optimisticView) {
    optimisticView.element.remove();
    scheduleUserMessageNavigationUpdate();
    return existingView;
  }

  optimisticView.element.dataset.itemId = item.id;
  state.itemViews.set(item.id, optimisticView);
  return optimisticView;
}

function renderItem(item, phase = "completed") {
  if (!item?.id || !item.type) return null;
  let view = state.itemViews.get(item.id);
  if (item.type === "userMessage" && item.clientId) {
    view = reconcileOptimisticUserMessage(item, view);
  }
  const isMessage = item.type === "userMessage" || item.type === "agentMessage";
  if (!view) {
    view = isMessage ? createMessageView(item) : createActivityView(item);
    state.itemViews.set(item.id, view);
  }

  if (isMessage) {
    view.text = itemText(item) || view.text;
    view.content.innerHTML = markdown(view.text);
    view.content.classList.toggle("streaming-cursor", phase === "started" && item.type === "agentMessage");
  } else {
    updateActivity(view, item, phase);
  }
  scheduleScrollToBottom();
  return view;
}

function renderOptimisticUserMessage(clientId, input) {
  const item = {
    clientId,
    content: input,
    id: `${OPTIMISTIC_USER_MESSAGE_PREFIX}:${clientId}`,
    type: "userMessage",
  };
  const view = renderItem(item, "completed");
  if (!view) return;
  state.optimisticUserMessages.set(clientId, {
    accepted: false,
    itemId: item.id,
    rpcSettled: false,
  });
  elements.welcome.classList.add("hidden");
}

function settleOptimisticUserMessage(clientId) {
  const optimistic = state.optimisticUserMessages.get(clientId);
  if (!optimistic) return;
  optimistic.rpcSettled = true;
  if (optimistic.accepted) {
    state.optimisticUserMessages.delete(clientId);
  }
}

function acceptBackgroundOptimisticUserMessage(clientId) {
  const optimistic = state.optimisticUserMessages.get(clientId);
  if (!optimistic) return;
  optimistic.accepted = true;
  if (optimistic.rpcSettled) {
    state.optimisticUserMessages.delete(clientId);
  }
}

function rollbackOptimisticUserMessage(clientId) {
  const optimistic = state.optimisticUserMessages.get(clientId);
  state.optimisticUserMessages.delete(clientId);
  if (optimistic?.accepted) return false;
  if (!optimistic) return true;

  const optimisticId = optimistic.itemId;
  const view = state.itemViews.get(optimisticId);
  if (view) {
    state.itemViews.delete(optimisticId);
    view.element.remove();
    if (state.userNavigationItemId === optimisticId) {
      state.userNavigationItemId = null;
      elements.userMessageNavigationStatus.textContent = "";
    }
    elements.welcome.classList.toggle(
      "hidden",
      elements.messages.childElementCount > 0,
    );
    scheduleUserMessageNavigationUpdate();
    updateScrollButton();
  }
  return true;
}

function renderHistory(thread) {
  clearConversation();
  let activeTurn = null;
  const inProgressTurns = [];
  for (const turn of thread.turns || []) {
    for (const item of turn.items || []) renderItem(item, "completed");
    if (turn.status === "inProgress") {
      inProgressTurns.push(turn);
      if (!state.completedTurns.has(turnEventKey(thread.id, turn.id))) {
        activeTurn = turn;
      }
    }
  }
  const activity = ensureThreadActivity(thread.id);
  const hasPendingInteraction = hasPendingInteractionForThread(thread.id);
  if (activeTurn) {
    activity.phase = hasPendingInteraction ? "needs-input" : "running";
    activity.terminalPhase = null;
    activity.turnId = activeTurn.id;
  } else if (hasPendingInteraction) {
    activity.phase = "needs-input";
  } else if (!activity.unread) {
    activity.phase = "idle";
    activity.terminalPhase = null;
    activity.turnId = null;
  }
  const onlyKnownCompletedTurnsRemain =
    inProgressTurns.length > 0 &&
    inProgressTurns.every((turn) =>
      state.completedTurns.has(turnEventKey(thread.id, turn.id)),
    );
  const threadIsActive =
    thread.status?.type === "active" && !onlyKnownCompletedTurnsRemain;
  setBusy(Boolean(activeTurn) || hasPendingInteraction || threadIsActive, activeTurn?.id);
  elements.welcome.classList.toggle("hidden", Boolean((thread.turns || []).length));
  renderThreadList();
  updateAttentionUi();
  scheduleScrollToBottom(true);
}

async function openThread(threadId, { historyMode = "push" } = {}) {
  if (!threadId) return;
  if (!state.currentThreadId && imageUploadsForDraft() > 0) {
    toast("برای حفظ تصاویر این پیش‌نویس، تا پایان افزودن آن‌ها صبر کنید.", "warning");
    return;
  }
  const navigationVersion = ++state.navigationVersion;
  if (threadId === state.currentThreadId) {
    updateThreadUrl(threadId, historyMode);
    setNavigating(false);
    markThreadSeen(threadId);
    renderThreadList();
    activateThreadInteractions(threadId);
    closeSidebar();
    return;
  }
  saveCurrentDraft();
  closeInteractionDialogs();
  setNavigating(true);
  state.openingThreadId = threadId;
  state.threadEventBacklog.set(threadId, []);
  try {
    elements.threadTitle.textContent = "در حال باز کردن…";
    const result = await rpc("thread/resume", { threadId });
    if (navigationVersion !== state.navigationVersion) return;
    setCurrentThread(result.thread, result);
    renderHistory(result.thread);
    flushThreadEventBacklog(threadId);
    updateThreadUrl(threadId, historyMode);
    setNavigating(false);
    closeSidebar();
    elements.prompt.focus();
  } catch (error) {
    if (navigationVersion !== state.navigationVersion) return;
    showError(error, "باز کردن گفتگو");
    setNavigating(false);
    elements.threadTitle.textContent = state.currentThread
      ? threadDisplayTitle(state.currentThread)
      : "گفتگوی تازه";
  } finally {
    if (state.openingThreadId === threadId) state.openingThreadId = null;
  }
}

const BOTTOM_THRESHOLD = 48;
let scrollEndTimer;

function distanceFromBottom() {
  return Math.max(
    0,
    elements.conversation.scrollHeight -
      elements.conversation.scrollTop -
      elements.conversation.clientHeight,
  );
}

function updateScrollButton() {
  const shouldShow =
    elements.messages.childElementCount > 0 &&
    !state.followOutput &&
    distanceFromBottom() > BOTTOM_THRESHOLD;
  elements.scrollBottom.classList.toggle("hidden", !shouldShow);
}

function resetScrollFollowing() {
  clearTimeout(scrollEndTimer);
  if (state.scrollFrame !== null) cancelAnimationFrame(state.scrollFrame);
  state.followOutput = true;
  state.forceNextScroll = false;
  state.scrollFrame = null;
  state.scrollingToBottom = false;
  elements.scrollBottom.classList.add("hidden");
}

function updateScrollState() {
  const atBottom = distanceFromBottom() <= BOTTOM_THRESHOLD;
  if (atBottom) {
    clearTimeout(scrollEndTimer);
    state.followOutput = !state.userNavigationItemId;
    state.scrollingToBottom = false;
  } else if (!state.scrollingToBottom) {
    state.followOutput = false;
  }
  updateScrollButton();
}

function cancelScrollAnimation(event) {
  if (event) {
    state.userNavigationItemId = null;
    elements.userMessageNavigationStatus.textContent = "";
    scheduleUserMessageNavigationUpdate();
  }
  if (state.scrollFrame !== null) {
    cancelAnimationFrame(state.scrollFrame);
    state.scrollFrame = null;
    state.forceNextScroll = false;
  }
  if (event?.type === "wheel" && event.deltaY < 0 && elements.conversation.scrollTop > 0) {
    state.followOutput = false;
  }
  if (!state.scrollingToBottom) {
    updateScrollButton();
    return;
  }
  clearTimeout(scrollEndTimer);
  state.scrollingToBottom = false;
  state.followOutput = distanceFromBottom() <= BOTTOM_THRESHOLD;
  updateScrollButton();
}

function scrollToBottom(immediate = true, force = false) {
  if (!force && !state.followOutput) {
    updateScrollButton();
    return;
  }

  if (force) {
    state.userNavigationItemId = null;
    elements.userMessageNavigationStatus.textContent = "";
    scheduleUserMessageNavigationUpdate();
  }
  clearTimeout(scrollEndTimer);
  state.followOutput = true;
  state.scrollingToBottom = !immediate;
  elements.scrollBottom.classList.add("hidden");
  elements.conversation.scrollTo({
    top: elements.conversation.scrollHeight,
    behavior: immediate ? "auto" : "smooth",
  });

  if (!immediate) {
    scrollEndTimer = setTimeout(updateScrollState, 1000);
  }
}

function scheduleScrollToBottom(force = false) {
  state.forceNextScroll ||= force;
  if (state.scrollFrame !== null) return;

  state.scrollFrame = requestAnimationFrame(() => {
    state.scrollFrame = null;
    const shouldForce = state.forceNextScroll;
    state.forceNextScroll = false;
    if (shouldForce || state.followOutput) {
      scrollToBottom(true, shouldForce);
    } else {
      updateScrollButton();
    }
  });
}

function userMessageNavigationTargets() {
  const rows = [...elements.messages.querySelectorAll(".message-row.user")];
  if (!rows.length) return { next: null, previous: null };

  if (state.userNavigationItemId) {
    const index = rows.findIndex(
      (row) => row.dataset.itemId === state.userNavigationItemId,
    );
    if (index !== -1) {
      return {
        next: rows[index + 1] || null,
        previous: rows[index - 1] || null,
      };
    }
    state.userNavigationItemId = null;
  }

  const conversationRect = elements.conversation.getBoundingClientRect();
  const viewportCenter = conversationRect.top + elements.conversation.clientHeight / 2;
  let next = null;
  let previous = null;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    const rowCenter = rect.top + rect.height / 2;
    if (rowCenter < viewportCenter - 12) {
      previous = row;
    } else if (rowCenter > viewportCenter + 12 && !next) {
      next = row;
    }
  }
  return { next, previous };
}

function updateUserMessageNavigation() {
  state.userMessageNavigationFrame = null;
  const { next, previous } = userMessageNavigationTargets();
  const focused = document.activeElement;
  elements.previousUserMessage.disabled = !previous;
  elements.nextUserMessage.disabled = !next;
  if (focused === elements.previousUserMessage && !previous && next) {
    elements.nextUserMessage.focus();
  } else if (focused === elements.nextUserMessage && !next && previous) {
    elements.previousUserMessage.focus();
  }
}

function scheduleUserMessageNavigationUpdate() {
  if (state.userMessageNavigationFrame !== null) return;
  state.userMessageNavigationFrame = requestAnimationFrame(updateUserMessageNavigation);
}

function navigateToUserMessage(direction) {
  const target = userMessageNavigationTargets()[direction];
  if (!target) return;

  clearTimeout(scrollEndTimer);
  if (state.scrollFrame !== null) {
    cancelAnimationFrame(state.scrollFrame);
    state.scrollFrame = null;
  }
  state.forceNextScroll = false;
  state.followOutput = false;
  state.scrollingToBottom = false;
  state.userNavigationItemId = target.dataset.itemId;
  const rows = [...elements.messages.querySelectorAll(".message-row.user")];
  const targetIndex = rows.indexOf(target);
  elements.userMessageNavigationStatus.textContent =
    targetIndex === -1
      ? ""
      : `پیام ${(targetIndex + 1).toLocaleString("fa-IR")} از ${rows.length.toLocaleString(
          "fa-IR",
        )}`;

  elements.messages
    .querySelectorAll(".message-row.user-message-target")
    .forEach((row) => row.classList.remove("user-message-target"));
  target.classList.add("user-message-target");
  clearTimeout(state.userMessageHighlightTimer);
  state.userMessageHighlightTimer = setTimeout(
    () => target.classList.remove("user-message-target"),
    1400,
  );

  const conversationRect = elements.conversation.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTop =
    elements.conversation.scrollTop +
    targetRect.top -
    conversationRect.top -
    Math.max(18, (elements.conversation.clientHeight - targetRect.height) / 2);
  elements.conversation.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "smooth",
  });
  updateScrollButton();
  scheduleUserMessageNavigationUpdate();
}

function appendDelta(itemId, delta, kind) {
  let view = state.itemViews.get(itemId);
  if (!view) {
    const item =
      kind === "agent"
        ? { id: itemId, type: "agentMessage", text: "" }
        : { id: itemId, type: kind === "reasoning" ? "reasoning" : "commandExecution" };
    view = renderItem(item, "started");
  }
  if (!view) return;

  if (kind === "agent") {
    view.text += delta;
    view.content.innerHTML = markdown(view.text);
    view.content.classList.add("streaming-cursor");
  } else if (kind === "reasoning") {
    view.text += delta;
    updateReasoning(view, {}, "started");
  } else if (kind === "command") {
    view.output = (view.output || "") + delta;
    const outputNode = view.element.querySelector(".output");
    if (outputNode) outputNode.textContent = view.output;
    else {
      updateActivity(
        view,
        { id: itemId, type: "commandExecution", status: "inProgress", aggregatedOutput: view.output },
        "started",
      );
    }
  } else if (kind === "file") {
    view.text += delta;
    view.content.textContent = view.text;
  }
  scheduleScrollToBottom();
}

function renderPlan(params) {
  const id = `plan-${params.turnId}`;
  let view = state.itemViews.get(id);
  if (!view) {
    view = createActivityView({ id, type: "plan" });
    view.element.open = true;
    state.itemViews.set(id, view);
  }
  view.content.className = "plan-list";
  view.content.replaceChildren();
  for (const step of params.plan || []) {
    const item = document.createElement("li");
    const status = document.createElement("span");
    status.className = `plan-status ${step.status}`;
    status.textContent =
      step.status === "completed" ? "✓" : step.status === "in_progress" ? "◉" : "○";
    const text = document.createElement("span");
    text.dir = "auto";
    text.textContent = step.step;
    item.append(status, text);
    view.content.append(item);
  }
  scheduleScrollToBottom();
}

async function ensureThread(sourceThreadId, navigationVersion, sourceDraftKey) {
  if (sourceThreadId) return sourceThreadId;
  const params = {
    cwd: state.settings.cwd,
    provider: state.settings.provider,
  };
  if (state.settings.approvalPolicy) params.approvalPolicy = state.settings.approvalPolicy;
  if (state.settings.sandbox) params.sandbox = state.settings.sandbox;
  const model = state.settings.modelByProvider[state.settings.provider] || "";
  if (model) params.model = model;
  if (state.settings.personality) params.personality = state.settings.personality;
  if (state.settings.provider === "claude" && state.settings.claudePermissionMode) {
    params.permissionMode = state.settings.claudePermissionMode;
  }
  const result = await rpc("thread/start", params);
  state.threadsRefreshVersion += 1;
  if (!state.threads.some((thread) => thread.id === result.thread.id)) {
    state.threads.unshift(result.thread);
  }
  if (state.drafts.has(sourceDraftKey)) {
    state.drafts.set(result.thread.id, state.drafts.get(sourceDraftKey));
    state.drafts.delete(sourceDraftKey);
  }
  syncThreadActivity(result.thread);
  if (
    navigationVersion === state.navigationVersion &&
    state.currentThreadId === null &&
    draftKey() === sourceDraftKey
  ) {
    setCurrentThread(result.thread, result);
  } else {
    renderThreadList();
  }
  return result.thread.id;
}

function turnEventKey(threadId, turnId) {
  return `${threadId}:${turnId}`;
}

async function sendPrompt(text = elements.prompt.value) {
  if (parseSlashCommand(text)) {
    await handleSlashCommand(text);
    return;
  }
  text = text.trim();
  if (
    !text ||
    !state.connected ||
    state.busy ||
    state.navigating ||
    imageUploadsForDraft() > 0
  ) {
    return;
  }
  const sourceThreadId = state.currentThreadId;
  const sourceDraftKey = draftKey(sourceThreadId);
  const navigationVersion = state.navigationVersion;
  let targetThreadId = sourceThreadId;
  const clientUserMessageId = crypto.randomUUID();
  const input = [{ type: "text", text }];
  elements.prompt.value = "";
  state.drafts.set(sourceDraftKey, "");
  resizePrompt();
  renderOptimisticUserMessage(clientUserMessageId, input);
  scrollToBottom(true, true);
  setBusy(true);
  if (sourceThreadId) {
    updateThreadActivity(sourceThreadId, {
      phase: "running",
      terminalPhase: null,
      turnId: null,
      unread: false,
    });
  }
  try {
    const threadId = await ensureThread(
      sourceThreadId,
      navigationVersion,
      sourceDraftKey,
    );
    targetThreadId = threadId;
    const params = {
      clientUserMessageId,
      input,
      threadId,
      provider:
        state.currentThreadId === threadId && state.currentThread?.provider
          ? state.currentThread.provider
          : providerForThread(threadId),
    };
    if (state.settings.effort) params.effort = state.settings.effort;
    const result = await rpc("turn/start", params);
    settleOptimisticUserMessage(clientUserMessageId);
    const completedBeforeResponse = state.completedTurns.has(
      turnEventKey(threadId, result.turn.id),
    );
    if (!completedBeforeResponse) {
      updateThreadActivity(threadId, {
        phase: "running",
        terminalPhase: null,
        turnId: result.turn.id,
        unread: false,
      });
      if (state.currentThreadId === threadId) {
        setBusy(true, result.turn.id);
        elements.welcome.classList.add("hidden");
      }
    } else if (state.currentThreadId === threadId) {
      setBusy(false);
    }
  } catch (error) {
    const shouldRollback = rollbackOptimisticUserMessage(clientUserMessageId);
    if (shouldRollback) {
      const restoreThreadId = targetThreadId || sourceThreadId;
      const restoreKey = restoreThreadId ? draftKey(restoreThreadId) : sourceDraftKey;
      const newerDraft = state.drafts.get(restoreKey) || "";
      state.drafts.set(restoreKey, newerDraft ? `${text}\n\n${newerDraft}` : text);
      if (restoreThreadId) {
        const activity = ensureThreadActivity(restoreThreadId);
        if (activity.phase === "running" && !activity.turnId) {
          activity.phase = "idle";
          activity.terminalPhase = null;
          activity.unread = false;
          renderThreadList();
          updateAttentionUi();
        }
      }
      if (
        state.currentThreadId === restoreThreadId ||
        (!restoreThreadId && draftKey() === sourceDraftKey)
      ) {
        setBusy(false);
        restoreDraft(restoreThreadId);
      }
    }
    showError(error, "ارسال پیام");
  }
}

async function stopTurn() {
  const threadId = state.currentThreadId;
  const turnId = threadId
    ? ensureThreadActivity(threadId).turnId || state.currentTurnId
    : null;
  if (!threadId || !turnId) return;
  try {
    await rpc("turn/interrupt", {
      threadId,
      turnId,
      provider:
        state.currentThread?.provider || providerForThread(threadId),
    });
  } catch (error) {
    showError(error, "توقف پاسخ");
  }
}

function appendTurnError(message) {
  const previous = elements.messages.lastElementChild;
  if (previous?.classList.contains("error-message") && previous.dataset.rawMessage === message) {
    return;
  }
  const node = document.createElement("div");
  node.className = "error-message";
  node.dataset.rawMessage = message;
  node.textContent = /refresh token (was already used|has already been used)|token_expired/i.test(message)
    ? "ورود Codex منقضی شده است. در ترمینال ابتدا `codex logout` و سپس `codex login` را اجرا کنید و Codex Web را دوباره راه بیندازید."
    : message;
  elements.messages.append(node);
  scheduleScrollToBottom();
}

const THREAD_RENDER_METHODS = new Set([
  "error",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/completed",
  "item/fileChange/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "turn/plan/updated",
]);

function terminalTurnPhase(status) {
  if (status === "failed") return "failed";
  if (status === "interrupted" || status === "cancelled") return "interrupted";
  return "completed";
}

function finishVisibleTurn(turn) {
  setBusy(false);
  for (const view of state.itemViews.values()) {
    if (view.type === "reasoning" && view.element?.classList.contains("running")) {
      const stopped = ["failed", "interrupted", "cancelled"].includes(turn?.status);
      updateReasoning(view, {}, "completed", stopped ? "stopped" : "completed");
    }
    view.content?.classList.remove("streaming-cursor");
    view.element?.classList.remove("running");
  }
  if (turn?.status === "failed") {
    appendTurnError(turn.error?.message || "اجرای turn ناموفق بود.");
  }
}

function queueThreadEvent(message) {
  const threadId = message.params?.threadId;
  if (!threadId || !THREAD_RENDER_METHODS.has(message.method)) return;
  const backlog = state.threadEventBacklog.get(threadId) || [];
  backlog.push(message);
  if (backlog.length > 300) backlog.splice(0, backlog.length - 300);
  state.threadEventBacklog.set(threadId, backlog);
}

function renderThreadEvent(message) {
  const { method, params = {} } = message;
  switch (method) {
    case "item/started":
      renderItem(params.item, "started");
      break;
    case "item/completed":
      renderItem(params.item, "completed");
      break;
    case "item/agentMessage/delta":
      appendDelta(params.itemId, params.delta || "", "agent");
      break;
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      appendDelta(params.itemId, params.delta || "", "reasoning");
      break;
    case "item/commandExecution/outputDelta":
      appendDelta(params.itemId, params.delta || "", "command");
      break;
    case "item/fileChange/outputDelta":
      appendDelta(params.itemId, params.delta || "", "file");
      break;
    case "turn/plan/updated":
      renderPlan(params);
      break;
    case "error":
      appendTurnError(params.error?.message || params.message || "خطای Codex");
      break;
  }
}

function flushThreadEventBacklog(threadId) {
  const backlog = state.threadEventBacklog.get(threadId) || [];
  state.threadEventBacklog.delete(threadId);
  if (threadId !== state.currentThreadId) return;
  const snapshotItemIds = new Set(state.itemViews.keys());
  for (const message of backlog) {
    const { method, params = {} } = message;
    const itemId = params.itemId || params.item?.id;
    const isIncremental =
      method === "item/started" ||
      method.endsWith("/delta") ||
      method.endsWith("Delta");
    if (itemId && snapshotItemIds.has(itemId) && isIncremental) continue;
    renderThreadEvent(message);
  }
}

function handleNotification(message) {
  const { method, params = {} } = message;
  const threadId = params.threadId || params.conversationId || null;

  if (method === "serverRequest/resolved") {
    if (params.requestId !== undefined) {
      removePendingInteraction(params.requestId, params.threadId || null);
    }
    return;
  }

  if (method === "thread/tokenUsage/updated" && threadId) {
    state.threadTokenUsage.set(threadId, params.tokenUsage || null);
    return;
  }

  if (
    threadId &&
    (method === "item/started" || method === "item/completed") &&
    params.item?.type === "contextCompaction"
  ) {
    state.compactPendingThreads.delete(threadId);
    if (method === "item/started") {
      updateThreadActivity(threadId, {
        phase: "running",
        terminalPhase: null,
        turnId: params.turnId || null,
        unread: false,
      });
      if (threadId === state.currentThreadId) setBusy(true, params.turnId || null);
    }
  }

  if (method === "thread/name/updated") {
    const threadName = params.threadName || params.name;
    const thread = threadById(threadId);
    if (thread && threadName) thread.name = threadName;
    if (threadId === state.currentThreadId && threadName) {
      elements.threadTitle.textContent = threadName;
    }
    refreshThreads();
    return;
  }

  if (method === "thread/status/changed" && threadId) {
    const thread = threadById(threadId);
    if (thread) thread.status = params.status;
    if (state.currentThread?.id === threadId) state.currentThread.status = params.status;
    const activity = ensureThreadActivity(threadId);
    if (hasPendingInteractionForThread(threadId)) {
      activity.phase = "needs-input";
    } else {
      const phase = phaseFromThreadStatus(params.status);
      if (phase !== "idle") {
        activity.phase = phase;
      } else if (activity.unread) {
        activity.phase = activity.terminalPhase || "completed";
      } else if (!activity.unread) {
        activity.phase = "idle";
        activity.terminalPhase = null;
        activity.turnId = null;
      }
    }
    if (threadId === state.currentThreadId) {
      setBusy(params.status?.type === "active", activity.turnId);
    }
    renderThreadList();
    updateAttentionUi();
    return;
  }

  if (method === "turn/started" && threadId) {
    const turnId = params.turn?.id || null;
    state.compactPendingThreads.delete(threadId);
    updateThreadActivity(threadId, {
      phase: hasPendingInteractionForThread(threadId) ? "needs-input" : "running",
      terminalPhase: null,
      turnId,
      unread: false,
    });
    if (threadId === state.currentThreadId) {
      setBusy(true, turnId);
      elements.welcome.classList.add("hidden");
    }
    return;
  }

  if (method === "turn/completed" && threadId) {
    const turn = params.turn || {};
    const turnId = turn.id || "unknown";
    const key = turnEventKey(threadId, turnId);
    state.compactPendingThreads.delete(threadId);
    state.completedTurns.add(key);

    const activity = ensureThreadActivity(threadId);
    const isTrackedTurn = !activity.turnId || activity.turnId === turn.id;
    const isBackground = threadId !== state.currentThreadId;
    const isUnseen = isBackground || document.hidden;
    if (isTrackedTurn) {
      activity.terminalPhase = terminalTurnPhase(turn.status);
      activity.phase = activity.terminalPhase;
      activity.turnId = null;
    }
    if (isUnseen) activity.unread = true;
    else if (isTrackedTurn) activity.unread = false;

    if (!state.notifiedTurns.has(key)) {
      state.notifiedTurns.add(key);
      void playCompletionSoundOnce(key, turn.status);
      if (isUnseen) {
        announceThreadCompletion(threadId, turn.status);
      }
    }

    if (!isBackground && isTrackedTurn) finishVisibleTurn(turn);
    renderThreadList();
    updateAttentionUi();
    refreshThreads();
    return;
  }

  if (method === "thread/closed" && threadId) {
    state.compactPendingThreads.delete(threadId);
    const activity = ensureThreadActivity(threadId);
    activity.phase = "idle";
    activity.terminalPhase = null;
    activity.turnId = null;
    if (threadId === state.currentThreadId) {
      setBusy(false);
      toast("ارتباط این گفتگو بسته شد.", "error");
    }
    renderThreadList();
    updateAttentionUi();
    return;
  }

  if (threadId && threadId !== state.currentThreadId) {
    if (
      (method === "item/started" || method === "item/completed") &&
      params.item?.type === "userMessage" &&
      params.item.clientId
    ) {
      acceptBackgroundOptimisticUserMessage(params.item.clientId);
    }
    queueThreadEvent(message);
    return;
  }
  renderThreadEvent(message);
}

function approvalDetail(params) {
  if (params.command) {
    const command = Array.isArray(params.command) ? params.command.join(" ") : params.command;
    return [params.cwd ? `cwd: ${params.cwd}` : "", command].filter(Boolean).join("\n\n");
  }
  if (params.fileChanges) return formatChanges(params.fileChanges);
  if (params.permissions) return JSON.stringify(params.permissions, null, 2);
  const copy = { ...params };
  delete copy.threadId;
  delete copy.turnId;
  delete copy.startedAtMs;
  delete copy.itemId;
  delete copy.reason;
  return JSON.stringify(copy, null, 2);
}

const HUMAN_INTERACTION_METHODS = new Set([
  "applyPatchApproval",
  "execCommandApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
]);

function interactionKey(id) {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function interactionThreadId(message) {
  return message?.params?.threadId || message?.params?.conversationId || null;
}

function hasPendingInteractionForThread(threadId) {
  if (!threadId) return false;
  return [...state.pendingInteractions.values()].some(
    (message) => interactionThreadId(message) === threadId,
  );
}

function interactionForCurrentThread() {
  for (const [key, message] of state.pendingInteractions) {
    const threadId = interactionThreadId(message);
    if (
      !state.postponedInteractions.has(key) &&
      threadId === state.currentThreadId
    ) {
      return { key, message };
    }
  }
  return null;
}

function setInteractionSubmitting(submitting) {
  state.interactionSubmitting = submitting;
  for (const control of document.querySelectorAll(
    "#approval-dialog button, #input-dialog button, #input-dialog input, #input-dialog textarea",
  )) {
    control.disabled = submitting;
  }
}

function closeInteractionDialogs() {
  if (elements.approvalDialog.open) elements.approvalDialog.close();
  if (elements.inputDialog.open) elements.inputDialog.close();
  state.activeInteractionKey = null;
  setInteractionSubmitting(false);
}

function updateThreadAfterInteractionChange(threadId, render = true) {
  if (!threadId) return;
  const activity = ensureThreadActivity(threadId);
  if (hasPendingInteractionForThread(threadId)) {
    activity.phase = "needs-input";
  } else if (activity.phase === "needs-input") {
    const status =
      threadById(threadId)?.status ||
      (state.currentThread?.id === threadId ? state.currentThread.status : null);
    const phase = phaseFromThreadStatus(status);
    if (activity.unread) activity.phase = activity.terminalPhase || "completed";
    else if (phase !== "idle" || activity.turnId) activity.phase = "running";
    else if (!activity.unread) activity.phase = "idle";
  }
  if (threadId === state.currentThreadId) {
    setBusy(
      activity.phase === "running" || activity.phase === "needs-input",
      activity.turnId,
    );
  }
  if (render) {
    renderThreadList();
    updateAttentionUi();
  }
}

function removePendingInteraction(id, expectedThreadId = null) {
  const key = interactionKey(id);
  const message = state.pendingInteractions.get(key);
  if (!message) return;
  const threadId = interactionThreadId(message);
  if (expectedThreadId && threadId !== expectedThreadId) return;
  state.pendingInteractions.delete(key);
  state.postponedInteractions.delete(key);
  if (state.activeInteractionKey === key) closeInteractionDialogs();
  updateThreadAfterInteractionChange(threadId);
  showNextInteraction();
}

function queueInteraction(message, { notify = true } = {}) {
  if (!HUMAN_INTERACTION_METHODS.has(message.method)) {
    console.debug("Ignoring unsupported app-server request", message.method);
    return;
  }
  const key = interactionKey(message.id);
  if (state.pendingInteractions.has(key)) return;
  state.pendingInteractions.set(key, message);
  const threadId = interactionThreadId(message);
  updateThreadAfterInteractionChange(threadId);

  if (threadId && threadId !== state.currentThreadId) {
    if (notify) {
      toast(`گفتگوی «${threadTitleById(threadId)}» منتظر پاسخ شماست — نمایش`, "warning", {
        duration: 8000,
        onClick: () => openThread(threadId),
      });
    }
    return;
  }
  showNextInteraction();
}

function syncPendingInteractions(requests) {
  const supported = (requests || []).filter((message) =>
    HUMAN_INTERACTION_METHODS.has(message.method),
  );
  const next = new Map(
    supported.map((message) => [interactionKey(message.id), message]),
  );
  const affectedThreads = new Set();
  for (const message of state.pendingInteractions.values()) {
    affectedThreads.add(interactionThreadId(message));
  }
  for (const message of next.values()) affectedThreads.add(interactionThreadId(message));

  state.pendingInteractions = next;
  state.postponedInteractions = new Set(
    [...state.postponedInteractions].filter((key) => next.has(key)),
  );
  if (state.activeInteractionKey && !next.has(state.activeInteractionKey)) {
    closeInteractionDialogs();
  }
  for (const threadId of affectedThreads) {
    updateThreadAfterInteractionChange(threadId, false);
  }
  renderThreadList();
  updateAttentionUi();
  showNextInteraction();
}

function activateThreadInteractions(threadId) {
  for (const [key, message] of state.pendingInteractions) {
    if (interactionThreadId(message) === threadId) {
      state.postponedInteractions.delete(key);
    }
  }
  showNextInteraction();
}

function postponeInteraction() {
  if (state.activeInteractionKey) {
    state.postponedInteractions.add(state.activeInteractionKey);
  }
  closeInteractionDialogs();
}

function showNextInteraction() {
  if (elements.approvalDialog.open || elements.inputDialog.open) return;
  const interaction = interactionForCurrentThread();
  if (!interaction) return;
  const { key, message } = interaction;
  state.activeInteractionKey = key;
  setInteractionSubmitting(false);
  const title = threadTitleById(interactionThreadId(message));

  if (message.method === "item/tool/requestUserInput") {
    elements.inputContext.textContent = `سؤال Codex · ${title}`;
    showInputRequest(message);
    return;
  }
  if (
    message.method === "mcpServer/elicitation/request" &&
    message.params?.mode === "form"
  ) {
    elements.inputContext.textContent =
      `درخواست ${message.params.serverName || "MCP"} · ${title}`;
    showMcpFormRequest(message);
    return;
  }

  const params = message.params || {};
  elements.approvalContext.textContent = `درخواست Codex · ${title}`;
  const isFile = message.method.includes("fileChange") || message.method === "applyPatchApproval";
  const isPermission = message.method.includes("permissions");
  const isMcp = message.method.includes("elicitation");
  elements.approvalTitle.textContent = isFile
    ? "تأیید تغییر فایل‌ها"
    : isPermission
      ? "درخواست دسترسی بیشتر"
      : isMcp
        ? "درخواست MCP"
        : "تأیید اجرای فرمان";
  elements.approvalReason.textContent =
    params.reason ||
    (isFile
      ? "Codex می‌خواهد این تغییرات را روی فایل‌ها اعمال کند."
      : isPermission
        ? "Codex برای ادامه به دسترسی بیشتری نیاز دارد."
        : isMcp
          ? "یک MCP server برای ادامه به ورودی یا تأیید نیاز دارد."
          : "Codex می‌خواهد این فرمان را اجرا کند.");
  elements.approvalDetail.textContent = approvalDetail(params);
  elements.approvalSession.classList.toggle(
    "hidden",
    isPermission || isMcp || !message.method.includes("requestApproval"),
  );
  elements.approvalDialog.showModal();
}

function interactionResult(message, action) {
  if (message.method === "item/permissions/requestApproval") {
    return {
      permissions: action === "accept" || action === "session" ? message.params.permissions : {},
      scope: action === "session" ? "session" : "turn",
    };
  }
  if (message.method === "mcpServer/elicitation/request") {
    const accepted = action === "accept" || action === "session";
    return {
      action: accepted ? "accept" : action === "cancel" ? "cancel" : "decline",
      content: null,
      _meta: {},
    };
  }
  if (message.method === "execCommandApproval" || message.method === "applyPatchApproval") {
    if (action === "accept") return { decision: "approved" };
    if (action === "session") return { decision: "approved_for_session" };
    if (action === "cancel") return { decision: "abort" };
    return { decision: { denied: { rejection: "کاربر در Codex Web این درخواست را رد کرد." } } };
  }
  const decisions = {
    accept: "accept",
    cancel: "cancel",
    decline: "decline",
    session: "acceptForSession",
  };
  return { decision: decisions[action] };
}

async function respondToInteraction(message, result, context) {
  const key = interactionKey(message.id);
  const threadId = interactionThreadId(message);
  if (!threadId || state.activeInteractionKey !== key) return;

  setInteractionSubmitting(true);
  try {
    await api("/api/respond", {
      method: "POST",
      body: JSON.stringify({ id: message.id, threadId, result }),
    });
    removePendingInteraction(message.id);
  } catch (error) {
    if (error.status === 404) {
      removePendingInteraction(message.id);
      toast("این درخواست قبلاً پاسخ داده شده است.", "warning");
      return;
    }
    if (state.pendingInteractions.has(key)) {
      setInteractionSubmitting(false);
      showError(error, context);
    }
  }
}

async function answerInteraction(action) {
  const message = state.pendingInteractions.get(state.activeInteractionKey);
  if (!message) return;
  await respondToInteraction(
    message,
    interactionResult(message, action),
    "ارسال پاسخ تأیید",
  );
}

function configureInputDialog(isMcpForm) {
  elements.inputDecline.classList.toggle("hidden", !isMcpForm);
  elements.inputCancel.classList.toggle("hidden", !isMcpForm);
  elements.inputSubmit.textContent = isMcpForm ? "ارسال و ادامه" : "ارسال پاسخ";
}

function mcpSchemaOptions(schema) {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((option) => ({
      label: option.title || String(option.const),
      value: String(option.const),
    }));
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value, index) => ({
      label: schema.enumNames?.[index] || String(value),
      value: String(value),
    }));
  }
  if (Array.isArray(schema.items?.anyOf)) {
    return schema.items.anyOf.map((option) => ({
      label: option.title || String(option.const),
      value: String(option.const),
    }));
  }
  if (Array.isArray(schema.items?.enum)) {
    return schema.items.enum.map((value) => ({
      label: String(value),
      value: String(value),
    }));
  }
  return [];
}

function createMcpFormField(fieldName, schema, required) {
  const block = document.createElement("section");
  block.className = "question-block mcp-form-field";
  block.dataset.mcpField = fieldName;

  const header = document.createElement("span");
  header.className = "question-header";
  header.textContent = `${schema.title || fieldName}${required ? " *" : ""}`;
  block.append(header);

  if (schema.description) {
    const description = document.createElement("p");
    description.dir = "auto";
    description.textContent = schema.description;
    block.append(description);
  }

  const controlName = `mcp:${fieldName}`;
  const options = mcpSchemaOptions(schema);
  if (schema.type === "array") {
    const optionGroup = document.createElement("div");
    optionGroup.className = "question-options";
    for (const option of options) {
      const label = document.createElement("label");
      label.className = "question-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = controlName;
      checkbox.value = option.value;
      checkbox.checked = (schema.default || []).map(String).includes(option.value);
      const title = document.createElement("strong");
      title.textContent = option.label;
      label.append(checkbox, title);
      optionGroup.append(label);
    }
    block.dataset.minimumItems = String(schema.minItems ?? (required ? 1 : 0));
    block.dataset.maximumItems =
      schema.maxItems == null ? "" : String(schema.maxItems);
    block.append(optionGroup);
    return block;
  }

  if (options.length || schema.type === "boolean") {
    const select = document.createElement("select");
    select.className = "question-control";
    select.name = controlName;
    select.required = required;
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = required ? "انتخاب کنید…" : "بدون انتخاب";
    select.append(empty);
    const selectOptions =
      schema.type === "boolean"
        ? [
            { label: "بله", value: "true" },
            { label: "خیر", value: "false" },
          ]
        : options;
    for (const option of selectOptions) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      select.append(node);
    }
    if (schema.default != null) select.value = String(schema.default);
    block.append(select);
    return block;
  }

  const input = document.createElement("input");
  input.className = "question-control";
  input.name = controlName;
  input.required = required;
  input.value = schema.default ?? "";
  if (schema.type === "number" || schema.type === "integer") {
    input.type = "number";
    if (schema.type === "integer") input.step = "1";
    if (schema.minimum != null) input.min = String(schema.minimum);
    if (schema.maximum != null) input.max = String(schema.maximum);
    input.dir = "ltr";
  } else {
    const inputTypes = {
      date: "date",
      "date-time": "datetime-local",
      email: "email",
      password: "password",
      uri: "url",
    };
    input.type = inputTypes[schema.format] || "text";
    if (input.type === "password" || schema.writeOnly === true) {
      input.type = "password";
      input.autocomplete = "off";
    }
    if (schema.minLength != null) input.minLength = schema.minLength;
    if (schema.maxLength != null) input.maxLength = schema.maxLength;
    input.dir = schema.format === "email" || schema.format === "uri" ? "ltr" : "auto";
  }
  block.append(input);
  return block;
}

function showMcpFormRequest(message) {
  configureInputDialog(true);
  elements.inputQuestions.replaceChildren();

  const intro = document.createElement("p");
  intro.className = "mcp-form-message";
  intro.dir = "auto";
  intro.textContent = message.params.message || "برای ادامه، فرم MCP را کامل کنید.";
  elements.inputQuestions.append(intro);

  const schema = message.params.requestedSchema || {};
  const requiredFields = new Set(schema.required || []);
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties || {})) {
    elements.inputQuestions.append(
      createMcpFormField(
        fieldName,
        fieldSchema || { type: "string" },
        requiredFields.has(fieldName),
      ),
    );
  }
  elements.inputDialog.showModal();
}

function showInputRequest(message) {
  configureInputDialog(false);
  elements.inputQuestions.replaceChildren();
  for (const question of message.params.questions || []) {
    const block = document.createElement("section");
    block.className = "question-block";
    block.dataset.questionId = question.id;

    const header = document.createElement("span");
    header.className = "question-header";
    header.textContent = question.header || "سؤال";
    const prompt = document.createElement("p");
    prompt.dir = "auto";
    prompt.textContent = question.question;
    block.append(header, prompt);

    if (question.options?.length) {
      const options = document.createElement("div");
      options.className = "question-options";
      for (const [index, option] of question.options.entries()) {
        const label = document.createElement("label");
        label.className = "question-option";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `question-${question.id}`;
        radio.value = option.label;
        radio.required = index === 0;
        const description = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = option.label;
        const small = document.createElement("small");
        small.textContent = option.description;
        description.append(title, small);
        label.append(radio, description);
        options.append(label);
      }
      block.append(options);
    } else {
      const input = document.createElement(question.isSecret ? "input" : "textarea");
      input.className = "question-control";
      if (question.isSecret) {
        input.type = "password";
        input.autocomplete = "off";
      } else {
        input.rows = 3;
      }
      input.dir = "auto";
      input.required = true;
      input.name = `question-${question.id}`;
      block.append(input);
    }
    elements.inputQuestions.append(block);
  }
  elements.inputDialog.showModal();
}

function collectMcpFormContent(message) {
  const formData = new FormData(elements.inputForm);
  const content = {};
  const schema = message.params.requestedSchema || {};
  const requiredFields = new Set(schema.required || []);

  for (const [fieldName, fieldSchema] of Object.entries(schema.properties || {})) {
    const controlName = `mcp:${fieldName}`;
    if (fieldSchema.type === "array") {
      const values = formData.getAll(controlName).map(String);
      const minimum = fieldSchema.minItems ?? (requiredFields.has(fieldName) ? 1 : 0);
      const maximum = fieldSchema.maxItems ?? Number.POSITIVE_INFINITY;
      if (values.length < minimum || values.length > maximum) {
        toast(
          `برای «${fieldSchema.title || fieldName}» بین ${minimum} تا ${
            Number.isFinite(maximum) ? maximum : "چند"
          } گزینه انتخاب کنید.`,
          "error",
        );
        return null;
      }
      if (values.length || requiredFields.has(fieldName)) content[fieldName] = values;
      continue;
    }

    const rawValue = formData.get(controlName);
    if ((rawValue === null || rawValue === "") && !requiredFields.has(fieldName)) {
      continue;
    }
    if (fieldSchema.type === "boolean") {
      content[fieldName] = rawValue === "true";
    } else if (fieldSchema.type === "number" || fieldSchema.type === "integer") {
      content[fieldName] = Number(rawValue);
    } else if (fieldSchema.format === "date-time" && rawValue) {
      content[fieldName] = new Date(String(rawValue)).toISOString();
    } else {
      content[fieldName] = String(rawValue ?? "");
    }
  }
  return content;
}

async function submitInputRequest(event) {
  event.preventDefault();
  const message = state.pendingInteractions.get(state.activeInteractionKey);
  if (!message) return;
  if (message.method === "mcpServer/elicitation/request") {
    const content = collectMcpFormContent(message);
    if (content === null) return;
    await respondToInteraction(
      message,
      { action: "accept", content, _meta: {} },
      "ارسال فرم MCP",
    );
    return;
  }
  const answers = {};
  for (const question of message.params.questions || []) {
    const control = elements.inputForm.elements.namedItem(`question-${question.id}`);
    let value = "";
    if (control instanceof RadioNodeList) value = control.value;
    else value = control?.value || "";
    answers[question.id] = { answers: [value] };
  }
  await respondToInteraction(message, { answers }, "ارسال پاسخ");
}

function handleRpcMessage(message) {
  if (message.method && Object.hasOwn(message, "id")) {
    queueInteraction(message);
    return;
  }
  if (message.method) handleNotification(message);
}

function connectEvents() {
  state.eventSource?.close();
  const events = new EventSource("/api/events");
  state.eventSource = events;
  events.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
    const providerStatus = data.providers?.[state.settings.provider];
    const ready = providerStatus ? Boolean(providerStatus.ready) : Boolean(data.ready);
    updateConnection(ready, ready ? "" : data.message);
    if (ready) {
      const refreshes = [refreshThreads()];
      if (!state.models.length) refreshes.push(loadModels());
      Promise.allSettled(refreshes).then(() => hydrateThreadFromUrl());
    }
  });
  events.addEventListener("rpc", (event) => {
    try {
      handleRpcMessage(JSON.parse(event.data));
    } catch (error) {
      console.error("Could not process Codex event", error);
    }
  });
  events.addEventListener("pending-interactions", (event) => {
    try {
      const data = JSON.parse(event.data);
      syncPendingInteractions(data.requests || []);
    } catch (error) {
      console.error("Could not restore pending Codex interactions", error);
    }
  });
  events.addEventListener("request-resolved", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.id !== undefined) {
        removePendingInteraction(data.id, data.threadId || null);
      }
    } catch (error) {
      console.error("Could not resolve Codex interaction", error);
    }
  });
  events.addEventListener("log", (event) => {
    const data = JSON.parse(event.data);
    console.debug("[codex app-server]", data.message);
  });
  events.onerror = () => updateConnection(false, "در حال اتصال دوباره…");
}

function renderModelOptions(models, selectedModel = "") {
  elements.modelSelect.querySelectorAll("option:not(:first-child)").forEach((node) => node.remove());
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.model || model.id;
    option.textContent = `${model.displayName}${model.isDefault ? " — پیش‌فرض" : ""}`;
    elements.modelSelect.append(option);
  }
  elements.modelSelect.value = models.some(
    (model) => (model.model || model.id) === selectedModel,
  )
    ? selectedModel
    : "";
}

async function loadModels(provider = state.settings.provider) {
  try {
    const result = await rpc("model/list", { limit: 100, provider });
    const models = (result.data || []).filter((model) => !model.hidden);
    state.modelsByProvider[provider] = models;
    const selectedModel = state.settings.modelByProvider[provider] || "";
    if (
      provider === state.settings.provider &&
      selectedModel &&
      !models.some((model) => (model.model || model.id) === selectedModel)
    ) {
      state.settings.modelByProvider[provider] = "";
      persistSettings();
    }
    if (provider === elements.providerSelect.value) {
      state.models = models;
      renderModelOptions(
        models,
        state.settings.modelByProvider[provider] || "",
      );
      if (provider === state.settings.provider) updateSettingsUi();
    }
  } catch (error) {
    console.warn(`Could not load ${provider} models`, error);
  }
}

async function refreshProviderStatus() {
  try {
    const status = await api("/api/status", { headers: {} });
    const providerStatus = status.providers?.[state.settings.provider];
    updateConnection(
      providerStatus ? Boolean(providerStatus.ready) : Boolean(status.ready),
      providerStatus?.message || "",
    );
  } catch (error) {
    updateConnection(false, "سرور در دسترس نیست");
    console.warn("Could not refresh provider status", error);
  }
}

function resizePrompt() {
  elements.prompt.style.height = "auto";
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 210)}px`;
  updateComposerControls();
}

function openSidebar() {
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

let searchTimer;

elements.prompt.addEventListener("input", () => {
  if (state.slashDismissedValue !== elements.prompt.value) {
    state.slashDismissedValue = null;
  }
  saveCurrentDraft();
  resizePrompt();
});
elements.prompt.addEventListener("click", () => updateSlashCommandMenu());
elements.prompt.addEventListener("keyup", (event) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    updateSlashCommandMenu();
  }
});
elements.prompt.addEventListener("paste", handlePromptPaste);
elements.addImages.addEventListener("click", () => elements.imageInput.click());
elements.imageInput.addEventListener("change", () => {
  const files = [...elements.imageInput.files];
  const targetDraftKey = draftKey();
  elements.imageInput.value = "";
  void uploadImages(files, targetDraftKey);
});
elements.conversation.addEventListener(
  "scroll",
  () => {
    updateScrollState();
    scheduleUserMessageNavigationUpdate();
  },
  { passive: true },
);
elements.conversation.addEventListener("scrollend", updateScrollState, { passive: true });
elements.conversation.addEventListener("wheel", cancelScrollAnimation, { passive: true });
elements.conversation.addEventListener("touchstart", cancelScrollAnimation, { passive: true });
elements.conversation.addEventListener("pointerdown", cancelScrollAnimation, { passive: true });
elements.scrollBottom.addEventListener("click", () => {
  state.userNavigationItemId = null;
  elements.userMessageNavigationStatus.textContent = "";
  scrollToBottom(false, true);
  scheduleUserMessageNavigationUpdate();
});
elements.previousUserMessage.addEventListener("click", () =>
  navigateToUserMessage("previous"),
);
elements.nextUserMessage.addEventListener("click", () => navigateToUserMessage("next"));
elements.prompt.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  const slashMenuOpen = !elements.slashCommandMenu.classList.contains("hidden");
  if (slashMenuOpen && event.key === "Escape") {
    event.preventDefault();
    closeSlashCommandMenu(true);
    return;
  }
  if (slashMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    moveSlashCommandSelection(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (slashMenuOpen && event.key === "Tab" && state.slashFilteredCommands.length) {
    event.preventDefault();
    replacePromptWithSlashCommand(state.slashFilteredCommands[state.slashActiveIndex]);
    return;
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (slashMenuOpen && state.slashFilteredCommands.length) {
      void activateHighlightedSlashCommand();
    } else {
      void sendPrompt();
    }
  }
});
elements.slashCommandOptions.addEventListener("pointerdown", (event) => {
  if (event.target.closest("[data-slash-command]")) event.preventDefault();
});
elements.slashCommandOptions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-slash-command]");
  if (!option) return;
  const command = slashCommandByName(option.dataset.slashCommand);
  const index = state.slashFilteredCommands.findIndex(
    (candidate) => candidate.name === command?.name,
  );
  if (index >= 0) state.slashActiveIndex = index;
  void activateHighlightedSlashCommand();
});
elements.sendMessage.addEventListener("click", () => {
  if (
    !elements.slashCommandMenu.classList.contains("hidden") &&
    state.slashFilteredCommands.length
  ) {
    void activateHighlightedSlashCommand();
  } else {
    void sendPrompt();
  }
});
elements.stopTurn.addEventListener("click", stopTurn);
elements.newChat.addEventListener("click", newChat);
elements.threadList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-thread-id]");
  if (button) openThread(button.dataset.threadId);
});
elements.threadSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refreshThreads(), 250);
});
elements.openSettings.addEventListener("click", openSettings);
elements.headerSettings.addEventListener("click", openSettings);
elements.cwdChip.addEventListener("click", openSettings);
elements.saveSettings.addEventListener("click", (event) => {
  event.preventDefault();
  saveSettings();
});
elements.settingsForm.addEventListener("submit", (event) => event.preventDefault());
elements.settingsCancel.addEventListener("click", () => elements.settingsDialog.close());
elements.settingsClose.addEventListener("click", () => elements.settingsDialog.close());
elements.providerSelect.addEventListener("change", () => {
  const provider = elements.providerSelect.value;
  const isClaude = provider === "claude";
  elements.claudePermissionField.classList.toggle("hidden", !isClaude);
  elements.fullAccessWarning.classList.toggle(
    "visible",
    elements.sandboxSelect.value === "danger-full-access" ||
      (isClaude && elements.claudePermissionMode.value === "bypassPermissions"),
  );
  const cachedModels = state.modelsByProvider[provider] || [];
  renderModelOptions(
    cachedModels,
    state.settings.modelByProvider[provider] || "",
  );
  void loadModels(provider);
});
elements.claudePermissionMode.addEventListener("change", () => {
  elements.fullAccessWarning.classList.toggle(
    "visible",
    elements.sandboxSelect.value === "danger-full-access" ||
      (elements.providerSelect.value === "claude" &&
        elements.claudePermissionMode.value === "bypassPermissions"),
  );
});
elements.sandboxSelect.addEventListener("change", () => {
  elements.fullAccessWarning.classList.toggle(
    "visible",
    elements.sandboxSelect.value === "danger-full-access",
  );
});
elements.menuButton.addEventListener("click", openSidebar);
elements.sidebarClose.addEventListener("click", closeSidebar);
elements.mobileScrim.addEventListener("click", closeSidebar);
elements.approvalAccept.addEventListener("click", () => answerInteraction("accept"));
elements.approvalSession.addEventListener("click", () => answerInteraction("session"));
elements.approvalDecline.addEventListener("click", () => answerInteraction("decline"));
elements.approvalCancel.addEventListener("click", () => answerInteraction("cancel"));
elements.approvalLater.addEventListener("click", postponeInteraction);
elements.approvalDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  postponeInteraction();
});
elements.inputLater.addEventListener("click", postponeInteraction);
elements.inputDecline.addEventListener("click", () => answerInteraction("decline"));
elements.inputCancel.addEventListener("click", () => answerInteraction("cancel"));
elements.inputDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  postponeInteraction();
});
elements.inputForm.addEventListener("submit", submitInputRequest);
document.addEventListener("pointerdown", primeCompletionAudio, {
  capture: true,
  once: true,
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".composer")) closeSlashCommandMenu(true);
});
document.addEventListener("keydown", primeCompletionAudio, {
  capture: true,
  once: true,
});
window.addEventListener("resize", scheduleUserMessageNavigationUpdate, {
  passive: true,
});
window.addEventListener("popstate", () => {
  const threadId = threadIdFromUrl();
  if (threadId) void openThread(threadId, { historyMode: "none" });
  else newChat({ historyMode: "none" });
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.currentThreadId) {
    markThreadSeen(state.currentThreadId);
    renderThreadList();
  }
});
elements.messages.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-code");
  if (!button) return;
  const code = button.parentElement.querySelector("code")?.textContent || "";
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = "کپی شد";
    setTimeout(() => (button.textContent = "کپی"), 1200);
  } catch {
    toast("کپی‌کردن ممکن نبود.", "error");
  }
});
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.prompt.value = button.dataset.prompt;
    saveCurrentDraft();
    resizePrompt();
    elements.prompt.focus();
  });
});

async function initialize() {
  updateSettingsUi();
  resizePrompt();
  connectEvents();
  try {
    const status = await api("/api/status", { headers: {} });
    if (status.cwd && state.settings.cwd === defaultSettings.cwd) {
      state.settings.cwd = status.cwd;
      persistSettings();
      updateSettingsUi();
    }
    const providerStatus = status.providers?.[state.settings.provider];
    const ready = providerStatus ? Boolean(providerStatus.ready) : Boolean(status.ready);
    updateConnection(ready, ready ? "" : providerStatus?.message || "در حال اتصال…");
    if (ready) {
      await Promise.allSettled([loadModels(), refreshThreads()]);
      await hydrateThreadFromUrl();
    }
  } catch (error) {
    updateConnection(false, "سرور در دسترس نیست");
    showError(error, "اتصال به سرور");
  }
}

initialize();
