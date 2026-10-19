import { Logger } from 'koishi';
export declare const logger: Logger;
/** 统一提取错误信息，不把异常对象直接抛给用户 */
export declare function getErrorMessage(error: unknown): string;
/** 可被 AbortSignal 打断的等待 */
export declare function sleep(ms: number, signal?: AbortSignal): Promise<void>;
/** 聊天平台单条消息长度有限，超长时截断并标记 */
export declare function truncate(text: string, max: number): string;
/** 把 IANA 时区名交给 DSH，非法值回退到 UTC */
export declare function normalizeTimeZone(value: string): string;
