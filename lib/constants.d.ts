export declare const PLUGIN_NAME = "koishi-plugin-dsh-connector";
export declare const LOGGER_NAME = "dsh-connector";
/** Markdown 图片语法，DSH 的文本回复里经常夹带图片链接 */
export declare const MARKDOWN_IMAGE_RE: RegExp;
/** 附件引用的内部前缀，解析时再换成真实数据 */
export declare const DSH_ATTACHMENT_PREFIX = "dsh-attachment:";
/** DSH 持久化的凭据文件名 */
export declare const DSH_CREDENTIALS_FILE = ".credentials.yaml";
/** 浏览器会话签名密钥在凭据文件中的记录名 */
export declare const DSH_BROWSER_SESSION_RECORD = "client-connection/browser-session";
/** DSH 签名 cookie 的名称前缀、版本与有效期 */
export declare const DSH_AUTH_COOKIE_PREFIX = "dsh-auth-";
export declare const DSH_AUTH_COOKIE_VERSION = 1;
export declare const DSH_AUTH_COOKIE_TTL_MS: number;
/** 未认证访问 DSH 首页时返回的指纹文本，用于端口发现 */
export declare const DSH_AUTH_MARK = "dsh web authentication required";
export declare const DSH_BOOT_MARK = "__DSH_BOOT__";
/** relay 下发的访问 cookie 名 */
export declare const RELAY_ACCESS_COOKIE = "dsh-relay-access";
/** relay 的免密入口，带 key 换取访问 cookie */
export declare const RELAY_LOGIN_PATH = "/?key=";
export declare const DISCOVER_PROBE_TIMEOUT_MS = 900;
export declare const DISCOVER_MAX_CANDIDATES = 300;
export declare const DISCOVER_CONCURRENCY = 24;
/** 支持合并转发的平台；其它平台一律降级为分段发送 */
export declare const FORWARD_PLATFORMS: string[];
/** DSH 权限预设的中文名 */
export declare const PRESET_LABELS: Record<string, string>;
/** DSH 公开的权限预设；新建会话的默认值只能从这里取 */
export declare const PERMISSION_PRESETS: string[];
export declare function presetLabel(value: string | undefined): string;
/**
 * 面向用户的文案。
 *
 * 聊天平台不渲染 Markdown，也不要把内容写成 `<...>`：Koishi 会把尖括号当消息元素
 * 解析并吞掉，用户只能看到残缺的提示。
 */
export declare const MESSAGES: {
    readonly noWhitelist: "插件还没配置允许的用户，请联系管理员。";
    readonly denied: (uid: string) => string;
    readonly notReady: "还没连上 DeepSeek Harness。请确认 DSH 已启动，或发 dsh.ping 查看具体原因。";
    readonly noBinding: "当前聊天还没有绑定 DSH 会话。发 dsh.new 新建一个，或发 dsh.use 加序号绑定已有会话。";
    readonly noPendingApproval: "当前没有等待处理的授权请求。";
    readonly promptAccepted: "已提交到 DeepSeek Harness，正在执行……";
    readonly busy: "这个聊天还有任务在执行，等它结束或先发 dsh.stop。";
    readonly promptAcceptedImages: (count: number) => string;
    readonly promptTimedOut: "等待超时，任务可能仍在 DSH 中执行。稍后可用 dsh.history 查看结果。";
    readonly stopRequested: "已请求停止当前任务。";
    readonly sessionCreated: "已创建并绑定新的 DSH 会话。";
    readonly sessionMissing: "没有找到匹配的 DSH 会话，发 dsh.sessions 查看可用列表。";
    readonly noSessions: "还没有会话，发 dsh.new 新建一个。";
    readonly listFirst: "先发 dsh.sessions 查看列表，再用 dsh.use 加序号绑定。";
    readonly indexOutOfRange: (count: number) => string;
    readonly noPermissionBinding: "先绑定一个 DSH 会话，再查看或切换权限。";
    readonly invalidPreset: (value: string, valid: string) => string;
    readonly permissionChanged: (label: string) => string;
    readonly approveSent: "已允许该授权请求。";
    readonly denySent: "已拒绝该授权请求。";
    readonly emptyUsage: "请提供要交给 DSH 的内容，例如：dsh.run 列出当前目录的文件";
    readonly noContent: "已完成这一轮，但没有返回可发送的内容。";
    readonly imagesSkipped: (count: number) => string;
};
/** 端口发现失败时的可执行指引 */
export declare const DISCOVERY_HINT: string;
