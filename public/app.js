import { escapeHtml, markdown } from "./markdown.js";

const $ = (selector) => document.querySelector(selector);
const BASE_DOCUMENT_TITLE = "Codex Web";
const NEW_THREAD_DRAFT_PREFIX = "__new_thread__";
const OPTIMISTIC_USER_MESSAGE_PREFIX = "__optimistic_user_message__";
const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_IMAGES_PER_BATCH = 20;
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const RESPONSE_STYLE_INSTRUCTIONS =
  "Make final responses adaptively structured and easy to scan. Lead with the direct answer or outcome. If a response contains multiple distinct parts, organize it with Markdown: use short descriptive ## headings for major sections, ### only for genuine subsections, bullets for three or more parallel items, options, or findings, and numbered lists only for ordered actions. Keep paragraphs to one to three sentences and use bold labels sparingly for scan points. Turn list-like prose into real lists. Keep simple answers as a short paragraph. Avoid # headings, deep nesting, decorative sections, redundant summaries, and tables unless a comparison is genuinely clearer.";
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
    name: "goal",
    label: "Goal mode",
    description: "تعیین هدفی که Codex در چند نوبت تا رسیدن به نتیجه پیگیری کند",
  },
  {
    name: "plan",
    label: "Plan mode",
    description: "روشن یا خاموش‌کردن حالت بررسی و برنامه‌ریزی قبل از اجرا",
  },
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
  composerHint: $("#composer-hint"),
  composerTools: $("#composer-tools"),
  composerToolsMenu: $("#composer-tools-menu"),
  composerToolsNote: $("#composer-tools-note"),
  conversation: $("#conversation"),
  cwdChip: $("#cwd-chip"),
  cwdInput: $("#cwd-input"),
  cwdLabel: $("#cwd-label"),
  dictate: $("#dictate"),
  effortSelect: $("#effort-select"),
  fullAccessWarning: $("#full-access-warning"),
  headerSettings: $("#header-settings"),
  imageInput: $("#image-input"),
  goalClear: $("#goal-clear"),
  goalDialog: $("#goal-dialog"),
  goalDialogCancel: $("#goal-dialog-cancel"),
  goalDialogClose: $("#goal-dialog-close"),
  goalDialogHelp: $("#goal-dialog-help"),
  goalDialogTitle: $("#goal-dialog-title"),
  goalEdit: $("#goal-edit"),
  goalForm: $("#goal-form"),
  goalInput: $("#goal-input"),
  goalModeOption: $("#goal-mode-option"),
  goalObjective: $("#goal-objective"),
  goalProgress: $("#goal-progress"),
  goalSave: $("#goal-save"),
  goalStatus: $("#goal-status"),
  goalToggle: $("#goal-toggle"),
  goalUsage: $("#goal-usage"),
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
  planModeOption: $("#plan-mode-option"),
  providerSelect: $("#provider-select"),
  claudePermissionMode: $("#claude-permission-mode"),
  previousUserMessage: $("#previous-user-message"),
  prompt: $("#prompt"),
  promptQueue: $("#prompt-queue"),
  promptQueueClear: $("#prompt-queue-clear"),
  promptQueueCount: $("#prompt-queue-count"),
  promptQueueItems: $("#prompt-queue-items"),
  sandboxSelect: $("#sandbox-select"),
  saveSettings: $("#save-settings"),
  scrollBottom: $("#scroll-bottom"),
  sendMessage: $("#send-message"),
  selectionAsk: $("#selection-ask"),
  settingsCancel: $("#settings-cancel"),
  settingsClose: $("#settings-close"),
  settingsDialog: $("#settings-dialog"),
  settingsForm: $("#settings-form"),
  sidebar: $("#sidebar"),
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
  welcomeDescription: $("#welcome-description"),
  welcomeTitle: $("#welcome-title"),
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
  sidebarCollapsed: false,
};

const SETTINGS_VERSION = 5;

