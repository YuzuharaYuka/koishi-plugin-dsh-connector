export type ImageTheme = 'dark' | 'light';
export interface DocumentOptions {
    theme: ImageTheme;
    /** 正文最大宽度（CSS 像素），截图时同时作为视口宽度 */
    maxWidth: number;
}
export declare function buildDocument(markdown: string, options: DocumentOptions): string;
