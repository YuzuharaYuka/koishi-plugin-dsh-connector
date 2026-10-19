/**
 * 按长度切分长回复。
 *
 * 优先在换行处断开，其次在中文句号处，最后才硬切；切片本身不带 Markdown，
 * 调用方按配置决定逐条发送还是合并转发。
 */
export function splitText(text: string, limit: number): string[] {
  const content = text.trim()
  if (!content) return []
  if (limit <= 0 || content.length <= limit) return [content]

  const chunks: string[] = []
  let rest = content
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < limit / 2) cut = rest.lastIndexOf('。', limit)
    if (cut < limit / 2) cut = rest.lastIndexOf('，', limit)
    if (cut < limit / 2) cut = limit
    const chunk = rest.slice(0, cut + 1).trim()
    if (chunk) chunks.push(chunk)
    rest = rest.slice(cut + 1).trimStart()
  }
  if (rest) chunks.push(rest)
  return chunks
}