const state = {
  activeInteractionKey: null,
  busy: false,
  collaborationModes: [],
  completedTurns: new Set(),
  compactPendingThreads: new Set(),
  composerModes: new Map(),
  connected: false,
  currentThread: null,
  currentThreadId: null,
  currentTurnId: null,
  dictationBase: "",
  dictationFinal: "",
  dictationRecognition: null,
  drafts: new Map(),
  eventSource: null,
  followOutput: true,
  goals: new Map(),
  goalLoadingThreads: new Set(),
  goalSaving: false,
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
  pendingGoals: new Map(),
  pendingTurnStarts: 0,
  postponedInteractions: new Set(),
  promptQueues: new Map(),
  providerStatuses: {
    claude: { message: "Claude Code CLI پیدا نشد", ready: false },
    codex: { message: "در حال راه‌اندازی Codex…", ready: false },
  },
  queueProcessing: new Set(),
  forceNextScroll: false,
  imageUploadsByDraft: new Map(),
  interactionSubmitting: false,
  scrollFrame: null,
  scrollingToBottom: false,
  settings: loadSettings(),
  selectedAssistantText: "",
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
  urlHydrationActiveKey: null,
  urlHydrationPending: null,
  urlHydrated: false,
  urlHydrationPromise: null,
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
      sidebarCollapsed: savedSettings.sidebarCollapsed === true,
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

function providerLabel(provider) {
  return provider === "claude" ? "Claude" : "Codex";
}

function effectiveProvider() {
  if (state.openingThreadId) return providerForThread(state.openingThreadId);
  if (state.currentThreadId) {
    return state.currentThread?.provider || providerForThread(state.currentThreadId);
  }
  const urlThreadId = !state.urlHydrated ? threadIdFromUrl() : "";
  return urlThreadId ? providerForThread(urlThreadId) : state.settings.provider;
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
  if (["goal", "plan"].includes(command.name) && effectiveProvider() !== "codex") {
    return { available: false, reason: "این حالت فقط برای گفتگوهای Codex در دسترس است." };
  }
  if (state.slashCommandExecuting && command.name === "compact") {
    return { available: false, reason: "یک فرمان دیگر در حال اجراست." };
  }
  if (command.name === "compact") {
    if (!state.currentThreadId) {
      return { available: false, reason: "ابتدا یک گفتگو را شروع یا باز کنید." };
    }
    if (effectiveProvider() !== "codex") {
      return {
        available: false,
        reason: "فشرده‌سازی context فقط برای گفتگوهای Codex پشتیبانی می‌شود.",
      };
    }
    if (!state.connected) return { available: false, reason: "Codex هنوز متصل نیست." };
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
  const provider = effectiveProvider();
  const label = providerLabel(provider);
  const selectedModel = state.settings.modelByProvider[provider] || "";
  const rows = [
    ["Agent", label],
    ["اتصال", state.connected ? "متصل" : "قطع"],
    ["وضعیت", state.busy ? "در حال اجرا" : threadId ? "آماده" : "گفتگوی تازه"],
    ["شناسهٔ گفتگو", threadId || "هنوز ساخته نشده"],
    ["پوشهٔ کاری", runtime.cwd || thread?.cwd || state.settings.cwd || "نامشخص"],
    ["مدل", runtime.model || thread?.model || selectedModel || `پیش‌فرض ${label}`],
  ];
  if (provider === "claude") {
    rows.push([
      "Permission mode",
      runtime.permissionMode ||
        thread?.permissionMode ||
        (!threadId ? state.settings.claudePermissionMode : "نامشخص"),
    ]);
  } else {
    rows.push(
      ["Sandbox", readableSandbox(runtime.sandbox || state.settings.sandbox)],
      ["Approval", readableApproval(runtime.approvalPolicy || state.settings.approvalPolicy)],
      ["Context", contextUsageText(usage)],
    );
  }
  const card = renderLocalCommandCard(`وضعیت ${label}`);
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
    case "goal":
      clearSlashCommandText(command.token, targetDraftKey);
      openGoalDialog();
      return;
    case "plan":
      clearSlashCommandText(command.token, targetDraftKey);
      togglePlanMode();
      return;
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
      openSettings({ focus: elements.modelSelect, provider: effectiveProvider() });
      return;
    case "permissions":
      clearSlashCommandText(command.token, targetDraftKey);
      openSettings({
        focus:
          effectiveProvider() === "claude"
            ? elements.claudePermissionMode
            : elements.sandboxSelect,
        provider: effectiveProvider(),
      });
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
  if (typeof elements.prompt.setRangeText === "function") {
    elements.prompt.setRangeText(text, start, end, "end");
  } else {
    elements.prompt.value =
      elements.prompt.value.slice(0, start) + text + elements.prompt.value.slice(end);
    const nextPosition = start + text.length;
    elements.prompt.setSelectionRange(nextPosition, nextPosition);
  }
  saveCurrentDraft();
  resizePrompt();
}

function markdownQuote(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function insertAssistantQuote(text) {
  const quote = markdownQuote(text || "");
  if (!quote) return;
  const { start, end } = promptSelection();
  const before = elements.prompt.value.slice(0, start);
  const prefix = before && !before.endsWith("\n\n") ? "\n\n" : "";
  insertPromptText(`${prefix}${quote}\n\n`);
  elements.prompt.focus();
}

function hideSelectionAsk() {
  state.selectedAssistantText = "";
  elements.selectionAsk.classList.add("hidden");
}

function selectedAssistantRange() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const range = selection.getRangeAt(0);
  const startNode = range.startContainer;
  const startElement =
    startNode?.nodeType === 1 ? startNode : startNode?.parentElement;
  const content = startElement?.closest?.(".message-row.assistant .message-content");
  if (!content || !content.contains(range.endContainer)) return null;
  return { content, range, selection, text };
}

function updateSelectionAsk() {
  const selected = selectedAssistantRange();
  if (!selected) {
    hideSelectionAsk();
    return;
  }
  const rect = selected.range.getBoundingClientRect?.();
  if (!rect) {
    hideSelectionAsk();
    return;
  }
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
  const center = Math.min(viewportWidth - 82, Math.max(82, rect.left + rect.width / 2));
  const below = rect.bottom + 9;
  const top = below + 42 < viewportHeight ? below : Math.max(8, rect.top - 47);
  state.selectedAssistantText = selected.text;
  elements.selectionAsk.style.left = `${center}px`;
  elements.selectionAsk.style.top = `${top}px`;
  elements.selectionAsk.classList.remove("hidden");
}

let selectionAskFrame = null;
function scheduleSelectionAskUpdate() {
  if (selectionAskFrame !== null) return;
  selectionAskFrame = requestAnimationFrame(() => {
    selectionAskFrame = null;
    updateSelectionAsk();
  });
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

function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setDictationActive(active) {
  elements.dictate.classList.toggle("active", active);
  elements.dictate.setAttribute("aria-pressed", String(active));
  elements.dictate.title = active ? "پایان دیکته" : "دیکته (Ctrl+Shift+D)";
}

function stopDictation() {
  const recognition = state.dictationRecognition;
  if (!recognition) return false;
  try {
    recognition.stop();
  } catch {
    try {
      recognition.abort();
    } catch {
      // Recognition may already have ended.
    }
  }
  return true;
}

function dictationErrorMessage(errorCode) {
  if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
    if (!window.isSecureContext) {
      return "Chrome اجازهٔ Dictation را روی این آدرس نداد؛ از میکروفون Gboard داخل فیلد پیام استفاده کنید.";
    }
    return "اجازهٔ میکروفون برای Dictation داده نشد؛ دسترسی Microphone این سایت را فعال کنید.";
  }
  if (errorCode === "audio-capture") {
    return "میکروفون در دسترس نیست؛ اتصال یا مجوز میکروفون دستگاه را بررسی کنید.";
  }
  if (errorCode === "network") {
    return "سرویس تبدیل گفتار در دسترس نیست؛ اتصال اینترنت را بررسی یا از میکروفون Gboard استفاده کنید.";
  }
  if (errorCode === "language-not-supported") {
    return "Dictation فارسی در این مرورگر دردسترس نیست؛ از میکروفون Gboard استفاده کنید.";
  }
  return `Dictation متوقف شد: ${errorCode || "خطای ناشناخته"}`;
}

function toggleDictation() {
  if (state.dictationRecognition) {
    stopDictation();
    return;
  }
  const SpeechRecognition = speechRecognitionConstructor();
  if (!SpeechRecognition) {
    toast("مرورگر شما Dictation را پشتیبانی نمی‌کند؛ Chrome یا Edge جدید را امتحان کنید.", "warning", {
      duration: 7000,
    });
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "fa-IR";
  recognition.continuous = true;
  recognition.interimResults = true;
  state.dictationBase = elements.prompt.value;
  state.dictationFinal = "";
  state.dictationRecognition = recognition;

  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript || "";
      if (result?.isFinal) finalText += transcript;
      else interimText += transcript;
    }
    state.dictationFinal = finalText.trim();
    const spoken = [state.dictationFinal, interimText.trim()].filter(Boolean).join(" ");
    const separator = state.dictationBase && spoken && !/\s$/.test(state.dictationBase) ? " " : "";
    elements.prompt.value = `${state.dictationBase}${separator}${spoken}`;
    elements.prompt.setSelectionRange(elements.prompt.value.length, elements.prompt.value.length);
    saveCurrentDraft();
    resizePrompt();
  };
  recognition.onerror = (event) => {
    if (!["aborted", "no-speech"].includes(event.error)) {
      const permission = event.error === "not-allowed" || event.error === "service-not-allowed";
      toast(dictationErrorMessage(event.error), permission ? "warning" : "error", {
        duration: 8000,
      });
    }
  };
  recognition.onend = () => {
    if (state.dictationRecognition !== recognition) return;
    state.dictationRecognition = null;
    setDictationActive(false);
    saveCurrentDraft();
    resizePrompt();
  };

  try {
    recognition.start();
    setDictationActive(true);
  } catch (error) {
    state.dictationRecognition = null;
    setDictationActive(false);
    showError(error, "شروع Dictation");
  }
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
  const queueMode = state.busy && !slash;
  elements.sendMessage.disabled = slash
    ? !slashCanRun
    : !state.connected || state.navigating || uploading || !text;
  elements.sendMessage.classList.toggle("queue-mode", queueMode);
  elements.sendMessage.setAttribute(
    "aria-label",
    queueMode ? "افزودن پیام به صف" : "ارسال پیام",
  );
  elements.sendMessage.title = queueMode ? "افزودن به صف" : "ارسال";
  elements.composerHint.textContent = state.busy
    ? "Enter برای افزودن به صف · Shift+Enter برای خط جدید"
    : "Enter برای ارسال · Shift+Enter برای خط جدید";
  elements.addImages.disabled = state.navigating || uploading;
  elements.imageInput.disabled = state.navigating || uploading;
  elements.composerTools.disabled = state.navigating;
  elements.dictate.disabled = state.navigating;
  elements.uploadStatus.textContent = uploadingImages > 1
    ? `در حال افزودن ${uploadingImages.toLocaleString("fa-IR")} تصویر…`
    : "در حال افزودن تصویر…";
  elements.uploadStatus.classList.toggle("hidden", !uploading);
  updateComposerModeUi();
  updateSlashCommandMenu();
}

function updateAgentCopy(provider) {
  const label = providerLabel(provider);
  elements.prompt.placeholder = `پیام به ${label}…`;
  elements.prompt.setAttribute("aria-label", `پیام به ${label}`);
  if (provider === "claude") {
    elements.welcomeTitle.textContent = "چه کاری را به Claude بسپاریم؟";
    elements.welcomeDescription.textContent =
      "پشت این صفحه Claude Code CLI اجرا می‌شود؛ با sessionها و permission mode خود Claude.";
  } else {
    elements.welcomeTitle.textContent = "چه کاری روی کد انجام دهیم؟";
    elements.welcomeDescription.textContent =
      "پشت این صفحه همان Codex CLI اجرا می‌شود؛ با همان login، تنظیمات، skillها، MCPها و دسترسی‌های ترمینال شما.";
  }
}

function updateConnection() {
  const provider = effectiveProvider();
  const status = state.providerStatuses[provider] || {};
  const ready = Boolean(status.ready);
  const label = providerLabel(provider);
  state.connected = ready;
  elements.statusDot.className = `status-dot ${ready ? "ready" : "starting"}`;
  elements.connectionLabel.textContent = ready
    ? `${label} متصل است`
    : status.message || `در حال اتصال به ${label}…`;
  updateAgentCopy(provider);
  updateComposerControls();
}

function setProviderStatus(provider, status = {}) {
  if (provider !== "codex" && provider !== "claude") return false;
  const previous = state.providerStatuses[provider] || {};
  const next = {
    ...previous,
    ...status,
    ready: Boolean(status.ready),
  };
  state.providerStatuses[provider] = next;
  return previous.ready !== next.ready || previous.message !== next.message;
}

function applyProviderStatusPayload(data = {}) {
  let changed = false;
  if (data.providers) {
    for (const provider of ["codex", "claude"]) {
      if (data.providers[provider]) {
        changed = setProviderStatus(provider, data.providers[provider]) || changed;
      }
    }
  } else if (
    (data.provider === "codex" || data.provider === "claude") &&
    Object.hasOwn(data, "ready")
  ) {
    changed =
      setProviderStatus(data.provider, {
        message: data.message || "",
        ready: Boolean(data.ready),
      }) || changed;
  } else if (Object.hasOwn(data, "ready")) {
    // Provider-less app-server status notifications have historically described Codex only.
    changed =
      setProviderStatus("codex", {
        message: data.message || "",
        ready: Boolean(data.ready),
      }) || changed;
  }
  updateConnection();
  return changed;
}

function markProviderConnectionsUnavailable(message) {
  setProviderStatus("codex", { message, ready: false });
  setProviderStatus("claude", { message, ready: false });
  updateConnection();
}

function setBusy(busy, turnId = null) {
  state.busy = busy;
  state.currentTurnId = busy ? turnId : null;
  elements.stopTurn.classList.toggle("hidden", !busy || !state.currentTurnId);
  updateComposerControls();
}

function setNavigating(navigating) {
  state.navigating = navigating;
  if (navigating) {
    closeSlashCommandMenu();
    closeComposerToolsMenu();
    stopDictation();
  }
  elements.prompt.disabled = navigating;
  updateConnection();
  updateComposerControls();
  resizePrompt();
}

function updateFullAccessWarning(provider = elements.providerSelect.value) {
  const dangerous =
    provider === "claude"
      ? elements.claudePermissionMode.value === "bypassPermissions"
      : elements.sandboxSelect.value === "danger-full-access";
  elements.fullAccessWarning.classList.toggle("visible", dangerous);
}

function updateSettingsProviderUi(provider) {
  elements.settingsDialog.dataset.provider = provider;
  const ultraEffort = elements.effortSelect.querySelector('option[value="ultra"]');
  if (ultraEffort) {
    ultraEffort.disabled = provider === "claude";
    ultraEffort.hidden = provider === "claude";
    if (provider === "claude" && elements.effortSelect.value === "ultra") {
      elements.effortSelect.value = "";
    } else if (
      provider === "codex" &&
      !elements.effortSelect.value &&
      state.settings.effort === "ultra"
    ) {
      elements.effortSelect.value = "ultra";
    }
  }
  updateFullAccessWarning(provider);
}

function updateModelLabel(provider = state.settings.provider) {
  const models = state.modelsByProvider[provider] || [];
  const selectedModel = state.settings.modelByProvider[provider] || "";
  const model = models.find(
    (candidate) =>
      candidate.id === selectedModel || candidate.model === selectedModel,
  );
  elements.modelLabel.textContent = model?.displayName || selectedModel || "مدل پیش‌فرض";
}

function updateSettingsUi() {
  const provider = state.settings.provider;
  state.models = state.modelsByProvider[provider] || [];
  const selectedModel = state.settings.modelByProvider[provider] || "";
  elements.cwdInput.value = state.settings.cwd;
  elements.cwdLabel.textContent = shortPath(state.settings.cwd, 38);
  elements.cwdLabel.title = state.settings.cwd;
  elements.providerSelect.value = provider;
  renderModelOptions(state.models, selectedModel, provider);
  elements.effortSelect.value = state.settings.effort;
  elements.sandboxSelect.value = state.settings.sandbox;
  elements.approvalSelect.value = state.settings.approvalPolicy;
  elements.personalitySelect.value = state.settings.personality;
  elements.claudePermissionMode.value = state.settings.claudePermissionMode;
  updateSettingsProviderUi(provider);
  updateModelLabel(provider);
}

function shortPath(path, length = 30) {
  if (!path) return "";
  if (path.length <= length) return path;
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return `…${path.slice(-(length - 1))}`;
  return `…/${parts.slice(-2).join("/")}`;
}

function openSettings({ focus = elements.cwdInput, provider = state.settings.provider } = {}) {
  updateSettingsUi();
  if (provider !== state.settings.provider) {
    elements.providerSelect.value = provider;
    updateSettingsProviderUi(provider);
    const models = state.modelsByProvider[provider] || [];
    renderModelOptions(models, state.settings.modelByProvider[provider] || "", provider);
    void loadModels(provider);
  }
  elements.settingsDialog.showModal();
  setTimeout(() => focus.focus(), 0);
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
    sidebarCollapsed: state.settings.sidebarCollapsed,
  };
  persistSettings();
  state.models = state.modelsByProvider[provider] || [];
  updateSettingsUi();
  updateConnection();
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
    provider.dir = "ltr";
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

function composerModeFor(key = draftKey()) {
  return state.composerModes.get(key) || "default";
}

function goalFor(key = draftKey()) {
  return state.pendingGoals.get(key) || state.goals.get(key) || null;
}

function closeComposerToolsMenu() {
  elements.composerToolsMenu.classList.add("hidden");
  elements.composerTools.setAttribute("aria-expanded", "false");
}

function updateComposerModeUi() {
  const provider = effectiveProvider();
  const codex = provider === "codex";
  const plan = codex && composerModeFor() === "plan";
  const goal = codex ? goalFor() : null;
  elements.planModeOption.disabled = !codex;
  elements.goalModeOption.disabled = !codex;
  elements.planModeOption.setAttribute("aria-checked", String(plan));
  elements.composerToolsNote.classList.toggle("hidden", codex);
  elements.composerTools.classList.toggle("active-mode", Boolean(plan || goal));
  const toolLabel = !codex
    ? "Plan و Goal فقط برای Codex در دسترس‌اند"
    : plan
      ? "ابزارهای گفتگو؛ Plan mode روشن است"
      : goal
        ? "ابزارهای گفتگو؛ Goal فعال است"
        : "ابزارهای گفتگو";
  elements.composerTools.setAttribute("aria-label", toolLabel);
  elements.composerTools.title = toolLabel;
}

function toggleComposerToolsMenu() {
  const opening = elements.composerToolsMenu.classList.contains("hidden");
  closeSlashCommandMenu();
  elements.composerToolsMenu.classList.toggle("hidden", !opening);
  elements.composerTools.setAttribute("aria-expanded", String(opening));
}

function togglePlanMode() {
  if (effectiveProvider() !== "codex") {
    toast("Plan mode فقط در گفتگوهای Codex در دسترس است.", "warning");
    return false;
  }
  const key = draftKey();
  const plan = composerModeFor(key) !== "plan";
  if (plan) state.composerModes.set(key, "plan");
  else state.composerModes.delete(key);
  updateComposerModeUi();
  closeComposerToolsMenu();
  toast(plan ? "Plan mode روشن شد." : "Plan mode خاموش شد.", "success");
  return plan;
}

function effectivePlanModel() {
  const selected = state.settings.modelByProvider.codex || "";
  if (selected) return selected;
  const runtime = state.currentThreadId
    ? state.threadRuntime.get(state.currentThreadId) || {}
    : {};
  if (runtime.model) return runtime.model;
  if (state.currentThread?.model) return state.currentThread.model;
  const models = state.modelsByProvider.codex || [];
  const fallback = models.find((model) => model.isDefault) || models[0];
  return fallback?.model || fallback?.id || "";
}

function planCollaborationMode() {
  const template =
    state.collaborationModes.find((mode) => mode.mode === "plan") || {};
  const model = effectivePlanModel() || template.model || "";
  if (!model) return null;
  return {
    mode: "plan",
    settings: {
      developer_instructions: null,
      model,
      reasoning_effort:
        template.reasoning_effort || state.settings.effort || "medium",
    },
  };
}

async function loadCollaborationModes() {
  try {
    const result = await rpc("collaborationMode/list", {});
    state.collaborationModes = Array.isArray(result?.data) ? result.data : [];
  } catch {}
}

const GOAL_STATUS_LABELS = {
  active: "فعال",
  paused: "مکث",
  blocked: "متوقف",
  usageLimited: "محدودیت مصرف",
  budgetLimited: "پایان بودجه",
  complete: "کامل",
};

function formatGoalUsage(goal) {
  const parts = [];
  if (Number.isFinite(goal?.tokensUsed) && goal.tokensUsed > 0) {
    const tokens = goal.tokensUsed.toLocaleString("fa-IR");
    parts.push(
      Number.isFinite(goal.tokenBudget) && goal.tokenBudget > 0
        ? `${tokens} از ${goal.tokenBudget.toLocaleString("fa-IR")} توکن`
        : `${tokens} توکن`,
    );
  }
  if (Number.isFinite(goal?.timeUsedSeconds) && goal.timeUsedSeconds > 0) {
    const minutes = Math.max(1, Math.round(goal.timeUsedSeconds / 60));
    parts.push(`${minutes.toLocaleString("fa-IR")} دقیقه`);
  }
  return parts.join(" · ");
}

function renderGoalProgress() {
  const goal = effectiveProvider() === "codex" ? goalFor() : null;
  elements.goalProgress.classList.toggle("hidden", !goal);
  if (!goal) {
    elements.goalProgress.removeAttribute("data-status");
    elements.goalObjective.textContent = "";
    elements.goalUsage.classList.add("hidden");
    updateComposerModeUi();
    return;
  }

  const status = goal.status || "active";
  elements.goalProgress.dataset.status = status;
  elements.goalObjective.textContent = goal.objective || "";
  elements.goalObjective.title = goal.objective || "";
  elements.goalStatus.textContent = goal.pending
    ? "با اولین ارسال فعال می‌شود"
    : GOAL_STATUS_LABELS[status] || status;
  const usage = formatGoalUsage(goal);
  elements.goalUsage.textContent = usage;
  elements.goalUsage.classList.toggle("hidden", !usage);

  const paused = status !== "active";
  elements.goalToggle.disabled = Boolean(goal.pending || status === "complete" || state.goalSaving);
  elements.goalEdit.disabled = state.goalSaving;
  elements.goalClear.disabled = state.goalSaving;
  elements.goalToggle.setAttribute(
    "aria-label",
    paused ? "ادامهٔ هدف" : "مکث هدف",
  );
  elements.goalToggle.title = paused ? "ادامهٔ هدف" : "مکث هدف";
  elements.goalToggle.innerHTML = paused
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5z" /></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10m6-10v10" /></svg>';
  updateComposerModeUi();
}

async function loadGoal(threadId) {
  if (!threadId || providerForThread(threadId) !== "codex") return null;
  if (state.goalLoadingThreads.has(threadId)) return null;
  state.goalLoadingThreads.add(threadId);
  try {
    const result = await rpc("thread/goal/get", { threadId });
    if (result?.goal) state.goals.set(threadId, result.goal);
    else state.goals.delete(threadId);
    if (state.currentThreadId === threadId) renderGoalProgress();
    return result?.goal || null;
  } catch {
    return null;
  } finally {
    state.goalLoadingThreads.delete(threadId);
  }
}

function openGoalDialog() {
  closeComposerToolsMenu();
  if (effectiveProvider() !== "codex") {
    toast("Goal mode فقط در گفتگوهای Codex در دسترس است.", "warning");
    return;
  }
  const goal = goalFor();
  elements.goalInput.value = goal?.objective || "";
  elements.goalDialogTitle.textContent = goal ? "ویرایش هدف" : "یک هدف تعیین کن";
  elements.goalSave.textContent = goal ? "ذخیرهٔ هدف" : "شروع Goal";
  elements.goalDialogHelp.textContent = state.currentThreadId
    ? "تغییر هدف از همین گفتگو ادامه پیدا می‌کند."
    : "هدف با اولین ارسال روی گفتگوی تازه فعال می‌شود.";
  elements.goalDialog.showModal();
  elements.goalInput.focus();
}

async function saveGoalFromDialog(event) {
  event.preventDefault();
  if (state.goalSaving) return;
  const objective = elements.goalInput.value.trim();
  if (!objective) {
    elements.goalInput.focus();
    return;
  }
  const key = draftKey();
  if (!state.currentThreadId) {
    const previous = goalFor(key);
    const replaceGeneratedPrompt =
      !elements.prompt.value.trim() ||
      (previous?.pending && elements.prompt.value.trim() === previous.objective);
    state.pendingGoals.set(key, {
      objective,
      pending: true,
      status: "active",
      timeUsedSeconds: 0,
      tokensUsed: 0,
    });
    if (replaceGeneratedPrompt) {
      elements.prompt.value = objective;
      saveCurrentDraft();
      resizePrompt();
    }
    elements.goalDialog.close();
    renderGoalProgress();
    elements.prompt.focus();
    return;
  }

  state.goalSaving = true;
  elements.goalSave.disabled = true;
  renderGoalProgress();
  try {
    const current = goalFor();
    const status = ["active", "paused"].includes(current?.status)
      ? current.status
      : "active";
    const result = await rpc("thread/goal/set", {
      threadId: state.currentThreadId,
      objective,
      status,
    });
    if (result?.goal) state.goals.set(state.currentThreadId, result.goal);
    elements.goalDialog.close();
    toast("هدف گفتگو ذخیره شد.", "success");
  } catch (error) {
    showError(error, "ذخیرهٔ هدف");
  } finally {
    state.goalSaving = false;
    elements.goalSave.disabled = false;
    renderGoalProgress();
  }
}

async function toggleGoalStatus() {
  const threadId = state.currentThreadId;
  const goal = goalFor();
  if (!threadId || !goal || goal.pending || state.goalSaving) return;
  const status = goal.status === "active" ? "paused" : "active";
  state.goalSaving = true;
  renderGoalProgress();
  try {
    const result = await rpc("thread/goal/set", { threadId, status });
    if (result?.goal) state.goals.set(threadId, result.goal);
    toast(status === "paused" ? "Goal موقتاً متوقف شد." : "Goal دوباره فعال شد.", "success");
  } catch (error) {
    showError(error, status === "paused" ? "مکث هدف" : "ادامهٔ هدف");
  } finally {
    state.goalSaving = false;
    renderGoalProgress();
  }
}

async function clearGoal() {
  const key = draftKey();
  if (!state.currentThreadId) {
    state.pendingGoals.delete(key);
    renderGoalProgress();
    return;
  }
  if (!goalFor() || state.goalSaving) return;
  const threadId = state.currentThreadId;
  state.goalSaving = true;
  renderGoalProgress();
  try {
    await rpc("thread/goal/clear", { threadId });
    state.goals.delete(threadId);
    state.pendingGoals.delete(threadId);
    toast("Goal از گفتگو برداشته شد.", "success");
  } catch (error) {
    showError(error, "پاک‌کردن هدف");
  } finally {
    state.goalSaving = false;
    renderGoalProgress();
  }
}

function migrateComposerState(sourceKey, targetKey) {
  if (!sourceKey || sourceKey === targetKey) return;
  if (state.composerModes.has(sourceKey)) {
    state.composerModes.set(targetKey, state.composerModes.get(sourceKey));
    state.composerModes.delete(sourceKey);
  }
  if (state.pendingGoals.has(sourceKey)) {
    state.pendingGoals.set(targetKey, state.pendingGoals.get(sourceKey));
    state.pendingGoals.delete(sourceKey);
  }
}

async function activatePendingGoal(threadId) {
  const pending = state.pendingGoals.get(threadId);
  if (!pending) return null;
  const result = await rpc("thread/goal/set", {
    threadId,
    objective: pending.objective,
    status: "active",
  });
  if (result?.goal) state.goals.set(threadId, result.goal);
  state.pendingGoals.delete(threadId);
  if (state.currentThreadId === threadId) renderGoalProgress();
  return result?.goal || null;
}

function promptQueueFor(key = draftKey(), create = false) {
  if (!state.promptQueues.has(key) && create) state.promptQueues.set(key, []);
  return state.promptQueues.get(key) || [];
}

function renderPromptQueue() {
  const queue = promptQueueFor();
  elements.promptQueue.classList.toggle("hidden", queue.length === 0);
  elements.promptQueueCount.textContent = queue.length.toLocaleString("fa-IR");
  elements.promptQueueItems.replaceChildren();

  queue.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "prompt-queue-item";
    row.dataset.queueId = item.id;

    const order = document.createElement("span");
    order.className = "prompt-queue-index";
    order.textContent = String(index + 1).padStart(2, "0");

    const preview = document.createElement("bdi");
    preview.className = "prompt-queue-preview";
    preview.textContent = item.text.replace(/\s+/g, " ").trim();
    preview.title = item.text;

    const actions = document.createElement("span");
    actions.className = "prompt-queue-actions";
    actions.innerHTML = `
      <button class="prompt-queue-action" type="button" data-queue-action="edit" aria-label="ویرایش پیام صف" title="ویرایش">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 5.3 4 4M4.75 19.25l3.6-.8L19.2 7.6a1.4 1.4 0 0 0 0-2l-.8-.8a1.4 1.4 0 0 0-2 0L5.55 15.65z" /></svg>
      </button>
      <button class="prompt-queue-action" type="button" data-queue-action="remove" aria-label="حذف پیام از صف" title="حذف">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4.75h6V7M8 10v7M12 10v7M16 10v7M6.5 7l.7 12.25h9.6L17.5 7" /></svg>
      </button>`;
    row.append(order, preview, actions);
    elements.promptQueueItems.append(row);
  });
}

