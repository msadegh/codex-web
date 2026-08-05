import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sharedConversationSnapshot, WebDataStore } from "../web-data-store.mjs";

test("projects persist shared settings and thread membership", async (t) => {
  const root = await mkdtemp(join(os.tmpdir(), "codex-web-projects-"));
  const workspace = join(root, "workspace");
  const dataDir = join(root, "data");
  await mkdir(workspace);
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = new WebDataStore(dataDir);
  const project = await first.createProject({
    name: "پروژهٔ تست",
    cwd: workspace,
    instructions: "تست‌ها را اجرا کن.",
  });
  await first.assignThread("thread-1", project.id);

  const restarted = new WebDataStore(dataDir);
  const stored = await restarted.workspace();
  assert.equal(stored.projects.length, 1);
  assert.equal(stored.projects[0].name, "پروژهٔ تست");
  assert.equal(stored.projects[0].instructions, "تست‌ها را اجرا کن.");
  assert.equal(stored.threadProjects["thread-1"], project.id);

  await restarted.deleteProject(project.id);
  const afterDelete = await restarted.workspace();
  assert.deepEqual(afterDelete.projects, []);
  assert.deepEqual(afterDelete.threadProjects, {});
});

test("shared conversations are snapshots that can be updated and revoked", async (t) => {
  const root = await mkdtemp(join(os.tmpdir(), "codex-web-shares-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new WebDataStore(root);

  const first = await store.upsertShare("thread-2", {
    title: "گفتگوی نمونه",
    messages: [{ role: "assistant", content: "نسخهٔ اول" }],
  });
  const updated = await store.upsertShare("thread-2", {
    title: "گفتگوی نمونه",
    messages: [{ role: "assistant", content: "نسخهٔ دوم" }],
  });

  assert.equal(updated.id, first.id);
  assert.equal((await store.getShare(first.id)).snapshot.messages[0].content, "نسخهٔ دوم");
  assert.equal((await store.findShareForThread("thread-2")).id, first.id);

  await store.deleteShare(first.id);
  assert.equal(await store.getShare(first.id), null);
});

test("project validation rejects missing or non-absolute working directories", async (t) => {
  const root = await mkdtemp(join(os.tmpdir(), "codex-web-project-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new WebDataStore(join(root, "data"));

  await assert.rejects(
    store.createProject({ name: "نامعتبر", cwd: "relative/path" }),
    /must be absolute/,
  );
  await assert.rejects(
    store.createProject({ name: "نامعتبر", cwd: join(root, "missing") }),
    /does not exist/,
  );
});

test("shared snapshots omit technical activity, thinking, and local file paths", () => {
  const snapshot = sharedConversationSnapshot({
    name: "گفتگوی امن",
    turns: [
      {
        items: [
          {
            type: "userMessage",
            content: [
              {
                type: "text",
                text: "این فایل را بررسی کن: C:\\Users\\K\\private\\notes.txt",
              },
              { type: "localImage", path: "C:\\private\\screen.png" },
            ],
          },
          { type: "agentMessage", phase: "commentary", text: "مسیر محرمانه را می‌خوانم" },
          { type: "commandExecution", command: "type C:\\private\\secret.txt" },
          {
            type: "agentMessage",
            phase: "final_answer",
            text: "بررسی C:\\private\\secret.txt تمام شد.",
          },
        ],
      },
    ],
  });

  assert.deepEqual(snapshot.messages, [
    {
      role: "user",
      content: "این فایل را بررسی کن: [فایل محلی]\n[تصویر پیوست‌شده]",
    },
    { role: "assistant", content: "بررسی [فایل محلی] تمام شد." },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /C:\\\\(?:Users|private)|مسیر محرمانه/);
});
