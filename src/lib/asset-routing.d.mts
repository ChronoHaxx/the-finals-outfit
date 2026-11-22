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
export declare function isMeshPath(path: string): boolean;
/** "<host label>/<path>" for an https mesh URL on a public host (one of `origins`, when given), else null. */
export declare function gatedMeshPath(url: string, origins?: readonly string[]): string | null;
/** The origins a release's cosmetic meshes come from: the only hosts the mesh gate stages. */
export declare function meshOrigins(bases: AssetBases): string[];
