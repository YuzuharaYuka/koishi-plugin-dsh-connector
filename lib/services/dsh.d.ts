import type { Config } from '../config';
import { type TurnImage } from '../core/media';
import { type ApprovalRequest } from '../core/mux';
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
export interface TurnResult {
    text: string;
    images: TurnImage[];
    /** 未能取回或超出上限的图片数量，用于如实告知用户 */
    skipped: number;
    seq: number;
}
/** 等待超时时带上已经看到的最后一段回复，避免整段丢弃 */
export declare class DshTurnTimeout extends Error {
    readonly partial: string;
    constructor(partial: string);
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
    /** 切权限没有独立 RPC，走官方 `/permission` 斜杠命令 */
    setPermission(sessionId: string, preset: string): Promise<void>;
    cursor(sessionId: string): Promise<number>;
    page(sessionId: string, throughSeq: number, maxMessages?: number): Promise<unknown[]>;
    prompt(sessionId: string, text: string, images?: TurnImage[]): Promise<void>;
    cancel(sessionId: string): Promise<void>;
    history(sessionId: string, limit: number): Promise<string[]>;
    /** 取出 `baseline` 之后的事件，按 seq 升序排列；分页返回的顺序不作假设 */
    private pageEvents;
    /** 提交一轮任务并等待 `turn/end`，中间步骤的 assistant 消息不并入最终结果 */
    runTurn(sessionId: string, text: string, images?: TurnImage[]): Promise<TurnResult>;
    awaitTurn(sessionId: string, baseline: number): Promise<TurnResult>;
    /** 把图片引用换成可以直接发送的数据；失败的只计数，不阻断文本回传 */
    private resolveImages;
    private readAttachment;
    setApprovalHandler(handler: (request: ApprovalRequest) => void): void;
    listPendingApprovals(sessionId?: string): ApprovalRequest[];
    answerApproval(decision: ApprovalDecision, sessionId?: string): Promise<ApprovalRequest | undefined>;
    dispose(): void;
}
