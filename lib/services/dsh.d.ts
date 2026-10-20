import type { Config } from '../config';
import { type TurnImage } from '../core/media';
import { type ApprovalRequest, type QuestionRequest } from '../core/mux';
import { type TokenUsage } from '../core/pricing';
export type ApprovalDecision = 'allow' | 'deny';
export interface DshSessionSummary {
    sessionId: string;
    title: string;
    running: boolean;
    /** 子会话（子代理）不出现在普通列表里 */
    parentSessionId?: string;
    cwd?: string;
    /** 还没跑过任何一轮的空会话 */
    blank: boolean;
    /** 最后修改时间（毫秒），列表按它倒序 */
    updatedAt: number;
}
export interface SessionListOptions {
    includeChildren?: boolean;
    includeBlank?: boolean;
}
/** 聊天里收到的文件，上传到 DSH 后换成凭据再提交 */
export interface TurnFile {
    receiptId: string;
    name: string;
}
/** DSH 可路由的模型，按 provider 分组展开 */
export interface DshModelOption {
    provider: string;
    providerName: string;
    model: string;
    name: string;
    description?: string;
    efforts: Array<{
        id: string;
        name: string;
        description?: string;
    }>;
    defaultEffort?: string;
}
export interface DshModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
export interface DshModelCatalog {
    models: DshModelOption[];
    /** 部署默认选择，新会话尚未指定模型时用它兜底 */
    defaultSelection?: DshModelSelection;
}
export interface DshWorkspaceEntry {
    name: string;
    type: string;
    size?: number;
}
export interface BalanceWallet {
    currency: string;
    balance: number;
}
export interface BalanceInfo {
    /** 充值余额 */
    wallets: BalanceWallet[];
    /** 赠送余额 */
    bonusWallets: BalanceWallet[];
}
export interface TurnResult {
    text: string;
    images: TurnImage[];
    /** 未能取回或超出上限的图片数量，用于如实告知用户 */
    skipped: number;
    seq: number;
    /** 本轮消耗的 token（快照相减） */
    usage: TokenUsage;
    /** 本轮实际使用的模型，用于估算费用 */
    model?: string;
}
/** 等待超时时带上已经看到的最后一段回复，避免整段丢弃 */
export declare class DshTurnTimeout extends Error {
    readonly partial: string;
    readonly baseline: number;
    constructor(partial: string, baseline?: number);
}
/** 从 `assistant/message` 事件里取出文本块 */
export declare function extractEventText(event: unknown): string;
/**
 * DSH 客户端：负责定位端口、取得 cookie、维护审批事件桥，并提供会话级操作。
 *
 * 直连与 relay 只差「cookie 从哪来」，其余 RPC 与事件桥完全一致。
 */
