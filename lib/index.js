"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// external/dsh-connector/src/index.ts
var index_exports = {};
__export(index_exports, {
  Config: () => Config,
  apply: () => apply,
  name: () => name,
  normalizeConfig: () => normalizeConfig,
  usage: () => usage
});
module.exports = __toCommonJS(index_exports);
var import_node_path5 = require("node:path");

// external/dsh-connector/src/config.ts
var import_koishi = require("koishi");

// external/dsh-connector/src/constants.ts
var PLUGIN_NAME = "koishi-plugin-dsh-connector";
var LOGGER_NAME = "dsh-connector";
var MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^\s)]+)(?:\s[^)]*)?\)/g;
var DSH_ATTACHMENT_PREFIX = "dsh-attachment:";
var DSH_CREDENTIALS_FILE = ".credentials.yaml";
var DSH_BROWSER_SESSION_RECORD = "client-connection/browser-session";
var DSH_AUTH_COOKIE_PREFIX = "dsh-auth-";
var DSH_AUTH_COOKIE_VERSION = 1;
var DSH_AUTH_COOKIE_TTL_MS = 60 * 60 * 1e3;
var DSH_AUTH_MARK = "dsh web authentication required";
var DSH_BOOT_MARK = "__DSH_BOOT__";
var RELAY_ACCESS_COOKIE = "dsh-relay-access";
var RELAY_LOGIN_PATH = "/?key=";
var DISCOVER_PROBE_TIMEOUT_MS = 900;
var DISCOVER_MAX_CANDIDATES = 300;
var DISCOVER_CONCURRENCY = 24;
var FORWARD_PLATFORMS = ["onebot"];
var PRESET_LABELS = {
  "read-only": "仅可查看",
  "workspace-write": "工作区可写",
  "danger-full-access": "完全权限",
  auto: "自动审查"
};
var PERMISSION_PRESETS = ["read-only", "workspace-write", "danger-full-access", "auto"];
function presetLabel(value) {
  if (!value) return "未知";
  return PRESET_LABELS[value] ?? value;
}
var EFFORT_LABELS = {
  off: "关闭",
  low: "低",
  high: "高",
  max: "最高"
};
function effortLabel(value) {
  if (!value) return "默认";
  return EFFORT_LABELS[value] ?? value;
}
var MESSAGES = {
  noWhitelist: "插件还没配置允许的用户，请联系管理员。",
  denied: (uid) => `你不在允许名单中（标识：${uid}）`,
  notReady: "还没连上 DeepSeek Harness。请确认 DSH 已启动，或发 dsh.ping 查看具体原因。",
  noBinding: "当前聊天还没有绑定 DSH 会话。发 dsh.new 新建一个，或发 dsh.use 加序号绑定已有会话。",
  noPendingApproval: "当前没有等待处理的授权请求。",
  promptAccepted: "已提交到 DeepSeek Harness，正在执行……",
  busy: "这个聊天还有任务在执行，等它结束或先发 dsh.stop。",
  attachmentsBuffered: (images, files) => {
    const parts = [];
    if (images > 0) parts.push(`${images} 张图片`);
    if (files > 0) parts.push(`${files} 个文件`);
    return `已暂存 ${parts.join("、")}，下一条 dsh.run 会一起提交。`;
  },
  promptTimedOut: "等待超时，任务可能仍在 DSH 中执行。稍后可用 dsh.history 查看结果。",
  stopRequested: "已请求停止当前任务。",
  sessionCreated: "已创建并绑定新的 DSH 会话。",
  sessionMissing: "没有找到匹配的 DSH 会话，发 dsh.sessions 查看可用列表。",
  noSessions: "还没有会话，发 dsh.new 新建一个。",
  listFirst: "先发 dsh.sessions 查看列表，再用 dsh.use 加序号绑定。",
  indexOutOfRange: (count) => `序号超出范围，当前列表只有 ${count} 个会话。`,
  noPermissionBinding: "先绑定一个 DSH 会话，再查看或切换权限。",
  invalidPreset: (value, valid) => `无效的权限预设：${value}，可选 ${valid}。`,
  permissionChanged: (label) => `已切换权限：${label}`,
  approveSent: "已允许该授权请求。",
  denySent: "已拒绝该授权请求。",
  noModelBinding: "先绑定一个 DSH 会话，再查看或切换模型。",
  invalidModel: (value) => `没有找到模型：${value}，发 dsh.model 查看可用列表。`,
  invalidEffort: (value, valid) => `无效的思考等级：${value}，可选 ${valid}。`,
  noEffortChoice: "这个模型不支持调整思考等级。",
  noWorkspace: "还没有可用的工作区，用 dsh.new 加路径新建一个。",
  workspaceMissing: (value) => `没有找到工作区：${value}`,
  getUsage: "用法：dsh.get 相对路径，例如 dsh.get src/index.ts。",
  fileTooLarge: (mb) => `文件超过 ${mb} MB 上限，没有发送。`,
  filesSkipped: (count) => `有 ${count} 个文件未能读取或超出上限。`,
  emptyUsage: "请提供要交给 DSH 的内容，例如：dsh.run 列出当前目录的文件",
  noContent: "已完成这一轮，但没有返回可发送的内容。",
  imagesSkipped: (count) => `有 ${count} 张图片未能取回或超出上限。`
};
var DISCOVERY_HINT = "未发现本机正在运行的 DeepSeek Harness 网页服务。请先启动 DSH 桌面版；或运行 dsh web --port 3080，再把插件配置 baseUrl 设为 http://127.0.0.1:3080";

// external/dsh-connector/src/config.ts
var Config = import_koishi.Schema.intersect([
  import_koishi.Schema.object({
    mode: import_koishi.Schema.union([
      import_koishi.Schema.const("auto").description("自动"),
      import_koishi.Schema.const("direct").description("直连"),
      import_koishi.Schema.const("relay").description("relay")
    ]).default("auto").description("**连接方式**<br>自动：有访问密钥走 relay，否则直连"),
    baseUrl: import_koishi.Schema.string().default("").description("**DSH 地址**<br>留空自动发现端口；固定端口或 relay 时填写"),
    dshHome: import_koishi.Schema.string().default("").description("**DSH 主目录**<br>留空取 `DSH_HOME` 或 `~/.dsh`，需含 `.credentials.yaml`"),
    accessKey: import_koishi.Schema.string().role("secret").default("").description("**relay 访问密钥**<br>仅跨机访问时填写")
  }).description("连接设置"),
  import_koishi.Schema.object({
    pollInterval: import_koishi.Schema.natural().min(300).max(1e4).step(100).default(1200).description("**轮询间隔**<br>单位毫秒"),
    promptTimeout: import_koishi.Schema.natural().min(10).max(3600).default(600).description("**等待上限**<br>单位秒，超时后任务仍在 DSH 继续"),
    historyLimit: import_koishi.Schema.natural().min(1).max(50).default(5).description("**历史条数**<br>`dsh.history` 默认条数"),
    sessionLimit: import_koishi.Schema.natural().min(1).max(200).default(20).description("**列表上限**<br>`dsh.sessions` 默认显示最近多少个会话"),
    defaultWorkspace: import_koishi.Schema.string().default("").description("**默认工作区**<br>`dsh.new` 不带参数时使用；留空则用 DSH 默认目录"),
    clientTimeZone: import_koishi.Schema.string().default("Asia/Shanghai").description("**客户端时区**<br>IANA 名称，如 `Asia/Shanghai`"),
    replyFormat: import_koishi.Schema.union([
      import_koishi.Schema.const("text").description("纯文本"),
      import_koishi.Schema.const("markdown").description("保留 Markdown")
    ]).default("text").description("**回复格式**<br>QQ 不渲染 Markdown，默认转纯文本")
  }).description("会话设置"),
  import_koishi.Schema.object({
    splitLength: import_koishi.Schema.natural().min(0).max(5e3).step(100).default(1500).description("**触发长度**<br>回复超过该字数才特殊处理；`0` 表示始终按下方规则处理"),
    chunkLength: import_koishi.Schema.natural().min(200).max(5e3).step(100).default(1500).description("**单段长度**<br>分段发送的每段、合并转发的每个节点的最大字数"),
    mergeForward: import_koishi.Schema.boolean().default(false).description("**合并转发**<br>超长回复改用合并转发，仅 OneBot 支持")
  }).description("回复设置"),
  import_koishi.Schema.object({
    allowUsers: import_koishi.Schema.array(import_koishi.Schema.string()).role("table").default([]).description(
      "**用户白名单**<br>写 `平台:用户ID`（如 `onebot:123456`），也可只写用户 ID。名单内用户在私聊和群聊都可使用；留空表示谁都不能用"
    ),
    defaultPermission: import_koishi.Schema.union([
      import_koishi.Schema.const("").description("不设置"),
      ...PERMISSION_PRESETS.map((value) => import_koishi.Schema.const(value).description(presetLabel(value)))
    ]).default("").description("**新建会话权限**<br>创建会话后自动切换到的权限预设；不设置则沿用 DSH 默认")
  }).description("权限设置"),
  import_koishi.Schema.object({
    enableImages: import_koishi.Schema.boolean().default(true).description("**回传图片**<br>把回复中的图片与附件转成聊天图片"),
    maxImages: import_koishi.Schema.natural().min(0).max(20).default(6).description("**单轮图片上限**<br>0 表示不回传图片"),
    maxImageMb: import_koishi.Schema.natural().min(1).max(64).default(8).description("**单张图片上限**<br>单位 MB"),
    enableFiles: import_koishi.Schema.boolean().default(true).description("**收发文件**<br>接收聊天里的文件并提交给 DSH，也可用 dsh.get 取回工作区文件"),
    maxFileMb: import_koishi.Schema.natural().min(1).max(200).default(20).description("**单个文件上限**<br>单位 MB")
  }).description("附件设置"),
  import_koishi.Schema.object({
    debug: import_koishi.Schema.boolean().default(false).description("**调试日志**<br>输出 RPC、端口发现与未识别事件帧")
  }).description("调试")
]);
function normalizeConfig(config) {
  return {
    ...config,
    mode: config.mode ?? "auto",
    baseUrl: (config.baseUrl ?? "").trim().replace(/\/+$/, ""),
    dshHome: (config.dshHome ?? "").trim(),
    accessKey: (config.accessKey ?? "").trim(),
    pollInterval: Math.max(300, Math.min(1e4, config.pollInterval ?? 1200)),
    promptTimeout: Math.max(10, Math.min(3600, config.promptTimeout ?? 600)),
    historyLimit: Math.max(1, Math.min(50, config.historyLimit ?? 5)),
    sessionLimit: Math.max(1, Math.min(200, config.sessionLimit ?? 20)),
    defaultWorkspace: (config.defaultWorkspace ?? "").trim(),
    clientTimeZone: (config.clientTimeZone ?? "").trim() || "Asia/Shanghai",
    replyFormat: config.replyFormat === "markdown" ? "markdown" : "text",
    allowUsers: (config.allowUsers ?? []).map((id) => String(id).trim()).filter(Boolean),
    defaultPermission: PERMISSION_PRESETS.includes(config.defaultPermission ?? "") ? config.defaultPermission : "",
    mergeForward: config.mergeForward ?? false,
    splitLength: Math.max(0, Math.min(5e3, config.splitLength ?? 1500)),
    chunkLength: Math.max(200, Math.min(5e3, config.chunkLength ?? 1500)),
    enableImages: config.enableImages ?? true,
    maxImages: Math.max(0, Math.min(20, config.maxImages ?? 6)),
    maxImageMb: Math.max(1, Math.min(64, config.maxImageMb ?? 8)),
    enableFiles: config.enableFiles ?? true,
    maxFileMb: Math.max(1, Math.min(200, config.maxFileMb ?? 20)),
    debug: config.debug ?? false
  };
}

