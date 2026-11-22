# Architektura danych E-Teczka: co, gdzie i na jakiej bazie jest przechowywane

Ten dokument opisuje faktyczny podział danych i używanych baz danych w obecnym kodzie aplikacji.

---

## 1. Zestawienie skrótowe

| Obszar / Moduł | Technologia bazy / magazynu | Fizyczna lokalizacja | Co tam jest przechowywane |
| :--- | :--- | :--- | :--- |
| **Konta centralne (`konto.arecki.pl`)** | **MariaDB** (w kontenerze na QNAP) + pliki konfiguracyjne | Serwer kont centralnych (`central-accounts`) | Konta użytkowników (`email`, hash hasła, powiązanie Google), sesje konta, aktywne plany/subskrypcje, limity i lista zaufanych urządzeń. |
| **Aplikacja Desktop (Windows)** | **SQLite** (Prisma ORM) + system plików + szyfrowane pliki AES | `backend/prisma/eteczka.db`, `backend/uploads/`, `backend/security/` | Kartoteki, metadane dokumentów, pozycje paragonów, tagi, sesje lokalne, grupa rodzinna, fizyczne pliki PDF/JPG, klucze i sekrety Sejfu. |
| **Wersja testowa WWW (`e-teczkatest.arecki.pl`) — tryb lokalny na dysku** | **File System Access API** (pliki na dysku testera) + uchwyt w `IndexedDB` | Wybrany przez testera folder na jego komputerze (`mojateczka-db.json` + `uploads/`) | Kartoteki, dokumenty, fizyczne pliki PDF/JPG, tagi i analizy danego testera (pełna prywatność, nie opuszczają komputera). |
| **Wersja testowa WWW (`e-teczkatest.arecki.pl`) — serwer QNAP** | **SQLite** (Prisma ORM) w trwałym wolumenie Dockera | Wolumeny na QNAP: `mojateczka_test_db`, `mojateczka_test_uploads`, `mojateczka_test_security` | Konta lokalne, sesje, rejestr zgód (`TesterConsent`), tabela rodziny (`FamilyGroup`/`FamilyMember`/`FamilyInvite`), oraz dokumenty testerów, którzy wybrali tryb serwerowy QNAP. |
| **Aplikacja mobilna (Android)** | **Expo SecureStore** (szyfrowane przez Android Keystore) + pamięć lokalna aplikacji | Pamięć chroniona telefonu | Token sesji, poświadczenia urządzenia, podpisany lease planu, pobrane dokumenty offline oraz szkice skanów. |

---

## 2. Szczegóły bazy SQLite (Prisma ORM)

Plik definicji schematu: [schema.prisma](file:///a:/GitHub/E-Teczka/backend/prisma/schema.prisma) + tabele tworzone automatycznie przez migracje runtime.

### Główne tabele w SQLite (`eteczka.db`):
1. **Konta i sesje:** `User`, `AuthSession`, `CentralAccountLink`
2. **Dokumenty i organizacja:** `Folder`, `FolderShare`, `Document`, `DocumentLineItem`, `Tag`, `DocumentTag`
3. **Grupa rodzinna (Pakiet Rodzinny):** `FamilyGroup`, `FamilyMember`, `FamilyInvite`
4. **Zgody testerów (wersja testowa WWW):** `TesterConsent` (`userId`, `email`, `accepted`, `storageMode`, `policyVersion`, `acceptedAt`)
5. **Plany, limity i synchronizacja:** `Subscription`, `PlanTrial`, `PlanUsage`, `PlanPrinterClaim`, `PlanScanReceipt`, `PlanTagOwner`, `SyncOperation`, `BackupDestination`, `PlanMeta`

---

## 3. Pliki na dysku i szyfrowane magazyny (`backend/security/` i `backend/uploads/`)

- **`backend/uploads/`** (na QNAP wolumen `mojateczka_test_uploads`): oryginalne pliki dokumentów (PDF, PDF/A-2b, obrazy JPG/PNG) oraz tymczasowe szkice skanera (`.scan-drafts`).
- **`backend/security/`** (na QNAP wolumen `mojateczka_test_security`):
  - `auth-secret` — lokalny sekret podpisywania tokenów sesji,
  - `folder-vaults.enc` / `folder-vault.enc` — zaszyfrowane hasła, PIN-y i sekrety TOTP Sejfu przypisane osobno do każdego `ownerId:folderId`,
  - `ocr-queue.enc` — stan kolejki OCR,
  - `backup-mfa.enc`, `account-login-mfa.enc`, `hello-credentials.enc` — zaszyfrowane ustawienia MFA i Windows Hello,
  - `central-entitlements.enc`, `central-plan-journal.enc`, `central-plan-snapshots.enc` — zaszyfrowany cache licencji i zużycia planu,
  - `paired-devices.json`, `local-ca-cert.pem`, `local-ca-key.pem` — lokalny certyfikat TLS i lista sparowanych telefonów.

---

## 4. Dane w przeglądarce użytkownika (`localStorage` i `IndexedDB`)

- **`localStorage`:**
  - `mojateczka_auth_token` — aktywny token sesji logowania,
  - `mojateczka_device_id` — losowy identyfikator przeglądarki/urządzenia,
  - `mojateczka_theme` — wybrany motyw (`dark` / `light` / `system`),
  - `mojateczka_notifications_topbar` — położenie powiadomień (bok aplikacji vs górny pasek),
  - `mojateczka_mobile_onboarding_v1:<email>` — status okna powitalnego aplikacji mobilnej.
- **`IndexedDB` (`mojateczka_tester_local_db_v1`):**
  - Wykorzystywana w wersji testowej WWW, gdy tester wybierze tryb **„Lokalnie w mojej przeglądarce”** (klucz `user:<email>`). Przechowuje foldery, dokumenty, tagi oraz zawartość plików lokalnie po stronie klienta.
