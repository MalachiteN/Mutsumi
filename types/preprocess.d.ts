declare module 'preprocess' {
    export interface PreprocessOptions {
        fileNotFoundSilentFail?: boolean;
        srcDir?: string;
        srcEol?: string;
        type?: string;
    }

    export function preprocess(
        source: string,
        context?: Record<string, any>,
        options?: PreprocessOptions
    ): string;

    export function preprocessFile(
        srcFile: string,
        destFile: string,
        context?: Record<string, any>,
        callback?: (err: Error) => void,
        options?: PreprocessOptions
    ): void;

    export function preprocessFileSync(
        srcFile: string,
        destFile: string,
        context?: Record<string, any>,
        options?: PreprocessOptions
    ): void;
}
