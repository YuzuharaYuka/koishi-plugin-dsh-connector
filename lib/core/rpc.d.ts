export declare class DshRpcError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(message: string, code: string, status: number);
}
export interface RpcOptions {
    baseUrl: string;
    cookie: string;
    method: string;
    args?: Record<string, unknown>;
    timeoutMs: number;
}
/** DSH 的 Typert 网关：`POST /api/<namespace>/<method>`，请求体带 `{ args }` */
export declare function callRpc(options: RpcOptions): Promise<unknown>;
