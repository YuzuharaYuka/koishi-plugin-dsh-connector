/**
 * 把 Markdown 转成聊天平台可读的纯文本。
 *
 * QQ 等平台不渲染 Markdown，直接发送会把 `**`、`>`、表格分隔行原样显示出来。
 * 这里只做「去掉语法、保留结构」的确定性转换，不依赖任何渲染库。
 */

const FENCE_RE = /^\s*(```|~~~)/
const TABLE_SEPARATOR_RE = /^[\s:|-]+$/

function isTableLine(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().length > 1
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  return TABLE_SEPARATOR_RE.test(trimmed) && trimmed.includes('-')
}

function renderTable(block: string[]): string[] {
  const rows = block
    .filter((line) => !isTableSeparator(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.some((cell) => cell !== ''))
  if (rows.length === 0) return []
  const width = Math.max(...rows.map((row) => row.length))
  return rows.map((cells) => [...cells, ...Array(width - cells.length).fill('')].join(' │ '))
}

function renderInline(text: string): string {
  return text
    // 图片已单独发送，正文里只留一个标记
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => (alt ? `[${alt}]` : '[图片]'))
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s[^)]*)?\)/g, (_match, label: string, url: string) =>
      label === url ? url : `${label} (${url})`,
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/<[^>]+>/g, '')
}

function renderLine(line: string): string {
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return '————'

  let text = line
  const heading = /^\s*#{1,6}\s+(.*)$/.exec(text)
  if (heading) text = heading[1]

  const quote = /^\s*>\s?(.*)$/.exec(text)
  if (quote) text = `│ ${quote[1]}`

  const list = /^(\s*)[-*+]\s+(.*)$/.exec(text)
  if (list) text = `${list[1]}· ${list[2]}`

  return renderInline(text)
}

export function toPlainText(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let fence: string | null = null

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    const match = FENCE_RE.exec(line)
    if (match) {
      if (fence === null) fence = match[1]
      else if (line.trim().startsWith(fence)) fence = null
      continue
    }
    // 代码块内容原样保留，避免把代码里的 * 和 # 当成语法
    if (fence !== null) {
      output.push(line)
      continue
    }

    if (isTableLine(line)) {
      const block: string[] = []
      while (index < lines.length && isTableLine(lines[index])) {
        block.push(lines[index])
        index++
      }
      index--
      output.push(...renderTable(block))
      continue
    }

    output.push(renderLine(line))
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 聊天平台会把元素序列化成 `<img .../>`、`<at .../>` 这类标签，提交给 DSH 前全部摘掉。
 * 只保留纯文本，避免机器人把平台内部的标记当成用户内容转发。
 */
export function stripChatMarkup(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').trim()
}
