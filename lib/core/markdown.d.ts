/** 终端/聊天窗口里的显示宽度：后续表格按它补空格才对得齐 */
export declare function displayWidth(text: string): number;
export declare function toPlainText(markdown: string): string;
/**
 * 聊天平台会把元素序列化成 `<img .../>`、`<at .../>` 这类标签，提交给 DSH 前全部摘掉。
 * 只保留纯文本，避免机器人把平台内部的标记当成用户内容转发。
 */
export declare function stripChatMarkup(text: string): string;
