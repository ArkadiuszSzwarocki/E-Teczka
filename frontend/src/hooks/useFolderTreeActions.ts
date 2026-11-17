import { useState } from 'react';
import { createFolder, renameFolder } from '../services/folderApi';
import { getFolderDeletePreview } from '../services/folderActions';
import { errorMessage } from '../utils/errors';

type UseFolderTreeActionsArgs = {
  apiUrl: string;
  fetcher: typeof fetch;
  fetchData: () => Promise<void>;
  showToast: (message: string, type?: string) => void;
  onConfirmEmptyDelete: (id: number, name: string, archivedCount: number, trashedCount: number) => void;
};

/** Manages folder tree editing state, creation, renaming, and deletion preview. */
export function useFolderTreeActions({
  apiUrl,
  fetcher,
  fetchData,
  showToast,
  onConfirmEmptyDelete,
}: UseFolderTreeActionsArgs) {
  const [isEditingFolders, setIsEditingFolders] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<number[]>([]);
  const [addingSubfolderTo, setAddingSubfolderTo] = useState<number | 'root' | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState('');
  const [folderDeletePreview, setFolderDeletePreview] = useState<{
    id: number; name: string; documentCount: number; archivedCount: number; trashedCount: number;
  } | null>(null);
  const [transferFolderId, setTransferFolderId] = useState('');

  const requestFolderDelete = async (id: number, name: string) => {
    try {
      const preview = await getFolderDeletePreview(apiUrl, fetcher, id);
      if (preview.documentCount + preview.archivedCount + preview.trashedCount > 0) {
        setTransferFolderId('');
        setFolderDeletePreview({
          id,
          name,
          documentCount: preview.documentCount,
          archivedCount: preview.archivedCount || 0,
          trashedCount: preview.trashedCount || 0,
        });
      } else {
        onConfirmEmptyDelete(id, name, preview.archivedCount || 0, preview.trashedCount || 0);
      }
    } catch (error: unknown) {
      showToast(errorMessage(error, 'Nie udało się sprawdzić kartoteki.'), 'error');
    }
  };

  const handleCreateFolder = async (parentId: number | null) => {
    if (!newFolderName.trim()) return;
    try {
      const res = await createFolder(apiUrl, fetcher, newFolderName.trim(), parentId);
      if (res.ok) {
        setAddingSubfolderTo(null);
        setNewFolderName('');
        if (parentId) setExpandedFolders(prev => [...prev, parentId]);
        await fetchData();
      }
    } catch { /* ignore */ }
  };

  const handleRenameFolder = async (id: number) => {
    if (!renamingFolderName.trim()) return;
    try {
      const res = await renameFolder(apiUrl, fetcher, id, renamingFolderName.trim());
      if (res.ok) { setRenamingFolderId(null); await fetchData(); }
    } catch { /* ignore */ }
  };

  const toggleFolderExpand = (id: number) => {
    setExpandedFolders(prev => (prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]));
  };

  return {
    isEditingFolders, setIsEditingFolders,
    expandedFolders, setExpandedFolders,
    addingSubfolderTo, setAddingSubfolderTo,
    newFolderName, setNewFolderName,
    renamingFolderId, setRenamingFolderId,
    renamingFolderName, setRenamingFolderName,
    folderDeletePreview, setFolderDeletePreview,
    transferFolderId, setTransferFolderId,
    requestFolderDelete,
    handleCreateFolder,
    handleRenameFolder,
    toggleFolderExpand,
  };
}
