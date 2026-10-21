import { h, type Context, type Session } from 'koishi';
import type { Config } from './config';
import type { QuestionItem } from './core/mux';
import { type ApprovalDecision, type DshClient, type DshSessionSummary } from './services/dsh';
import { type BindingStore } from './services/store';
/** 等待用户回答的提问 */
export interface PendingQuestion {
    sessionId: string;
    callId: string;
    questions: QuestionItem[];
    at: number;
}
export interface HandlerDeps {
    ctx: Context;
    config: Config;
    client: DshClient;
    store: BindingStore;
    /** 每个聊天最近一次会话列表的顺序，用来按序号绑定 */
    listings: Map<string, DshSessionSummary[]>;
    /** 正在执行任务的聊天：同一聊天不允许并发跑两轮 */
    running: Set<string>;
    /** 等待回答的提问，按聊天隔离 */
    questions: Map<string, PendingQuestion>;
    /** 已安排超时补发的聊天 */
    deferred: Set<string>;
    /** 自然语言模式的按聊天覆盖（on/off） */
    chatMode: Map<string, boolean>;
    /** 最近一次与插件交互的时间，用于自然语言窗口 */
    lastActive: Map<string, number>;
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
    title: string;
    path: string;
    count: number;
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
/** 把提问渲染成聊天里能直接回答的形式 */
export declare function renderQuestions(questions: QuestionItem[]): string;
/** 解析用户回答；多选题按序号返回 label，其它文字当作自定义回答 */
export declare function parseQuestionAnswer(questions: QuestionItem[], text: string): {
    answers: Array<{
        id: string;
        selected: string[];
        custom?: string;
    }>;
} | {
    error: string;
};
/** 有提问待回答时消费这条消息；未消费返回 undefined */
export declare function answerPendingQuestion(deps: HandlerDeps, session: Session, text: string): Promise<string | undefined>;
/** 把补充指令注入正在运行的任务；没有在跑就按普通任务处理 */
export declare function handleSteer(deps: HandlerDeps, session: Session, text: string): Promise<h.Fragment>;
/** /compact 与 /clear：交给 DSH 自己的命令处理 */
export declare function handleContextCommand(deps: HandlerDeps, session: Session, kind: 'compact' | 'clear'): Promise<string>;
/** 记录一次交互，自然语言窗口据此续期 */
export declare function touchSession(deps: HandlerDeps, session: Session): void;
/** 私聊里是否该把这句普通消息直接当作指令 */
export declare function shouldRunNaturalLanguage(deps: HandlerDeps, session: Session): boolean;
export declare function handleChatMode(deps: HandlerDeps, session: Session, action?: string): string;
