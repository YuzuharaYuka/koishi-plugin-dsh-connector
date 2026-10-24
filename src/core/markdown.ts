/**
 * Markdown → 纯文本。
 *
 * 解析交给 marked，排版自己控制：聊天平台需要的是一份「结构还在、语法消失」
 * 的输出，而 html-to-text 之类工具是给邮件/文档设计的，表格会被拆成多行、
 * 列表之间塞满空行，读起来反而更乱。
 *
 * 图片转换见 `document.ts`，两处共用同一份解析结果约定。
 */
import { marked, type Token, type Tokens } from 'marked'

/** 引用前缀、列表符号与分隔线，都用全角/制表字符，等宽环境下对齐 */
const QUOTE_PREFIX = '│'
const BULLET = '·'
const RULE = '————————'

/** 声明宽度按两个字符算的区间：CJK、假名、韩文、全角标点与常见 emoji */
function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/** 终端/聊天窗口里的显示宽度：后续表格按它补空格才对得齐 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0xfe0f) continue
    width += isWideCodePoint(code) ? 2 : 1
  }
  return width
}

function splitLines(text: string): string[] {
  return text.split('\n')
}

/** 段落之间只留一个空行，避免出现连续空白 */
function blank(lines: string[]): void {
  if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
}

function finish(lines: string[]): string {
  const trimmed = lines.map((line) => line.replace(/[ \t]+$/, ''))
  while (trimmed.length > 0 && trimmed[0] === '') trimmed.shift()
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop()
  return trimmed.join('\n')
}