// external/dsh-connector/src/handlers.ts
var import_promises5 = require("node:fs/promises");
var import_node_os2 = require("node:os");
var import_node_path4 = require("node:path");
var import_node_url2 = require("node:url");
var import_koishi3 = require("koishi");

// external/dsh-connector/src/core/markdown.ts
var FENCE_RE = /^\s*(```|~~~)/;
var TABLE_SEPARATOR_RE = /^[\s:|-]+$/;
function isTableLine(line) {
  return line.trim().startsWith("|") && line.trim().length > 1;
}
function isTableSeparator(line) {
  const trimmed = line.trim();
  return TABLE_SEPARATOR_RE.test(trimmed) && trimmed.includes("-");
}
function renderTable(block) {
  const rows = block.filter((line) => !isTableSeparator(line)).map(
    (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim())
  ).filter((cells) => cells.some((cell) => cell !== ""));
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((cells) => [...cells, ...Array(width - cells.length).fill("")].join(" │ "));
}
function renderInline(text) {
  return text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt) => alt ? `[${alt}]` : "[图片]").replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s[^)]*)?\)/g,
    (_match, label, url) => label === url ? url : `${label} (${url})`
  ).replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/~~([^~]+)~~/g, "$1").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2").replace(/<[^>]+>/g, "");
}
function renderLine(line) {
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return "————";
  let text = line;
  const heading = /^\s*#{1,6}\s+(.*)$/.exec(text);
  if (heading) text = heading[1];
  const quote = /^\s*>\s?(.*)$/.exec(text);
  if (quote) text = `│ ${quote[1]}`;
  const list = /^(\s*)[-*+]\s+(.*)$/.exec(text);
  if (list) text = `${list[1]}· ${list[2]}`;
  return renderInline(text);
}
function toPlainText(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = FENCE_RE.exec(line);
    if (match) {
      if (fence === null) fence = match[1];
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) {
      output.push(line);
      continue;
    }
    if (isTableLine(line)) {
      const block = [];
      while (index < lines.length && isTableLine(lines[index])) {
        block.push(lines[index]);
        index++;
      }
      index--;
      output.push(...renderTable(block));
      continue;
    }
    output.push(renderLine(line));
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function stripChatMarkup(text) {
  return text.replace(/<[^>]+>/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

// external/dsh-connector/src/core/media.ts
var import_node_buffer = require("node:buffer");
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_url = require("node:url");
var IMAGE_KEY_HINTS = /* @__PURE__ */ new Set([
  "url",
  "uri",
  "src",
  "source",
  "image",
  "image_url",
  "attachment",
  "attachments"
]);
function pushUnique(list, value) {
  const normalized = value.trim().replace(/^<|>$/g, "");
  if (normalized && !list.includes(normalized)) list.push(normalized);
}
function looksLikeImageRef(value) {
  return /^data:image\//i.test(value) || /^https?:\/\//i.test(value);
}
function collectImages(value, images, hint) {
  if (typeof value === "string") {
    if (hint || looksLikeImageRef(value)) pushUnique(images, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImages(item, images, hint);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value;
  const attachmentId = record.attachmentId;
  if (typeof attachmentId === "string" && attachmentId.trim()) {
    pushUnique(images, `${DSH_ATTACHMENT_PREFIX}${attachmentId.trim()}`);
    return;
  }
  for (const [key, item] of Object.entries(record)) {
    if (key === "type") continue;
    collectImages(item, images, hint || IMAGE_KEY_HINTS.has(key.toLowerCase()));
  }
}
function parseMarkdownImages(text) {
  const found = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const url = match[1];
    if (url) pushUnique(found, url);
  }
  return found;
}
function extractContent(event) {
  if (!event || typeof event !== "object") return { text: "", images: [] };
  const data = event.data ?? {};
  const message = data.message ?? {};
  const raw = message.content ?? data.content ?? [];
  const blocks = Array.isArray(raw) ? raw : [raw];
  const texts = [];
  const images = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const item = block;
    if ((item.type === "text" || item.type === "markdown") && typeof item.text === "string") {
      texts.push(item.text);
      for (const url of parseMarkdownImages(item.text)) pushUnique(images, url);
      continue;
    }
    const imageBlock = item.type === "image" || item.type === "image_url" || item.type === "attachment";
    collectImages(item, images, imageBlock);
  }
  const text = texts.join("");
  for (const url of parseMarkdownImages(text)) pushUnique(images, url);
  return { text, images };
}
function guessImageType(buffer) {
  return sniffImageType(buffer) ?? "image/png";
}
function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (buffer.length >= 12) {
    if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
      return "image/webp";
    }
  }
  return void 0;
}
async function fetchImage(url, maxBytes, timeoutMs) {
  const dataUri = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url);
  if (dataUri) {
    const buffer = import_node_buffer.Buffer.from(dataUri[2], "base64");
    if (buffer.length === 0 || buffer.length > maxBytes) return null;
    return { buffer, type: sniffImageType(buffer) ?? dataUri[1].toLowerCase() };
  }
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type && !type.startsWith("image/")) return null;
    const buffer = import_node_buffer.Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > maxBytes) return null;
    const sniffed = sniffImageType(buffer);
    if (!sniffed && type !== "image/svg+xml") return null;
    return { buffer, type: sniffed ?? type };
  } catch {
    return null;
  }
}
function decodeAttachment(data, mediaType) {
  if (!data) return null;
  if (mediaType && !mediaType.toLowerCase().startsWith("image/")) return null;
  const buffer = import_node_buffer.Buffer.from(data, "base64");
  if (buffer.length === 0) return null;
  return { buffer, type: mediaType ? mediaType.toLowerCase() : guessImageType(buffer) };
}
async function loadImageSource(source, maxBytes, timeoutMs) {
  const value = source.trim();
  if (!value) return null;
  if (/^data:/i.test(value) || /^https?:\/\//i.test(value)) {
    return fetchImage(value, maxBytes, timeoutMs);
  }
  let filePath = value;
  if (/^file:\/\//i.test(value)) {
    try {
      filePath = (0, import_node_url.fileURLToPath)(value);
    } catch {
      return null;
    }
  }
  if (!(0, import_node_path.isAbsolute)(filePath)) return null;
  try {
    const buffer = await (0, import_promises.readFile)(filePath);
    if (buffer.length === 0 || buffer.length > maxBytes) return null;
    const type = sniffImageType(buffer);
    return type ? { buffer, type } : null;
  } catch {
    return null;
  }
}
var MEDIA_TYPES = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".yml": "application/yaml",
  ".yaml": "application/yaml",
  ".log": "text/plain",
  ".js": "text/javascript",
  ".ts": "text/plain",
  ".py": "text/x-python",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};
function sanitizeFileName(name2) {
  const leaf = name2.split(/[\\/]/).filter(Boolean).pop() ?? "file";
  const cleaned = leaf.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return cleaned.slice(0, 80) || "file";
}
function guessMediaType(buffer, name2) {
  const sniffed = sniffImageType(buffer);
  if (sniffed) return sniffed;
  const ext = (0, import_node_path.extname)(name2).toLowerCase();
  return MEDIA_TYPES[ext] ?? "application/octet-stream";
}
async function loadFileSource(source, name2, maxBytes, timeoutMs) {
  const value = source.trim();
  if (!value) return null;
  let buffer;
  if (/^data:/i.test(value)) {
    const match = /^data:([^;,]*);base64,(.*)$/is.exec(value);
    if (!match) return null;
    buffer = import_node_buffer.Buffer.from(match[2], "base64");
  } else if (/^https?:\/\//i.test(value)) {
    try {
      const response = await fetch(value, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > maxBytes) return null;
      buffer = import_node_buffer.Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    }
  } else {
    let filePath = value;
    if (/^file:\/\//i.test(value)) {
      try {
        filePath = (0, import_node_url.fileURLToPath)(value);
      } catch {
        return null;
      }
    }
    if (!(0, import_node_path.isAbsolute)(filePath)) return null;
    try {
      buffer = await (0, import_promises.readFile)(filePath);
    } catch {
      return null;
    }
  }
  if (!buffer || buffer.length === 0 || buffer.length > maxBytes) return null;
  const safeName = sanitizeFileName(name2 || "file");
  return { buffer, name: safeName, mediaType: guessMediaType(buffer, safeName) };
}

// external/dsh-connector/src/core/text.ts
function splitText(text, limit) {
  const content = text.trim();
  if (!content) return [];
  if (limit <= 0 || content.length <= limit) return [content];
  const chunks = [];
  let rest = content;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf("。", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf("，", limit);
    if (cut < limit / 2) cut = limit;
    const chunk = rest.slice(0, cut + 1).trim();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(cut + 1).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// external/dsh-connector/src/services/dsh.ts
var import_node_crypto3 = require("node:crypto");

// external/dsh-connector/src/core/auth.ts
var import_node_crypto = require("node:crypto");
var import_promises2 = require("node:fs/promises");
var import_node_os = require("node:os");
var import_node_path2 = require("node:path");
var DshAuthError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DshAuthError";
  }
};
function resolveDshHome(explicit) {
  const candidate = explicit.trim() || (process.env.DSH_HOME ?? "").trim();
  return candidate || (0, import_node_path2.join)((0, import_node_os.homedir)(), ".dsh");
}
function base64url(buffer) {
  return buffer.toString("base64url");
}
function decodeSecret(raw) {
  const text = raw.trim();
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const decoded = Buffer.from(text, "base64url");
    return decoded.length > 0 && base64url(decoded) === text ? decoded : null;
  } catch {
    return null;
  }
}
function parseBrowserSessionSecret(text) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() !== `${DSH_BROWSER_SESSION_RECORD}:`) continue;
    const recordIndent = lines[index].search(/\S/);
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      const trimmed = line.trim();
      if (trimmed && line.search(/\S/) <= recordIndent) break;
      if (!trimmed.startsWith("secret:")) continue;
      const raw = trimmed.slice("secret:".length).trim().replace(/^['"]|['"]$/g, "");
      return decodeSecret(raw);
    }
  }
  return null;
}
async function readBrowserSessionSecret(home) {
  const file = (0, import_node_path2.join)(home, DSH_CREDENTIALS_FILE);
  let text;
  try {
    text = await (0, import_promises2.readFile)(file, "utf8");
  } catch {
    throw new DshAuthError(
      `读不到 DSH 凭据文件: ${file}。请确认 DSH 至少启动过一次，或把配置项 \`dshHome\` 指向正在运行的 DSH 主目录（默认 \`~/.dsh\`）；若 Koishi 与 DSH 不是同一个系统用户，还需要让该文件对 Koishi 可读。`
    );
  }
  const secret = parseBrowserSessionSecret(text);
  if (!secret) {
    throw new DshAuthError(
      `凭据文件里没有 ${DSH_BROWSER_SESSION_RECORD} 记录: ${file}。请启动一次 DSH 网页服务，让它生成浏览器会话密钥。`
    );
  }
  return secret;
}
function buildAuthCookie(secret, authority, ttlMs = DSH_AUTH_COOKIE_TTL_MS) {
  const now = Date.now();
  const payload = {
    version: DSH_AUTH_COOKIE_VERSION,
    authority,
    issuedAt: now,
    expiresAt: now + ttlMs
  };
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = base64url((0, import_node_crypto.createHmac)("sha256", secret).update(body).digest());
  const name2 = DSH_AUTH_COOKIE_PREFIX + base64url((0, import_node_crypto.createHash)("sha256").update(authority).digest());
  return `${name2}=v1.${body}.${signature}`;
}
function readSetCookies(response) {
  const headers = response.headers;
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}
async function loginRelay(baseUrl, accessKey, timeoutMs) {
  const url = `${baseUrl}${RELAY_LOGIN_PATH}${encodeURIComponent(accessKey)}`;
  let response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/html,application/json" }
    });
  } catch (error) {
    throw new DshAuthError(`连接 relay 失败: ${baseUrl}。请确认 relay 正在运行且地址可达 (${String(error)})。`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new DshAuthError("relay 拒绝了访问密钥。请检查配置项 `accessKey` 是否与 `relay-config.json` 中的值一致。");
  }
  const cookie = readSetCookies(response).map((item) => item.split(";")[0].trim()).find((item) => item.startsWith(`${RELAY_ACCESS_COOKIE}=`));
  if (!cookie) {
    if (response.status === 200) {
      throw new DshAuthError(
        "relay 返回了页面但没有下发访问 cookie。请确认 `baseUrl` 指向的是 DSH relay，而不是 DSH 本体。"
      );
    }
    throw new DshAuthError(
      `relay 没有下发访问 cookie (HTTP ${response.status})。请确认 \`baseUrl\` 与 \`accessKey\` 配置正确。`
    );
  }
  return cookie;
}

