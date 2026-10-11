export interface AssetBases {
  assetsBase: string;
  modelsBase?: string;
  reconstructionBase?: string;
  reconstructionRoutes?: Record<string, string>;
}

export declare function isModelPath(path: string): boolean;
export declare function isReconstructionPath(path: string): boolean;
export declare function joinBase(base: string, path: string): string;
export declare function parseReconstructionRoutes(value?: unknown): Record<string, string>;
export declare function compactReconstructionRoutes(value?: unknown): { formatVersion: number; hosts: { baseUrl: string; prefixes: string[] }[] };
export declare function modelBase(path: string, bases: AssetBases): string;
export declare function modelUrlFor(path: string, bases: AssetBases): string;
