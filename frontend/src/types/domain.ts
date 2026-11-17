export type RetentionUnit = 'years' | 'months' | 'days' | 'minutes';

export interface Tag {
  id: number;
  name: string;
  color: string;
  inactive?: boolean;
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
  readOnly?: boolean;
  retentionEnabled: boolean;
  retentionValue: number;
  retentionUnit: RetentionUnit;
  isArchived?: boolean;
  isDeleted?: boolean;
  amountCents?: number | null;
  currency?: string;
  dueDate?: string | null;
  paymentStatus?: 'paid' | 'unpaid' | null;
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
  createdAt?: string;
  updatedAt?: string;
  _count?: { documents: number };
}
