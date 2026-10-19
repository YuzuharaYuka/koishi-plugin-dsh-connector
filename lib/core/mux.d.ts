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
export interface EventBridgeOptions {
    wsUrl: string;
    baseUrl: string;
    getCookie: () => Promise<string>;
    onApproval: (request: ApprovalRequest) => void;
    debug: boolean;
}
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
    private delay;
    constructor(options: EventBridgeOptions);
    get clientId(): string | undefined;
    get connected(): boolean;
    start(): void;
    close(): void;
    private scheduleReconnect;
    private connect;
    private handleMessage;
    /** 把授权结论回送给 DSH，`value` 由调用方按 DSH 的 outcome 词表给出 */
    answer(eventId: string, value: string): Promise<void>;
}
