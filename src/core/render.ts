/**
 * 用 Koishi 的 puppeteer 服务把 Markdown 渲染成图片。
 *
 * 不直接依赖 puppeteer：`koishi-plugin-puppeteer` 是可选的，没装时调用方回退纯文本。
 */
import type { Context } from 'koishi'
import type { Config } from '../config'
import { buildDocument } from './document'

/** 截图回调里用到的页面能力，只声明实际用到的部分 */
interface RenderPage {
  setViewport(options: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>
  evaluate<T>(callback: () => T): Promise<T>
  screenshot(options: { type: 'png'; fullPage?: boolean }): Promise<Uint8Array>
}

type RenderCallback = (page: RenderPage) => Promise<string>

interface PuppeteerService {
  render(content: string, callback?: RenderCallback): Promise<string>
}

/** 超过这个体积就回退文本：聊天端上传过大的图片容易失败 */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
/** 内容高度上限（CSS 像素），再高就回退文本 */
const MAX_IMAGE_HEIGHT = 12000
/** 截图密度：2 倍屏，QQ 里放大看仍然清晰 */
const DEVICE_SCALE_FACTOR = 2

export function puppeteerOf(ctx: Context): PuppeteerService | undefined {
  return (ctx as Context & { puppeteer?: PuppeteerService }).puppeteer
}

export async function renderMarkdownImage(
  ctx: Context,
  markdown: string,
  config: Config,
): Promise<Buffer | null> {
  const service = puppeteerOf(ctx)
  if (!service) return null

  const width = config.imageMaxWidth
  const html = buildDocument(markdown, { theme: config.imageTheme, maxWidth: width })

  const output = await service.render(html, async (page) => {
    await page.setViewport({ width, height: 900, deviceScaleFactor: DEVICE_SCALE_FACTOR })

    // 视口高度默认是 900，直接 fullPage 会让短回复底部拖着一大片背景，
    // 所以先量出 body 的真实高度，再把视口收到内容高度上截图。
    const height = await page.evaluate(() =>
      Math.ceil(document.body?.getBoundingClientRect().height ?? 0),
    )
    if (!Number.isFinite(height) || height <= 0) throw new Error('页面高度异常')
    if (height > MAX_IMAGE_HEIGHT) throw new Error(`内容过长（${height}px）`)

    await page.setViewport({
      width,
      height: Math.max(80, height + 2),
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    })
    const shot = await page.screenshot({ type: 'png' })
    return Buffer.from(shot).toString('base64')
  })

  const buffer = Buffer.from(String(output), 'base64')
  if (buffer.byteLength < 8 || buffer.byteLength > MAX_IMAGE_BYTES) return null
  return buffer
}
