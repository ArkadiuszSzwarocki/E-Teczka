import React, { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { clearIncomingShare, commitIncomingShare, type ParsedIncomingShare } from '../services/incomingShareHandler';

type Props = {
  share: ParsedIncomingShare | null;
  onClose: () => void;
};

/** Confirmation sheet shown when another Android app shares a receipt, PDF, or image to MojaTeczka. */
export default function IncomingShareModal({ share, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [addWarranty, setAddWarranty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!share) return;
    setTitle(share.suggestedTitle);
    setAddWarranty(share.suggestWarranty);
  }, [share]);

  if (!share) return null;

  const dismiss = async () => {
    await clearIncomingShare();
    onClose();
  };

  const save = async () => {
    try {
      setSaving(true);
      const target = await commitIncomingShare(share, title, addWarranty);
      Alert.alert(
        'Zapisano w MojejTeczce',
        target === 'desktop'
          ? 'Dokument został wysłany na komputer i zapisany w kartotece.'
          : 'Dokument został zapisany lokalnie na telefonie. Zsynchronizuje się po połączeniu z komputerem.',
      );
      onClose();
    } catch (error) {
      Alert.alert('Nie udało się zapisać', error instanceof Error ? error.message : 'Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => void dismiss()}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.badge}>Udostępniono do MojejTeczki</Text>
          <Text style={styles.heading}>Zapisz dokument / e-Paragon</Text>
          {(share.detectedStore || share.detectedTotal) && (
            <View style={styles.metaBox}>
              {share.detectedStore ? <Text style={styles.metaText}>Sklep: {share.detectedStore}</Text> : null}
              {share.detectedTotal ? <Text style={styles.metaTotal}>Kwota: {share.detectedTotal}</Text> : null}
            </View>
          )}
          <Text style={styles.label}>Nazwa dokumentu</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Nazwa dokumentu" placeholderTextColor="#64748b" />
          <View style={styles.switchRow}>
            <View style={styles.switchLeft}>
              <Text style={styles.switchTitle}>Dodaj 2-letnią gwarancję / rękojmię</Text>
              <Text style={styles.switchSub}>Przypomnienia push 30, 7 i 1 dzień przed końcem</Text>
            </View>
            <Switch value={addWarranty} onValueChange={setAddWarranty} />
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} disabled={saving} onPress={() => void dismiss()}>
              <Text style={styles.cancelText}>Anuluj</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, saving && styles.disabled]} disabled={saving} onPress={() => void save()}>
              <Text style={styles.saveText}>{saving ? 'Zapisywanie…' : 'Zapisz'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#0f172a', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: '#334155', padding: 20, gap: 12 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#1d4ed8', color: '#eff6ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  heading: { color: '#ffffff', fontSize: 19, fontWeight: '800' },
  metaBox: { backgroundColor: '#1e293b', borderRadius: 10, padding: 12, gap: 4 },
  metaText: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  metaTotal: { color: '#60a5fa', fontSize: 16, fontWeight: '800' },
  label: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  input: { backgroundColor: '#020617', borderWidth: 1, borderColor: '#475569', borderRadius: 10, color: '#ffffff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  switchLeft: { flex: 1 },
  switchTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '700' },
  switchSub: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: '#475569', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#cbd5e1', fontWeight: '700' },
  saveBtn: { flex: 1.4, backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: '#ffffff', fontWeight: '800' },
  disabled: { opacity: 0.6 },
});