export declare class DshClient {
    private readonly config;
    private baseUrl?;
    private cookie?;
    private secret?;
    private authority?;
    private preferredPort?;
    private connecting?;
    private bridge?;
    private readonly pending;
    private approvalHandler?;
    private questionHandler?;
    constructor(config: Config);
    get relayMode(): boolean;
    get connected(): boolean;
    describe(): {
        mode: string;
        baseUrl?: string;
        bridge: boolean;
    };
    ensureReady(): Promise<void>;
    private connect;
    /** DSH 重启会换端口与密钥，这里丢弃连接状态，保留上次端口作为首选探测目标 */
    private invalidate;
    private refreshCookie;
    private getCookieForBridge;
    private startBridge;
    private rawRpc;
    /** 结果带二进制的接口走 multipart，重试策略与普通 RPC 一致 */
    private rpcMultipart;
    rpc(method: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
    /**
     * 会话列表，按最后修改时间倒序。
     *
     * `session/list` 会同时返回子代理会话与从未使用过的空会话，两者都不该出现在
     * 用户可见的列表里：子会话的标题其实是子代理的提示词，空会话则没有内容。
     * 排序放在这里，保证所有调用方（列表、绑定、状态）看到的是同一个顺序。
     */
    listSessions(options?: SessionListOptions): Promise<DshSessionSummary[]>;
    createSession(cwd?: string): Promise<string>;
    /** 新建会话按配置切到默认权限；失败只记日志，不阻断会话创建 */
    private applyDefaultPermission;
    sessionTitle(sessionId: string): Promise<string>;
    /** 权限预设目录，由 DSH 官方插件 `dsh-permission-presets` 提供 */
    permissionPresets(): Promise<string[]>;
    /** 会话当前生效的权限预设 */
    currentPermission(sessionId: string): Promise<string | undefined>;
    /** 一次 projections 取回状态面板需要的字段 */
    sessionSnapshot(sessionId: string): Promise<{
        permission?: string;
        model?: DshModelSelection;
    }>;
    /** 切权限没有独立 RPC，走官方 `/permission` 斜杠命令 */
    setPermission(sessionId: string, preset: string): Promise<void>;
    /** 全部可路由模型，按 provider 分组展开成一维；附带部署默认选择 */
    modelCatalog(): Promise<DshModelCatalog>;
    /** 会话当前生效的模型与思考等级；`next` 是下一次生效的选择 */
    modelSelection(sessionId: string): Promise<DshModelSelection | undefined>;
    selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<void>;
    /** 把聊天里的文件上传到会话，返回可直接放进 prompt 的凭据 */
    uploadFile(sessionId: string, name: string, mediaType: string, buffer: Buffer): Promise<string>;
    /** 列会话工作区里的目录内容 */
    listWorkspace(sessionId: string, path: string): Promise<DshWorkspaceEntry[]>;
    /** 读会话工作区里的一个文件；超出上限时报错而不是截断 */
    readWorkspaceFile(sessionId: string, path: string, maxBytes: number): Promise<{
        name: string;
        buffer: Buffer;
        bytes: number;
    }>;
    cursor(sessionId: string): Promise<number>;
    page(sessionId: string, throughSeq: number, maxMessages?: number): Promise<unknown[]>;
    prompt(sessionId: string, text: string, images?: TurnImage[], files?: TurnFile[]): Promise<void>;
    cancel(sessionId: string): Promise<void>;
    history(sessionId: string, limit: number): Promise<string[]>;
    /** 取出 `baseline` 之后的事件，按 seq 升序排列；分页返回的顺序不作假设 */
    private pageEvents;
    /** 提交一轮任务并等待 `turn/end`，中间步骤的 assistant 消息不并入最终结果 */
    runTurn(sessionId: string, text: string, images?: TurnImage[], files?: TurnFile[]): Promise<TurnResult>;
    /** 会话当前模型 ID；没有选择时用部署默认值 */
    private currentModelName;
    /** 会话累计的 token 用量 */
    tokenUsage(sessionId: string): Promise<TokenUsage>;
    /** 账户余额；未登录平台账号时返回 undefined */
    accountBalance(): Promise<BalanceInfo | undefined>;
    awaitTurn(sessionId: string, baseline: number, timeoutMs?: number): Promise<Omit<TurnResult, 'usage' | 'model'>>;
    /** 把图片引用换成可以直接发送的数据；失败的只计数，不阻断文本回传 */
    private resolveImages;
    private readAttachment;
    setApprovalHandler(handler: (request: ApprovalRequest) => void): void;
    setQuestionHandler(handler: (request: QuestionRequest) => void): void;
    /** 回答 agent 的提问；`callId` 用事件帧里的 eventId */
    answerQuestion(sessionId: string, callId: string, answers: Array<{
        id: string;
        selected: string[];
        custom?: string;
    }>): Promise<void>;
    /** 把补充指令注入正在运行的回合 */
    steer(sessionId: string, text: string): Promise<void>;
    /** 执行会话级斜杠命令（/compact、/permission 等） */
    runCommand(sessionId: string, line: string): Promise<{
        kind: string;
        text: string;
    }>;
    listPendingApprovals(sessionId?: string): ApprovalRequest[];
    answerApproval(decision: ApprovalDecision, sessionId?: string): Promise<ApprovalRequest | undefined>;
    dispose(): void;
}