function migratePromptQueue(sourceKey, targetKey) {
  if (!sourceKey || sourceKey === targetKey) return;
  const source = promptQueueFor(sourceKey);
  if (!source.length) return;
  const target = promptQueueFor(targetKey);
  state.promptQueues.set(targetKey, [...source, ...target]);
  state.promptQueues.delete(sourceKey);
  if (draftKey() === targetKey) renderPromptQueue();
}

function enqueuePrompt(text, key = draftKey()) {
  const queue = promptQueueFor(key, true);
  const item = { id: crypto.randomUUID(), text };
  queue.push(item);
  if (key === draftKey()) {
    elements.prompt.value = "";
    state.drafts.set(key, "");
    closeSlashCommandMenu();
    resizePrompt();
    renderPromptQueue();
  }
  return item;
}

function removeQueuedPrompt(queueId, { edit = false } = {}) {
  const key = draftKey();
  const queue = promptQueueFor(key);
  const index = queue.findIndex((item) => item.id === queueId);
  if (index < 0) return;
  const [item] = queue.splice(index, 1);
  if (!queue.length) state.promptQueues.delete(key);
  renderPromptQueue();
  if (!edit) return;

  const existing = elements.prompt.value.trim();
  elements.prompt.value = existing ? `${item.text}\n\n${elements.prompt.value}` : item.text;
  elements.prompt.setSelectionRange(elements.prompt.value.length, elements.prompt.value.length);
  saveCurrentDraft();
  resizePrompt();
  elements.prompt.focus();
}

