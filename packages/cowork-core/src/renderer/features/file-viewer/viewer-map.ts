import type { ComponentType } from 'react';
import type { PreviewKind, ReadFileResult } from './types';

export interface ViewerComponentProps {
  path: string;
  readResult?: ReadFileResult;
}

export type ViewerLoader = () => Promise<{
  default: ComponentType<ViewerComponentProps>;
}>;

export const viewerLoaders: Partial<Record<PreviewKind, ViewerLoader>> = {};
