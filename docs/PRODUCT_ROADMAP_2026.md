# Roadmapa Produktowa 2026 — MojaTeczka (Rynek PL)

Dokument zbiera kluczowe wyróżniki przewagi konkurencyjnej dla rynku polskiego w 2026 roku, dopasowane do struktury planów **MojaTeczka**.

---

## 1. e-Paragony (QR / HUB MF / sklepy sieciowe) — Plan Premium & Rodzinny

**Cel:** Bezpośrednia przewaga i obrona przed aplikacjami typu PanParagon poprzez 100% dokładność danych bez błędów OCR na pogniecionych paragonach.

### Zakres i wpięcie w architekturę
- **Źródła danych:**
  - Skanowanie kodu QR e-paragonu w `CameraCaptureModal` / aplikacji mobilnej (`ETeczkaMobile`).
  - Import e-paragonów PDF/JSON z aplikacji sieciowych (Biedronka, Lidl, Rossmann, Orlen) oraz rządowego HUB-a e-Paragonów (przez poczekalnię `mailInbox` i `watchFolder`).
- **Backend (`backend/services/eReceiptParser.ts`):**
  - Deterministyczne wyciąganie nazwy sklepu (`merchantName`), kwoty (`amountCents`), daty zakupu oraz pozycji (`DocumentLineItem`) z automatyczną kategoryzacją.
  - Automatyczne ustawianie terminu gwarancji/rękojmi (`retentionEnabled`, `retentionValue = 2`, `retentionUnit = 'years'`) dla elektroniki, AGD i obuwia.
- **Frontend (`ReceiptInsightsPanel.tsx`):**
  - Zasilanie istniejącego panelu „Paragony: zakupy wg sklepów i artykułów” bez zmian w schemacie bazy.

---

## 2. KSeF (Krajowy System e-Faktur) — Plan Firmowy (JDG)

**Cel:** Silny argument sprzedażowy dla jednoosobowych działalności gospodarczych (JDG) — trzymanie faktur KSeF razem z umowami, gwarancjami i paragonami w jednej prywatnej bazie (dysk / NAS) oraz eksport jednym kliknięciem do księgowej.

### Etap 1 — Import i podgląd KSeF XML (`FA(2)` / `FA(3)`) (bez integracji API MF)
- **Backend (`backend/services/ksefXmlParser.ts`):**
  - Obsługa plików `.xml` zgodnych ze schemą `FA(2)` / `FA(3)` przy użyciu istniejącej biblioteki `fast-xml-parser` (już zainstalowanej w `backend/package.json`).
  - Bezpośrednie wyciąganie: sprzedawcy (`Podmiot1`), NIP, numeru faktury, kwoty brutto/netto (`P_15`), waluty, terminu płatności i pozycji bez uruchamiania OCR.
  - Zapis oryginalnego XML + wygenerowanie czytelnego podglądu PDF do `DocumentPreviewModal`.
- **Eksport dla księgowej (`backend/services/accountantExport.ts`):**
  - Automatyczne dołączanie par `XML + PDF` oraz zbiorczego zestawienia CSV do miesięcznej paczki ZIP.

### Etap 2 — Automatyczne pobieranie faktur z API KSeF
- **Backend (`backend/services/ksefSyncService.ts`):**
  - Zaszyfrowane przechowywanie tokenu autoryzacyjnego KSeF użytkownika (analogicznie do kont IMAP w `mailInbox`).
  - Okresowe lub ręczne pobieranie nowych faktur kosztowych prosto do poczekalni z automatyczną propozycją kartoteki.

---

## 3. Powiązane dokumenty
- Architektura monorepo: `docs/MONOREPO.md`
- Sklepy (Google Play, App Store) i ASO: `docs/IOS_AND_SEO_ROADMAP.md`