/** 文本里的 HTML 实体还原成字符，否则 `&amp;` 会原样出现在聊天里 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
}

function padCell(text: string, width: number, align: string | null | undefined): string {
  const diff = width - displayWidth(text)
  if (diff <= 0) return text
  if (align === 'right') return ' '.repeat(diff) + text
  if (align === 'center') {
    const left = Math.floor(diff / 2)
    return ' '.repeat(left) + text + ' '.repeat(diff - left)
  }
  return text + ' '.repeat(diff)
}

function renderTable(table: Tokens.Table, out: string[]): void {
  const header = table.header.map((cell) => renderInline(cell.tokens).replace(/\n/g, ' ').trim())
  const rows = table.rows.map((row) => row.map((cell) => renderInline(cell.tokens).replace(/\n/g, ' ').trim()))
  const columns = Math.max(header.length, ...rows.map((row) => row.length), 1)
  const widths = Array.from({ length: columns }, (_, index) => {
    const cells = [header[index] ?? '', ...rows.map((row) => row[index] ?? '')]
    return Math.max(1, ...cells.map((cell) => displayWidth(cell)))
  })
  const align = table.align ?? []
  const format = (cells: string[]) =>
    cells
      .map((cell, index) => padCell(cell, widths[index], align[index]))
      .join(` ${QUOTE_PREFIX} `)
      .replace(/\s+$/, '')

  out.push(format(header))
  out.push(widths.map((width) => '─'.repeat(width)).join('─┼─'))
  for (const row of rows) out.push(format(row))
  blank(out)
}

function renderList(list: Tokens.List, indent: string, out: string[]): void {
  const start = list.ordered ? (typeof list.start === 'number' && list.start > 0 ? list.start : 1) : 0

  list.items.forEach((item, index) => {
    // 任务项用勾选框代替列表符号，避免 "· [x]" 这种重复前缀
    const marker = item.task ? '' : list.ordered ? `${start + index}. ` : `${BULLET} `
    const checkbox = item.task ? (item.checked ? '[x] ' : '[ ] ') : ''
    const body: string[] = []
    const nested: string[] = []

    for (const child of item.tokens as Token[]) {
      switch (child.type) {
        case 'text': {
          const text = child as Tokens.Text
          const inline = text.tokens && text.tokens.length > 0 ? renderInline(text.tokens) : decodeEntities(text.text)
          body.push(...splitLines(inline))
          break
        }
        case 'paragraph': {
          body.push(...splitLines(renderInline((child as Tokens.Paragraph).tokens)))
          break
        }
        case 'list':
          // 嵌套列表与上一级正文同列起排，而不是固定两格
          renderList(child as Tokens.List, indent + ' '.repeat(marker.length + checkbox.length), nested)
          break
        case 'code': {
          const pad = indent + ' '.repeat(marker.length + checkbox.length)
          for (const line of (child as Tokens.Code).text.split('\n')) nested.push(`${pad}${line}`)
          break
        }
        case 'space':
          break
        default: {
          const extra = renderBlocks([child], 1)
          while (extra.length > 0 && extra[extra.length - 1] === '') extra.pop()
          nested.push(...extra)
        }
      }
    }

    const first = body.length > 0 ? body[0] : ''
    out.push(`${indent}${marker}${checkbox}${first}`)
    // 续行按前缀宽度对齐，而不是简单两格
    const pad = ' '.repeat(indent.length + marker.length + checkbox.length)
    for (let line = 1; line < body.length; line++) out.push(`${pad}${body[line]}`)
    // 嵌套列表自带的尾部空行会让下一项隔开一段，这里去掉
    while (nested.length > 0 && nested[nested.length - 1] === '') nested.pop()
    out.push(...nested)
  })
  blank(out)
}

function renderBlocks(tokens: Token[], depth: number): string[] {
  const out: string[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        break
      case 'heading':
        out.push(renderInline((token as Tokens.Heading).tokens))
        blank(out)
        break
      case 'paragraph':
        out.push(...splitLines(renderInline((token as Tokens.Paragraph).tokens)))
        blank(out)
        break
      case 'text': {
        const text = token as Tokens.Text
        const inline = text.tokens && text.tokens.length > 0 ? renderInline(text.tokens) : decodeEntities(text.text)
        out.push(...splitLines(inline))
        if (depth === 0) blank(out)
        break
      }
      case 'code': {
        // 代码块去掉围栏但保留空行与缩进，方便直接复制
        out.push(...(token as Tokens.Code).text.split('\n'))
        blank(out)
        break
      }
      case 'blockquote': {
        const inner = renderBlocks((token as Tokens.Blockquote).tokens, depth + 1)
        while (inner.length > 0 && inner[inner.length - 1] === '') inner.pop()
        for (const line of inner) out.push(line ? `${QUOTE_PREFIX} ${line}` : QUOTE_PREFIX)
        blank(out)
        break
      }
      case 'list':
        renderList(token as Tokens.List, '', out)
        break
      case 'table':
        renderTable(token as Tokens.Table, out)
        break
      case 'hr':
        out.push(RULE)
        blank(out)
        break
      case 'html': {
        const text = stripHtml((token as Tokens.HTML).text).trim()
        if (text) {
          out.push(...splitLines(text))
          if (depth === 0) blank(out)
        }
        break
      }
      default:
        break
    }
  }

  return out
}

function renderInline(tokens: Token[] | undefined): string {
  if (!tokens || tokens.length === 0) return ''
  let out = ''

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text
        out += text.tokens && text.tokens.length > 0 ? renderInline(text.tokens) : decodeEntities(text.text)
        break
      }
      case 'escape':
        out += (token as Tokens.Escape).text
        break
      case 'strong':
        out += renderInline((token as Tokens.Strong).tokens)
        break
      case 'em':
        out += renderInline((token as Tokens.Em).tokens)
        break
      case 'del':
        out += renderInline((token as Tokens.Del).tokens)
        break
      case 'codespan':
        out += (token as Tokens.Codespan).text
        break
      case 'br':
        out += '\n'
        break
      case 'link': {
        const link = token as Tokens.Link
        const label = renderInline(link.tokens) || link.href || ''
        // 锚点与自己就是 URL 的链接不重复贴一遍地址
        const sameAsLabel = !link.href || link.href === label
        out += sameAsLabel || link.href.startsWith('#') ? label : `${label} (${link.href})`
        break
      }
      case 'image': {
        const image = token as Tokens.Image
        const alt = (image.text ?? '').trim()
        out += alt ? `[图片：${alt}]` : '[图片]'
        break
      }
      case 'html':
        out += stripHtml((token as Tokens.HTML).text)
        break
      case 'checkbox':
        break
      default: {
        const fallback = token as { text?: string }
        out += fallback.text ?? ''
      }
    }
  }

  return out
}

export function toPlainText(markdown: string): string {
  const source = markdown.replace(/\r\n?/g, '\n')
  if (!source.trim()) return ''

  let tokens: Token[]
  try {
    tokens = marked.lexer(source, { gfm: true })
  } catch {
    // 解析失败时原样返回，至少内容还在
    return source.trim()
  }
  return finish(renderBlocks(tokens, 0))
}

/**
 * 聊天平台会把元素序列化成 `<img .../>`、`<at .../>` 这类标签，提交给 DSH 前全部摘掉。
 * 只保留纯文本，避免机器人把平台内部的标记当成用户内容转发。
 */
export function stripChatMarkup(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').trim()
}
