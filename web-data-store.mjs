import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const DATA_VERSION = 1;
const MAX_PROJECT_NAME = 80;
const MAX_PROJECT_INSTRUCTIONS = 8_000;
const MAX_THREAD_ID = 512;
const MAX_SHARE_BYTES = 2 * 1024 * 1024;

function emptyData() {
  return {
    version: DATA_VERSION,
    projects: [],
    threadProjects: {},
    shares: [],
  };
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanThreadId(value) {
  const threadId = String(value || "").trim();
  if (!threadId || threadId.length > MAX_THREAD_ID) {
    throw httpError("Thread id is invalid");
  }
  return threadId;
}

function redactLocalPaths(value) {
  return String(value || "")
    .replace(/file:\/\/\/?[^\s<>"'`)\]}]+/gi, "[فایل محلی]")
    .replace(/\b[A-Za-z]:\\[^\s<>"'`)\]}]+/g, "[فایل محلی]")
    .replace(/\\\\[^\s<>"'`)\]}]+/g, "[فایل محلی]")
    .replace(
      /(^|[\s([{"'`])\/(?:Users|home|tmp|var\/folders|private\/var|mnt|Volumes)\/[^\s<>"'`)\]}]+/g,
      "$1[فایل محلی]",
    );
}

function sharedUserText(item) {
  return redactLocalPaths(
    (Array.isArray(item?.content) ? item.content : [])
    .map((part) => {
      if (part?.type === "text") return String(part.text || "");
      if (part?.type === "image" || part?.type === "localImage") {
        return "[تصویر پیوست‌شده]";
      }
      if (part?.type === "audio" || part?.type === "localAudio") {
        return "[پیام صوتی]";
      }
      if (part?.type === "skill" && part.name) return `$${part.name}`;
      if (part?.type === "mention" && part.name) return `@${part.name}`;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim(),
  );
}

export function sharedConversationSnapshot(thread) {
  const messages = [];
  for (const turn of Array.isArray(thread?.turns) ? thread.turns : []) {
    for (const item of Array.isArray(turn?.items) ? turn.items : []) {
      if (item?.type === "userMessage") {
        const content = sharedUserText(item);
        if (content) messages.push({ role: "user", content });
        continue;
      }
      if (item?.type === "agentMessage" && item.phase !== "commentary") {
        const content = redactLocalPaths(item.text).trim();
        if (content) messages.push({ role: "assistant", content });
        continue;
      }
      if (item?.type === "plan") {
        const content = redactLocalPaths(item.text).trim();
        if (content) messages.push({ role: "assistant", content });
      }
    }
  }
  const name = String(thread?.name || "").trim();
  const preview = redactLocalPaths(thread?.preview).trim().replace(/\s+/g, " ");
  return {
    title: redactLocalPaths(name) || preview.slice(0, 90) || "گفتگوی Codex",
    provider: thread?.provider === "claude" ? "claude" : "codex",
    createdAt: thread?.createdAt || null,
    sharedAt: Date.now(),
    messages,
  };
}

function normalizeData(value) {
  if (!value || typeof value !== "object") return emptyData();
  const projects = Array.isArray(value.projects)
    ? value.projects.filter(
        (project) =>
          project &&
          typeof project.id === "string" &&
          typeof project.name === "string" &&
          typeof project.cwd === "string",
      )
    : [];
  const projectIds = new Set(projects.map((project) => project.id));
  const threadProjects = {};
  if (value.threadProjects && typeof value.threadProjects === "object") {
    for (const [threadId, projectId] of Object.entries(value.threadProjects)) {
      if (threadId && projectIds.has(projectId)) threadProjects[threadId] = projectId;
    }
  }
  const shares = Array.isArray(value.shares)
    ? value.shares.filter(
        (share) =>
          share &&
          typeof share.id === "string" &&
          typeof share.threadId === "string" &&
          share.snapshot &&
          typeof share.snapshot === "object",
      )
    : [];
  return { version: DATA_VERSION, projects, threadProjects, shares };
}

async function normalizeProjectInput(input, previous = null) {
  const name = String(input?.name ?? previous?.name ?? "").trim();
  const cwd = String(input?.cwd ?? previous?.cwd ?? "").trim();
  const instructions = String(
    input?.instructions ?? previous?.instructions ?? "",
  ).trim();
  if (!name || name.length > MAX_PROJECT_NAME) {
    throw httpError(`Project name must be between 1 and ${MAX_PROJECT_NAME} characters`);
  }
  if (!cwd || !isAbsolute(cwd)) throw httpError("Project working directory must be absolute");
  let info;
  try {
    info = await stat(resolve(cwd));
  } catch {
    throw httpError("Project working directory does not exist");
  }
  if (!info.isDirectory()) throw httpError("Project working directory must be a directory");
  if (instructions.length > MAX_PROJECT_INSTRUCTIONS) {
    throw httpError(`Project instructions cannot exceed ${MAX_PROJECT_INSTRUCTIONS} characters`);
  }
  return { name, cwd: resolve(cwd), instructions };
}

export class WebDataStore {
  constructor(directory) {
    this.directory = resolve(directory);
    this.path = join(this.directory, "workspace.json");
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  async #load() {
    if (this.data) return this.data;
    try {
      this.data = normalizeData(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.data = emptyData();
    }
    return this.data;
  }

  async #read() {
    await this.writeQueue;
    return structuredClone(await this.#load());
  }

  async #persist(data) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporaryPath = join(this.directory, `workspace-${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async #update(change) {
    const run = async () => {
      const current = structuredClone(await this.#load());
      const result = await change(current);
      await this.#persist(current);
      this.data = current;
      return structuredClone(result);
    };
    const pending = this.writeQueue.then(run, run);
    this.writeQueue = pending.catch(() => {});
    return pending;
  }

  async workspace() {
    const data = await this.#read();
    return { projects: data.projects, threadProjects: data.threadProjects };
  }

  async createProject(input) {
    const fields = await normalizeProjectInput(input);
    return this.#update((data) => {
      const now = Date.now();
      const project = { id: randomUUID(), ...fields, createdAt: now, updatedAt: now };
      data.projects.push(project);
      return project;
    });
  }

  async updateProject(projectId, input) {
    const data = await this.#read();
    const previous = data.projects.find((project) => project.id === projectId);
    if (!previous) throw httpError("Project not found", 404);
    const fields = await normalizeProjectInput(input, previous);
    return this.#update((next) => {
      const project = next.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw httpError("Project not found", 404);
      Object.assign(project, fields, { updatedAt: Date.now() });
      return project;
    });
  }

  async deleteProject(projectId) {
    return this.#update((data) => {
      const index = data.projects.findIndex((project) => project.id === projectId);
      if (index < 0) throw httpError("Project not found", 404);
      data.projects.splice(index, 1);
      for (const [threadId, assignedProjectId] of Object.entries(data.threadProjects)) {
        if (assignedProjectId === projectId) delete data.threadProjects[threadId];
      }
      return { ok: true };
    });
  }

  async assignThread(threadIdValue, projectIdValue) {
    const threadId = cleanThreadId(threadIdValue);
    const projectId = projectIdValue ? String(projectIdValue) : null;
    return this.#update((data) => {
      if (projectId && !data.projects.some((project) => project.id === projectId)) {
        throw httpError("Project not found", 404);
      }
      if (projectId) data.threadProjects[threadId] = projectId;
      else delete data.threadProjects[threadId];
      return { threadId, projectId };
    });
  }

  async findShareForThread(threadIdValue) {
    const threadId = cleanThreadId(threadIdValue);
    const data = await this.#read();
    return data.shares.find((share) => share.threadId === threadId) || null;
  }

  async upsertShare(threadIdValue, snapshot) {
    const threadId = cleanThreadId(threadIdValue);
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > MAX_SHARE_BYTES) {
      throw httpError("Conversation is too large to share", 413);
    }
    return this.#update((data) => {
      const now = Date.now();
      let share = data.shares.find((candidate) => candidate.threadId === threadId);
      if (share) {
        share.snapshot = snapshot;
        share.updatedAt = now;
      } else {
        share = {
          id: randomUUID(),
          threadId,
          snapshot,
          createdAt: now,
          updatedAt: now,
        };
        data.shares.push(share);
      }
      return share;
    });
  }

  async getShare(shareId) {
    const data = await this.#read();
    return data.shares.find((share) => share.id === shareId) || null;
  }

  async deleteShare(shareId) {
    return this.#update((data) => {
      const index = data.shares.findIndex((share) => share.id === shareId);
      if (index < 0) throw httpError("Shared conversation not found", 404);
      data.shares.splice(index, 1);
      return { ok: true };
    });
  }
}
