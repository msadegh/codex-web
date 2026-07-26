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
