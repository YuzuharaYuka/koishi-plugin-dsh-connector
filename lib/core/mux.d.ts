export interface WaterfallFrame {
    [key: string]: unknown;
}
export interface ApprovalRequest {
    eventId: string;
    sessionId?: string;
    tool?: string;
    reason?: string;
    raw: WaterfallFrame;
}
export interface QuestionOption {
    label: string;
    description?: string;
}
export interface QuestionItem {
    id: string;
    question: string;
    header?: string;
    options: QuestionOption[];
    multiSelect?: boolean;
}
/** DSH 的 `user-questions/request`：agent 在回合中主动向用户提问 */
export interface QuestionRequest {
    eventId: string;
    sessionId: string;
    questions: QuestionItem[];
    raw: WaterfallFrame;
}
export interface WorkspaceInfo {
    id: string;
    path: string;
    title: string;
    sessionIds: string[];
}
/** DSH 的工作区基线：工作区成员关系、归档与置顶会话 */
export interface WorkspaceSnapshot {
    workspaces: WorkspaceInfo[];
    archived: string[];
    pinned: string[];
}
/** 工作区流的增量：归档/置顶都是整表替换 */
export type WorkspaceUpdate = {
    kind: 'baseline';
    snapshot: WorkspaceSnapshot;
} | {
    kind: 'archived';
    archived: string[];
} | {
    kind: 'pinned';
    pinned: string[];
};
export interface EventBridgeOptions {
    wsUrl: string;
    baseUrl: string;
    getCookie: () => Promise<string>;
    onApproval: (request: ApprovalRequest) => void;
    onQuestion?: (request: QuestionRequest) => void;
    onWorkspace?: (update: WorkspaceUpdate) => void;
    /** 是否空闲：空闲时连续失败会暂停重连，等下次使用插件再唤醒 */
    isIdle?: () => boolean;
    debug: boolean;
}
/**
 * 把一帧 waterfall 识别成提问请求。
 *
 * 实测帧形如：
 * `{ type: 'waterfall', event: 'user-questions/request', eventId, agentId, request: { questions: [...] } }`
 */
export declare function readQuestionFrame(frame: WaterfallFrame): QuestionRequest | null;
/**
 * 把一帧 waterfall 识别成授权请求。
 *
 * DSH 的转发帧在文档里只承诺「带 eventId 的 approval/request」，不同版本把
 * 端点名放在 `endpoint`/`method`/`name`/`type` 中的某个字段，因此这里逐个探测，
 * 认不出来时由调用方记 debug 日志，不猜测。
 */
export declare function readApprovalFrame(frame: WaterfallFrame): ApprovalRequest | null;
/**
 * 维持 `/api/remote.mux` 上的 `$events` 流，并把授权结论送回去。
 *
 * HTTP 侧没有推送能力，审批请求只在这条连接上下发；断线后 DSH 会把未答复的
 * 请求重新投递给新连接，因此这里只要保证重连即可补齐。
 */
export declare class EventBridge {
    private readonly options;
    private socket?;
    private retryTimer?;
    private closed;
    private readyClientId?;
    /** 退避阶梯下标 */
    private delayIndex;
    /** 连续失败次数，连接成功后清零 */
    private failures;
    /** 空闲且连续失败过多时暂停重连，等 resume() 唤醒 */
    private suspended;
    private lastFailureLogAt;
    private connecting;
    constructor(options: EventBridgeOptions);
    get clientId(): string | undefined;
    get connected(): boolean;
    get isSuspended(): boolean;
    start(): void;
    /** 被指令唤醒：暂停中的桥重新开始连接 */
    resume(): void;
    close(): void;
    private scheduleReconnect;
    /** 失败日志只在首次、或距上次超过 5 分钟时输出 */
    private shouldLogFailure;
    /** 连接失败后的统一处理：记录次数，空闲时暂停，否则退避重试 */
    private handleFailure;
    private connect;
    private openSocket;
    private handleMessage;
    /** 把授权结论回送给 DSH，`value` 由调用方按 DSH 的 outcome 词表给出 */
    answer(eventId: string, value: string): Promise<void>;
}
