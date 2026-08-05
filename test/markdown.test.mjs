import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

import { markdown } from "../public/markdown.js";

function render(source) {
  const { document } = parseHTML(`<main id="root">${markdown(source)}</main>`);
  return document.querySelector("#root");
}

test("renders Persian GFM tables instead of raw pipe-delimited text", () => {
  const root = render(`پیشنهاد من برای نوع تراکنش:

| نوع | اثر روی پول نقد | درآمد/هزینه محسوب شود؟ |
|---|:---:|---:|
| درآمد | ورود | بله، درآمد |
| خرید طلا | خروج | خیر |

**سرمایه‌گذاری**`);

  const table = root.querySelector("table.markdown-table");
  assert.ok(table);
  assert.equal(table.getAttribute("dir"), "rtl");
  assert.equal(root.querySelector(".markdown-table-wrap").getAttribute("dir"), "rtl");
  assert.equal(root.querySelectorAll("thead th").length, 3);
  assert.equal(root.querySelectorAll("tbody tr").length, 2);
  assert.deepEqual(
    [...root.querySelectorAll("tbody tr:first-child td")].map((cell) =>
      cell.textContent.trim(),
    ),
    ["درآمد", "ورود", "بله، درآمد"],
  );
  assert.equal(root.querySelector("thead th:nth-child(2)").className, "align-center");
  assert.equal(root.querySelector("thead th:nth-child(3)").className, "align-right");
  assert.equal(root.querySelector("strong").textContent, "سرمایه‌گذاری");
});

test("keeps pipes inside inline code or escaped table cells", () => {
  const root = render(`| مقدار | توضیح |
| --- | --- |
| \`a|b\` | x\\|y |`);

  const cells = [...root.querySelectorAll("tbody td")];
  assert.equal(cells[0].querySelector("code").textContent, "a|b");
  assert.equal(cells[1].textContent.trim(), "x|y");
});

test("keeps English tables left-to-right", () => {
  const root = render(`| Type | Value |
| --- | --- |
| income | 42 |`);

  assert.equal(root.querySelector("table").getAttribute("dir"), "ltr");
});

test("uses Persian block direction when mixed text starts with an English term", () => {
  const root = render(`GitHub در Chrome لاگین نیست. لطفاً روی Sign in بزن.

# Pull Request آماده است

- GitHub را باز کن

> Chrome هنوز لاگین نیست

| GitHub | وضعیت مخزن |
| --- | --- |
| fork | آماده است |`);

  assert.equal(root.querySelector("p").getAttribute("dir"), "rtl");
  assert.equal(root.querySelector("h1").getAttribute("dir"), "rtl");
  assert.equal(root.querySelector("li").getAttribute("dir"), "rtl");
  assert.equal(root.querySelector("blockquote").getAttribute("dir"), "rtl");
  assert.equal(root.querySelector("table").getAttribute("dir"), "rtl");
  assert.equal(root.querySelector("th").getAttribute("dir"), "ltr");
  assert.equal(root.querySelector("th:nth-child(2)").getAttribute("dir"), "rtl");
});

test("keeps purely English message blocks left-to-right", () => {
  const root = render(`GitHub is open in Chrome.

- Sign in to continue`);

  assert.equal(root.querySelector("p").getAttribute("dir"), "ltr");
  assert.equal(root.querySelector("li").getAttribute("dir"), "ltr");
});

test("uses the Persian UI font only for RTL text inside code blocks", () => {
  const root = render(`\`\`\`text
پنل جاب‌بورد در مرورگر
↓
API اختصاصی ساخت رزومه
\`\`\``);
  const block = root.querySelector(".code-block");

  assert.equal(block.classList.contains("has-rtl-code"), true);
  assert.equal(block.querySelector(".code-rtl-text").textContent, "پنل جاب‌بورد در مرورگر");
  assert.match(block.querySelector("code").innerHTML, /API <span class="code-rtl-text">اختصاصی ساخت رزومه<\/span>/);

  const english = render(`\`\`\`js
const answer = 42;
\`\`\``);
  assert.equal(english.querySelector(".code-block").classList.contains("has-rtl-code"), false);
  assert.equal(english.querySelector(".code-rtl-text"), null);
});

test("renders structured answers with semantic section and list hierarchy", () => {
  const root = render(`## پیشنهاد اصلی

یک مقدمهٔ کوتاه.

### مزایا

- اتصال خصوصی
- راه‌اندازی ساده
- دسترسی موبایل

### مراحل

1. نصب برنامه
2. بازکردن آدرس`);

  assert.equal(root.querySelector("h2").textContent, "پیشنهاد اصلی");
  assert.equal(root.querySelectorAll("h3").length, 2);
  assert.equal(root.querySelectorAll("ul > li").length, 3);
  assert.equal(root.querySelectorAll("ol > li").length, 2);
  assert.equal(root.querySelector("ul").getAttribute("dir"), "rtl");
  assert.equal(root.querySelector("ol").getAttribute("dir"), "rtl");
});

test("renders nested lists, ordered starts, soft wraps, and section dividers", () => {
  const root = render(`## نتیجه

- گزینهٔ اصلی
  - جزئیات اول
  - جزئیات دوم
- گزینهٔ بعدی

3. مرحلهٔ سوم
4. مرحلهٔ چهارم

این یک پاراگراف است
که در منبع روی دو خط نوشته شده.

---

ادامه`);

  assert.equal(root.querySelectorAll("ul").length, 2);
  assert.equal(root.querySelectorAll("ul > li > ul > li").length, 2);
  assert.equal(root.querySelector("ol").getAttribute("start"), "3");
  assert.equal(root.querySelectorAll("p")[0].querySelector("br"), null);
  assert.equal(root.querySelectorAll("hr.markdown-divider").length, 1);
});

test("escapes table HTML and rejects unsafe links", () => {
  const root = render(`| ورودی | پیوند |
| --- | --- |
| <img src=x onerror=alert(1)> | [خطر](javascript:alert(1)) |`);

  assert.equal(root.querySelector("img"), null);
  assert.match(root.querySelector("tbody td").textContent, /<img src=x/);
  assert.equal(root.querySelector("a").getAttribute("href"), "#");
});

test("leaves malformed table-like text as a paragraph", () => {
  const root = render(`| عنوان | توضیح |
| --- | not-a-delimiter |
| یک | دو |`);

  assert.equal(root.querySelector("table"), null);
  assert.match(root.textContent, /not-a-delimiter/);
});
