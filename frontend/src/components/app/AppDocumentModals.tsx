import type { ComponentProps, Dispatch, FormEvent, SetStateAction } from 'react';
import BulkMoveModal from '../BulkMoveModal';
import DestructiveActionModal from '../DestructiveActionModal';
import DocumentPreviewModal from '../DocumentPreviewModal';
import DocumentPropertiesModal from '../DocumentPropertiesModal';
import FolderDeletePreviewModal from '../FolderDeletePreviewModal';
import HoverDocumentPreview from '../HoverDocumentPreview';
import MoveDocumentModal from '../MoveDocumentModal';
import OcrPanel from '../OcrPanel';
import RetentionModal from '../RetentionModal';
import SecureShareModal from '../SecureShareModal';
import TagManagerModal from '../TagManagerModal';
import UploadTransferProgress from '../UploadTransferProgress';
import type { useDocumentAndFolderActions } from '../../hooks/useDocumentAndFolderActions';
import type { DocumentRecord, FolderRecord, Tag } from '../../types/domain';

type ActionsType = ReturnType<typeof useDocumentAndFolderActions>;

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  apiFetch: typeof fetch;
  documents: DocumentRecord[];
  folders: FolderRecord[];
  tags: Tag[];
  folderOptions: ReturnType<typeof import('../../utils/folderTree').buildFolderOptions>;
  activeView: string;
  selectedDocs: number[];
  previewDoc: DocumentRecord | null;
  previewZoom: number;
  onPreviewZoomChange: Dispatch<SetStateAction<number>>;
  onClosePreview: () => void;
  propertiesDoc: DocumentRecord | null;
  onCloseProperties: () => void;
  ocrDocumentId: number | null;
  onCloseOcr: () => void;
  secureShareId: number | null;
  onCloseSecureShare: () => void;
  hoverDocId: number | null;
  hoverAnchor: HTMLElement | null;
  onHoverEnter: (id: number) => void;
  onHoverLeave: () => void;
  isUploading: boolean;
  uploadProgress: ComponentProps<typeof UploadTransferProgress>['progress'] | null;
  onCancelUpload: () => void;
  uploadReport: { folder: string; saved: number; skipped: Array<{ name: string; existingTitle: string }> } | null;
  onCloseUploadReport: () => void;
  isTagManagerOpen: boolean;
  onCloseTagManager: () => void;
  moveModalDocId: number | null;
  onCloseMoveModal: () => void;
  isBulkMoveOpen: boolean;
  onCloseBulkMove: () => void;
  actions: ActionsType;
  onCancelAction: () => void;
  onConfirmAction: () => void;
};

