export type PreviewKind =
  | 'markdown'
  | 'text'
  | 'csv'
  | 'pdf'
  | 'html'
  | 'image'
  | 'code'
  | 'docx'
  | 'xlsx'
  | 'unsupported';

export type ReadFileErrorCode =
  | 'NOT_FOUND'
  | 'NOT_ABSOLUTE'
  | 'OUTSIDE_WORKSPACE'
  | 'TOO_LARGE'
  | 'READ_FAILED';

export type ReadFileResult =
  | {
      buffer: string;
      ext: string;
      name: string;
      size: number;
    }
  | {
      error: ReadFileErrorCode;
      limit?: number;
    };
