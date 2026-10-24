/**
 * Markdown → 自包含 HTML，用来截图。
 *
 * 颜色、字号与间距对齐 DSH 自己的 Markdown 样式（`_markdown_1ypvv_5` 那套规则），
 * 让聊天里收到的图片和 Web 界面看到的是同一个东西。只依赖系统字体，不引外链。
 */
import katex from 'katex'
import { Marked, type MarkedOptions, type TokenizerAndRendererExtension } from 'marked'

export type ImageTheme = 'dark' | 'light'

interface Palette {
  background: string
  text: string
  muted: string
  borderWeak: string
  border: string
  borderStrong: string
  codeBackground: string
  codeBanner: string
  inlineCode: string
  link: string
  quote: string
}

const PALETTES: Record<ImageTheme, Palette> = {
  dark: {
    background: '#151517',
    text: '#f9fafb',
    muted: '#adb2b8',
    borderWeak: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.12)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    codeBackground: '#1b1b1c',
    codeBanner: '#2c2c2e',
    inlineCode: '#292929',
    link: '#7aaaff',
    quote: '#adb2b8',
  },
  light: {
    background: '#ffffff',
    text: '#0f1115',
    muted: '#81858c',
    borderWeak: 'rgba(0, 0, 0, 0.04)',
    border: 'rgba(0, 0, 0, 0.1)',
    borderStrong: 'rgba(0, 0, 0, 0.12)',
    codeBackground: '#f9fafb',
    codeBanner: '#f2f3f5',
    inlineCode: '#f5f5f6',
    link: '#4176e6',
    quote: '#81858c',
  },
}

const SANS_FONT = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"Helvetica Neue"',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(', ')

const MONO_FONT = [
  '"SF Mono"',
  '"JetBrains Mono"',
  '"Fira Code"',
  'Consolas',
  '"Liberation Mono"',
  'Menlo',
  'Courier',
  '"PingFang SC"',
  '"Microsoft YaHei"',
  'monospace',
].join(', ')

export interface DocumentOptions {
  theme: ImageTheme
  /** 正文最大宽度（CSS 像素），截图时同时作为视口宽度 */
  maxWidth: number
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 公式交给 KaTeX 转成 MathML：不依赖 KaTeX 的 CSS 和字体文件，
 * Chrome 原生就能排版，截图不会缺字。解析失败时退回原文。
 */
function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      output: 'mathml',
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    })
  } catch {
    return `<code>${escapeHtml(displayMode ? `$$${tex}$$` : `$${tex}$`)}</code>`
  }
}

const mathBlock: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start(src) {
    const index = src.search(/\$\$/)
    return index < 0 ? undefined : index
  },
  tokenizer(src) {
    const match = /^\$\$[ \t]*\n?([\s\S]+?)\n?\$\$[ \t]*(?:\n+|$)/.exec(src)
    if (!match) return undefined
    return { type: 'mathBlock', raw: match[0], text: match[1].trim() }
  },
  renderer(token) {
    return `<div class="math-block">${renderMath(String(token.text), true)}</div>`
  },
}

const mathInline: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start(src) {
    const index = src.search(/\$(?!\$)/)
    return index < 0 ? undefined : index
  },
  tokenizer(src) {
    const block = /^\$\$([^\n$]+?)\$\$/.exec(src)
    if (block) return { type: 'mathInline', raw: block[0], text: block[1].trim() }
    const match = /^\$([^\n$]+)\$/.exec(src)
    if (!match) return undefined
    const text = match[1]
    // 货币符号或前后带空白的片段不当公式，避免把普通文本吃掉
    if (!text.trim() || /^\s|\s$/.test(text)) return undefined
    return { type: 'mathInline', raw: match[0], text }
  },
  renderer(token) {
    return `<span class="math-inline">${renderMath(String(token.text), false)}</span>`
  },
}

/**
 * 截图前把不该进渲染流程的东西摘掉：
 * 脚本、内嵌样式、事件属性、iframe 一类会加载外部资源的标签。
 */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|object|embed|link|meta|base)\b[\s\S]*?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
}

/** 远程图片会把截图拖进网络等待，换成占位符；内联的 data URL 保留 */
function replaceRemoteImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    /src\s*=\s*["']data:image\//i.test(tag) ? tag : '<span class="media-placeholder">[图片]</span>',
  )
}

/** marked 输出的代码块没有 DSH 那种顶部横幅，这里补一层容器 */
function decorateCodeBlocks(html: string): string {
  return html
    .replace(/<pre><code([^>]*)>/g, (_match, attrs: string) => {
      const lang = /class="language-([^"]+)"/.exec(attrs)?.[1] ?? ''
      const label = lang ? escapeHtml(lang) : '代码'
      return `<div class="code-block"><div class="code-banner"><span>${label}</span></div><pre><code${attrs}>`
    })
    .replace(/<\/code><\/pre>/g, '</code></pre></div>')
}

/** 任务列表项自带勾选框，再挂一个列表符号就重复了 */
function decorateTaskItems(html: string): string {
  return html.replace(/<li>(?=<input[^>]*type="checkbox")/g, '<li class="task-list-item">')
}

