import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchServerSnapshotForConflict,
  getConflictItems,
  resolveConflictKeepServer,
  resolveConflictOverwriteFromPhone,
  type ConflictItem,
} from '../services/offlineSync';
import { errorMessage } from '../utils/errors';

type Props = {
  visible: boolean;
  onClose: () => void;
  onResolved: (info: { pending: number; conflicts: number }) => void;
};

function formatDate(value: unknown): string {
  if (!value) return 'Brak daty';
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? 'Brak daty' : parsed.toLocaleString('pl-PL');
}

function summarizeRecord(entity: ConflictItem['entity'], data: Record<string, unknown> | null): string[] {
  if (!data) return ['Usunięto lub brak na serwerze'];
  if (entity === 'folders') {
    return [
      `Nazwa: ${String(data.name || '—')}`,
      `Zmiana: ${formatDate(data.updatedAt || data.createdAt)}`,
    ];
  }
  const lines = [
    `Tytuł: ${String(data.title || '—')}`,
    `Kartoteka ID: ${String(data.folderId ?? '—')}`,
  ];
  if (data.isArchived) lines.push('Status: W archiwum');
  else if (data.isDeleted) lines.push('Status: W koszu');
  lines.push(`Zmiana: ${formatDate(data.updatedAt || data.createdAt)}`);
  return lines;
}

/** Interactive modal for resolving offline sync conflicts side-by-side (server vs phone). */
export default function ConflictResolutionModal({ visible, onClose, onResolved }: Props) {
  const [items, setItems] = useState<ConflictItem[]>([]);
  const [serverMap, setServerMap] = useState<Record<string, Record<string, unknown> | null>>({});
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadConflicts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getConflictItems();
      setItems(list);
      const entries = await Promise.all(
        list.map(async item => {
          try {
            const snap = await fetchServerSnapshotForConflict(item);
            return [item.queuedAt, snap] as const;
          } catch {
            return [item.queuedAt, null] as const;
          }
        }),
      );
      setServerMap(Object.fromEntries(entries));
    } catch (error: unknown) {
      Alert.alert('Błąd', errorMessage(error, 'Nie udało się pobrać listy konfliktów.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void loadConflicts();
  }, [visible, loadConflicts]);

  const handleKeepServer = async (item: ConflictItem) => {
    setBusyKey(item.queuedAt);
    try {
      const info = await resolveConflictKeepServer(item.queuedAt);
      onResolved(info);
      const remaining = await getConflictItems();
      setItems(remaining);
      if (remaining.length === 0) onClose();
    } catch (error: unknown) {
      Alert.alert('Błąd', errorMessage(error, 'Nie udało się zachować wersji z serwera.'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleOverwriteFromPhone = async (item: ConflictItem) => {
    setBusyKey(item.queuedAt);
    try {
      const info = await resolveConflictOverwriteFromPhone(item.queuedAt);
      onResolved(info);
      const remaining = await getConflictItems();
      setItems(remaining);
      if (remaining.length === 0) onClose();
    } catch (error: unknown) {
      Alert.alert('Błąd nadpisania', errorMessage(error, 'Sprawdź połączenie z komputerem i spróbuj ponownie.'));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>SYNCHRONIZACJA OFFLINE</Text>
              <Text style={styles.title}>Rozwiąż konflikty ({items.length})</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#cbd5e1" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text style={styles.muted}>Pobieranie wersji z serwera…</Text>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="checkmark-circle" size={44} color="#22c55e" />
              <Text style={styles.emptyTitle}>Brak konfliktów</Text>
              <Text style={styles.muted}>Kolejka synchronizacji jest odblokowana.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {items.map(item => {
                const isBusy = busyKey === item.queuedAt;
                const serverLines = summarizeRecord(item.entity, serverMap[item.queuedAt] ?? null);
                const phoneLines = summarizeRecord(item.entity, item.value);
                const entityLabel = item.entity === 'folders' ? 'Kartoteka' : 'Dokument';
                const opLabel = item.operation === 'deleted' ? 'Usunięcie' : 'Edycja';
                return (
                  <View key={item.queuedAt} style={styles.card}>
                    <View style={styles.badgeRow}>
                      <Text style={styles.badge}>{entityLabel} · {opLabel}</Text>
                      <Text style={styles.dateText}>{formatDate(item.detectedAt)}</Text>
                    </View>
                    <Text style={styles.reason}>{item.reason}</Text>

                    <View style={styles.compareRow}>
                      <View style={[styles.sideBox, styles.serverBox]}>
                        <Text style={styles.sideTitle}>Wersja na serwerze</Text>
                        {serverLines.map((line, idx) => (
                          <Text key={idx} style={styles.sideLine}>{line}</Text>
                        ))}
                      </View>
                      <View style={[styles.sideBox, styles.phoneBox]}>
                        <Text style={styles.sideTitle}>Twoja wersja (offline)</Text>
                        {phoneLines.map((line, idx) => (
                          <Text key={idx} style={styles.sideLine}>{line}</Text>
                        ))}
                      </View>
                    </View>

                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        disabled={isBusy}
                        onPress={() => void handleKeepServer(item)}
                        style={[styles.actionBtn, styles.keepServerBtn, isBusy && styles.disabled]}
                      >
                        <Text style={styles.actionText}>Zatrzymaj wersję z serwera</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={isBusy}
                        onPress={() => void handleOverwriteFromPhone(item)}
                        style={[styles.actionBtn, styles.overwriteBtn, isBusy && styles.disabled]}
                      >
                        <Text style={styles.actionText}>Nadpisz z telefonu</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', backgroundColor: '#0f172a', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: '#334155', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  eyebrow: { color: '#60a5fa', fontSize: 11, fontWeight: '700' },
  title: { color: '#ffffff', fontSize: 19, fontWeight: '800', marginTop: 2 },
  closeBtn: { padding: 6 },
  center: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  emptyTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  muted: { color: '#94a3b8', fontSize: 13 },
  list: { paddingTop: 14, paddingBottom: 24, gap: 14 },
  card: { backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#475569', padding: 14, gap: 10 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { color: '#fbbf24', fontSize: 12, fontWeight: '800' },
  dateText: { color: '#94a3b8', fontSize: 11 },
  reason: { color: '#e2e8f0', fontSize: 13, lineHeight: 18 },
  compareRow: { flexDirection: 'row', gap: 8 },
  sideBox: { flex: 1, borderRadius: 8, padding: 10, borderWidth: 1, gap: 4 },
  serverBox: { backgroundColor: '#0f172a', borderColor: '#334155' },
  phoneBox: { backgroundColor: '#172554', borderColor: '#3b82f6' },
  sideTitle: { color: '#93c5fd', fontSize: 11, fontWeight: '800', marginBottom: 2 },
  sideLine: { color: '#e2e8f0', fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  actionBtn: { flex: 1, paddingVertical: 11, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center' },
  keepServerBtn: { backgroundColor: '#334155' },
  overwriteBtn: { backgroundColor: '#2563eb' },
  actionText: { color: '#ffffff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.55 },
});