function clearPromptQueue() {
  state.promptQueues.delete(draftKey());
  renderPromptQueue();
}

function scheduleNextQueuedPrompt(threadId = state.currentThreadId) {
  if (!threadId) return;
  setTimeout(() => void processNextQueuedPrompt(threadId), 0);
}

async function processNextQueuedPrompt(threadId) {
  if (
    !threadId ||
    threadId !== state.currentThreadId ||
    state.busy ||
    state.navigating ||
    !state.connected ||
    state.pendingTurnStarts > 0 ||
    imageUploadsForDraft(threadId) > 0
  ) {
    return false;
  }
  const key = draftKey(threadId);
  if (state.queueProcessing.has(key)) return false;
  const queue = promptQueueFor(key);
  const item = queue.shift();
  if (!item) return false;
  if (!queue.length) state.promptQueues.delete(key);
  state.queueProcessing.add(key);
  renderPromptQueue();
  try {
    const started = await sendPrompt(item.text, { fromQueue: true });
    if (!started) {
      promptQueueFor(key, true).unshift(item);
      renderPromptQueue();
    }
    return started;
  } finally {
    state.queueProcessing.delete(key);
  }
}

function saveCurrentDraft() {
  state.drafts.set(draftKey(), elements.prompt.value);
}

function restoreDraft(threadId = state.currentThreadId) {
  elements.prompt.value = state.drafts.get(draftKey(threadId)) || "";
  state.slashDismissedValue = null;
  renderPromptQueue();
  renderGoalProgress();
  resizePrompt();
}

