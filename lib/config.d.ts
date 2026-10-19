import { Schema } from 'koishi';
export interface Config {
    mode: 'auto' | 'direct' | 'relay';
    baseUrl: string;
    dshHome: string;
    accessKey: string;
    pollInterval: number;
    promptTimeout: number;
    historyLimit: number;
    sessionLimit: number;
    clientTimeZone: string;
    replyFormat: 'text' | 'markdown';
    allowUsers: string[];
    /** 新建会话后自动切换到的权限预设；空串表示沿用 DSH 默认 */
    defaultPermission: string;
    mergeForward: boolean;
    splitLength: number;
    chunkLength: number;
    enableImages: boolean;
    maxImages: number;
    maxImageMb: number;
    debug: boolean;
}
export declare const Config: Schema<Config>;
/** 运行时夹逼：`koishi.yml` 手改或旧配置升级都可能绕过 Schema 约束 */
export declare function normalizeConfig(config: Config): Config;
