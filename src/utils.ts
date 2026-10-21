import { Logger } from 'koishi'
import { LOGGER_NAME } from './constants'

export const logger = new Logger(LOGGER_NAME)

/** 统一调试日志：只有开启 debug 才输出，带 scope 便于过滤 */
export function debugLog(enabled: boolean, scope: string, message: string): void {
  if (enabled) logger.info(`[${scope}] ${message}`)
}

/** 统一提取错误信息，不把异常对象直接抛给用户 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** 可被 AbortSignal 打断的等待 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 聊天平台单条消息长度有限，超长时截断并标记 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/** 把 IANA 时区名交给 DSH，非法值回退到 UTC */
export function normalizeTimeZone(value: string): string {
  const candidate = value.trim()
  if (!candidate || candidate === 'UTC' || candidate.includes('/')) return candidate || 'UTC'
  return 'UTC'
}