function threadIdFromUrl() {
  if (!window.location?.href) return "";
  const searchParams = new URL(window.location.href).searchParams;
  // app-server calls this value threadId; the user-facing URL calls it a session.
  const sessionId = searchParams.get("session");
  return sessionId !== null ? sessionId : searchParams.get("thread") || "";
}

function historyStateMatches(stateValue) {
  const current = window.history?.state || {};
  return (
    (current.threadId || "") === (stateValue.threadId || "") &&
    (current.draftId || "") === (stateValue.draftId || "")
  );
}

function updateThreadUrl(threadId, mode = "push", draftId = state.newDraftId) {
  if (!window.location?.href || !window.history) return;
  const url = new URL(window.location.href);
  const target = threadId || "";
  const current = threadIdFromUrl();
  const currentSessionIds = url.searchParams.getAll("session");
  const canonicalUrlMatches =
    !url.searchParams.has("thread") &&
    (target
      ? currentSessionIds.length === 1 && currentSessionIds[0] === target
      : currentSessionIds.length === 0);
  const sameTarget = current === target;
  if (mode === "none" && !sameTarget) return;
  if (threadId) url.searchParams.set("session", threadId);
  else url.searchParams.delete("session");
  url.searchParams.delete("thread");
  const stateValue = threadId ? { threadId } : { draftId };
  if (canonicalUrlMatches && historyStateMatches(stateValue)) return;
  if (mode === "none" || sameTarget) mode = "replace";
  const method = mode === "replace" ? "replaceState" : "pushState";
  if (typeof window.history[method] !== "function") return;
  window.history[method](stateValue, "", `${url.pathname}${url.search}${url.hash}`);
}

function urlHydrationTarget(draftId = null) {
  const threadId = threadIdFromUrl();
  const historyDraftId =
    typeof window.history?.state?.draftId === "string"
      ? window.history.state.draftId
      : "";
  const targetDraftId = threadId
    ? ""
    : draftId || historyDraftId || state.newDraftId;
  return {
    draftId: targetDraftId,
    key: threadId ? `thread:${threadId}` : `draft:${targetDraftId}`,
    threadId,
  };
}

function hydrationTargetMatchesCurrentView(target) {
  return target.threadId
    ? state.currentThreadId === target.threadId
    : !state.currentThreadId && state.newDraftId === target.draftId;
}

async function hydrateThreadFromUrl({ draftId = null, force = false } = {}) {
  const requestedTarget = urlHydrationTarget(draftId);
  if (force) state.urlHydrated = false;
  if (state.urlHydrated && !state.urlHydrationPromise) return true;
  if (state.urlHydrationPromise) {
    if (
      requestedTarget.key !== state.urlHydrationActiveKey &&
      requestedTarget.key !== state.urlHydrationPending?.key
    ) {
      state.urlHydrationPending = requestedTarget;
      // Cancel an in-flight resume before it can commit a now-stale history target.
      state.navigationVersion += 1;
    }
    return state.urlHydrationPromise;
  }

  state.urlHydrationPending = requestedTarget;
  state.urlHydrationPromise = (async () => {
    let hydrated = false;
    while (state.urlHydrationPending) {
      const target = state.urlHydrationPending;
      state.urlHydrationPending = null;
      state.urlHydrationActiveKey = target.key;
      state.urlHydrated = false;

      const currentTarget = urlHydrationTarget();
      if (currentTarget.key !== target.key) {
        state.urlHydrationPending = currentTarget;
        continue;
      }

      hydrated = target.threadId
        ? await openThread(target.threadId, { historyMode: "none" })
        : newChat({
            draftId: target.draftId,
            historyMode: "none",
          });

      const latestTarget = urlHydrationTarget();
      if (latestTarget.key !== target.key) {
        state.urlHydrationPending = latestTarget;
        continue;
      }
      state.urlHydrated =
        Boolean(hydrated) || hydrationTargetMatchesCurrentView(target);
      updateConnection();
    }
    return state.urlHydrated;
  })();
  try {
    return await state.urlHydrationPromise;
  } finally {
    state.urlHydrationActiveKey = null;
    state.urlHydrationPending = null;
    state.urlHydrationPromise = null;
  }
}

