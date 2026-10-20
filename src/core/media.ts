import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_ATTACHMENT_PREFIX, MARKDOWN_IMAGE_RE } from '../constants'

export interface TurnImage {
  buffer: Buffer
  type: string
}

/** 聊天里收到的文件，按原样交给 DSH */
export interface IncomingFile {
  buffer: Buffer
  name: string
  mediaType: string
}

export interface ExtractedContent {
  text: string
  images: string[]
}

/** 图片块里可能承载地址的字段名，命中即把其值当作图片候选 */
const IMAGE_KEY_HINTS = new Set([
  'url',
  'uri',
  'src',
  'source',
  'image',
  'image_url',
  'attachment',
  'attachments',
])

function pushUnique(list: string[], value: string): void {
  const normalized = value.trim().replace(/^<|>$/g, '')
  if (normalized && !list.includes(normalized)) list.push(normalized)
}

function looksLikeImageRef(value: string): boolean {
  return /^data:image\//i.test(value) || /^https?:\/\//i.test(value)
}

/**
 * 递归收集图片引用。
 *
 * DSH 的内容块是可扩展的，图片既可能是 `{ type: 'image', attachmentId }`，
 * 也可能是嵌在别的字段里的 URL，因此按字段名与取值形态双重判断。
 */
function collectImages(value: unknown, images: string[], hint: boolean): void {
  if (typeof value === 'string') {
    if (hint || looksLikeImageRef(value)) pushUnique(images, value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImages(item, images, hint)
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const attachmentId = record.attachmentId
  if (typeof attachmentId === 'string' && attachmentId.trim()) {
    pushUnique(images, `${DSH_ATTACHMENT_PREFIX}${attachmentId.trim()}`)
    return
  }
  for (const [key, item] of Object.entries(record)) {
    if (key === 'type') continue
    collectImages(item, images, hint || IMAGE_KEY_HINTS.has(key.toLowerCase()))
  }
}

export function parseMarkdownImages(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const url = match[1]
    if (url) pushUnique(found, url)
  }
  return found
}

/** 从 `assistant/message` 事件里同时取出文本与图片引用 */
export function extractContent(event: unknown): ExtractedContent {
  if (!event || typeof event !== 'object') return { text: '', images: [] }
  const data = ((event as Record<string, unknown>).data ?? {}) as Record<string, unknown>
  const message = (data.message ?? {}) as Record<string, unknown>
  const raw = message.content ?? data.content ?? []
  const blocks = Array.isArray(raw) ? raw : [raw]

  const texts: string[] = []
  const images: string[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if ((item.type === 'text' || item.type === 'markdown') && typeof item.text === 'string') {
      texts.push(item.text)
      for (const url of parseMarkdownImages(item.text)) pushUnique(images, url)
      continue
    }
    const imageBlock = item.type === 'image' || item.type === 'image_url' || item.type === 'attachment'
    collectImages(item, images, imageBlock)
  }

  const text = texts.join('')
  for (const url of parseMarkdownImages(text)) pushUnique(images, url)
  return { text, images }
}

export function guessImageType(buffer: Buffer): string {
  return sniffImageType(buffer) ?? 'image/png'
}

/**
 * 按文件头识别常见图片格式。
 *
 * 只认 png / jpeg / gif / webp；用于挡掉伪装成图片的任意文件，
 * 尤其是聊天消息里指向本机路径的「图片」。
 */
export function sniffImageType(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('ascii')
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  }
  if (buffer.length >= 12) {
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
      return 'image/webp'
    }
  }
  return undefined
}

/** 取回一张图片；只接受 data URI 与 http(s)，本地路径一律忽略 */
export async function fetchImage(url: string, maxBytes: number, timeoutMs: number): Promise<TurnImage | null> {
  const dataUri = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url)
  if (dataUri) {
    const buffer = Buffer.from(dataUri[2], 'base64')
    if (buffer.length === 0 || buffer.length > maxBytes) return null
    return { buffer, type: sniffImageType(buffer) ?? dataUri[1].toLowerCase() }
  }
  if (!/^https?:\/\//i.test(url)) return null

  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null

    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > maxBytes) return null

    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (type && !type.startsWith('image/')) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > maxBytes) return null
    // 以文件头为准：Content-Type 可能说谎，SVG 之类交给调用方按类型过滤
    const sniffed = sniffImageType(buffer)
    if (!sniffed && type !== 'image/svg+xml') return null
    return { buffer, type: sniffed ?? type }
  } catch {
    return null
  }
}

