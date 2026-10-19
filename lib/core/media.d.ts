import { Buffer } from 'node:buffer';
export interface TurnImage {
    buffer: Buffer;
    type: string;
}
export interface ExtractedContent {
    text: string;
    images: string[];
}
export declare function parseMarkdownImages(text: string): string[];
/** 从 `assistant/message` 事件里同时取出文本与图片引用 */
export declare function extractContent(event: unknown): ExtractedContent;
export declare function guessImageType(buffer: Buffer): string;
/**
 * 按文件头识别常见图片格式。
 *
 * 只认 png / jpeg / gif / webp；用于挡掉伪装成图片的任意文件，
 * 尤其是聊天消息里指向本机路径的「图片」。
 */
export declare function sniffImageType(buffer: Buffer): string | undefined;
/** 取回一张图片；只接受 data URI 与 http(s)，本地路径一律忽略 */
export declare function fetchImage(url: string, maxBytes: number, timeoutMs: number): Promise<TurnImage | null>;
/** `session/attachment` 返回的 base64 数据 */
export declare function decodeAttachment(data: string, mediaType: string): TurnImage | null;
/**
 * 读取聊天消息里的图片来源。
 *
 * 各适配器给的形态不一样：QQ 常是 http(s) 链接，本地适配器可能给 `file://` 或绝对路径。
 */
export declare function loadImageSource(source: string, maxBytes: number, timeoutMs: number): Promise<TurnImage | null>;
