export interface AssetBases {
  assetsBase: string;
  modelsBase?: string;
  reconstructionBase?: string;
}

export declare function isModelPath(path: string): boolean;
export declare function isReconstructionPath(path: string): boolean;
export declare function joinBase(base: string, path: string): string;
export declare function modelBase(path: string, bases: AssetBases): string;
export declare function modelUrlFor(path: string, bases: AssetBases): string;
