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
    /** 新建会话使用的工作区；空串表示用 DSH 默认目录 */
    defaultWorkspace: string;
    /** 私聊里不带指令前缀的消息直接交给 DSH */
    naturalLanguagePrivate: boolean;
    /** 自然语言模式的空闲窗口（分钟） */
    chatIdleMinutes: number;
    /** 会话列表分组方式 */
    sessionGroupBy: 'workspace' | 'flat';
    /** 会话列表排序方式 */
    sessionSortBy: 'manual' | 'updated';
    /** 会话列表筛选方式 */
    sessionFilter: 'active' | 'all' | 'archived';
    mergeForward: boolean;
    splitLength: number;
    chunkLength: number;
    enableImages: boolean;
    maxImages: number;
    maxImageMb: number;
    enableFiles: boolean;
    maxFileMb: number;
    /** 每轮回复后附带 token 用量 */
    showUsage: boolean;
    /** 用量里同时给出估算费用 */
    showCost: boolean;
    /** 余额低于该值时提醒；0 表示关闭 */
    balanceWarning: number;
    debug: boolean;
}
export declare const Config: Schema<Config>;
/** 运行时夹逼：`koishi.yml` 手改或旧配置升级都可能绕过 Schema 约束 */
export declare function normalizeConfig(config: Config): Config;