// external/dsh-connector/src/core/discover.ts
var import_node_child_process = require("node:child_process");
var import_promises3 = require("node:fs/promises");
var import_node_http = require("node:http");

// external/dsh-connector/src/utils.ts
var import_koishi2 = require("koishi");
var logger = new import_koishi2.Logger(LOGGER_NAME);
function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
function normalizeTimeZone(value) {
  const candidate = value.trim();
  if (!candidate || candidate === "UTC" || candidate.includes("/")) return candidate || "UTC";
  return "UTC";
}

// external/dsh-connector/src/core/discover.ts
var LOOPBACK_ADDRESSES = /* @__PURE__ */ new Set(["127.0.0.1", "0.0.0.0", "[::]", "[::1]", "[::ffff:127.0.0.1]"]);
var PROCESS_HINTS = ["deepseek", "dsh", "electron", "node"];
function runCommand(file, args, timeout = 8e3) {
  return new Promise((resolve) => {
    (0, import_node_child_process.execFile)(file, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}
async function listWindowsListeners() {
  const [netstat, tasklist] = await Promise.all([
    runCommand("netstat", ["-ano", "-p", "tcp"]),
    runCommand("tasklist", ["/fo", "csv", "/nh"])
  ]);
  const names = /* @__PURE__ */ new Map();
  for (const line of tasklist.split(/\r?\n/)) {
    const match = /^"(?<name>[^"]+)","(?<pid>\d+)"/.exec(line.trim());
    if (match?.groups) names.set(Number(match.groups.pid), match.groups.name.toLowerCase());
  }
  const listeners = [];
  for (const line of netstat.split(/\r?\n/)) {
    const match = /^\s*TCP\s+(?<address>\S+):(?<port>\d+)\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$/i.exec(line);
    if (!match?.groups) continue;
    if (!LOOPBACK_ADDRESSES.has(match.groups.address.trim())) continue;
    const port = Number(match.groups.port);
    if (!Number.isInteger(port) || port <= 0) continue;
    listeners.push({ port, processName: names.get(Number(match.groups.pid)) ?? "" });
  }
  return listeners;
}
function isLoopbackProcAddress(raw) {
  if (raw.length === 8) {
    const ip = [0, 2, 4, 6].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16));
    const dotted = [ip[3], ip[2], ip[1], ip[0]].join(".");
    return dotted === "127.0.0.1" || dotted === "0.0.0.0";
  }
  if (raw.length === 32) {
    const tail = raw.slice(24);
    return raw === "0".repeat(32) || tail === "01000000";
  }
  return false;
}
async function listLinuxListeners() {
  const listeners = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = await (0, import_promises3.readFile)(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 4 || columns[3] !== "0A") continue;
      const [address, portHex] = columns[1].split(":");
      if (!address || !portHex || !isLoopbackProcAddress(address)) continue;
      const port = Number.parseInt(portHex, 16);
      if (!Number.isInteger(port) || port <= 0) continue;
      listeners.push({ port, processName: "" });
    }
  }
  return listeners;
}
async function listMacListeners() {
  const stdout = await runCommand("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "n"]);
  const listeners = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^n(?<address>.+):(?<port>\d+)$/.exec(line.trim());
    if (!match?.groups) continue;
    const address = match.groups.address.trim();
    if (address !== "127.0.0.1" && address !== "*" && address !== "[::1]") continue;
    const port = Number(match.groups.port);
    if (!Number.isInteger(port) || port <= 0) continue;
    listeners.push({ port, processName: "" });
  }
  return listeners;
}
async function listLoopbackListeners() {
  switch (process.platform) {
    case "win32":
      return listWindowsListeners();
    case "darwin":
      return listMacListeners();
    default:
      return listLinuxListeners();
  }
}
function looksLikeDsh(status, body) {
  if (body.includes(DSH_AUTH_MARK)) return true;
  if (body.includes(DSH_BOOT_MARK)) return true;
  return status === 200 && body.includes("DeepSeek Harness");
}
function probePort(port, timeoutMs = DISCOVER_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = (0, import_node_http.request)(
      {
        host: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        headers: {
          host: `127.0.0.1:${port}`,
          connection: "close",
          "user-agent": "koishi-plugin-dsh"
        },
        timeout: timeoutMs
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (body.length < 8192) body += chunk;
        });
        res.on("end", () => resolve(looksLikeDsh(res.statusCode, body)));
        res.on("error", () => resolve(false));
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}
async function probeAll(ports) {
  const hits = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(DISCOVER_CONCURRENCY, ports.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < ports.length) {
      const port = ports[cursor++];
      if (await probePort(port)) hits.push(port);
    }
  });
  await Promise.all(workers);
  return hits.sort((left, right) => left - right);
}
async function discoverDshPort(preferred) {
  if (preferred !== void 0 && await probePort(preferred)) {
    logger.debug(`[discover] 复用上次端口: ${preferred}`);
    return preferred;
  }
  const listeners = await listLoopbackListeners();
  if (listeners.length === 0) return void 0;
  const hinted = listeners.filter((item) => PROCESS_HINTS.some((hint) => item.processName.includes(hint)));
  const candidates = (hinted.length > 0 ? hinted : listeners).slice(0, DISCOVER_MAX_CANDIDATES);
  const ports = [...new Set(candidates.map((item) => item.port))];
  logger.debug(`[discover] 监听端口 ${listeners.length} 个，探测 ${ports.length} 个`);
  const hits = await probeAll(ports);
  if (hits.length === 0) return void 0;
  logger.debug(`[discover] 命中端口: ${hits.join(", ")}`);
  return hits[0];
}

// external/dsh-connector/src/core/mux.ts
var import_ws = __toESM(require("ws"));

// external/dsh-connector/src/core/rpc.ts
var import_node_crypto2 = require("node:crypto");
var DshRpcError = class extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "DshRpcError";
  }
};
function assertStatus(response, method) {
  if (response.status === 401) {
    throw new DshRpcError("DSH 拒绝了请求 (401)，浏览器会话凭据无效或已过期", "unauthorized", 401);
  }
  if (response.status === 403) {
    throw new DshRpcError(
      "DSH 拒绝了请求 (403)，Host 校验未通过。请把地址写成回环地址，或给 `dsh web` 加 `--trusted-host`",
      "forbidden",
      403
    );
  }
  if (response.status === 404) {
    throw new DshRpcError(
      `DSH 不支持接口 ${method} (404)，可能是 DSH 版本与插件不匹配`,
      "unsupported",
      404
    );
  }
  if (response.status === 503) {
    throw new DshRpcError("DSH 网页服务尚未就绪 (503)，请稍候重试", "starting", 503);
  }
  if (response.status !== 200) {
    throw new DshRpcError(`DSH 返回 HTTP ${response.status}`, "http", response.status);
  }
}
function buildEnvelope(method, args) {
  return {
    type: "client-request",
    rpcId: (0, import_node_crypto2.randomUUID)(),
    method,
    payload: { args }
  };
}
function post(baseUrl, cookie, method, args, timeoutMs) {
  return (async () => {
    let response;
    try {
      response = await fetch(`${baseUrl}/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(buildEnvelope(method, args)),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new DshRpcError(`连接 DSH 失败: ${baseUrl} (${reason})`, "network", 0);
    }
    assertStatus(response, method);
    return response;
  })();
}
function unwrap(body, method) {
  const result = body.result;
  if (!result || typeof result !== "object") {
    throw new DshRpcError(`DSH 返回了意外响应 (${method})`, "malformed", 200);
  }
  if (result.ok !== true) {
    const code = result.error?.code ?? "unknown";
    const message = result.error?.message ?? "未知错误";
    throw new DshRpcError(`DSH 错误 ${code}: ${message}`, String(code), 200);
  }
  return result.value;
}
async function callRpc(options) {
  const { baseUrl, cookie, method, args = {}, timeoutMs } = options;
  const response = await post(baseUrl, cookie, method, args, timeoutMs);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new DshRpcError(`DSH 返回了无法解析的响应 (${method})`, "malformed", 200);
  }
  return unwrap(body, method);
}
async function callRpcMultipart(options) {
  const { baseUrl, cookie, method, args = {}, timeoutMs } = options;
  const response = await post(baseUrl, cookie, method, args, timeoutMs);
  let form;
  try {
    form = await response.formData();
  } catch {
    throw new DshRpcError(`DSH 返回了无法解析的响应 (${method})`, "malformed", 200);
  }
  const parts = /* @__PURE__ */ new Map();
  let metadata;
  for (const [name2, value] of form.entries()) {
    if (typeof value === "string") {
      if (name2 === "metadata") {
        try {
          metadata = JSON.parse(value);
        } catch {
          throw new DshRpcError(`DSH 返回了无法解析的响应 (${method})`, "malformed", 200);
        }
      }
      continue;
    }
    parts.set(name2, Buffer.from(await value.arrayBuffer()));
  }
  if (!metadata) throw new DshRpcError(`DSH 返回了意外响应 (${method})`, "malformed", 200);
  return { value: unwrap(metadata, method), parts };
}

// external/dsh-connector/src/core/mux.ts
var RECONNECT_MIN_MS = 2e3;
var RECONNECT_MAX_MS = 3e4;
var RESULT_TIMEOUT_MS = 15e3;
function pickString(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return void 0;
}
function pickRecord(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}
function readApprovalFrame(frame) {
  const eventId = pickString(frame, ["eventId", "id", "requestId"]);
  if (!eventId) return null;
  const label = ["endpoint", "method", "name", "event", "type"].map((key) => frame[key]).filter((value) => typeof value === "string").join(" ");
  if (!label.includes("approval")) return null;
  const args = pickRecord(frame, ["args", "payload", "request", "data"]);
  return {
    eventId,
    sessionId: pickString(args, ["sessionId", "agentId"]) ?? pickString(frame, ["sessionId", "agentId"]),
    tool: pickString(args, ["tool", "toolName", "name"]),
    reason: pickString(args, ["reason", "message", "description"]),
    raw: frame
  };
}
var EventBridge = class {
  constructor(options) {
    this.options = options;
  }
  socket;
  retryTimer;
  closed = false;
  readyClientId;
  delay = RECONNECT_MIN_MS;
  get clientId() {
    return this.readyClientId;
  }
  get connected() {
    return this.readyClientId !== void 0;
  }
  start() {
    if (this.closed) return;
    void this.connect();
  }
  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = void 0;
    this.readyClientId = void 0;
    const socket = this.socket;
    this.socket = void 0;
    if (!socket) return;
    socket.removeAllListeners();
    if (socket.readyState === import_ws.default.CONNECTING) socket.terminate();
    else socket.close();
  }
  scheduleReconnect() {
    if (this.closed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = void 0;
      void this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, RECONNECT_MAX_MS);
  }
  async connect() {
    if (this.closed) return;
    let cookie;
    try {
      cookie = await this.options.getCookie();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.closed) return;
    let socket;
    try {
      socket = new import_ws.default(this.options.wsUrl, {
        headers: { cookie, origin: this.options.baseUrl }
      });
    } catch (error) {
      logger.debug(`[mux] 建立连接失败: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "open",
        streamId: "koishi-plugin-dsh",
        endpoint: "$events",
        payload: { args: {} }
      }));
      this.delay = RECONNECT_MIN_MS;
    });
    socket.on("message", (raw) => {
      this.handleMessage(raw.toString());
    });
    socket.on("error", (error) => {
      if (this.options.debug) {
        logger.debug(`[mux] 事件桥错误: ${error.message}`);
      }
    });
    socket.on("close", () => {
      this.readyClientId = void 0;
      this.socket = void 0;
      this.scheduleReconnect();
    });
  }
  handleMessage(text) {
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (frame.type !== "item") return;
    const value = frame.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const payload = value;
    if (payload.type === "ready") {
      const clientId = typeof payload.clientId === "string" ? payload.clientId : "";
      this.readyClientId = clientId || void 0;
      return;
    }
    const approval = readApprovalFrame(payload);
    if (approval) {
      this.options.onApproval(approval);
      return;
    }
    if (this.options.debug) {
      logger.debug(`[mux] 未识别的事件帧: ${text.slice(0, 400)}`);
    }
  }
  /** 把授权结论回送给 DSH，`value` 由调用方按 DSH 的 outcome 词表给出 */
  async answer(eventId, value) {
    const clientId = this.readyClientId;
    if (!clientId) throw new Error("事件桥尚未就绪，无法回送授权结果");
    await callRpc({
      baseUrl: this.options.baseUrl,
      cookie: await this.options.getCookie(),
      method: "$events/result",
      args: { clientId, eventId, outcome: { kind: "result", value } },
      timeoutMs: RESULT_TIMEOUT_MS
    });
  }
};

