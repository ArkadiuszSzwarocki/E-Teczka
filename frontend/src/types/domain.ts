export type RetentionUnit = 'years' | 'months' | 'days' | 'minutes';

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface DocumentTag {
  tagId: number;
  tag: Tag;
}

export interface DocumentRecord {
  id: number;
  title: string;
  filePath: string;
  mimeType: string;
  folderId: number;
  thumbnail?: string | null;
  ocrText?: string | null;
  createdAt: string;
  updatedAt?: string;
  fileSize?: number;
  retentionEnabled: boolean;
  retentionValue: number;
  retentionUnit: RetentionUnit;
  isArchived?: boolean;
  isDeleted?: boolean;
  tags?: DocumentTag[];
  user?: { name: string | null; email: string | null } | null;
}

export type DocumentPatch = Partial<Pick<
  DocumentRecord,
  | 'title'
  | 'folderId'
  | 'retentionEnabled'
  | 'retentionValue'
  | 'retentionUnit'
  | 'isArchived'
  | 'isDeleted'
>> & {
  deletedAt?: string | null;
  tagIds?: number[];
};

export interface FolderRecord {
  id: number;
  name: string;
  parentId: number | null;
  order: number;
  _count?: { documents: number };
}
