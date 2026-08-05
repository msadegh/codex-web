import { markdown } from "./markdown.js";

const shareId = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "");
const loading = document.querySelector("#share-loading");
const errorView = document.querySelector("#share-error");
const heading = document.querySelector("#share-heading");
const title = document.querySelector("#share-title");
const meta = document.querySelector("#share-meta");
const messages = document.querySelector("#share-messages");

function formatSharedAt(value) {
  if (!Number.isFinite(value)) return "";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function renderMessage(message) {
  const row = document.createElement("article");
  const role = message.role === "user" ? "user" : "assistant";
  row.className = `share-message ${role}`;
  const label = document.createElement("span");
  label.className = "share-message-role";
  label.textContent = role === "user" ? "شما" : "Codex";
  const content = document.createElement("div");
  content.className = "share-message-content message-content";
  content.dir = "auto";
  if (role === "assistant") content.innerHTML = markdown(String(message.content || ""));
  else content.textContent = String(message.content || "");
  row.append(label, content);
  messages.append(row);
}

async function initializeShare() {
  try {
    const response = await fetch(`/api/shares/${encodeURIComponent(shareId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.share?.snapshot) throw new Error("Share not found");
    const snapshot = data.share.snapshot;
    title.textContent = snapshot.title || "گفتگوی Codex";
    meta.textContent = [
      snapshot.provider === "claude" ? "Claude" : "Codex",
      formatSharedAt(data.share.updatedAt || snapshot.sharedAt),
    ]
      .filter(Boolean)
      .join(" · ");
    document.title = `${title.textContent} · Codex Web`;
    for (const message of snapshot.messages || []) renderMessage(message);
    loading.classList.add("hidden");
    heading.classList.remove("hidden");
  } catch {
    loading.classList.add("hidden");
    errorView.classList.remove("hidden");
  }
}

initializeShare();
