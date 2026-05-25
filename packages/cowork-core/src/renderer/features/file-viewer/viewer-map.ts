import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PreviewKind, ReadFileResult } from './types';

export interface ViewerComponentProps {
  path: string;
  cwd?: string;
  readResult?: ReadFileResult;
}

export type ViewerComponent = LazyExoticComponent<ComponentType<ViewerComponentProps>>;

const UnsupportedViewer = lazy(() => import('./viewers/UnsupportedViewer'));

export const READ_REQUIRED_KINDS = new Set<PreviewKind>([
  'markdown',
  'text',
  'csv',
  'html',
  'pdf',
  'image',
]);

export const viewerComponents: Record<PreviewKind, ViewerComponent> = {
  markdown: lazy(() => import('./viewers/MarkdownViewer')),
  text: lazy(() => import('./viewers/TextViewer')),
  csv: lazy(() => import('./viewers/CsvViewer')),
  pdf: lazy(() => import('./viewers/PdfViewer')),
  html: lazy(() => import('./viewers/HtmlViewer')),
  image: lazy(() => import('./viewers/ImageViewer')),
  code: UnsupportedViewer,
  docx: UnsupportedViewer,
  xlsx: UnsupportedViewer,
  unsupported: UnsupportedViewer,
};
