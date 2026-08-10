// Dependency-free HTTP Client tokenizer used by the Editor DLC.
const requestMethods = new Set([
  "ACL",
  "BASELINE-CONTROL",
  "BIND",
  "CHECKIN",
  "CHECKOUT",
  "CONNECT",
  "COPY",
  "DELETE",
  "GET",
  "HEAD",
  "LABEL",
  "LINK",
  "LOCK",
  "MERGE",
  "MKACTIVITY",
  "MKCALENDAR",
  "MKCOL",
  "MKREDIRECTREF",
  "MKWORKSPACE",
  "MOVE",
  "OPTIONS",
  "ORDERPATCH",
  "PATCH",
  "POST",
  "PRI",
  "PROPFIND",
  "PROPPATCH",
  "PURGE",
  "PUT",
  "REBIND",
  "REPORT",
  "SEARCH",
  "TRACE",
  "UNBIND",
  "UNCHECKOUT",
  "UNLINK",
  "UNLOCK",
  "UPDATE",
  "UPDATEREDIRECTREF",
  "VERSION-CONTROL",
]);

const jsonKeywords = new Set(["false", "null", "true"]);

function add(spans, from, to, kind) {
  if (to > from) spans.push({ from, to, kind });
}

function firstContentIndex(text) {
  let index = 0;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) {
    index += 1;
  }
  return index;
}

function scanBody(text, from, spans) {
  let index = from;

  while (index < text.length) {
    const char = text[index];

    if (text.startsWith("{{", index)) {
      const close = text.indexOf("}}", index + 2);
      const end = close < 0 ? text.length : close + 2;
      add(spans, index, end, "variable");
      index = end;
      continue;
    }

    if (
      text.startsWith("http://", index) ||
      text.startsWith("https://", index)
    ) {
      let end = index + (text[index + 4] === "s" ? 8 : 7);
      while (end < text.length && !/\s|["'<>]/.test(text[end])) end += 1;
      add(spans, index, end, "url");
      index = end;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let end = index + 1;
      while (end < text.length) {
        if (text[end] === "\\") {
          end = Math.min(text.length, end + 2);
          continue;
        }
        end += 1;
        if (text[end - 1] === quote) break;
      }
      add(spans, index, end, "string");
      index = end;
      continue;
    }

    const number = text.slice(index).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      const end = index + number[0].length;
      add(spans, index, end, "number");
      index = end;
      continue;
    }

    const word = text.slice(index).match(/^[A-Za-z]+/);
    if (word) {
      const end = index + word[0].length;
      if (jsonKeywords.has(word[0])) add(spans, index, end, "keyword");
      index = end;
      continue;
    }

    if ("{}[]:,".includes(char)) add(spans, index, index + 1, "operator");
    index += 1;
  }
}

export function highlightHttpLine(text) {
  const spans = [];
  const start = firstContentIndex(text);
  if (start === text.length) return spans;

  if (text.startsWith("###", start)) {
    add(spans, start, text.length, "separator");
    return spans;
  }

  if (text[start] === "#" || text.startsWith("//", start)) {
    add(spans, start, text.length, "comment");
    return spans;
  }

  const request = text
    .slice(start)
    .match(/^([A-Za-z-]+)(\s+)(\S+)(?:\s+(HTTP\/\d(?:\.\d)?))?/);
  if (request && requestMethods.has(request[1].toUpperCase())) {
    const methodEnd = start + request[1].length;
    const targetFrom = methodEnd + request[2].length;
    const targetEnd = targetFrom + request[3].length;
    add(spans, start, methodEnd, "method");
    add(spans, targetFrom, targetEnd, "url");
    if (request[4]) {
      const protocolFrom = text.indexOf(request[4], targetEnd);
      add(spans, protocolFrom, protocolFrom + request[4].length, "protocol");
    }
    return spans;
  }

  const response = text
    .slice(start)
    .match(/^(HTTP\/\d(?:\.\d)?)\s+(\d{3})(?:\s+(.+))?$/);
  if (response) {
    const statusFrom = start + response[1].length + 1;
    add(spans, start, start + response[1].length, "protocol");
    add(spans, statusFrom, statusFrom + response[2].length, "number");
    if (response[3]) {
      const descriptionFrom = text.indexOf(
        response[3],
        statusFrom + response[2].length,
      );
      add(spans, descriptionFrom, text.length, "string");
    }
    return spans;
  }

  const variable = text.slice(start).match(/^(@[A-Za-z_][\w.-]*)(\s*)(=)/);
  if (variable) {
    const operatorFrom = start + variable[1].length + variable[2].length;
    add(spans, start, start + variable[1].length, "variable");
    add(spans, operatorFrom, operatorFrom + 1, "operator");
    scanBody(text, operatorFrom + 1, spans);
    return spans;
  }

  const header = text.slice(start).match(/^([!#$%&'*+.^_`|~\w-]+)(\s*):/);
  if (header) {
    const colonFrom = start + header[1].length + header[2].length;
    add(spans, start, start + header[1].length, "header");
    add(spans, colonFrom, colonFrom + 1, "operator");
    scanBody(text, colonFrom + 1, spans);
    return spans;
  }

  if (text.startsWith("> {%", start) || text.startsWith("< {%", start)) {
    add(spans, start, text.length, "script-boundary");
    return spans;
  }

  scanBody(text, start, spans);
  return spans;
}

const tokenStyles = {
  comment: "comment",
  header: "property",
  keyword: "keyword",
  method: "keyword",
  number: "number",
  operator: "operator",
  protocol: "meta",
  "script-boundary": "meta",
  separator: "heading",
  string: "string",
  url: "link",
  variable: "variable",
};

export default {
  highlighters: {
    "http-request": {
      tokenStyles,
      highlightLine: highlightHttpLine,
    },
  },
};
