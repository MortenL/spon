import type { CamDiagnostic, Diagnostic, GeometryCatalog, HeightName, OpOverlays, ParsedProgram, PostSection, ResolvedHeights } from '@sponcam/core';

export interface OperationSummary { operationId: string; diagnostics: CamDiagnostic[]; heights: ResolvedHeights | null; overlays: OpOverlays; hasToolpath: boolean }
export interface GeneratedFile { name: string; text: string; operationIds: string[]; tools: number[]; sections: PostSection[]; parsed: ParsedProgram; postErrors: Diagnostic[] }
export interface CamRun { results: OperationSummary[]; files: GeneratedFile[]; catalog: GeometryCatalog | null }
export interface CamFile { name: string; blobId: string; operationIds: string[]; sections: PostSection[]; postErrors: Diagnostic[] }
export type CamPickTarget = 'geometry' | { height: HeightName };
export type InspectorTab = 'geometry' | 'tool' | 'heights' | 'passes';
