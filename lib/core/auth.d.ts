export declare class DshAuthError extends Error {
    constructor(message: string);
}
/** 配置优先，其次环境变量，最后 `~/.dsh` */
export declare function resolveDshHome(explicit: string): string;
/**
 * 从 `.credentials.yaml` 中取出浏览器会话签名密钥。
 *
 * 该文件是「记录名 → 小型 YAML 块」的扁平映射，只按缩进扫描目标记录，
 * 这样不必为了一个字段引入 YAML 依赖，也不会把文件里的其它凭据带进内存之外的地方。
 */
export declare function parseBrowserSessionSecret(text: string): Buffer | null;
export declare function readBrowserSessionSecret(home: string): Promise<Buffer>;
/** 按 authority 现签一个 DSH 浏览器会话 cookie */
export declare function buildAuthCookie(secret: Buffer, authority: string, ttlMs?: number): string;
/**
 * relay 模式：用访问密钥换一个 `dsh-relay-access` cookie。
 *
 * relay 会自己给每个请求注入 DSH 的签名 cookie，因此这里不需要 DSH 的密钥。
 */
export declare function loginRelay(baseUrl: string, accessKey: string, timeoutMs: number): Promise<string>;
