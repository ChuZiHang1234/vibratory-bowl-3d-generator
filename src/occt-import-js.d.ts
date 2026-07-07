declare module "occt-import-js" {
  export interface OcctImportOptions {
    locateFile?: (path: string, prefix?: string) => string;
  }

  const occtImport: (options?: OcctImportOptions) => Promise<unknown>;
  export default occtImport;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
