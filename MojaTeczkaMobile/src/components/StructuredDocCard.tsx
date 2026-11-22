import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildStructuredDocPrintHtml, type StructuredDocView } from '../services/structuredDocumentParser';

type Props = {
  doc: StructuredDocView;
  rawText: string;
};

/** Visual mobile card for KSeF XML invoices and e-Receipt JSON documents with PDF sharing. */
export default function StructuredDocCard({ doc, rawText }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const shareAsPdf = async () => {
    try {
      setExportingPdf(true);
      const html = buildStructuredDocPrintHtml(doc);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${doc.badge} — ${doc.number}` });
      } else {
        Alert.alert('PDF gotowy', `Zapisano plik: ${uri}`);
      }
    } catch {
      Alert.alert('Nie udało się wygenerować PDF', 'Spróbuj ponownie lub udostępnij oryginalny plik.');
    } finally {
      setExportingPdf(false);
    }
  };

  if (showRaw) {
    return (
      <View style={styles.container}>
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowRaw(false)}>
            <Ionicons name="card-outline" size={16} color="#93c5fd" />
            <Text style={styles.toggleText}>Wróć do karty</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.rawContent}>
          <Text selectable style={styles.rawText}>{rawText}</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.cardContent}>
      <View style={styles.topRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{doc.badge}</Text>
        </View>
        <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowRaw(true)}>
          <Ionicons name="code-slash-outline" size={15} color="#93c5fd" />
          <Text style={styles.toggleText}>XML / JSON</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.docNumber}>{doc.number}</Text>
      <View style={styles.metaRow}>
        {doc.issueDate ? <Text style={styles.metaText}>Wystawiono: {doc.issueDate}</Text> : null}
        {doc.dueDate ? <Text style={styles.metaText}>Termin: {doc.dueDate}</Text> : null}
      </View>

      <View style={styles.partyBox}>
        <Text style={styles.partyLabel}>SPRZEDAWCA</Text>
        <Text style={styles.partyName}>{doc.sellerName}</Text>
        {doc.sellerNip ? <Text style={styles.partySub}>NIP: {doc.sellerNip}</Text> : null}
      </View>

      {doc.buyerName ? (
        <View style={styles.partyBox}>
          <Text style={styles.partyLabel}>NABYWCA</Text>
          <Text style={styles.partyName}>{doc.buyerName}</Text>
          {doc.buyerNip ? <Text style={styles.partySub}>NIP: {doc.buyerNip}</Text> : null}
        </View>
      ) : null}

      {doc.items.length > 0 ? (
        <View style={styles.itemsCard}>
          <Text style={styles.sectionTitle}>Pozycje ({doc.items.length})</Text>
          {doc.items.map((item, idx) => (
            <View key={`${idx}-${item.name}`} style={styles.itemRow}>
              <View style={styles.itemLeft}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemSub}>
                  Ilość: {item.quantity}{item.vatRate ? ` · VAT ${item.vatRate}` : ''}
                </Text>
              </View>
              <Text style={styles.itemTotal}>{item.total} {doc.currency}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.totalsCard}>
        {doc.netTotal ? <Text style={styles.totalSub}>Netto: {doc.netTotal} {doc.currency}</Text> : null}
        {doc.vatTotal ? <Text style={styles.totalSub}>VAT: {doc.vatTotal} {doc.currency}</Text> : null}
        {doc.grossTotal ? <Text style={styles.totalGross}>Razem: {doc.grossTotal} {doc.currency}</Text> : null}
      </View>

      <TouchableOpacity style={[styles.pdfBtn, exportingPdf && styles.pdfBtnDisabled]} disabled={exportingPdf} onPress={() => void shareAsPdf()}>
        <Ionicons name="document-text-outline" size={18} color="#ffffff" />
        <Text style={styles.pdfBtnText}>{exportingPdf ? 'Generowanie PDF…' : 'Udostępnij jako PDF'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', padding: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  scroll: { flex: 1, backgroundColor: '#020617' },
  cardContent: { padding: 14, gap: 12 },
  rawContent: { padding: 14 },
  rawText: { color: '#e2e8f0', fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: '#1d4ed8', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#eff6ff', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  toggleText: { color: '#93c5fd', fontSize: 12, fontWeight: '700' },
  docNumber: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metaText: { color: '#94a3b8', fontSize: 12 },
  partyBox: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#1e293b', borderRadius: 10, padding: 12 },
  partyLabel: { color: '#60a5fa', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  partyName: { color: '#f8fafc', fontSize: 14, fontWeight: '700', marginTop: 4 },
  partySub: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  itemsCard: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#1e293b', borderRadius: 10, padding: 12, gap: 10 },
  sectionTitle: { color: '#cbd5e1', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 8 },
  itemLeft: { flex: 1 },
  itemName: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  itemSub: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  itemTotal: { color: '#93c5fd', fontSize: 13, fontWeight: '700' },
  totalsCard: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#1d4ed8', borderRadius: 10, padding: 14, alignItems: 'flex-end', gap: 4 },
  totalSub: { color: '#cbd5e1', fontSize: 13 },
  totalGross: { color: '#60a5fa', fontSize: 20, fontWeight: '800', marginTop: 2 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 13 },
  pdfBtnDisabled: { opacity: 0.6 },
  pdfBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
});