/** `session/attachment` 返回的 base64 数据 */
export function decodeAttachment(data: string, mediaType: string): TurnImage | null {
  if (!data) return null
  if (mediaType && !mediaType.toLowerCase().startsWith('image/')) return null
  const buffer = Buffer.from(data, 'base64')
  if (buffer.length === 0) return null
  return { buffer, type: mediaType ? mediaType.toLowerCase() : guessImageType(buffer) }
}

/**
 * 读取聊天消息里的图片来源。
 *
 * 各适配器给的形态不一样：QQ 常是 http(s) 链接，本地适配器可能给 `file://` 或绝对路径。
 */
export async function loadImageSource(source: string, maxBytes: number, timeoutMs: number): Promise<TurnImage | null> {
  const value = source.trim()
  if (!value) return null
  if (/^data:/i.test(value) || /^https?:\/\//i.test(value)) {
    return fetchImage(value, maxBytes, timeoutMs)
  }

  let filePath = value
  if (/^file:\/\//i.test(value)) {
    try {
      filePath = fileURLToPath(value)
    } catch {
      return null
    }
  }
  if (!isAbsolute(filePath)) return null

  try {
    const buffer = await readFile(filePath)
    if (buffer.length === 0 || buffer.length > maxBytes) return null
    // 聊天消息可能带着任意本地路径，只有真的像图片才读出来
    const type = sniffImageType(buffer)
    return type ? { buffer, type } : null
  } catch {
    return null
  }
}

const MEDIA_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.log': 'text/plain',
  '.js': 'text/javascript',
  '.ts': 'text/plain',
  '.py': 'text/x-python',
  '.zip': 'application/zip',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** 文件名去掉路径与危险字符，避免写盘时逃出目标目录 */
export function sanitizeFileName(name: string): string {
  const leaf = name.split(/[\\/]/).filter(Boolean).pop() ?? 'file'
  const cleaned = leaf.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim()
  return cleaned.slice(0, 80) || 'file'
}

function guessMediaType(buffer: Buffer, name: string): string {
  const sniffed = sniffImageType(buffer)
  if (sniffed) return sniffed
  const ext = extname(name).toLowerCase()
  return MEDIA_TYPES[ext] ?? 'application/octet-stream'
}

/** 读取聊天里文件元素指向的内容：支持 data URI、http(s) 与本地绝对路径 */
export async function loadFileSource(
  source: string,
  name: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<IncomingFile | null> {
  const value = source.trim()
  if (!value) return null

  let buffer: Buffer | undefined
  if (/^data:/i.test(value)) {
    const match = /^data:([^;,]*);base64,(.*)$/is.exec(value)
    if (!match) return null
    buffer = Buffer.from(match[2], 'base64')
  } else if (/^https?:\/\//i.test(value)) {
    try {
      const response = await fetch(value, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) return null
      const declared = Number(response.headers.get('content-length') ?? '0')
      if (Number.isFinite(declared) && declared > maxBytes) return null
      buffer = Buffer.from(await response.arrayBuffer())
    } catch {
      return null
    }
  } else {
    let filePath = value
    if (/^file:\/\//i.test(value)) {
      try {
        filePath = fileURLToPath(value)
      } catch {
        return null
      }
    }
    if (!isAbsolute(filePath)) return null
    try {
      buffer = await readFile(filePath)
    } catch {
      return null
    }
  }

  if (!buffer || buffer.length === 0 || buffer.length > maxBytes) return null
  const safeName = sanitizeFileName(name || 'file')
  return { buffer, name: safeName, mediaType: guessMediaType(buffer, safeName) }
}
