export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHref(value) {
  const decoded = value.replaceAll("&amp;", "&");
  if (/^(https?:\/\/|mailto:)/i.test(decoded)) return value;
  return "#";
}

function inlineMarkdown(value) {
  let text = value;
  const code = [];
  text = text.replace(/`([^`\n]+)`/g, (_, content) => {
    const token = `\uE100${code.length}\uE101`;
    code.push(`<code>${content}</code>`);
    return token;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const safe = safeHref(href);
    const target = safe === "#" ? "" : ' target="_blank" rel="noreferrer"';
    return `<a href="${safe}"${target}>${label}</a>`;
  });
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!؟])/g, "$1<em>$2</em>");
  text = text.replace(/\uE100(\d+)\uE101/g, (_, index) => code[Number(index)]);
  return text;
}

function blockDirection(value) {
  return /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(value) ? "rtl" : "ltr";
}

function codeBlockContent(value) {
  return escapeHtml(value).replace(
    /[\p{Script=Arabic}\u200c\u200d]+(?:[ \t]+[\p{Script=Arabic}\u200c\u200d]+)*/gu,
    '<span class="code-rtl-text">$&</span>',
  );
}

function splitTableRow(rawLine) {
  const line = rawLine.trim();
  const cells = [];
  let cell = "";
  let codeDelimiterLength = 0;
  let pipeCount = 0;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === "\\" && line[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }

    if (character === "`") {
      let runLength = 1;
      while (line[index + runLength] === "`") runLength += 1;
      if (!codeDelimiterLength) codeDelimiterLength = runLength;
      else if (codeDelimiterLength === runLength) codeDelimiterLength = 0;
      cell += "`".repeat(runLength);
      index += runLength - 1;
      continue;
    }

    if (character === "|" && !codeDelimiterLength) {
      cells.push(cell);
      cell = "";
      pipeCount += 1;
      continue;
    }

    cell += character;
  }
  cells.push(cell);

  if (!pipeCount) return null;
  if (cells[0]?.trim() === "") cells.shift();
  if (cells.at(-1)?.trim() === "") cells.pop();
  return cells;
}

function tableAlignment(cell) {
  const delimiter = cell.trim();
  if (!/^:?-{3,}:?$/.test(delimiter)) return null;
  if (delimiter.startsWith(":") && delimiter.endsWith(":")) return "center";
  if (delimiter.startsWith(":")) return "left";
  if (delimiter.endsWith(":")) return "right";
  return "";
}

function normalizeTableRow(cells, columnCount) {
  return Array.from({ length: columnCount }, (_, index) => cells[index] || "");
}

function renderTableCell(tag, value, alignment) {
  const className = alignment ? ` class="align-${alignment}"` : "";
  const content = value.trim();
  return `<${tag} dir="${blockDirection(content)}"${className}>${inlineMarkdown(escapeHtml(content))}</${tag}>`;
}

function tableDirection(header) {
  return blockDirection(header.join(" "));
}

function parseTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length) return null;
  const header = splitTableRow(lines[startIndex]);
  const delimiters = splitTableRow(lines[startIndex + 1]);
  if (!header?.length || !delimiters || header.length !== delimiters.length) return null;

  const alignments = delimiters.map(tableAlignment);
  if (alignments.some((alignment) => alignment === null)) return null;
  const direction = tableDirection(header);

  const rows = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length && lines[nextIndex].trim()) {
    const cells = splitTableRow(lines[nextIndex]);
    if (!cells) break;
    rows.push(normalizeTableRow(cells, header.length));
    nextIndex += 1;
  }

  const head = header
    .map((cell, index) => renderTableCell("th", cell, alignments[index]))
    .join("");
  const body = rows.length
    ? `<tbody>${rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell, index) => renderTableCell("td", cell, alignments[index]))
              .join("")}</tr>`,
        )
        .join("")}</tbody>`
    : "";

  return {
    html:
      `<div class="markdown-table-wrap" dir="${direction}">` +
      `<table class="markdown-table" dir="${direction}"><thead><tr>${head}</tr></thead>${body}</table>` +
      "</div>",
    nextIndex,
  };
}

function listEntry(rawLine) {
  const match = rawLine.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  const whitespace = match[1].replaceAll("\t", "    ");
  const ordered = /^\d/.test(match[2]);
  return {
    content: match[3],
    indent: whitespace.length,
    kind: ordered ? "ol" : "ul",
    start: ordered ? Number.parseInt(match[2], 10) : null,
  };
}

function parseList(lines, startIndex) {
  const entries = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const entry = listEntry(lines[nextIndex]);
    if (!entry) break;
    entries.push(entry);
    nextIndex += 1;
  }
  if (!entries.length) return null;

  const html = [];
  const stack = [];
  const openLevel = (entry) => {
    const start = entry.kind === "ol" && entry.start > 1 ? ` start="${entry.start}"` : "";
    html.push(`<${entry.kind} dir="${blockDirection(entry.content)}"${start}>`);
    stack.push({ indent: entry.indent, kind: entry.kind, liOpen: false });
  };
  const closeLevel = () => {
    const level = stack.pop();
    if (!level) return;
    if (level.liOpen) html.push("</li>");
    html.push(`</${level.kind}>`);
  };

  for (const entry of entries) {
    while (stack.length && entry.indent < stack.at(-1).indent) closeLevel();

    let current = stack.at(-1);
    if (!current || entry.indent > current.indent) {
      openLevel(entry);
      current = stack.at(-1);
    } else if (entry.kind !== current.kind) {
      closeLevel();
      openLevel(entry);
      current = stack.at(-1);
    } else if (current.liOpen) {
      html.push("</li>");
      current.liOpen = false;
    }

    const content = escapeHtml(entry.content);
    html.push(`<li dir="${blockDirection(content)}">${inlineMarkdown(content)}`);
    current.liOpen = true;
  }

  while (stack.length) closeLevel();
  return { html: html.join(""), nextIndex };
}

export function markdown(source) {
  const lines = String(source ?? "").replaceAll("\r\n", "\n").split("\n");
  const output = [];
  let paragraph = [];
  let inFence = false;
  let fenceLanguage = "";
  let fenceLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const content = paragraph.join("\n");
    output.push(`<p dir="${blockDirection(content)}">${inlineMarkdown(content)}</p>`);
    paragraph = [];
  };

  const flushFence = () => {
    const rawContent = fenceLines.join("\n");
    const hasRtlText = blockDirection(rawContent) === "rtl";
    const content = codeBlockContent(rawContent);
    output.push(
      `<div class="code-block${hasRtlText ? " has-rtl-code" : ""}"><span class="code-language">${escapeHtml(fenceLanguage || "code")}</span>` +
        `<button class="copy-code" type="button">کپی</button><pre><code>${content}</code></pre></div>`,
    );
    fenceLines = [];
    fenceLanguage = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const fence = rawLine.match(/^```\s*([^`]*)$/);
    if (fence) {
      if (inFence) {
        inFence = false;
        flushFence();
      } else {
        flushParagraph();
        inFence = true;
        fenceLanguage = fence[1].trim();
      }
      continue;
    }
    if (inFence) {
      fenceLines.push(rawLine);
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      flushParagraph();
      output.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    const line = escapeHtml(rawLine);
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      output.push(
        `<h${level} dir="${blockDirection(heading[2])}">${inlineMarkdown(heading[2])}</h${level}>`,
      );
      continue;
    }

    const list = parseList(lines, index);
    if (list) {
      flushParagraph();
      output.push(list.html);
      index = list.nextIndex - 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(rawLine)) {
      flushParagraph();
      output.push('<hr class="markdown-divider">');
      continue;
    }

    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      flushParagraph();
      output.push(
        `<blockquote dir="${blockDirection(quote[1])}">${inlineMarkdown(quote[1])}</blockquote>`,
      );
      continue;
    }

    paragraph.push(line);
  }

  if (inFence) flushFence();
  flushParagraph();
  return output.join("");
}
