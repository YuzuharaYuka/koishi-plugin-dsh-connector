import { h, type Context, type Session } from 'koishi';
import type { Config } from './config';
import { type ApprovalDecision, type DshClient, type DshSessionSummary } from './services/dsh';
import { type BindingStore } from './services/store';
export interface HandlerDeps {
    ctx: Context;
    config: Config;
    client: DshClient;
    store: BindingStore;
    /** 每个聊天最近一次会话列表的顺序，用来按序号绑定 */
    listings: Map<string, DshSessionSummary[]>;
    /** 正在执行任务的聊天：同一聊天不允许并发跑两轮 */
    running: Set<string>;
}
/** 聊天窗口在绑定表中的键；私聊时 channelId 可能缺失 */
export declare function sessionKey(session: Session): string;
/**
 * 权限判定：只认用户白名单。
 *
 * `session.uid` 是 Koishi 的跨平台用户标识（`平台:用户ID`），裸用户 ID 也接受，
 * 方便直接从 `dsh.whoami` 复制。白名单为空表示谁都不允许。
 */
export declare function checkAccess(config: Config, session: Session): string | null;
/** 会话 ID 很长，状态与确认信息里只显示前缀 */
export declare function shortSessionId(sessionId: string): string;
export declare function handleWhoami(deps: HandlerDeps, session: Session): string;
/** QQ 不渲染 Markdown，按配置转成纯文本 */
export declare function renderReply(config: Config, text: string): string;
export declare function handlePing(deps: HandlerDeps, session: Session): Promise<string>;
export declare function handleSessions(deps: HandlerDeps, session: Session, includeAll?: boolean): Promise<string>;
/** 查看账户余额 */
export declare function handleBalance(deps: HandlerDeps): Promise<string>;
export interface WorkspaceEntry {
    cwd: string;
    count: number;
    updatedAt: number;
}
/**
 * 新建会话。
 *
 * 参数可以是工作区序号（来自 dsh.workspaces）、绝对路径，或省略走 `defaultWorkspace`。
 */
export declare function handleNew(deps: HandlerDeps, session: Session, target?: string): Promise<string>;
/** 列出已知工作区，供 dsh.new 按序号选择 */
export declare function handleWorkspaces(deps: HandlerDeps): Promise<string>;
export declare function handleUse(deps: HandlerDeps, session: Session, target: string): Promise<string>;
export declare function handleRun(deps: HandlerDeps, session: Session, text: string): Promise<h.Fragment>;
export declare function handleStop(deps: HandlerDeps, session: Session): Promise<string>;
/**
 * 查看或切换当前会话的权限预设。
 *
 * DSH 没有独立的权限 RPC，切换走官方 `/permission` 斜杠命令；预设本身由
 * `dsh-permission-presets` 插件提供，同时决定沙箱模式与审批策略。
 */
export declare function handlePermission(deps: HandlerDeps, session: Session, preset?: string): Promise<string>;
/** 查看或切换模型；思考等级可以跟在序号后面一起设置 */
export declare function handleModel(deps: HandlerDeps, session: Session, target?: string, effort?: string): Promise<string>;
/** 只调整思考等级，模型保持不变 */
export declare function handleThink(deps: HandlerDeps, session: Session, effort?: string): Promise<string>;
/** 取回会话工作区里的文件并发到聊天 */
export declare function handleGet(deps: HandlerDeps, session: Session, path?: string): Promise<h.Fragment>;
export declare function handleHistory(deps: HandlerDeps, session: Session, limit?: number): Promise<string>;
export declare function handleApproval(deps: HandlerDeps, session: Session, decision: ApprovalDecision): Promise<string>;