function restoreCurrentViewUrl() {
  if (state.currentThreadId) {
    updateThreadUrl(state.currentThreadId, "replace");
  } else {
    updateThreadUrl(null, "replace", state.newDraftId);
  }
}

function newChat({ draftId = null, historyMode = "push" } = {}) {
  if (!state.currentThreadId && imageUploadsForDraft() > 0) {
    toast("برای حفظ تصاویر این پیش‌نویس، تا پایان افزودن آن‌ها صبر کنید.", "warning");
    if (historyMode === "none") restoreCurrentViewUrl();
    return false;
  }
  saveCurrentDraft();
  stopDictation();
  state.navigationVersion += 1;
  closeInteractionDialogs();
  state.openingThreadId = null;
  state.currentThread = null;
  state.currentThreadId = null;
  state.currentTurnId = null;
  state.newDraftId = draftId || crypto.randomUUID();
  setNavigating(false);
  setBusy(false);
  clearConversation();
  elements.welcome.classList.remove("hidden");
  elements.threadTitle.textContent = "گفتگوی تازه";
  elements.threadMeta.textContent = "";
  updateThreadUrl(null, historyMode, state.newDraftId);
  restoreDraft(null);
  renderThreadList();
  updateAttentionUi();
  updateConnection();
  closeSidebar();
  elements.prompt.focus();
  return true;
}

function setCurrentThread(thread, metadata = {}) {
  if (state.currentThreadId !== thread.id) closeInteractionDialogs();
  state.currentThread = thread;
  state.currentThreadId = thread.id;
  const runtime = { ...(state.threadRuntime.get(thread.id) || {}) };
  if (metadata.approvalPolicy !== undefined) runtime.approvalPolicy = metadata.approvalPolicy;
  if (metadata.reasoningEffort !== undefined) runtime.reasoningEffort = metadata.reasoningEffort;
  if (metadata.permissionMode !== undefined) runtime.permissionMode = metadata.permissionMode;
  if (metadata.sandbox !== undefined) runtime.sandbox = metadata.sandbox;
  if (metadata.cwd || thread.cwd) runtime.cwd = metadata.cwd || thread.cwd;
  if (metadata.model || thread.model) runtime.model = metadata.model || thread.model;
  if (thread.permissionMode) runtime.permissionMode = thread.permissionMode;
  state.threadRuntime.set(thread.id, runtime);
  syncThreadActivity(thread);
  markThreadSeen(thread.id);
  elements.threadTitle.textContent = threadDisplayTitle(thread);
  const cwd = metadata.cwd || thread.cwd || state.settings.cwd;
  const model = metadata.model || thread.model || "";
  elements.threadMeta.textContent = [
    providerLabel(thread.provider || providerForThread(thread.id)),
    cwd,
    model,
  ]
    .filter(Boolean)
    .join("  ·  ");
  elements.welcome.classList.add("hidden");
  restoreDraft(thread.id);
  renderThreadList();
  activateThreadInteractions(thread.id);
  updateConnection();
  void loadGoal(thread.id);
}

function itemText(item) {
  if (item.type === "userMessage") {
    return (item.content || [])
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "image" || part.type === "localImage") return `[تصویر: ${part.path || part.url}]`;
        if (part.type === "audio" || part.type === "localAudio") return "🎙️ پیام صوتی";
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

function createAssistantMessageActions() {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.setAttribute("aria-label", "کارهای پاسخ");
  actions.innerHTML = `
    <button class="message-action" type="button" data-message-action="copy" title="کپی Markdown" aria-label="کپی پاسخ به‌صورت Markdown">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
      <span>کپی</span>
    </button>
    <button class="message-action" type="button" data-message-action="quote" title="ارجاع به این پاسخ" aria-label="ارجاع به این پاسخ در پیام تازه">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.25 10.75H4.5A5.5 5.5 0 0 1 10 5.25v3A2.5 2.5 0 0 1 7.5 10.75v3H4.75M16.25 10.75H13.5A5.5 5.5 0 0 1 19 5.25v3a2.5 2.5 0 0 1-2.5 2.5v3h-2.75" /></svg>
      <span>ارجاع</span>
    </button>`;
  return actions;
}

function createMessageView(item) {
  const role = item.type === "userMessage" ? "user" : "assistant";
  const row = document.createElement("article");
  row.className = `message-row ${role}`;
  row.dataset.itemId = item.id;

  const body = document.createElement("div");
  body.className = "message-body";
  const content = document.createElement("div");
  content.className = "message-content";
  content.dir = "auto";
  body.append(content);
  if (role === "assistant") body.append(createAssistantMessageActions());
  row.append(body);
  elements.messages.append(row);
  if (role === "user") scheduleUserMessageNavigationUpdate();
  return { content, element: row, text: "", type: item.type };
}

function activityTitle(item) {
  const titles = {
    collabAgentToolCall: "عامل‌های همکار",
    commandExecution: "ترمینال",
    contextCompaction: "بهینه‌سازی گفتگو",
    dynamicToolCall: item.tool ? `ابزار · ${item.tool}` : "ابزار",
    enteredReviewMode: "حالت بررسی",
    exitedReviewMode: "پایان بررسی",
    fileChange: "ویرایش فایل‌ها",
    hookPrompt: "Hook",
    imageGeneration: "ساخت تصویر",
    imageView: "مشاهده تصویر",
    mcpToolCall: item.tool ? `ابزار · ${item.tool}` : "ابزار MCP",
    plan: "برنامه",
    reasoning: "تفکر",
    sleep: "انتظار",
    subAgentActivity: "عامل‌های همکار",
    webSearch: item.query ? `جستجوی وب · ${item.query}` : "جستجوی وب",
  };
  return titles[item.type] || item.type || "فعالیت";
}

function createActivityView(item) {
  const details = document.createElement("details");
  details.className = `activity-card activity-${item.type.replace(/[^a-z0-9_-]/gi, "-")}`;
  details.dataset.itemId = item.id;
  details.dataset.activityType = item.type;
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
  const wasRunning = view.element.classList.contains("running");
  view.element.hidden = false;
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
    view.summary.textContent = running ? "در حال فکر کردن" : "تفکر";
    view.content.hidden = false;
    view.content.className = "activity-content";
    view.content.textContent = view.text;
    if (!running && wasRunning) view.element.open = false;
    return;
  }

  const stopped = !running && outcome === "stopped";
  view.element.classList.add("reasoning-status");
  view.element.classList.toggle("reasoning-complete", !running && !stopped);
  view.element.classList.toggle("reasoning-stopped", stopped);
  view.element.open = false;
  view.element.hidden = !running && !stopped;
  view.summary.setAttribute("aria-disabled", "true");
  view.content.hidden = true;
  view.content.replaceChildren();
  setReasoningStatusLabel(
    view,
    running ? "در حال فکر کردن" : stopped ? "تفکر متوقف شد" : "تفکر انجام شد",
    running,
  );
}

function updateCompaction(view, phase) {
  const running = phase !== "completed";
  view.element.classList.add("compaction-status");
  view.element.classList.toggle("running", running);
  view.element.classList.toggle("completed", !running);
  view.element.open = false;
  view.element.hidden = !running;
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

  const wasRunning = view.element.classList.contains("running");
  const running = phase !== "completed" && ["inProgress", "running"].includes(item.status);
  const failed =
    ["failed", "error"].includes(item.status) ||
    (item.type === "commandExecution" && item.exitCode != null && item.exitCode !== 0);
  view.element.hidden = false;
  view.element.classList.toggle("running", running);
  view.element.classList.toggle("completed", !running);
  view.element.classList.toggle("failed", failed);
  if (!running && wasRunning) view.element.open = false;

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
  if (!state.busy) scheduleNextQueuedPrompt(thread.id);
}

