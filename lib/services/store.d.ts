export interface ChannelBinding {
    platform: string;
    selfId: string;
    channelId: string;
    sessionId: string;
    title: string;
    updatedAt: number;
}
export declare function bindingKey(platform: string, selfId: string, channelId: string): string;
/**
 * 聊天窗口到 DSH 会话的绑定表。
 *
 * 落盘是为了让 Koishi 重启后授权请求仍然知道该推回哪个聊天；写入合并成一次，
 * 避免每条消息都刷盘。
 */
export declare class BindingStore {
    private readonly file;
    private readonly bindings;
    private loaded;
    private flushTimer?;
    constructor(file: string);
    load(): Promise<void>;
    get(key: string): ChannelBinding | undefined;
    set(binding: Omit<ChannelBinding, 'updatedAt'>): ChannelBinding;
    remove(key: string): void;
    findBySession(sessionId: string): ChannelBinding | undefined;
    list(): ChannelBinding[];
    private scheduleFlush;
    flush(): Promise<void>;
    dispose(): void;
}