// external/dsh-connector/src/services/dsh.ts
var AUTH_TIMEOUT_MS = 15e3;
var RPC_TIMEOUT_MS = 3e4;
var IMAGE_TIMEOUT_MS = 15e3;
var PAGE_SIZE = 100;
var MAX_PENDING_APPROVALS = 50;
var DshTurnTimeout = class extends Error {
  constructor(partial) {
    super("等待 DSH 回复超时");
    this.partial = partial;
    this.name = "DshTurnTimeout";
  }
};
function toModelSelection(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const value = raw;
  const provider = typeof value.provider === "string" ? value.provider : "";
  const model = typeof value.model === "string" ? value.model : "";
  if (!provider || !model) return void 0;
  return {
    provider,
    model,
    reasoningEffort: typeof value.reasoningEffort === "string" ? value.reasoningEffort : void 0
  };
}
function toSummary(row) {
  if (!row || typeof row !== "object") return null;
  const record = row;
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
  if (!sessionId) return null;
  const projections = record.projections ?? {};
  const values = projections.values ?? {};
  return {
    sessionId,
    title: typeof values.title === "string" ? values.title : "",
    running: Boolean(record.running),
    parentSessionId: typeof record.parentSessionId === "string" ? record.parentSessionId : void 0,
    cwd: typeof record.cwd === "string" && record.cwd ? record.cwd : void 0,
    blank: Boolean(record.blank),
    updatedAt: Number.isFinite(Number(record.updatedAt)) ? Number(record.updatedAt) : 0
  };
}
function parseBaseUrl(raw) {
  const text = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return text;
  } catch {
    throw new DshAuthError(`配置项 \`baseUrl\` 不是合法的 HTTP 地址: ${raw}`);
  }
}
function extractEventText(event) {
  if (!event || typeof event !== "object") return "";
  const data = event.data ?? {};
  const message = data.message ?? {};
  const raw = message.content ?? data.content ?? [];
  const blocks = Array.isArray(raw) ? raw : [raw];
  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const item = block;
    if ((item.type === "text" || item.type === "markdown") && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("");
}
var DshClient = class {
  constructor(config) {
    this.config = config;
  }
  baseUrl;
  cookie;
  secret;
  authority;
  preferredPort;
  connecting;
  bridge;
  pending = [];
  approvalHandler;
  get relayMode() {
    return this.config.mode === "relay" || this.config.mode === "auto" && this.config.accessKey !== "";
  }
  get connected() {
    return this.baseUrl !== void 0 && this.cookie !== void 0;
  }
  describe() {
    return {
      mode: this.relayMode ? "relay" : "direct",
      baseUrl: this.baseUrl,
      bridge: this.bridge?.connected ?? false
    };
  }
  async ensureReady() {
    if (this.baseUrl && this.cookie) return;
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = void 0;
      });
    }
    await this.connecting;
  }
  async connect() {
    if (this.relayMode) {
      if (!this.config.baseUrl) {
        throw new DshAuthError("relay 模式需要填写配置项 `baseUrl`，例如 `http://192.168.192.100`。");
      }
      const baseUrl = parseBaseUrl(this.config.baseUrl);
      const cookie = await loginRelay(baseUrl, this.config.accessKey, AUTH_TIMEOUT_MS);
      this.baseUrl = baseUrl;
      this.cookie = cookie;
      this.authority = new URL(baseUrl).host;
    } else {
      const home = resolveDshHome(this.config.dshHome);
      this.secret = await readBrowserSessionSecret(home);
      let baseUrl = this.config.baseUrl;
      if (!baseUrl) {
        const port = await discoverDshPort(this.preferredPort);
        if (port === void 0) throw new DshAuthError(DISCOVERY_HINT);
        this.preferredPort = port;
        baseUrl = `http://127.0.0.1:${port}`;
      }
      const resolved = parseBaseUrl(baseUrl);
      const authority = new URL(resolved).host;
      const cookie = buildAuthCookie(this.secret, authority);
      this.baseUrl = resolved;
      this.authority = authority;
      this.cookie = cookie;
    }
    logger.debug(`[client] 已连接 ${this.baseUrl} (${this.relayMode ? "relay" : "direct"})`);
    this.startBridge();
  }
  /** DSH 重启会换端口与密钥，这里丢弃连接状态，保留上次端口作为首选探测目标 */
  invalidate() {
    this.baseUrl = void 0;
    this.cookie = void 0;
    this.bridge?.close();
    this.bridge = void 0;
  }
  async refreshCookie() {
    if (this.relayMode) {
      const baseUrl = this.baseUrl ?? this.config.baseUrl;
      if (!baseUrl) throw new DshAuthError("relay 模式需要填写配置项 `baseUrl`");
      this.cookie = await loginRelay(baseUrl, this.config.accessKey, AUTH_TIMEOUT_MS);
      return this.cookie;
    }
    const secret = await readBrowserSessionSecret(resolveDshHome(this.config.dshHome));
    this.secret = secret;
    if (!this.baseUrl) await this.ensureReady();
    if (!this.baseUrl) throw new DshAuthError("DSH 地址尚未确定");
    this.authority = new URL(this.baseUrl).host;
    this.cookie = buildAuthCookie(secret, this.authority);
    return this.cookie;
  }
  async getCookieForBridge() {
    await this.ensureReady();
    if (!this.cookie) throw new DshAuthError("DSH 凭据尚未就绪");
    return this.cookie;
  }
  startBridge() {
    if (this.bridge || !this.baseUrl) return;
    const baseUrl = this.baseUrl;
    this.bridge = new EventBridge({
      wsUrl: `${baseUrl.replace(/^http/, "ws")}/api/remote.mux`,
      baseUrl,
      debug: this.config.debug,
      getCookie: () => this.getCookieForBridge(),
      onApproval: (request2) => {
        this.pending.push(request2);
        if (this.pending.length > MAX_PENDING_APPROVALS) this.pending.shift();
        this.approvalHandler?.(request2);
      }
    });
    this.bridge.start();
  }
  async rawRpc(method, args, timeoutMs) {
    if (!this.baseUrl || !this.cookie) throw new DshAuthError("DSH 连接尚未就绪");
    return callRpc({ baseUrl: this.baseUrl, cookie: this.cookie, method, args, timeoutMs });
  }
  /** 结果带二进制的接口走 multipart，重试策略与普通 RPC 一致 */
  async rpcMultipart(method, args, timeoutMs = RPC_TIMEOUT_MS) {
    await this.ensureReady();
    const run = async () => {
      if (!this.baseUrl || !this.cookie) throw new DshAuthError("DSH 连接尚未就绪");
      return callRpcMultipart({ baseUrl: this.baseUrl, cookie: this.cookie, method, args, timeoutMs });
    };
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof DshRpcError)) throw error;
      if (error.code === "unauthorized") {
        await this.refreshCookie();
        return run();
      }
      if (error.code === "network") {
        this.invalidate();
        await this.ensureReady();
        return run();
      }
      throw error;
    }
  }
  async rpc(method, args = {}, timeoutMs = RPC_TIMEOUT_MS) {
    await this.ensureReady();
    try {
      return await this.rawRpc(method, args, timeoutMs);
    } catch (error) {
      if (!(error instanceof DshRpcError)) throw error;
      if (error.code === "unauthorized") {
        await this.refreshCookie();
        return this.rawRpc(method, args, timeoutMs);
      }
      if (error.code === "network") {
        this.invalidate();
        await this.ensureReady();
        return this.rawRpc(method, args, timeoutMs);
      }
      throw error;
    }
  }
  /**
   * 会话列表，按最后修改时间倒序。
   *
   * `session/list` 会同时返回子代理会话与从未使用过的空会话，两者都不该出现在
   * 用户可见的列表里：子会话的标题其实是子代理的提示词，空会话则没有内容。
   * 排序放在这里，保证所有调用方（列表、绑定、状态）看到的是同一个顺序。
   */
  async listSessions(options = {}) {
    const value = await this.rpc("session/list", { _request: {} });
    return (value.items ?? []).map(toSummary).filter((item) => item !== null).filter((item) => {
      if (!options.includeChildren && item.parentSessionId) return false;
      if (!options.includeBlank && item.blank) return false;
      return true;
    }).sort((left, right) => right.updatedAt - left.updatedAt);
  }
  async createSession(cwd) {
    const request2 = {};
    if (cwd) request2.cwd = cwd;
    const value = await this.rpc("session/create", { request: request2 });
    const sessionId = value.sessionId;
    if (!sessionId) throw new Error("DSH 没有返回会话 ID");
    await this.applyDefaultPermission(sessionId);
    return sessionId;
  }
  /** 新建会话按配置切到默认权限；失败只记日志，不阻断会话创建 */
  async applyDefaultPermission(sessionId) {
    const preset = this.config.defaultPermission;
    if (!preset) return;
    try {
      await this.setPermission(sessionId, preset);
      logger.debug(`[session] 新会话权限已设为 ${preset}`);
    } catch (error) {
      logger.warn(`[session] 新会话权限设置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async sessionTitle(sessionId) {
    const sessions = await this.listSessions();
    return sessions.find((item) => item.sessionId === sessionId)?.title ?? "";
  }
  /** 权限预设目录，由 DSH 官方插件 `dsh-permission-presets` 提供 */
  async permissionPresets() {
    const value = await this.rpc("permissionPresets/catalog", {});
    return (value.options ?? []).map((option) => String(option?.value ?? "")).filter(Boolean);
  }
  /** 会话当前生效的权限预设 */
  async currentPermission(sessionId) {
    return (await this.sessionSnapshot(sessionId)).permission;
  }
  /** 一次 projections 取回状态面板需要的字段 */
  async sessionSnapshot(sessionId) {
    const value = await this.rpc("session/projections", { request: { sessionId } });
    const values = value.values ?? {};
    const permissions = values.permissions;
    const selection = values.modelSelection;
    return {
      permission: typeof permissions?.currentValue === "string" ? permissions.currentValue : void 0,
      model: toModelSelection(selection?.next ?? selection?.lastUsed)
    };
  }
  /** 切权限没有独立 RPC，走官方 `/permission` 斜杠命令 */
  async setPermission(sessionId, preset) {
    const value = await this.rpc("commands/execute", {
      agentId: sessionId,
      line: `/permission ${preset}`,
      submittedAttachments: []
    });
    if (value?.result?.kind !== "success") {
      throw new Error(String(value?.result?.text ?? "切换权限失败"));
    }
  }
  /** 全部可路由模型，按 provider 分组展开成一维；附带部署默认选择 */
  async modelCatalog() {
    const value = await this.rpc("session/modelCatalog", {});
    const options = [];
    for (const group of value.groups ?? []) {
      const provider = String(group.id ?? "");
      const providerName = String(group.name ?? group.id ?? "");
      for (const model of group.models ?? []) {
        const reasoning = model.reasoning ?? {};
        options.push({
          provider,
          providerName,
          model: String(model.id ?? ""),
          name: String(model.name ?? model.id ?? ""),
          description: typeof model.description === "string" ? model.description : void 0,
          efforts: Array.isArray(reasoning.efforts) ? reasoning.efforts.map((item) => ({
            id: String(item.id ?? ""),
            name: String(item.name ?? item.id ?? ""),
            description: typeof item.description === "string" ? item.description : void 0
          })) : [],
          defaultEffort: typeof reasoning.defaultEffort === "string" ? reasoning.defaultEffort : void 0
        });
      }
    }
    return { models: options, defaultSelection: toModelSelection(value.default) };
  }
  /** 会话当前生效的模型与思考等级；`next` 是下一次生效的选择 */
  async modelSelection(sessionId) {
    const value = await this.rpc("session/projections", { request: { sessionId } });
    const selection = (value.values ?? {}).modelSelection;
    return toModelSelection(selection?.next ?? selection?.lastUsed);
  }
  async selectModel(sessionId, provider, model, reasoningEffort) {
    const request2 = { sessionId, provider, model };
    if (reasoningEffort) request2.reasoningEffort = reasoningEffort;
    await this.rpc("session/selectModel", { request: request2 });
  }
  /** 把聊天里的文件上传到会话，返回可直接放进 prompt 的凭据 */
  async uploadFile(sessionId, name2, mediaType, buffer) {
    const value = await this.rpc("fileUploads/upload", {
      agentId: sessionId,
      request: { name: name2, mediaType, data: buffer.toString("base64") }
    });
    if (!value?.receiptId) throw new Error("DSH 没有返回文件凭据");
    return value.receiptId;
  }
  /** 列会话工作区里的目录内容 */
  async listWorkspace(sessionId, path) {
    const value = await this.rpc("workspaceFiles/list", {
      workspaceFileScopeId: sessionId,
      path
    });
    return (value.entries ?? []).map((entry) => ({
      name: String(entry.name ?? ""),
      type: String(entry.type ?? "file"),
      size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : void 0
    }));
  }
  /** 读会话工作区里的一个文件；超出上限时报错而不是截断 */
  async readWorkspaceFile(sessionId, path, maxBytes) {
    const { value, parts } = await this.rpcMultipart("workspaceFiles/readBytes", {
      workspaceFileScopeId: sessionId,
      path,
      options: { range: { offset: 0, length: maxBytes + 1 } }
    });
    const buffer = parts.get("bytes-0");
    if (!buffer) throw new Error("DSH 没有返回文件内容");
    if (buffer.length > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`);
    const meta = value ?? {};
    const absolute = typeof meta.absolutePath === "string" ? meta.absolutePath : path;
    const name2 = absolute.split(/[\\/]/).filter(Boolean).pop() ?? "file";
    return { name: name2, buffer, bytes: buffer.length };
  }
  async cursor(sessionId) {
    const value = await this.rpc("session/projections", { request: { sessionId } });
    const cursor = Number(value.asOfSeq ?? 0);
    return Number.isFinite(cursor) ? cursor : 0;
  }
  async page(sessionId, throughSeq, maxMessages = PAGE_SIZE) {
    const value = await this.rpc("session/page", {
      request: {
        address: { kind: "session", sessionId },
        throughSeq,
        maxMessages
      }
    });
    return value.records ?? [];
  }
  async prompt(sessionId, text, images = [], files = []) {
    const content = [];
    if (text) content.push({ type: "text", text });
    for (const image of images) {
      content.push({ type: "image", data: image.buffer.toString("base64"), mediaType: image.type });
    }
    for (const file of files) {
      content.push({ type: "file", receiptId: file.receiptId });
    }
    await this.rpc("session/prompt", {
      request: {
        requestId: (0, import_node_crypto3.randomUUID)(),
        sessionId,
        mode: "queue",
        content,
        clientTimeZone: normalizeTimeZone(this.config.clientTimeZone)
      }
    });
  }
  async cancel(sessionId) {
    await this.rpc("session/cancel", { request: { sessionId } });
  }
  async history(sessionId, limit) {
    const cursor = await this.cursor(sessionId);
    if (cursor <= 0) return [];
    const events = await this.pageEvents(sessionId, cursor, 0);
    const messages = [];
    for (const item of events) {
      if (item.event.type !== "assistant/message") continue;
      const text = extractEventText(item.event).trim();
      if (text) messages.push(text);
    }
    return messages.slice(-limit);
  }
  /** 取出 `baseline` 之后的事件，按 seq 升序排列；分页返回的顺序不作假设 */
  async pageEvents(sessionId, throughSeq, baseline) {
    const records = await this.page(sessionId, throughSeq);
    const events = [];
    for (const entry of records) {
      const event = entry?.event;
      if (!event || typeof event !== "object") continue;
      const record = event;
      const seq = Number(record.seq ?? 0);
      if (!Number.isFinite(seq) || seq <= baseline) continue;
      events.push({ seq, event: record });
    }
    return events.sort((left, right) => left.seq - right.seq);
  }
  /** 提交一轮任务并等待 `turn/end`，中间步骤的 assistant 消息不并入最终结果 */
  async runTurn(sessionId, text, images = [], files = []) {
    const baseline = await this.cursor(sessionId);
    await this.prompt(sessionId, text, images, files);
    return this.awaitTurn(sessionId, baseline);
  }
  async awaitTurn(sessionId, baseline) {
    const deadline = Date.now() + this.config.promptTimeout * 1e3;
    let lastSeen = "";
    let lastCursor = baseline;
    while (Date.now() < deadline) {
      const cursor = await this.cursor(sessionId);
      if (cursor > baseline && cursor !== lastCursor) {
        lastCursor = cursor;
        const events = await this.pageEvents(sessionId, cursor, baseline);
        for (const item of events) {
          if (item.event.type !== "assistant/message") continue;
          const candidate = extractEventText(item.event).trim();
          if (candidate) lastSeen = candidate;
        }
        const end = [...events].reverse().find((item) => item.event.type === "turn/end");
        if (end) {
          const data = end.event.data ?? {};
          const reason = data.reason ?? {};
          if (reason.kind === "error") {
            const error = reason.error ?? {};
            throw new Error(`DSH 任务失败: ${String(error.message ?? error.code ?? "未知错误")}`);
          }
          let text = "";
          const refs = [];
          for (const item of events) {
            if (item.seq >= end.seq) break;
            if (item.event.type !== "assistant/message") continue;
            const content = extractContent(item.event);
            if (content.text.trim()) text = content.text.trim();
            for (const ref of content.images) {
              if (!refs.includes(ref)) refs.push(ref);
            }
          }
          const resolved = await this.resolveImages(sessionId, refs);
          return { text: text || lastSeen, images: resolved.images, skipped: resolved.skipped, seq: cursor };
        }
      }
      await sleep(this.config.pollInterval);
    }
    throw new DshTurnTimeout(lastSeen);
  }
  /** 把图片引用换成可以直接发送的数据；失败的只计数，不阻断文本回传 */
  async resolveImages(sessionId, refs) {
    if (refs.length === 0) return { images: [], skipped: 0 };
    if (!this.config.enableImages) return { images: [], skipped: refs.length };
    const maxBytes = this.config.maxImageMb * 1024 * 1024;
    const images = [];
    let skipped = 0;
    for (const ref of refs) {
      if (images.length >= this.config.maxImages) {
        skipped += 1;
        continue;
      }
      const image = ref.startsWith(DSH_ATTACHMENT_PREFIX) ? await this.readAttachment(sessionId, ref.slice(DSH_ATTACHMENT_PREFIX.length)) : await fetchImage(ref, maxBytes, IMAGE_TIMEOUT_MS);
      if (!image || image.buffer.length > maxBytes) {
        skipped += 1;
        continue;
      }
      images.push(image);
    }
    return { images, skipped };
  }
  async readAttachment(sessionId, attachmentId) {
    try {
      const value = await this.rpc("session/attachment", {
        request: { sessionId, attachmentId }
      });
      const mediaType = String(value.attachment?.mediaType ?? "image/png");
      return decodeAttachment(String(value.data ?? ""), mediaType);
    } catch (error) {
      logger.debug(`[media] 读取附件失败 ${attachmentId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  setApprovalHandler(handler) {
    this.approvalHandler = handler;
  }
  listPendingApprovals(sessionId) {
    return this.pending.filter((item) => !sessionId || !item.sessionId || item.sessionId === sessionId);
  }
  async answerApproval(decision, sessionId) {
    const target = this.listPendingApprovals(sessionId).at(-1);
    if (!target) return void 0;
    if (!this.bridge) throw new Error("审批事件桥尚未就绪，请稍后重试");
    await this.bridge.answer(target.eventId, decision);
    const index = this.pending.indexOf(target);
    if (index >= 0) this.pending.splice(index, 1);
    return target;
  }
  dispose() {
    this.bridge?.close();
    this.bridge = void 0;
    this.pending.length = 0;
    this.approvalHandler = void 0;
  }
};

// external/dsh-connector/src/services/store.ts
var import_promises4 = require("node:fs/promises");
var import_node_path3 = require("node:path");
function bindingKey(platform, selfId, channelId) {
  return `${platform}:${selfId}:${channelId}`;
}
var BindingStore = class {
  constructor(file) {
    this.file = file;
  }
  bindings = /* @__PURE__ */ new Map();
  loaded = false;
  flushTimer;
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = await (0, import_promises4.readFile)(this.file, "utf8");
      const parsed = JSON.parse(text);
      for (const item of parsed.bindings ?? []) {
        if (!item || typeof item.sessionId !== "string") continue;
        this.bindings.set(bindingKey(item.platform, item.selfId, item.channelId), item);
      }
    } catch {
    }
  }
  get(key) {
    return this.bindings.get(key);
  }
  set(binding) {
    const record = { ...binding, updatedAt: Date.now() };
    this.bindings.set(bindingKey(binding.platform, binding.selfId, binding.channelId), record);
    this.scheduleFlush();
    return record;
  }
  remove(key) {
    if (this.bindings.delete(key)) this.scheduleFlush();
  }
  findBySession(sessionId) {
    for (const binding of this.bindings.values()) {
      if (binding.sessionId === sessionId) return binding;
    }
    return void 0;
  }
  list() {
    return [...this.bindings.values()];
  }
  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = void 0;
      void this.flush();
    }, 500);
  }
  async flush() {
    const payload = JSON.stringify({ version: 1, bindings: this.list() }, null, 2);
    const temporary = `${this.file}.tmp`;
    try {
      await (0, import_promises4.mkdir)((0, import_node_path3.dirname)(this.file), { recursive: true });
      await (0, import_promises4.writeFile)(temporary, payload, "utf8");
      await (0, import_promises4.rename)(temporary, this.file);
    } catch {
    }
  }
  dispose() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = void 0;
    }
    void this.flush();
  }
};

// external/dsh-connector/src/handlers.ts
var INCOMING_IMAGE_TIMEOUT_MS = 15e3;
var MAX_INCOMING_FILES = 5;
var TEMP_FILE_TTL_MS = 36e5;
var PENDING_TTL_MS = 10 * 60 * 1e3;
var PENDING_MAX_ITEMS = 10;
function sessionKey(session) {
  return bindingKey(session.platform, session.selfId, session.channelId || session.userId || "");
}
function matchesIdentifier(list, qualified, bare) {
  return list.some((entry) => entry === qualified || entry === bare);
}
function checkAccess(config, session) {
  const uid = session.uid ?? "";
  if (config.allowUsers.length === 0) return MESSAGES.noWhitelist;
  if (!matchesIdentifier(config.allowUsers, uid, session.userId ?? "")) {
    return MESSAGES.denied(uid);
  }
  return null;
}
function shortSessionId(sessionId) {
  return sessionId.length > 16 ? `${sessionId.slice(0, 16)}…` : sessionId;
}
function handleWhoami(deps, session) {
  const denied = checkAccess(deps.config, session);
  return [
    `用户：${session.uid}`,
    ...session.guildId ? [`群组：${session.gid}`] : [],
    `权限：${denied ?? "允许"}`
  ].join("\n");
}
function bindingOf(deps, session) {
  return deps.store.get(sessionKey(session));
}
function rememberBinding(deps, session, sessionId, title) {
  return deps.store.set({
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId || session.userId || "",
    sessionId,
    title
  });
}
function renderReply(config, text) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return config.replyFormat === "text" ? toPlainText(trimmed) : trimmed;
}
async function sendLongText(deps, session, chunks, wantForward) {
  if (chunks.length === 0) return;
  if (wantForward) {
    try {
      await session.send((0, import_koishi3.h)("message", { forward: true }, ...chunks.map((chunk) => import_koishi3.h.text(chunk))));
      return;
    } catch (error) {
      logger.warn(`[reply] 合并转发失败，改为分段发送: ${getErrorMessage(error)}`);
    }
  }
  for (const chunk of chunks) await session.send(chunk);
}
function collectSessionImages(session) {
  const elements = session.elements ?? [];
  const sources = [];
  for (const element of elements) {
    if (!element || element.type !== "img" && element.type !== "image") continue;
    const attrs = element.attrs ?? {};
    const source = attrs.src ?? attrs.url ?? attrs.file;
    if (typeof source === "string" && source.trim()) sources.push(source.trim());
  }
  return sources;
}
async function loadIncomingImages(deps, session, extra = []) {
  if (!deps.config.enableImages) return [];
  const sources = [...extra, ...collectSessionImages(session)].slice(-deps.config.maxImages);
  const maxBytes = deps.config.maxImageMb * 1024 * 1024;
  const images = [];
  for (const source of sources) {
    const image = await loadImageSource(source, maxBytes, INCOMING_IMAGE_TIMEOUT_MS);
    if (image && image.buffer.length <= maxBytes) images.push(image);
  }
  return images;
}
function collectSessionFiles(session) {
  const elements = session.elements ?? [];
  const files = [];
  for (const element of elements) {
    if (!element || element.type !== "file") continue;
    const attrs = element.attrs ?? {};
    const src = attrs.src ?? attrs.url ?? attrs.file;
    if (typeof src !== "string" || !src.trim()) continue;
    const name2 = typeof attrs.title === "string" ? attrs.title : typeof attrs.name === "string" ? attrs.name : "";
    files.push({ src: src.trim(), name: name2 });
  }
  return files;
}
async function loadIncomingAttachments(deps, session, sessionId, pending) {
  const images = await loadIncomingImages(deps, session, pending?.images ?? []);
  if (!deps.config.enableFiles) return { images, files: [] };
  const maxBytes = deps.config.maxFileMb * 1024 * 1024;
  const files = [];
  const sources = [...pending?.files ?? [], ...collectSessionFiles(session)];
  for (const item of sources.slice(-(MAX_INCOMING_FILES + (pending?.files.length ?? 0)))) {
    const loaded = await loadFileSource(item.src, item.name, maxBytes, INCOMING_IMAGE_TIMEOUT_MS);
    if (!loaded) {
      logger.debug(`[media] 文件读取失败或超出上限: ${item.name || item.src}`);
      continue;
    }
    try {
      const receiptId = await deps.client.uploadFile(sessionId, loaded.name, loaded.mediaType, loaded.buffer);
      files.push({ receiptId, name: loaded.name });
    } catch (error) {
      logger.warn(`[media] 文件上传失败: ${getErrorMessage(error)}`);
    }
  }
  return { images, files };
}
function bufferAttachments(deps, session) {
  if (session.userId && session.userId === session.selfId) return void 0;
  if (checkAccess(deps.config, session) !== null) return void 0;
  if (stripChatMarkup(session.content ?? "")) return void 0;
  const images = collectSessionImages(session);
  const files = collectSessionFiles(session);
  if (images.length === 0 && files.length === 0) return void 0;
  const key = sessionKey(session);
  const previous = deps.pending.get(key);
  const entry = previous && Date.now() - previous.at <= PENDING_TTL_MS ? previous : { images: [], files: [], at: 0 };
  entry.images = [...entry.images, ...images].slice(-PENDING_MAX_ITEMS);
  entry.files = [...entry.files, ...files].slice(-PENDING_MAX_ITEMS);
  entry.at = Date.now();
  deps.pending.set(key, entry);
  return { ...entry };
}
function takePendingAttachments(deps, session) {
  const key = sessionKey(session);
  const entry = deps.pending.get(key);
  deps.pending.delete(key);
  if (!entry || Date.now() - entry.at > PENDING_TTL_MS) return void 0;
  return entry;
}
async function handlePing(deps, session) {
  await deps.client.ensureReady();
  const info = deps.client.describe();
  const sessions = await deps.client.listSessions();
  const binding = bindingOf(deps, session);
  const bound = binding ? sessions.find((item) => item.sessionId === binding.sessionId) : void 0;
  const title = bound?.title || binding?.title || "未命名";
  const lines = [
    "连接正常",
    `方式：${info.mode}`,
    `地址：${info.baseUrl ?? "未知"}`,
    `会话：${sessions.length} 个`,
    `事件桥：${info.bridge ? "已连接" : "未连接"}`,
    `当前绑定：${binding ? `${title}（${binding.sessionId}）` : "无"}`
  ];
  if (!binding) return lines.join("\n");
  lines.push(`工作区：${bound?.cwd ?? "未知"}`);
  lines.push(`任务：${bound?.running ? "正在执行" : "空闲"}`);
  try {
    const snapshot = await deps.client.sessionSnapshot(binding.sessionId);
    const catalog = await deps.client.modelCatalog();
    const current = snapshot.model ?? catalog.defaultSelection;
    const option = current ? catalog.models.find((item) => item.provider === current.provider && item.model === current.model) : void 0;
    const modelText = current ? `${option?.name ?? current.model} · 思考 ${effortLabel(current.reasoningEffort)}` : "未知";
    lines.push(`模型：${modelText}`);
    lines.push(`权限：${presetLabel(snapshot.permission)}`);
  } catch (error) {
    logger.debug(`[ping] 读取会话状态失败: ${getErrorMessage(error)}`);
  }
  const pending = pendingSummary(deps, session);
  if (pending) lines.push(`暂存附件：${pending}`);
  return lines.join("\n");
}
function pendingSummary(deps, session) {
  const entry = deps.pending.get(sessionKey(session));
  if (!entry || Date.now() - entry.at > PENDING_TTL_MS) return void 0;
  const parts = [];
  if (entry.images.length > 0) parts.push(`${entry.images.length} 张图片`);
  if (entry.files.length > 0) parts.push(`${entry.files.length} 个文件`);
  return parts.length > 0 ? parts.join("、") : void 0;
}
async function handleSessions(deps, session, includeAll = false) {
  const all = await deps.client.listSessions({
    includeChildren: includeAll,
    includeBlank: includeAll
  });
  if (all.length === 0) {
    deps.listings.delete(sessionKey(session));
    return MESSAGES.noSessions;
  }
  const cap = includeAll ? all.length : deps.config.sessionLimit;
  const sessions = all.slice(0, cap);
  const binding = bindingOf(deps, session);
  const groups = /* @__PURE__ */ new Map();
  for (const item of sessions) {
    const group = item.cwd?.trim() || "默认工作区";
    const list = groups.get(group) ?? [];
    list.push(item);
    groups.set(group, list);
  }
  const ordered = [];
  const header = sessions.length < all.length ? `会话列表（显示 ${sessions.length} / 共 ${all.length} 个）` : `会话列表（共 ${sessions.length} 个）`;
  const lines = [header];
  for (const [group, items] of groups) {
    lines.push(`【${group}】`);
    for (const item of items) {
      ordered.push(item);
      const title = item.title ? truncate(item.title, 28) : "（未命名）";
      const flags = [
        item.running ? "运行中" : "",
        item.sessionId === binding?.sessionId ? "当前绑定" : "",
        item.parentSessionId ? "子会话" : ""
      ].filter(Boolean).join("，");
      lines.push(`${ordered.length}. ${title}${flags ? `（${flags}）` : ""}`);
    }
  }
  deps.listings.set(sessionKey(session), ordered);
  if (sessions.length < all.length) {
    lines.push(`按修改时间排序，只显示最近 ${sessions.length} 个；加 -a 查看全部。`);
  }
  lines.push("用 dsh.use 序号绑定。");
  return lines.join("\n");
}
function acceptedMessage(images, files) {
  const parts = [];
  if (images > 0) parts.push(`${images} 张图片`);
  if (files > 0) parts.push(`${files} 个文件`);
  if (parts.length === 0) return MESSAGES.promptAccepted;
  return `已提交到 DeepSeek Harness（含 ${parts.join("、")}），正在执行……`;
}
async function listWorkspaces(deps) {
  const sessions = await deps.client.listSessions();
  const map = /* @__PURE__ */ new Map();
  for (const item of sessions) {
    const cwd = item.cwd?.trim();
    if (!cwd) continue;
    const entry = map.get(cwd) ?? { cwd, count: 0, updatedAt: 0 };
    entry.count += 1;
    entry.updatedAt = Math.max(entry.updatedAt, item.updatedAt);
    map.set(cwd, entry);
  }
  return [...map.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}
function expandHome(path) {
  if (path === "~") return (0, import_node_os2.homedir)();
  if (path.startsWith("~/") || path.startsWith("~\\")) return (0, import_node_path4.join)((0, import_node_os2.homedir)(), path.slice(2));
  return path;
}
async function resolveWorkspace(deps, target) {
  const value = (target ?? "").trim();
  if (!value) return deps.config.defaultWorkspace || void 0;
  if (/^\d+$/.test(value)) {
    const list = await listWorkspaces(deps);
    return list[Number(value) - 1]?.cwd;
  }
  return expandHome(value);
}
async function handleNew(deps, session, target) {
  const cwd = await resolveWorkspace(deps, target);
  if (target?.trim() && !cwd) return MESSAGES.workspaceMissing(target.trim());
  const sessionId = await deps.client.createSession(cwd);
  rememberBinding(deps, session, sessionId, cwd ? `cwd: ${cwd}` : "");
  const applied = deps.config.defaultPermission;
  const lines = [`已创建会话（${shortSessionId(sessionId)}）`];
  if (cwd) lines.push(`工作区：${cwd}`);
  if (applied) lines.push(`权限：${presetLabel(applied)}`);
  return lines.join("\n");
}
async function handleWorkspaces(deps) {
  const list = await listWorkspaces(deps);
  if (list.length === 0) return MESSAGES.noWorkspace;
  const lines = ["已知工作区"];
  list.forEach((entry, index) => {
    const flag = entry.cwd === deps.config.defaultWorkspace ? "（默认）" : "";
    lines.push(`${index + 1}. ${entry.cwd}（${entry.count} 个会话）${flag}`);
  });
  lines.push("用 dsh.new 序号 在该工作区新建，或 dsh.new 加绝对路径。");
  return lines.join("\n");
}
async function handleUse(deps, session, target) {
  const value = target.trim();
  if (!value) return MESSAGES.sessionMissing;
  if (/^\d+$/.test(value)) {
    const listing = deps.listings.get(sessionKey(session));
    if (!listing) return MESSAGES.listFirst;
    const item = listing[Number(value) - 1];
    if (!item) return MESSAGES.indexOutOfRange(listing.length);
    rememberBinding(deps, session, item.sessionId, item.title);
    return `已绑定：${item.title || "未命名"}（${shortSessionId(item.sessionId)}）`;
  }
  const sessions = await deps.client.listSessions({ includeChildren: true, includeBlank: true });
  const matched = sessions.find((item) => item.sessionId === value) ?? sessions.find((item) => item.sessionId.startsWith(value));
  if (!matched) return MESSAGES.sessionMissing;
  rememberBinding(deps, session, matched.sessionId, matched.title);
  return `已绑定：${matched.title || "未命名"}（${shortSessionId(matched.sessionId)}）`;
}
async function handleRun(deps, session, text) {
  const input = stripChatMarkup(text);
  const pending = takePendingAttachments(deps, session);
  const hasAttachments = (session.elements ?? []).some((element) => {
    const type = element.type;
    return type === "img" || type === "image" || type === "file";
  });
  if (!input && !hasAttachments && !pending) return MESSAGES.emptyUsage;
  const key = sessionKey(session);
  if (deps.running.has(key)) return MESSAGES.busy;
  deps.running.add(key);
  try {
    let binding = bindingOf(deps, session);
    let created = false;
    if (!binding) {
      const sessionId = await deps.client.createSession(deps.config.defaultWorkspace || void 0);
      binding = rememberBinding(deps, session, sessionId, "");
      created = true;
    }
    const { images, files } = await loadIncomingAttachments(deps, session, binding.sessionId, pending);
    if (!input && images.length === 0 && files.length === 0) return MESSAGES.emptyUsage;
    const ack = acceptedMessage(images.length, files.length);
    await session.send(created ? `${MESSAGES.sessionCreated} ${ack}` : ack);
    try {
      const result = await deps.client.runTurn(binding.sessionId, input, images, files);
      const parts = [];
      const output = renderReply(deps.config, result.text);
      const chunks = output ? splitText(output, deps.config.chunkLength) : [];
      const wantForward = deps.config.mergeForward && FORWARD_PLATFORMS.includes(session.platform);
      const alwaysHandle = deps.config.splitLength === 0;
      const tooLong = output.length > 0 && (alwaysHandle || output.length > deps.config.splitLength);
      const longPath = tooLong && (wantForward || chunks.length > 1);
      if (longPath) await sendLongText(deps, session, chunks, wantForward);
      else if (output) parts.push(output);
      for (const image of result.images) parts.push(import_koishi3.h.image(image.buffer, image.type));
      if (result.skipped > 0) parts.push(MESSAGES.imagesSkipped(result.skipped));
      if (parts.length === 0) return longPath ? "" : MESSAGES.noContent;
      return parts;
    } catch (error) {
      if (error instanceof DshTurnTimeout) {
        const partial = renderReply(deps.config, error.partial);
        return partial ? `${partial}

${MESSAGES.promptTimedOut}` : MESSAGES.promptTimedOut;
      }
      throw error;
    }
  } finally {
    deps.running.delete(key);
  }
}
async function handleStop(deps, session) {
  const binding = bindingOf(deps, session);
  if (!binding) return MESSAGES.noBinding;
  await deps.client.cancel(binding.sessionId);
  return MESSAGES.stopRequested;
}
async function handlePermission(deps, session, preset) {
  const binding = bindingOf(deps, session);
  if (!binding) return MESSAGES.noPermissionBinding;
  const catalog = await deps.client.permissionPresets();
  const requested = (preset ?? "").trim();
  if (!requested) {
    const current = await deps.client.currentPermission(binding.sessionId);
    return [
      `当前权限：${presetLabel(current)}`,
      `可选：${catalog.map((value) => `${value}（${presetLabel(value)}）`).join("、")}`,
      "用 dsh.permission 加预设名切换。"
    ].join("\n");
  }
  if (catalog.length > 0 && !catalog.includes(requested)) {
    return MESSAGES.invalidPreset(requested, catalog.join("、"));
  }
  await deps.client.setPermission(binding.sessionId, requested);
  return MESSAGES.permissionChanged(presetLabel(requested));
}
function resolveModelOption(options, target) {
  const value = target.trim();
  if (/^\d+$/.test(value)) return options[Number(value) - 1];
  const lower = value.toLowerCase();
  return options.find((item) => item.model.toLowerCase() === lower) ?? options.find((item) => item.name.toLowerCase() === lower) ?? options.find((item) => item.model.toLowerCase().includes(lower));
}
function modelLabel(selection, options) {
  if (!selection) return "未知";
  const option = options.find((item) => item.provider === selection.provider && item.model === selection.model);
  return `${option?.name ?? selection.model}，思考 ${effortLabel(selection.reasoningEffort)}`;
}
async function handleModel(deps, session, target, effort) {
  const binding = bindingOf(deps, session);
  if (!binding) return MESSAGES.noModelBinding;
  const catalog = await deps.client.modelCatalog();
  const options = catalog.models;
  if (options.length === 0) return "DSH 没有返回可用的模型。";
  const current = await deps.client.modelSelection(binding.sessionId) ?? catalog.defaultSelection;
  if (!target?.trim()) {
    const lines = [`当前模型：${modelLabel(current, options)}`];
    options.forEach((option2, index) => {
      const isCurrent = current !== void 0 && option2.provider === current.provider && option2.model === current.model;
      const efforts = option2.efforts.map((item) => item.id).join("/");
      const suffix = [efforts, isCurrent ? "← 当前" : ""].filter(Boolean).join(" · ");
      lines.push(`${index + 1}. ${option2.name}（${option2.providerName}）${suffix ? ` ${suffix}` : ""}`);
    });
    lines.push("用 dsh.model 序号 [思考等级] 切换。");
    return lines.join("\n");
  }
  const option = resolveModelOption(options, target);
  if (!option) return MESSAGES.invalidModel(target.trim());
  const requestedEffort = (effort ?? "").trim();
  let nextEffort = requestedEffort || current?.reasoningEffort || option.defaultEffort;
  if (nextEffort && option.efforts.length > 0 && !option.efforts.some((item) => item.id === nextEffort)) {
    if (requestedEffort) {
      return MESSAGES.invalidEffort(requestedEffort, option.efforts.map((item) => item.id).join("、"));
    }
    nextEffort = option.defaultEffort ?? option.efforts[0]?.id;
  }
  await deps.client.selectModel(binding.sessionId, option.provider, option.model, nextEffort);
  return `已切换模型：${option.name}，思考 ${effortLabel(nextEffort)}`;
}
async function handleThink(deps, session, effort) {
  const binding = bindingOf(deps, session);
  if (!binding) return MESSAGES.noModelBinding;
  const catalog = await deps.client.modelCatalog();
  const options = catalog.models;
  const current = await deps.client.modelSelection(binding.sessionId) ?? catalog.defaultSelection;
  if (!current) return "DSH 没有返回当前模型，先发 dsh.model 查看列表。";
  const option = options.find((item) => item.provider === current.provider && item.model === current.model);
  const efforts = option?.efforts ?? [];
  if (efforts.length === 0) return MESSAGES.noEffortChoice;
  const value = (effort ?? "").trim();
  if (!value) {
    return [
      `当前思考等级：${effortLabel(current.reasoningEffort)}`,
      `可选：${efforts.map((item) => item.id).join("、")}`,
      "用 dsh.think 等级 切换。"
    ].join("\n");
  }
  if (!efforts.some((item) => item.id === value)) {
    return MESSAGES.invalidEffort(value, efforts.map((item) => item.id).join("、"));
  }
  await deps.client.selectModel(binding.sessionId, current.provider, current.model, value);
  return `已切换思考等级：${effortLabel(value)}`;
}
async function tempDir(deps) {
  return (0, import_node_path4.join)(deps.ctx.baseDir, "data", "koishi-plugin-dsh-connector", "files");
}
async function pruneTempFiles(dir) {
  try {
    const now = Date.now();
    for (const item of await (0, import_promises5.readdir)(dir)) {
      const full = (0, import_node_path4.join)(dir, item);
      try {
        const info = await (0, import_promises5.stat)(full);
        if (now - info.mtimeMs > TEMP_FILE_TTL_MS) await (0, import_promises5.unlink)(full);
      } catch {
      }
    }
  } catch {
  }
}
async function writeTempFile(deps, name2, buffer) {
  const dir = await tempDir(deps);
  await (0, import_promises5.mkdir)(dir, { recursive: true });
  await pruneTempFiles(dir);
  const file = (0, import_node_path4.join)(dir, `${Date.now()}-${sanitizeFileName(name2)}`);
  await (0, import_promises5.writeFile)(file, buffer);
  return file;
}
async function handleGet(deps, session, path) {
  const binding = bindingOf(deps, session);
  if (!binding) return MESSAGES.noBinding;
  const target = (path ?? "").trim();
  if (!target) return MESSAGES.getUsage;
  const maxBytes = deps.config.maxFileMb * 1024 * 1024;
  let file;
  try {
    file = await deps.client.readWorkspaceFile(binding.sessionId, target, maxBytes);
  } catch (error) {
    return `读取失败：${getErrorMessage(error)}`;
  }
  const tempPath = await writeTempFile(deps, file.name, file.buffer);
  return (0, import_koishi3.h)("file", { src: (0, import_node_url2.pathToFileURL)(tempPath).href, title: file.name });
}
async function handleHistory(deps, session, limit) {
  const binding = bindingOf(deps, session);
  if (!binding) return MESSAGES.noBinding;
  const count = limit && limit > 0 ? Math.min(limit, deps.config.historyLimit) : deps.config.historyLimit;
  const messages = await deps.client.history(binding.sessionId, count);
  if (messages.length === 0) return "这个会话还没有助手回复。";
  return messages.map((item, index) => `${index + 1}. ${truncate(renderReply(deps.config, item), 1200)}`).join("\n\n");
}
async function handleApproval(deps, session, decision) {
  const binding = bindingOf(deps, session);
  const answered = await deps.client.answerApproval(decision, binding?.sessionId);
  if (!answered) return MESSAGES.noPendingApproval;
  return decision === "allow" ? MESSAGES.approveSent : MESSAGES.denySent;
}

// external/dsh-connector/src/commands.ts
var HELP_TEXT = [
  "可用指令",
  "· dsh.ping：连接状态与当前绑定",
  "· dsh.sessions：会话列表，加 -a 显示全部",
  "· dsh.new [目录/序号]：新建并绑定会话",
  "· dsh.workspaces：列出已知工作区",
  "· dsh.use 序号：按序号或 ID 绑定",
  "· dsh.run 内容：交给 DSH 执行",
  "· dsh.stop：停止当前任务",
  "· dsh.history [条数]：回放最近回复",
  "· dsh.model [序号] [等级]：查看或切换模型",
  "· dsh.think [等级]：调整思考等级",
  "· dsh.get 路径：取回工作区文件",
  "· dsh.permission [预设]：查看或切换权限",
  "· dsh.approve / dsh.deny：处理授权",
  "· dsh.whoami：查看自己的标识"
].join("\n");
function registerCommands(deps, config) {
  const { ctx } = deps;
  const isBotSender = (session) => {
    if (session.userId && session.userId === session.selfId) return true;
    return ctx.bots.some((bot) => bot.platform === session.platform && bot.selfId === session.userId);
  };
  const action = (session, run, options) => {
    if (!session) return "";
    if (isBotSender(session)) return "";
    if (!options?.ignoreAccess) {
      const denied = checkAccess(config, session);
      if (denied) return denied;
    }
    return deps.store.load().then(() => run(session)).then((result) => typeof result === "string" ? renderReply(config, result) : result).catch((error) => {
      const message = getErrorMessage(error);
      logger.warn(`[command] 指令执行失败: ${message}`);
      return renderReply(config, `执行失败：${message}`);
    });
  };
  ctx.command("dsh", "DeepSeek Harness 控制").usage("按聊天窗口绑定 DSH 会话，把任务交给本机 DSH 执行。\n\n" + HELP_TEXT).action(({ session }) => action(session, () => Promise.resolve(HELP_TEXT)));
  ctx.command("dsh.ping", "检查 DSH 连接").alias("dsh状态").action(({ session }) => action(session, (session2) => handlePing(deps, session2)));
  ctx.command("dsh.sessions", "列出 DSH 会话").alias("dsh会话").option("all", "-a 包含子会话与空白会话").usage("按工作目录分组并编号，回复 dsh.use 加序号即可绑定。\n默认隐藏子代理会话与从未使用过的空会话。").example("dsh.sessions").example("dsh.sessions -a").action(({ session, options }) => action(session, (session2) => handleSessions(deps, session2, options?.all ?? false)));
  ctx.command("dsh.new [target:string]", "新建并绑定 DSH 会话").alias("dsh新建").usage(
    "参数可以是 dsh.workspaces 里的序号、绝对路径，或省略。\n省略时使用配置项 defaultWorkspace，未配置则用 DSH 默认目录。"
  ).example("dsh.new").example("dsh.new 2").example("dsh.new D:\\AI\\workspace").action(({ session }, target) => action(session, (session2) => handleNew(deps, session2, target ?? void 0)));
  ctx.command("dsh.workspaces", "列出已知工作区").alias("dsh工作区").usage("按现有会话的目录归纳，按最近使用排序；可直接把序号交给 dsh.new。").action(({ session }) => action(session, () => handleWorkspaces(deps)));
  ctx.command("dsh.model [target:string] [effort:string]", "查看或切换模型").alias("dsh模型").usage(
    "不带参数列出可用模型与当前选择。\n带序号或模型名切换，第二个参数可同时设置思考等级（off / low / high / max）。"
  ).example("dsh.model").example("dsh.model 2").example("dsh.model 2 max").action(
    ({ session }, target, effort) => action(session, (session2) => handleModel(deps, session2, target ?? void 0, effort ?? void 0))
  );
  ctx.command("dsh.think [effort:string]", "调整思考等级").alias("dsh思考").usage("只改思考等级，模型保持不变；不带参数查看当前等级与可选值。").example("dsh.think").example("dsh.think high").action(({ session }, effort) => action(session, (session2) => handleThink(deps, session2, effort ?? void 0)));
  ctx.command("dsh.get <path:string>", "取回工作区里的文件").alias("dsh取文件").usage("路径相对当前会话的工作区，例如 src/index.ts。单个文件受配置项 maxFileMb 限制。").example("dsh.get dist/report.md").action(({ session }, path) => action(session, (session2) => handleGet(deps, session2, path ?? void 0)));
  ctx.command("dsh.use <target:string>", "绑定已有 DSH 会话").alias("dsh切换").usage("参数可以是 dsh.sessions 里的序号，也可以是完整会话 ID 或能唯一匹配的前缀。").example("dsh.use 3").example("dsh.use session-2fb91522").action(({ session }, target) => action(session, (session2) => handleUse(deps, session2, target ?? "")));
  ctx.command("dsh.run <text:text>", "交给 DSH 执行并等待结果").alias("dsh运行").usage("内容和后面的所有文字一起提交给 DSH，消息附带的图片也会一并提交。\n未绑定会话时会自动新建一个。").example("dsh.run 列出当前目录下的文件").action(({ session }, text) => action(session, (session2) => handleRun(deps, session2, text ?? "")));
  ctx.command("dsh.stop", "停止当前任务").alias("dsh停止").action(({ session }) => action(session, (session2) => handleStop(deps, session2)));
  ctx.command("dsh.history [count:number]", "回放最近的助手回复").alias("dsh历史").usage("条数受配置项 historyLimit 约束。").example("dsh.history 3").action(({ session }, count) => action(session, (session2) => handleHistory(deps, session2, count)));
  ctx.command("dsh.permission [preset:string]", "查看或切换权限预设").alias("dsh权限").usage(
    "预设同时决定沙箱模式与审批策略：\nread-only 仅可查看、workspace-write 工作区可写、danger-full-access 完全权限、auto 自动审查。\n不带参数查看当前权限。"
  ).example("dsh.permission").example("dsh.permission read-only").action(
    ({ session }, preset) => action(session, (session2) => handlePermission(deps, session2, preset ?? void 0))
  );
  ctx.command("dsh.approve", "允许当前的授权请求").alias("dsh允许").action(({ session }) => action(session, (session2) => handleApproval(deps, session2, "allow")));
  ctx.command("dsh.deny", "拒绝当前的授权请求").alias("dsh拒绝").action(({ session }) => action(session, (session2) => handleApproval(deps, session2, "deny")));
  ctx.command("dsh.whoami", "查看自己的用户标识").alias("dsh我是谁").usage("未在名单中的用户也能用它查看标识，把标识填进配置项 allowUsers 即可放行。").action(
    ({ session }) => action(session, (session2) => Promise.resolve(handleWhoami(deps, session2)), { ignoreAccess: true })
  );
}

// external/dsh-connector/src/index.ts
var name = PLUGIN_NAME;
var usage = `
通过聊天平台控制同一台主机上运行的 DeepSeek Harness 会话。

| 指令 | 别名 | 说明 |
| :--- | :--- | :--- |
| \`dsh.ping\` | \`dsh状态\` | 连接状态与当前绑定 |
| \`dsh.sessions\` | \`dsh会话\` | 会话列表，加 \`-a\` 显示全部 |
| \`dsh.new [目录/序号]\` | \`dsh新建\` | 新建并绑定会话 |
| \`dsh.workspaces\` | \`dsh工作区\` | 列出已知工作区 |
| \`dsh.use 序号\` | \`dsh切换\` | 按序号或 ID 绑定 |
| \`dsh.run 内容\` | \`dsh运行\` | 交给 DSH 执行 |
| \`dsh.stop\` | \`dsh停止\` | 停止当前任务 |
| \`dsh.history [条数]\` | \`dsh历史\` | 回放最近回复 |
| \`dsh.model [序号] [等级]\` | \`dsh模型\` | 查看或切换模型与思考等级 |
| \`dsh.think [等级]\` | \`dsh思考\` | 只调整思考等级 |
| \`dsh.get 路径\` | \`dsh取文件\` | 取回工作区里的文件 |
| \`dsh.permission [预设]\` | \`dsh权限\` | 查看或切换权限预设 |
| \`dsh.approve\` / \`dsh.deny\` | \`dsh允许\` / \`dsh拒绝\` | 处理授权 |
| \`dsh.whoami\` | \`dsh我是谁\` | 查看自己的标识 |

**权限**：只认用户白名单，写 \`平台:用户ID\`（如 \`onebot:123456\`）。名单内用户在私聊和群聊都能用；白名单为空时所有指令都会被拒绝（\`dsh.whoami\` 除外，用于取自己的标识）。

**风险提示**：DSH 会话可执行本机命令、写入文件，被放行的用户等于拥有本机权限，请谨慎添加。
`;
function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const store = new BindingStore((0, import_node_path5.join)(ctx.baseDir, "data", "koishi-plugin-dsh-connector", "bindings.json"));
  const client = new DshClient(config);
  const listings = /* @__PURE__ */ new Map();
  const running = /* @__PURE__ */ new Set();
  const pending = /* @__PURE__ */ new Map();
  ctx.on("ready", async () => {
    await store.load();
    if (config.allowUsers.length === 0) {
      logger.warn("未配置用户白名单，所有指令都会被拒绝；用 dsh.whoami 取到标识后填入 allowUsers。");
    }
    try {
      await client.ensureReady();
      const info = client.describe();
      logger.info(`已连接 DSH (${info.mode}) ${info.baseUrl ?? ""}`);
    } catch (error) {
      logger.error("连接 DSH 失败，插件暂不可用。");
      logger.error(`原因: ${getErrorMessage(error)}`);
    }
  });
  client.setApprovalHandler((request2) => {
    const binding = request2.sessionId ? store.findBySession(request2.sessionId) : void 0;
    if (!binding) {
      logger.debug("[approval] 没有对应的聊天绑定，跳过推送");
      return;
    }
    const bot = ctx.bots.find((item) => item.platform === binding.platform && item.selfId === binding.selfId);
    if (!bot) {
      logger.warn("[approval] 找不到对应的机器人实例，无法推送授权请求。");
      return;
    }
    const content = [
      "请求授权",
      request2.tool ? `工具：${request2.tool}` : "",
      request2.reason ? `原因：${request2.reason}` : "",
      `会话：${binding.sessionId}`,
      "回复 dsh.approve 允许，dsh.deny 拒绝。"
    ].filter(Boolean).join("\n");
    bot.sendMessage(binding.channelId, content).catch((error) => {
      logger.warn(`[approval] 推送授权请求失败: ${getErrorMessage(error)}`);
    });
  });
  const deps = { ctx, config, client, store, listings, running, pending };
  ctx.middleware((session, next) => {
    const buffered = bufferAttachments(deps, session);
    if (buffered && buffered.files.length > 0) {
      const message = MESSAGES.attachmentsBuffered(buffered.images.length, buffered.files.length);
      session.send(message).catch((error) => {
        logger.debug(`[attachments] 暂存提示发送失败: ${getErrorMessage(error)}`);
      });
    }
    return next();
  }, true);
  registerCommands(deps, config);
  ctx.on("dispose", () => {
    client.dispose();
    store.dispose();
    listings.clear();
    running.clear();
    pending.clear();
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  name,
  normalizeConfig,
  usage
});
