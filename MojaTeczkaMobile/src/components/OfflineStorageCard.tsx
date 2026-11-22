import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FolderSummary } from '../types/navigation';

type Props = {
  offlineBytes: number;
  offlineFolders: FolderSummary[];
  offlineFolderIds: number[];
  folderLoadError: string;
  vaultSyncing: boolean;
  syncing: boolean;
  vaultProgress: string;
  onRefreshList: () => void;
  onToggleFolder: (folderId: number) => void;
  onDownloadSelected: () => void;
  onRemoveOfflineCopies: () => void;
};

/** Offline catalog & encrypted document storage controls extracted from SyncScreen. */
export default function OfflineStorageCard({
  offlineBytes,
  offlineFolders,
  offlineFolderIds,
  folderLoadError,
  vaultSyncing,
  syncing,
  vaultProgress,
  onRefreshList,
  onToggleFolder,
  onDownloadSelected,
  onRemoveOfflineCopies,
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.vaultTitle}>Dane aplikacyjne offline</Text>
      <Text style={styles.subText}>Zajętość lokalnej kopii: {(offlineBytes / 1024 / 1024).toFixed(1)} MB</Text>
      <TouchableOpacity style={styles.btn} onPress={onRefreshList}>
        <Text style={styles.btnText}>Odśwież listę kartotek</Text>
      </TouchableOpacity>
      {Boolean(folderLoadError) && <Text style={styles.hint}>{folderLoadError}</Text>}
      {offlineFolders.length > 0 && (
        <>
          <Text style={styles.optionLabel}>Kartoteki pobierane na telefon</Text>
          {offlineFolders.filter(folder => folder.parentId !== null).map(folder => (
            <TouchableOpacity key={folder.id} style={styles.folderChoice} onPress={() => onToggleFolder(folder.id)}>
              <Ionicons name={offlineFolderIds.includes(folder.id) ? 'checkbox' : 'square-outline'} size={22} color={offlineFolderIds.includes(folder.id) ? '#22c55e' : '#94a3b8'} />
              <Text style={styles.btnText}>{folder.name}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.hint}>Zaznacz podkartoteki, a następnie pobierz ich dokumenty na telefon. Kopie są szyfrowane.</Text>
        </>
      )}
      <TouchableOpacity disabled={vaultSyncing} style={[styles.saveBtn, vaultSyncing && styles.disabledBtn]} onPress={onDownloadSelected}>
        {vaultSyncing ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>Pobierz wybrane na telefon ({offlineFolderIds.length})</Text>}
      </TouchableOpacity>
      <TouchableOpacity disabled={vaultSyncing || syncing} style={[styles.lockNowButton, (vaultSyncing || syncing) && styles.disabledBtn]} onPress={onRemoveOfflineCopies}>
        <Ionicons name="trash-outline" size={17} color="white" />
        <Text style={styles.btnText}>Usuń kopie offline z telefonu</Text>
      </TouchableOpacity>
      {Boolean(vaultProgress) && <Text style={styles.hint}>{vaultProgress}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1e293b', padding: 20, borderRadius: 12, borderColor: '#334155', borderWidth: 1 },
  vaultTitle: { color: 'white', fontSize: 17, fontWeight: 'bold' },
  subText: { color: '#94a3b8', fontSize: 14, marginBottom: 14, marginTop: 4 },
  btn: { backgroundColor: '#3b82f6', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: 'bold' },
  hint: { color: '#94a3b8', fontSize: 12, marginTop: 8, marginBottom: 12 },
  optionLabel: { color: '#cbd5e1', fontSize: 13, fontWeight: '700', marginTop: 12 },
  folderChoice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0f172a', padding: 10, borderRadius: 7, marginTop: 6 },
  saveBtn: { backgroundColor: '#16a34a', padding: 13, borderRadius: 8, alignItems: 'center', marginTop: 10, marginBottom: 10 },
  disabledBtn: { opacity: 0.55 },
  lockNowButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#b91c1c', padding: 12, borderRadius: 8 },
});
