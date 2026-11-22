# Roadmapa Etapu 3 — SEO, Domena i Natywne Sklepy (Google Play / App Store)

## 1. Domena i SEO (MojaTeczka)
- Docelowa domena produkcyjna: np. `mojateczka.pl` (strona główna) + `app.mojateczka.pl` (aplikacja) + `konta.mojateczka.pl` (`central-accounts`).
- Metadane w `frontend/index.html` są już ustawione pod SEO (`<title>MojaTeczka — Domowe archiwum dokumentów i paragonów OCR</title>`, `<meta name="description">`, `manifest.webmanifest`, `favicon.png`).
- Po podpięciu domeny: dodać `robots.txt`, `sitemap.xml` oraz tagi Open Graph (`og:title`, `og:description`, `og:image`).

## 2. iOS / iPadOS (gotowe teraz + ścieżka do App Store)
- **Gotowe dziś (PWA):** manifest PWA, tagi Apple, ikona 512×512 MT, instrukcja QR „Do ekranu początkowego” w Safari, wybór plików z Plików / iCloud Drive, obsługa planów Rodzinnych przez Stripe.
- **Konfiguracja natywna w `ETeczkaMobile/app.json`:** ustawiono `bundleIdentifier: "pl.arecki.mojateczka"`, opisy uprawnień iOS (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSFaceIDUsageDescription`) oraz nieprzezroczystą ikonę 1024×1024 `assets/icon.png`.
- **Do wykonania przy publikacji w App Store:**
  1. Rejestracja konta Apple Developer (\$99/rok).
  2. Natywny moduł Swift w `ETeczkaMobile/plugins/withLocalTls` (pinning certyfikatu TLS przez `URLSessionDelegate`, odpowiednik `LocalTls.kt`).
  3. Integracja Apple StoreKit 2 + weryfikacja paragonów App Store w `central-accounts`.
  4. Kompilacja przez Expo EAS Build (`eas build --platform ios`).

## 3. Android (Google Play)
- Zaktualizowano ikony adaptacyjne (`android-icon-foreground.png`, tło `#0F172A`, `splash-icon.png`) i nazwę wyświetlaną `MojaTeczka` w `ETeczkaMobile/app.json`.
- Przed publikacją produkcyjną zmienić `android.package` z `com.anonymous.eteczkamobile` na `pl.arecki.mojateczka` i wygenerować podpisany `.aab`.
