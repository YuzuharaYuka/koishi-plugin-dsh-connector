/**
 * 费用估算。
 *
 * DSH 只给出 token 用量，没有金额接口；这里按 DeepSeek 官方价目表换算：
 * 缓存命中输入、缓存未命中输入、输出三档，高峰时段价格是空闲时段的两倍。
 * 价格变动时改这张表即可。
 */
export interface TokenUsage {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
export interface ModelPrice {
    /** 缓存命中输入，元 / 百万 token，空闲时段 */
    inputHit: number;
    /** 缓存未命中输入，元 / 百万 token，空闲时段 */
    inputMiss: number;
    /** 输出，元 / 百万 token，空闲时段 */
    output: number;
}
export declare const DEFAULT_PRICES: Record<string, ModelPrice>;
export declare const EMPTY_USAGE: TokenUsage;
/**
 * 是否处于高峰时段（北京时间周一至周五 9:00-12:00、14:00-18:00）。
 * 法定节假日没有数据源，这里只按周末排除，估算结果可能略偏高。
 */
export declare function isPeakHour(date?: Date): boolean;
/** 两轮快照相减，得到本轮消耗 */
export declare function diffUsage(after: TokenUsage, before: TokenUsage): TokenUsage;
export declare function totalTokens(usage: TokenUsage): number;
/** 返回人民币金额；模型未知时返回 undefined */
export declare function estimateCost(usage: TokenUsage, model: string, at?: Date): number | undefined;
export declare function formatCost(value: number): string;
export declare function formatNumber(value: number): string;
