export interface LoopbackListener {
    port: number;
    processName: string;
}
export declare function listLoopbackListeners(): Promise<LoopbackListener[]>;
export declare function probePort(port: number, timeoutMs?: number): Promise<boolean>;
/**
 * 找到本机 DSH 网页服务的端口。
 *
 * `preferred` 是上一次成功的端口：DSH 只是重启时先探它，避免每次都跑一遍全量扫描。
 */
export declare function discoverDshPort(preferred?: number): Promise<number | undefined>;