async function openThread(threadId, { historyMode = "push" } = {}) {
  if (!threadId) return false;
  if (!state.currentThreadId && imageUploadsForDraft() > 0) {
    toast("برای حفظ تصاویر این پیش‌نویس، تا پایان افزودن آن‌ها صبر کنید.", "warning");
    if (historyMode === "none") restoreCurrentViewUrl();
    return false;
  }
  const navigationVersion = ++state.navigationVersion;
  if (threadId === state.currentThreadId) {
    state.openingThreadId = null;
    updateThreadUrl(threadId, historyMode);
    setNavigating(false);
    markThreadSeen(threadId);
    renderThreadList();
    activateThreadInteractions(threadId);
    updateConnection();
    if (!state.busy) scheduleNextQueuedPrompt(threadId);
    closeSidebar();
    return true;
  }
  saveCurrentDraft();
  closeInteractionDialogs();
  state.openingThreadId = threadId;
  setNavigating(true);
  state.threadEventBacklog.set(threadId, []);
  try {
    elements.threadTitle.textContent = "در حال باز کردن…";
    const result = await rpc("thread/resume", { threadId });
    if (navigationVersion !== state.navigationVersion) return false;
    setCurrentThread(result.thread, result);
    renderHistory(result.thread);
    flushThreadEventBacklog(result.thread.id);
    updateThreadUrl(result.thread.id, historyMode);
    state.openingThreadId = null;
    setNavigating(false);
    updateConnection();
    closeSidebar();
    elements.prompt.focus();
    return true;
  } catch (error) {
    if (navigationVersion !== state.navigationVersion) return false;
    showError(error, "باز کردن گفتگو");
    state.openingThreadId = null;
    setNavigating(false);
    elements.threadTitle.textContent = state.currentThread
      ? threadDisplayTitle(state.currentThread)
      : "گفتگوی تازه";
    if (historyMode === "none") restoreCurrentViewUrl();
    updateConnection();
    return false;
  } finally {
    if (state.openingThreadId === threadId) state.openingThreadId = null;
    updateConnection();
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
    view.element.open = false;
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
    text.className = "plan-step-text";
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
  if (state.settings.provider === "codex") {
    if (composerModeFor(sourceDraftKey) !== "plan") {
      params.developerInstructions = RESPONSE_STYLE_INSTRUCTIONS;
    }
    if (state.settings.approvalPolicy) params.approvalPolicy = state.settings.approvalPolicy;
    if (state.settings.sandbox) params.sandbox = state.settings.sandbox;
    if (state.settings.personality) params.personality = state.settings.personality;
  }
  const model = state.settings.modelByProvider[state.settings.provider] || "";
  if (model) params.model = model;
  if (state.settings.provider === "claude" && state.settings.claudePermissionMode) {
    params.permissionMode = state.settings.claudePermissionMode;
  }
  const result = await rpc("thread/start", params);
  state.threadsRefreshVersion += 1;
  if (!state.threads.some((thread) => thread.id === result.thread.id)) {
    state.threads.unshift(result.thread);
  }
  migratePromptQueue(sourceDraftKey, result.thread.id);
  migrateComposerState(sourceDraftKey, result.thread.id);
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
    updateThreadUrl(result.thread.id, "replace");
  } else {
    renderThreadList();
  }
  return result.thread.id;
}

function turnEventKey(threadId, turnId) {
  return `${threadId}:${turnId}`;
}

async function sendPrompt(
  text = elements.prompt.value,
  { fromQueue = false } = {},
) {
  if (parseSlashCommand(text)) {
    return Boolean(await handleSlashCommand(text));
  }
  text = String(text || "").trim();
  const input = text ? [{ type: "text", text }] : [];
  if (!input.length || !state.connected || state.navigating || imageUploadsForDraft() > 0) {
    return false;
  }
  if (state.busy) {
    if (fromQueue) return false;
    enqueuePrompt(text);
    return true;
  }
  const sourceThreadId = state.currentThreadId;
  const sourceDraftKey = draftKey(sourceThreadId);
  const navigationVersion = state.navigationVersion;
  let targetThreadId = sourceThreadId;
  const clientUserMessageId = crypto.randomUUID();
  if (!fromQueue) {
    elements.prompt.value = "";
    state.drafts.set(sourceDraftKey, "");
    resizePrompt();
  }
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
  state.pendingTurnStarts += 1;
  let turnAccepted = false;
  try {
    const threadId = await ensureThread(
      sourceThreadId,
      navigationVersion,
      sourceDraftKey,
    );
    targetThreadId = threadId;
    await activatePendingGoal(threadId);
    const provider =
      state.currentThreadId === threadId && state.currentThread?.provider
        ? state.currentThread.provider
        : providerForThread(threadId);
    const params = {
      clientUserMessageId,
      input,
      threadId,
      provider,
    };
    if (provider === "codex" && composerModeFor(threadId) === "plan") {
      const collaborationMode = planCollaborationMode();
      if (!collaborationMode) {
        throw new Error("برای Plan mode ابتدا یک مدل Codex انتخاب یا بارگذاری کنید.");
      }
      params.collaborationMode = collaborationMode;
    }
    if (provider === "codex" && !params.collaborationMode) {
      params.developerInstructions = RESPONSE_STYLE_INSTRUCTIONS;
    }
    if (
      state.settings.effort &&
      !params.collaborationMode &&
      (provider === "codex" || CLAUDE_EFFORTS.has(state.settings.effort))
    ) {
      params.effort = state.settings.effort;
    }
    const result = await rpc("turn/start", params);
    turnAccepted = true;
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
    turnAccepted = !shouldRollback;
    if (shouldRollback) {
      const restoreThreadId = targetThreadId || sourceThreadId;
      const restoreKey = restoreThreadId ? draftKey(restoreThreadId) : sourceDraftKey;
      if (!fromQueue) {
        const newerDraft = state.drafts.get(restoreKey) || "";
        state.drafts.set(restoreKey, newerDraft ? `${text}\n\n${newerDraft}` : text);
      }
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
        if (!fromQueue) restoreDraft(restoreThreadId);
      }
    }
    showError(error, "ارسال پیام");
  } finally {
    state.pendingTurnStarts = Math.max(0, state.pendingTurnStarts - 1);
    if (turnAccepted && state.currentThreadId && !state.busy) {
      scheduleNextQueuedPrompt(state.currentThreadId);
    }
  }
  return turnAccepted;
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

  if (method === "thread/goal/updated" && threadId) {
    if (params.goal) state.goals.set(threadId, params.goal);
    state.pendingGoals.delete(threadId);
    if (threadId === state.currentThreadId) renderGoalProgress();
    return;
  }

  if (method === "thread/goal/cleared" && threadId) {
    state.goals.delete(threadId);
    state.pendingGoals.delete(threadId);
    if (threadId === state.currentThreadId) renderGoalProgress();
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

    if (!isBackground && isTrackedTurn) {
      finishVisibleTurn(turn);
      scheduleNextQueuedPrompt(threadId);
    }
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
    const changed = applyProviderStatusPayload(data);
    void hydrateThreadFromUrl();
    if (data.providers || (changed && data.ready)) {
      const refreshes = [refreshThreads()];
      if (!(state.modelsByProvider[state.settings.provider] || []).length) {
        refreshes.push(loadModels());
      }
      void Promise.allSettled(refreshes);
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
  events.onerror = () => markProviderConnectionsUnavailable("در حال اتصال دوباره…");
}

function renderModelOptions(
  models,
  selectedModel = "",
  provider = elements.providerSelect.value || state.settings.provider,
) {
  const defaultOption = elements.modelSelect.querySelector("option:first-child");
  if (defaultOption) defaultOption.textContent = `پیش‌فرض ${providerLabel(provider)}`;
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
        provider,
      );
      if (provider === state.settings.provider) updateModelLabel(provider);
    }
  } catch (error) {
    console.warn(`Could not load ${provider} models`, error);
  }
}

