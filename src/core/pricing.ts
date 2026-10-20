/**
 * 费用估算。
 *
 * DSH 只给出 token 用量，没有金额接口；这里按 DeepSeek 官方价目表换算：
 * 缓存命中输入、缓存未命中输入、输出三档，高峰时段价格是空闲时段的两倍。
 * 价格变动时改这张表即可。
 */

export interface TokenUsage {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ModelPrice {
  /** 缓存命中输入，元 / 百万 token，空闲时段 */
  inputHit: number
  /** 缓存未命中输入，元 / 百万 token，空闲时段 */
  inputMiss: number
  /** 输出，元 / 百万 token，空闲时段 */
  output: number
}

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'deepseek-flash': { inputHit: 0.02, inputMiss: 1, output: 4 },
  'deepseek-v4-pro': { inputHit: 0.15, inputMiss: 4.5, output: 13.5 },
}

export const EMPTY_USAGE: TokenUsage = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/**
 * 是否处于高峰时段（北京时间周一至周五 9:00-12:00、14:00-18:00）。
 * 法定节假日没有数据源，这里只按周末排除，估算结果可能略偏高。
 */
export function isPeakHour(date = new Date()): boolean {
  const beijing = new Date(date.getTime() + 8 * 3600_000)
  const day = beijing.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = beijing.getUTCHours() + beijing.getUTCMinutes() / 60
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** 两轮快照相减，得到本轮消耗 */
export function diffUsage(after: TokenUsage, before: TokenUsage): TokenUsage {
  return {
    uncachedInputTokens: Math.max(0, after.uncachedInputTokens - before.uncachedInputTokens),
    outputTokens: Math.max(0, after.outputTokens - before.outputTokens),
    cacheReadTokens: Math.max(0, after.cacheReadTokens - before.cacheReadTokens),
    cacheWriteTokens: Math.max(0, after.cacheWriteTokens - before.cacheWriteTokens),
  }
}

export function totalTokens(usage: TokenUsage): number {
  return (
    usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  )
}

/** 返回人民币金额；模型未知时返回 undefined */
export function estimateCost(usage: TokenUsage, model: string, at = new Date()): number | undefined {
  const price = DEFAULT_PRICES[model]
  if (!price) return undefined
  const factor = isPeakHour(at) ? 2 : 1
  const cost =
    usage.cacheReadTokens * price.inputHit +
    (usage.uncachedInputTokens + usage.cacheWriteTokens) * price.inputMiss +
    usage.outputTokens * price.output
  return (cost / 1_000_000) * factor
}

export function formatCost(value: number): string {
  if (value >= 1) return `¥${value.toFixed(2)}`
  if (value >= 0.01) return `¥${value.toFixed(3)}`
  return `¥${value.toFixed(4)}`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}
