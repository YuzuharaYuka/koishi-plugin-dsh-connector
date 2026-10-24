/**
 * 用 Koishi 的 puppeteer 服务把 Markdown 渲染成图片。
 *
 * 不直接依赖 puppeteer：`koishi-plugin-puppeteer` 是可选的，没装时调用方回退纯文本。
 */
import type { Context } from 'koishi';
import type { Config } from '../config';
/** 截图回调里用到的页面能力，只声明实际用到的部分 */
interface RenderPage {
    setViewport(options: {
        width: number;
        height: number;
        deviceScaleFactor?: number;
    }): Promise<void>;
    evaluate<T>(callback: () => T): Promise<T>;
    screenshot(options: {
        type: 'png';
        fullPage?: boolean;
    }): Promise<Uint8Array>;
}
type RenderCallback = (page: RenderPage) => Promise<string>;
interface PuppeteerService {
    render(content: string, callback?: RenderCallback): Promise<string>;
}
export declare function puppeteerOf(ctx: Context): PuppeteerService | undefined;
export declare function renderMarkdownImage(ctx: Context, markdown: string, config: Config): Promise<Buffer | null>;
export {};