async function refreshProviderStatus() {
  try {
    const status = await api("/api/status", { headers: {} });
    applyProviderStatusPayload(status);
  } catch (error) {
    markProviderConnectionsUnavailable("سرور در دسترس نیست");
    console.warn("Could not refresh provider status", error);
  }
}

function resizePrompt() {
  elements.prompt.style.height = "auto";
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 210)}px`;
  updateComposerControls();
}

function sidebarUsesOverlay() {
  return window.matchMedia?.("(max-width: 820px)").matches ?? false;
}

function updateSidebarUi() {
  const overlay = sidebarUsesOverlay();
  const open = overlay
    ? document.body.classList.contains("sidebar-open")
    : !state.settings.sidebarCollapsed;
  document.body.classList.toggle(
    "sidebar-collapsed",
    !overlay && state.settings.sidebarCollapsed,
  );
  elements.sidebar.setAttribute("aria-hidden", String(!open));
  elements.sidebar.toggleAttribute("inert", !open);
  elements.menuButton.setAttribute("aria-expanded", String(open));
  elements.sidebarClose.setAttribute("aria-expanded", String(open));
}

function openSidebar() {
  if (sidebarUsesOverlay()) {
    document.body.classList.add("sidebar-open");
  } else if (state.settings.sidebarCollapsed) {
    state.settings.sidebarCollapsed = false;
    persistSettings();
  }
  updateSidebarUi();
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  updateSidebarUi();
}

function collapseSidebar() {
  if (sidebarUsesOverlay()) {
    closeSidebar();
  } else {
    state.settings.sidebarCollapsed = true;
    persistSettings();
    updateSidebarUi();
  }
  elements.menuButton.focus();
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
elements.composerTools.addEventListener("click", toggleComposerToolsMenu);
elements.planModeOption.addEventListener("click", togglePlanMode);
elements.goalModeOption.addEventListener("click", openGoalDialog);
elements.goalEdit.addEventListener("click", openGoalDialog);
elements.goalToggle.addEventListener("click", () => void toggleGoalStatus());
elements.goalClear.addEventListener("click", () => void clearGoal());
elements.goalForm.addEventListener("submit", (event) => void saveGoalFromDialog(event));
elements.goalDialogCancel.addEventListener("click", () => elements.goalDialog.close());
elements.goalDialogClose.addEventListener("click", () => elements.goalDialog.close());
elements.dictate.addEventListener("click", toggleDictation);
elements.imageInput.addEventListener("change", () => {
  const files = [...elements.imageInput.files];
  const targetDraftKey = draftKey();
  elements.imageInput.value = "";
  void uploadImages(files, targetDraftKey);
});
elements.conversation.addEventListener(
  "scroll",
  () => {
    hideSelectionAsk();
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
  const toolsMenuOpen = !elements.composerToolsMenu.classList.contains("hidden");
  if (toolsMenuOpen && event.key === "Escape") {
    event.preventDefault();
    closeComposerToolsMenu();
    return;
  }
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
  if (
    slashMenuOpen &&
    event.key === "Tab" &&
    !event.shiftKey &&
    state.slashFilteredCommands.length
  ) {
    event.preventDefault();
    replacePromptWithSlashCommand(state.slashFilteredCommands[state.slashActiveIndex]);
    return;
  }
  if (event.key === "Tab" && event.shiftKey && !slashMenuOpen) {
    event.preventDefault();
    togglePlanMode();
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
elements.promptQueueItems.addEventListener("click", (event) => {
  const action = event.target.closest("[data-queue-action]");
  const row = action?.closest("[data-queue-id]");
  if (!action || !row) return;
  removeQueuedPrompt(row.dataset.queueId, {
    edit: action.dataset.queueAction === "edit",
  });
});
elements.promptQueueClear.addEventListener("click", clearPromptQueue);
elements.stopTurn.addEventListener("click", stopTurn);
elements.newChat.addEventListener("click", () => newChat());
elements.threadList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-thread-id]");
  if (button) openThread(button.dataset.threadId);
});
elements.threadSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refreshThreads(), 250);
});
elements.openSettings.addEventListener("click", () => openSettings());
elements.headerSettings.addEventListener("click", () => openSettings());
elements.cwdChip.addEventListener("click", () => openSettings());
elements.saveSettings.addEventListener("click", (event) => {
  event.preventDefault();
  saveSettings();
});
elements.settingsForm.addEventListener("submit", (event) => event.preventDefault());
elements.settingsCancel.addEventListener("click", () => elements.settingsDialog.close());
elements.settingsClose.addEventListener("click", () => elements.settingsDialog.close());
elements.settingsDialog.addEventListener("close", updateSettingsUi);
elements.providerSelect.addEventListener("change", () => {
  const provider = elements.providerSelect.value;
  updateSettingsProviderUi(provider);
  const cachedModels = state.modelsByProvider[provider] || [];
  renderModelOptions(
    cachedModels,
    state.settings.modelByProvider[provider] || "",
    provider,
  );
  void loadModels(provider);
});
elements.claudePermissionMode.addEventListener("change", () =>
  updateFullAccessWarning(elements.providerSelect.value),
);
elements.sandboxSelect.addEventListener("change", () =>
  updateFullAccessWarning(elements.providerSelect.value),
);
elements.menuButton.addEventListener("click", openSidebar);
elements.sidebarClose.addEventListener("click", collapseSidebar);
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
  if (!event.target.closest("#composer-tools, #composer-tools-menu")) {
    closeComposerToolsMenu();
  }
});
document.addEventListener("selectionchange", scheduleSelectionAskUpdate);
elements.messages.addEventListener("pointerup", scheduleSelectionAskUpdate);
elements.selectionAsk.addEventListener("pointerdown", (event) => event.preventDefault());
elements.selectionAsk.addEventListener("click", () => {
  const text = state.selectedAssistantText;
  if (!text) return;
  insertAssistantQuote(text);
  window.getSelection?.()?.removeAllRanges?.();
  hideSelectionAsk();
});
document.addEventListener("keydown", primeCompletionAudio, {
  capture: true,
  once: true,
});
document.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
    event.preventDefault();
    toggleDictation();
  }
});
window.addEventListener(
  "resize",
  () => {
    hideSelectionAsk();
    scheduleUserMessageNavigationUpdate();
    updateSidebarUi();
  },
  { passive: true },
);
window.addEventListener("popstate", (event) => {
  void hydrateThreadFromUrl({
    draftId:
      typeof event.state?.draftId === "string" && event.state.draftId
        ? event.state.draftId
        : null,
    force: true,
  });
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.currentThreadId) {
    markThreadSeen(state.currentThreadId);
    renderThreadList();
  }
});
elements.messages.addEventListener("click", async (event) => {
  const messageAction = event.target.closest("[data-message-action]");
  if (messageAction) {
    const row = messageAction.closest(".message-row.assistant");
    const view = row ? state.itemViews.get(row.dataset.itemId) : null;
    const text = view?.text || row?.querySelector(".message-content")?.textContent || "";
    if (!text) return;
    if (messageAction.dataset.messageAction === "quote") {
      insertAssistantQuote(text);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      const label = messageAction.querySelector("span");
      messageAction.classList.add("success");
      if (label) label.textContent = "کپی شد";
      setTimeout(() => {
        messageAction.classList.remove("success");
        if (label) label.textContent = "کپی";
      }, 1200);
    } catch {
      toast("کپی‌کردن ممکن نبود.", "error");
    }
    return;
  }

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
  updateSidebarUi();
  updateSettingsUi();
  updateConnection();
  resizePrompt();
  connectEvents();
  try {
    const status = await api("/api/status", { headers: {} });
    if (status.cwd && state.settings.cwd === defaultSettings.cwd) {
      state.settings.cwd = status.cwd;
      persistSettings();
      updateSettingsUi();
    }
    applyProviderStatusPayload(status);
    await Promise.allSettled([
      loadModels(),
      loadCollaborationModes(),
      refreshThreads(),
      hydrateThreadFromUrl(),
    ]);
  } catch (error) {
    markProviderConnectionsUnavailable("سرور در دسترس نیست");
    showError(error, "اتصال به سرور");
  }
}

initialize();