/** Renders document-related modals, previews, upload report, and destructive confirmations. */
export function AppDocumentModals(p: Props) {
  const hovered = p.hoverDocId !== null ? p.documents.find(d => d.id === p.hoverDocId) : null;
  const { actions } = p;

  return (
    <>
      {p.previewDoc && (
        <DocumentPreviewModal
          fetcher={p.fetcher}
          apiUrl={p.apiUrl}
          document={p.previewDoc}
          zoom={p.previewZoom}
          onZoomChange={p.onPreviewZoomChange}
          onMarkPaid={async id => { await actions.updateDocument(id, { paymentStatus: 'paid' }); }}
          onClose={p.onClosePreview}
        />
      )}
      {p.isUploading && p.uploadProgress && <UploadTransferProgress progress={p.uploadProgress} onCancel={p.onCancelUpload} />}
      {p.uploadReport && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="upload-report-title" className="w-full max-w-lg rounded-xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
            <h2 id="upload-report-title" className="text-xl font-bold text-white">Wynik wgrywania</h2>
            <p className="mt-3 text-sm">Podkartoteka: <strong>{p.uploadReport.folder}</strong>. Wgrano plików: <strong>{p.uploadReport.saved}</strong>.</p>
            <p className="mt-3 text-sm text-amber-200">Pominięto {p.uploadReport.skipped.length} identycznych plików — były już w tej podkartotece lub pojawiły się wcześniej w wybranej paczce.</p>
            <ul className="mt-3 max-h-48 list-disc overflow-auto pl-5 text-sm text-slate-300">
              {p.uploadReport.skipped.map((item, idx) => <li key={idx} className="break-words">{item.name} — identyczny jak „{item.existingTitle}”</li>)}
            </ul>
            <button onClick={p.onCloseUploadReport} className="mt-5 rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white">Rozumiem</button>
          </section>
        </div>
      )}
      {p.secureShareId !== null && (
        <SecureShareModal
          apiUrl={p.apiUrl}
          fetcher={p.apiFetch}
          documentId={p.secureShareId}
          title={p.documents.find(doc => doc.id === p.secureShareId)?.title || 'Dokument'}
          onClose={p.onCloseSecureShare}
        />
      )}
      {p.ocrDocumentId !== null && (
        <OcrPanel
          apiUrl={p.apiUrl}
          documentId={p.ocrDocumentId}
          title={p.documents.find(doc => doc.id === p.ocrDocumentId)?.title || 'Dokument'}
          fetcher={p.fetcher}
          onClose={p.onCloseOcr}
        />
      )}
      {p.propertiesDoc && (
        <DocumentPropertiesModal
          document={p.propertiesDoc}
          folders={p.folders}
          onUpdateDocument={actions.updateDocument}
          onClose={p.onCloseProperties}
        />
      )}
      {hovered && p.hoverAnchor && (
        <HoverDocumentPreview
          document={hovered}
          anchor={p.hoverAnchor}
          apiUrl={p.apiUrl}
          fetcher={p.fetcher}
          onEnter={() => p.onHoverEnter(hovered.id)}
          onLeave={p.onHoverLeave}
        />
      )}
      <TagManagerModal
        isOpen={p.isTagManagerOpen}
        tags={p.tags}
        name={actions.newTagName}
        color={actions.newTagColor}
        onNameChange={actions.setNewTagName}
        onColorChange={actions.setNewTagColor}
        onCreate={() => void actions.createTag()}
        onDelete={tagId => void actions.deleteTag(tagId)}
        onClose={p.onCloseTagManager}
      />
      <MoveDocumentModal
        documentId={p.moveModalDocId}
        folderOptions={p.folderOptions}
        onMove={fid => actions.updateDocument(p.moveModalDocId!, { folderId: fid })}
        onClose={p.onCloseMoveModal}
      />
      <BulkMoveModal
        isOpen={p.isBulkMoveOpen}
        documentCount={p.selectedDocs.length}
        restoring={p.activeView === 'trash' || p.activeView === 'archive'}
        folderOptions={p.folderOptions}
        onMove={actions.moveSelectedDocs}
        onClose={p.onCloseBulkMove}
      />
      {actions.folderDeletePreview && (
        <FolderDeletePreviewModal
          preview={actions.folderDeletePreview}
          transferFolderId={actions.transferFolderId}
          onTransferFolderChange={actions.setTransferFolderId}
          folderOptions={p.folderOptions}
          onConfirmTransfer={() => {
            const pv = actions.folderDeletePreview!;
            actions.setFolderDeletePreview(null);
            actions.initiateAction('delete_folder', pv.id, pv.name, Number(actions.transferFolderId), pv.archivedCount, pv.trashedCount, { deleteMode: 'transfer' });
          }}
          onConfirmTrash={() => {
            const pv = actions.folderDeletePreview!;
            actions.setFolderDeletePreview(null);
            actions.initiateAction('delete_folder', pv.id, pv.name, null, pv.archivedCount, pv.trashedCount, { deleteMode: 'trash' });
          }}
          onCancel={() => actions.setFolderDeletePreview(null)}
        />
      )}
      <DestructiveActionModal
        action={actions.pendingAction}
        seconds={actions.actionTimer}
        onCancel={p.onCancelAction}
        onConfirm={p.onConfirmAction}
      />
      <RetentionModal
        state={actions.retentionModal}
        folderOptions={p.folderOptions}
        onStateChange={actions.setRetentionModal}
        onSubmit={(e: FormEvent) => actions.handleRetentionUpdate(e)}
        onClose={() => actions.setRetentionModal({ ...actions.retentionModal, isOpen: false })}
      />
    </>
  );
}