/** 只给本插件用的解析器：全局 marked 可能被别的插件改过规则 */
const parser = new Marked()
parser.use({ extensions: [mathBlock, mathInline] })

function renderMarkdown(markdown: string): string {
  const source = markdown.replace(/\r\n?/g, '\n').trim()
  if (!source) return ''

  const options: MarkedOptions = { gfm: true, breaks: false, async: false }
  let html: string
  try {
    html = parser.parse(source, options) as string
  } catch {
    html = `<p>${escapeHtml(source)}</p>`
  }
  return decorateTaskItems(decorateCodeBlocks(replaceRemoteImages(sanitize(html))))
}

function styles(palette: Palette): string {
  return `
:root { color-scheme: ${palette.background === '#151517' ? 'dark' : 'light'}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: ${palette.background}; }
body {
  width: 100%;
  padding: 20px 24px 22px;
  color: ${palette.text};
  font-family: ${SANS_FONT};
  font-size: 14px;
  line-height: 24px;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: anywhere;
}
.markdown > :first-child { margin-top: 0 !important; }
.markdown > :last-child { margin-bottom: 0 !important; }
.markdown p { margin: 16px 0; }
.markdown h1, .markdown h2, .markdown h3 { font-weight: 600; }
.markdown h1 { font-size: 21px; line-height: 30px; margin: 32px 0 16px; }
.markdown h2 { font-size: 19px; line-height: 28px; margin: 32px 0 16px; }
.markdown h3 { font-size: 18px; line-height: 27px; margin: 32px 0 16px; }
.markdown h4, .markdown h5, .markdown h6 { font-size: 14px; font-weight: 600; margin: 32px 0 16px; }
.markdown strong { font-weight: 600; }
.markdown em { font-style: italic; }
.markdown del { text-decoration: line-through; color: ${palette.muted}; }
.markdown a { color: ${palette.link}; font-weight: 500; text-decoration: none; }
.markdown ul, .markdown ol { margin: 16px 0; padding-left: 18px; }
.markdown li:not(:first-child) { margin-top: 6px; }
.markdown li > ul, .markdown li > ol { margin: 6px 0; }
.markdown li.task-list-item { list-style: none; }
.markdown li::marker { color: ${palette.muted}; }
.markdown blockquote {
  margin: 16px 0;
  padding-left: 14px;
  border-left: 2px solid ${palette.quote};
  color: ${palette.muted};
}
.markdown blockquote p { margin: 8px 0; }
.markdown hr {
  border: none;
  height: 1px;
  margin: 32px 0;
  background: ${palette.border};
}
.markdown code { font-family: ${MONO_FONT}; }
.markdown :not(pre) > code {
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid ${palette.borderWeak};
  background: ${palette.inlineCode};
  font-size: 12.5px;
}
.markdown pre {
  margin: 16px 0;
  padding: 12px 16px;
  border-radius: 12px;
  background: ${palette.codeBackground};
  overflow-x: auto;
}
.markdown pre code {
  display: block;
  font-size: 13px;
  line-height: 21px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.markdown .code-block {
  margin: 16px 0;
  border-radius: 12px;
  border: 1px solid ${palette.borderWeak};
  background: ${palette.codeBackground};
  overflow: hidden;
}
.markdown .code-block pre { margin: 0; border-radius: 0; background: transparent; }
.markdown .code-banner {
  display: flex;
  align-items: center;
  padding: 6px 14px;
  background: ${palette.codeBanner};
  color: ${palette.muted};
  font-family: ${MONO_FONT};
  font-size: 12px;
  line-height: 18px;
}
.markdown table {
  max-width: 100%;
  margin: 16px 0;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 13.5px;
  line-height: 22px;
}
.markdown th {
  padding: 10px 16px;
  border-bottom: 1px solid ${palette.borderStrong};
  font-weight: 600;
  text-align: start;
}
.markdown td {
  padding: 10px 16px;
  border-bottom: 1px solid ${palette.border};
  text-align: start;
  vertical-align: top;
}
.markdown th:first-child, .markdown td:first-child { padding-left: 0; }
.markdown th:last-child, .markdown td:last-child { padding-right: 0; }
.markdown img { display: block; max-width: 100%; border-radius: 8px; }
.markdown .media-placeholder { color: ${palette.muted}; }
.markdown .math-block { margin: 16px 0; text-align: center; overflow-x: auto; overflow-y: hidden; }
.markdown .math-block math { margin: 0 auto; }
.markdown .math-inline math { vertical-align: -0.15em; }
.markdown input[type='checkbox'] { margin: 0 8px 0 0; vertical-align: -1px; }
`
}

export function buildDocument(markdown: string, options: DocumentOptions): string {
  const palette = PALETTES[options.theme] ?? PALETTES.dark
  const body = renderMarkdown(markdown)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${styles(palette)}</style>
</head>
<body style="max-width: ${Math.max(320, options.maxWidth)}px">
<main class="markdown">${body}</main>
</body>
</html>`
}
