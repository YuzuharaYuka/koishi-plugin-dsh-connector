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
/**
 * 结果里含二进制（Uint8Array）的接口会返回 multipart/form-data：
 * 每个二进制字段一个分片，另有 `metadata` 放 JSON 结果信封。
 */
export declare function callRpcMultipart(options: RpcOptions): Promise<{
    value: unknown;
    parts: Map<string, Buffer>;
}>;
