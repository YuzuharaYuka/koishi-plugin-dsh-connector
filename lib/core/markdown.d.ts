/**
 * 把 Markdown 转成聊天平台可读的纯文本。
 *
 * QQ 等平台不渲染 Markdown，直接发送会把 `**`、`>`、表格分隔行原样显示出来。
 * 这里只做「去掉语法、保留结构」的确定性转换，不依赖任何渲染库。
 */
export declare function toPlainText(markdown: string): string;
/**
 * 聊天平台会把元素序列化成 `<img .../>`、`<at .../>` 这类标签，提交给 DSH 前全部摘掉。
 * 只保留纯文本，避免机器人把平台内部的标记当成用户内容转发。
 */
export declare function stripChatMarkup(text: string): string;
