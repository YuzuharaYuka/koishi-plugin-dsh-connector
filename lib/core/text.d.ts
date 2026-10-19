/**
 * 按长度切分长回复。
 *
 * 优先在换行处断开，其次在中文句号处，最后才硬切；切片本身不带 Markdown，
 * 调用方按配置决定逐条发送还是合并转发。
 */
export declare function splitText(text: string, limit: number): string[];
