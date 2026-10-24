/**
 * 用 puppeteer 服务把 Markdown 渲染成图片。
 *
 * 只依赖服务本身，不绑定具体插件：任何提供 puppeteer 服务的插件都可以；
 * 没有该服务时调用方回退纯文本。
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
