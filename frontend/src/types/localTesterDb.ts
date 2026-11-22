export type LocalFolder = {
  id: number;
  name: string;
  parentId: number | null;
  ownerId: number;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type LocalTag = {
  id: number;
  name: string;
  color: string;
};

export type LocalDocument = {
  id: number;
  title: string;
  filePath: string;
  mimeType: string;
  folderId: number;
  physicalLocation: string | null;
  retentionEnabled: boolean;
  retentionValue: number;
  retentionUnit: string;
  thumbnail: string | null;
  isArchived: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: number[];
  merchantName: string | null;
  amountCents: number | null;
  currency: string;
  dueDate: string | null;
  paymentStatus: string | null;
};

export type LocalDatabase = {
  nextFolderId: number;
  nextDocId: number;
  nextTagId: number;
  folders: LocalFolder[];
  documents: LocalDocument[];
  tags: LocalTag[];
  blobs: Record<string, { mimeType: string; dataUrl: string; size: number }>;
};

export type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

export function emptyLocalDb(): LocalDatabase {
  return { nextFolderId: 1, nextDocId: 1, nextTagId: 1, folders: [], documents: [], tags: [], blobs: {} };
}
