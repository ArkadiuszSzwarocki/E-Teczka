# Architektura Monorepo — MojaTeczka

Repozytorium utrzymuje wszystkie moduły ekosystemu **MojaTeczka** w jednym miejscu, przy zachowaniu ścisłych granic między aplikacjami i niezależnych celów wdrożenia.

## Mapa modułów

| Katalog | Rola | Cel wdrożenia |
|---|---|---|
| `frontend/` | Interfejs Web + PWA (React, Vite, Tailwind) — obsługuje Windows, macOS, Android i iOS Safari PWA | Obraz Docker `mojateczka-test` + paczka Electron |
| `backend/` | Lokalny i serwerowy backend dokumentów, OCR, paragonów, kopii zapasowych (Express + Prisma SQLite) | Obraz Docker `mojateczka-test` + wbudowany serwer Electron |
| `desktop/` + `main.js` + `preload.js` | Powłoka desktopowa Electron (Windows Hello + macOS Touch ID, WIA na Windows, zasobnik, zaufana baza) | Instalator Windows (`nsis`) i macOS (`dmg`/`zip`) |
| `central-accounts/` | Serwis centralnych kont, urządzeń, planów i rozliczeń (MariaDB) | Kontener `mojateczka-accounts` na QNAP |
| `share-service/` | Niezależny serwis bezpiecznego udostępniania linków | Kontener `mojateczka-share-test` na QNAP |
| `MojaTeczkaMobile/` | Natywna aplikacja mobilna (Expo / React Native) | Android APK / Google Play (i docelowo iOS App Store) |
| `packages/shared/` | Wspólne kontrakty domeny (`@mojateczka/shared`): kody błędów API, identyfikatory planów i stałe marki | Współdzielone między modułami |

## Komendy weryfikacyjne (z katalogu głównego)

- `npm run check:desktop` — testy modułów Electron (w tym kompatybilność macOS/Windows)
- `npm run check:backend` — `typecheck`, `build` oraz `build:dist` dla backendu
- `npm run check:frontend` — `lint`, `typecheck` oraz `vite build` dla frontendu/PWA
- `npm run check:all` — pełna weryfikacja wszystkich warstw przed wdrożeniem
- `npm run build:win` / `npm run build:mac` — budowanie instalatora desktopowego MojaTeczka

## Roadmapy produktowe
- `docs/IOS_AND_SEO_ROADMAP.md` — Google Play, App Store (iOS), ASO oraz rozdzielenie `DEV` vs `release`
- `docs/PRODUCT_ROADMAP_2026.md` — plan wdrożenia **e-Paragonów (QR)** oraz **KSeF (XML FA(2)/FA(3) + API)** na rynek PL 2026
