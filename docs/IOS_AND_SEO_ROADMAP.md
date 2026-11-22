# Roadmapa Sklepów — Google Play, App Store i ASO (MojaTeczka)

## 1. Rozdzielenie wersji testowej (DEV) i produkcyjnej (Sklep) na jednym telefonie
- **Wersja testowa (`Buduj i wgraj telefon.ps1` -> `:app:assembleDebug`):**
  - ID paczki: `pl.arecki.mojateczka.dev` (`applicationIdSuffix '.dev'`)
  - Nazwa na telefonie: **MojaTeczka DEV** (`android/app/src/debug/res/values/strings.xml`)
- **Wersja produkcyjna (Google Play -> `:app:bundleRelease`):**
  - ID paczki: `pl.arecki.mojateczka`
  - Nazwa na telefonie: **MojaTeczka** (`android/app/src/main/res/values/strings.xml`)
- Dzięki temu na tym samym telefonie mogą działać równolegle obie aplikacje bez nadpisywania danych ani konfliktów podpisu.

## 2. ASO (Google Play & App Store)
- **Tytuł w sklepie (max 30 znaków):** `MojaTeczka: Skaner i Dokumenty`
- **Krótki opis (max 80 znaków):** `Domowe archiwum dokumentów, paragonów i faktur OCR z ochroną RODO i kopią NAS.`
- **Słowa kluczowe:** skaner dokumentów, paragony OCR, faktury, gwarancje, umowy, domowe archiwum, kartoteki, RODO, sejf, kopia zapasowa NAS.
- **Grafiki:** ikona 3D **MT** (`ETeczkaMobile/assets/icon.png` 1024×1024), baner `og-image.png` (`1200×630` jako baza dla banera `1024×500` w Google Play).

## 3. Wymagania formalne sklepów
- Publiczny link HTTPS do **Polityki prywatności** oraz strony **usuwania konta** (udostępniane przez `central-accounts`).
- **Google Play:** podpisany plik `.aab` + produkty subskrypcyjne zsynchronizowane z `googlePlayBilling.ts`.
- **iOS (App Store):**
  - Gotowe dziś: pełne PWA w Safari (z `manifest.webmanifest`, ikoną **MT**, aparatem OCR i obsługą planu Rodzinnego przez Stripe) oraz konfiguracja `ios.bundleIdentifier: "pl.arecki.mojateczka"` i uprawnienia `infoPlist` w `ETeczkaMobile/app.json`.
  - Przy publikacji natywnej w App Store: konto Apple Developer (\$99/rok), moduł Swift dla TLS pinningu (odpowiednik `LocalTls.kt`), integracja Apple StoreKit 2 oraz kompilacja przez Expo EAS Build (`eas build --platform ios`).
