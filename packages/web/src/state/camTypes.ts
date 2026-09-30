import type { Diagnostic, HeightName, PostSection } from '@sponcam/core';

export type { CamRun, GeneratedFile, OperationSummary } from '@sponcam/core';
export interface CamFile { name: string; blobId: string; operationIds: string[]; sections: PostSection[]; postErrors: Diagnostic[] }
export type CamPickTarget = 'geometry' | { height: HeightName };
export type InspectorTab = 'geometry' | 'tool' | 'heights' | 'passes';
