# Plany konta i urządzenia

MariaDB na QNAP jest źródłem przypisania planu: `account_plans` przechowuje konto,
plan (`free`, `standard`, `premium`), status, termin oraz źródło nadania.
`account_devices` przechowuje zaufane instalacje i skróty ich sekretów.
Nowe tabele tworzą się przy starcie kontenera; migracja nie usuwa istniejących danych.
Nowe konto otrzymuje plan Darmowy.

## Aktualizacja

1. Uruchom z pulpitu `Aktualizuj E-Teczka QNAP.cmd` (tryb `-UpdateSecrets`).
2. Uruchom ponownie desktop i zaloguj się raz przez Google lub hasłem konta.
3. Dla telefonu zbuduj i wgraj nowy APK. Klient rejestruje telefon osobno od komputera.

Skrypt wdrożenia zachowuje istniejący klucz podpisywania uprawnień podczas kolejnych
aktualizacji. Klucza prywatnego nie przekazuje się aplikacjom ani do Git.

## Nadanie planu przez administratora

Z katalogu repozytorium, z dostępem do NAS i plikiem `central-accounts/.env`:

```powershell
.\Ustaw-plan-konta.ps1 -Email "uzytkownik@example.com" -Plan standard -DoKiedy "2026-12-31T23:59:59+01:00"
.\Ustaw-plan-konta.ps1 -Email "uzytkownik@example.com" -Plan free
```

Nie ma publicznego API, którym użytkownik może sam nadać sobie płatny plan.
Nie przenosimy automatycznie dawnych subskrypcji `desktop-local`: trzeba ustalić
właściwe konto i potwierdzić istniejącą płatność albo świadome nadanie administracyjne.

## Urządzenia i offline

Domyślne limity zgodne z bieżącym katalogiem: Darmowy — 1 komputer, Standard — 2,
Premium — bez limitu komputerów. Każdy z tych planów ma 1 urządzenie mobilne.
Plan firmowy pozostaje w przygotowaniu. Limit obejmuje zaufane instalacje,
nie tylko jednoczesne sesje. Wylogowanie nie usuwa zaufania.

Na `https://konto.arecki.pl/account` po zalogowaniu można sprawdzić plan i usunąć
poprzednie urządzenie przed dodaniem nowego. Odebranie zaufania jest wykrywane przy
kolejnym odświeżeniu online; istniejąca kopia offline może działać do końca ważności.
Desktop odświeża uprawnienia przy logowaniu i co około 5 minut podczas korzystania
z API. Podpisana kopia uprawnień działa maksymalnie 24 godziny i nigdy dłużej niż
opłacony okres. Dokumenty nie są kasowane. Telefon przechowuje otrzymane przez HTTPS
uprawnienia w systemowym SecureStore i sprawdza ich datę ważności.

## Wspólne liczniki i konfiguracja

`plan_catalog` przechowuje funkcje, ceny, promocje, limity oraz długość okresów.
Panel deweloperski zapisuje konfigurację bezpośrednio do tej tabeli przez
chronione API administracyjne. Sekret `CENTRAL_CATALOG_ADMIN_TOKEN` jest dostępny
tylko w narzędziu deweloperskim i na QNAP-ie; nie trafia do aplikacji użytkowników.
Plik lokalnego katalogu pozostaje jedynie konfiguracją testową dla odizolowanych testów.

`plan_operations` przechowuje wspólne wykorzystanie skanowania aparatem, drukarką
i łączenia plików. `plan_trials` przechowuje początek triala OCR i kopii zapasowych
raz dla całego konta. `plan_inventory` sumuje dokumenty (także kosz i archiwum)
i tagi z jego aktywnych instalacji. Telefon połączony z komputerem nalicza skany
przez ten komputer, więc tej samej operacji nie naliczamy dodatkowo jako operacji telefonu.

`plan_offline_pools` przechowuje oddzielne rezerwacje dokumentów, tagów, skanów
aparatem i drukarką oraz łączenia dla każdej instalacji. Przy logowaniu desktop
próbuje automatycznie pobrać mały przydział: 5 dokumentów, 1 tag, po 5 skanów
każdego rodzaju i 2 łączenia (serwer przydziela najwyżej tyle, ile zostało na koncie).
„Mój plan i limity” → „Przygotuj do pracy offline” pozwala wybrać większe pule lub
wpisać 0, aby oddać niewykorzystaną część po synchronizacji.

Przydział jest dostępny maksymalnie 24 godziny, nie dłużej niż ważność podpisanych
uprawnień i opłacony okres. Po wyczerpaniu lub wygaśnięciu nie odnawia się offline.
Po połączeniu serwer rozlicza dziennik; w tle aplikacja pobiera mały przydział, gdy
nie ma już żadnej dostępnej puli. Różne sieci nie mają znaczenia: każda instalacja
kontaktuje się przez HTTPS z tą samą usługą. Nowa instalacja wymaga logowania online.

Serwer blokuje sumę zużycia i zarezerwowanych pul pod blokadą konta w MariaDB.
**Samo wygaśnięcie lub usunięcie urządzenia nie zwalnia jego nierozliczonej puli.**
Nie wolno przydzielić jej innemu urządzeniu, bo pierwsze mogło wykonać operacje
bez internetu. Utrata instalacji może więc pozostawić rezerwację wymagającą
osobnego uzgodnienia; nie ma automatycznego odzyskiwania jej przez administratora.
Interfejs pokazuje faktyczne wykorzystanie osobno od rezerwacji offline. Pole API `used` zachowuje łączną zajętość, a `reservedOffline` umożliwia odróżnienie rezerwacji od wykonanych operacji.

Dziennik, pule i ostatni stan konta są szyfrowane lokalnie. Wydatek puli jest
zapisywany przed operacją, a jej wynik sprawdzany znacznikiem w tej samej transakcji
SQLite co dokument/skan. Przy awarii lub braku potwierdzenia pozostaje zapis do
ponowienia. Wycofana transakcja oddaje wydatek po uzgodnieniu online. Każda operacja
ma stały identyfikator; powtarzanie potwierdzeń nie nalicza jej ponownie. Zużycie
skanów wykonanych offline jest datowane czasem rozliczenia przez serwer, więc
niewiarygodny zegar klienta nie zwalnia limitu wcześniej. Cofnięcie zegara względem
lokalnego znacznika czasu wstrzymuje korzystanie z puli.

Dokumenty i tagi powstałe offline zastępują zarezerwowane miejsca po przesłaniu
inwentarza. Usunięcie ich offline nie powiększa nowego przydziału przed uzgodnieniem.
Odczyt ostatniego stanu i wcześniej rozpoczęty trial działają do ich ustalonej daty
oraz ważności uprawnień; nowy trial i odtwarzanie kopii wymagają sieci. Telefon może
zachować szkice offline; naliczanie ich importu nadal odbywa się raz na komputerze,
z jego puli (telefon nie nalicza ponownie tego samego dokumentu/skanu).

Przy pierwszym logowaniu po aktualizacji lokalne triale i historia użycia są
importowane jednokrotnie (z zachowaniem najwcześniejszej daty triala). Odtworzenie
kopii nie resetuje centralnych liczników. Zwiększenie liczby dokumentów/tagów
podczas odtwarzania musi zmieścić się we wspólnym limicie konta.

## Zakupy Google Play

To osobna konfiguracja od logowania Google. W `.env` serwera kont potrzebne są:

- `CENTRAL_GOOGLE_PLAY_PACKAGE`: nazwa pakietu aplikacji;
- `CENTRAL_GOOGLE_PLAY_PRODUCTS`: JSON z dokładnym mapowaniem identyfikatorów produktów na `standard`/`premium`;
- `CENTRAL_GOOGLE_PLAY_SERVICE_ACCOUNT`: JSON konta usługi zakodowany Base64, z uprawnieniami Android Publisher.

Zakup musi być przypisany do SHA-256 centralnego identyfikatora konta poprzez
`obfuscatedExternalAccountId`. Serwer sprawdza odpowiedź Google, produkt, konto,
stan i datę ważności; nie ufa planowi przesłanemu z aplikacji. Dopiero wtedy
aktualizuje `account_plans`. Bez tej konfiguracji zakup nie nada uprawnień.
Potwierdzone zakupy i historia uprawnień są zapisywane centralnie w
`account_purchases` i `account_billing_events`. Token zakupu jest szyfrowany kluczem
serwera. Po skonfigurowaniu Google Play serwer ponownie sprawdza zapisane zakupy
co około 15–20 minut, aktualizując okres i stan również bez uruchomionej aplikacji.
Nowe zakupy wymagające potwierdzenia są potwierdzane w Google przed nadaniem planu.
Powiadomienia RTDN nie są wymagane przez ten mechanizm odpytywania i nie zostały
podłączone. Historia potwierdzeń nie udaje faktur: gdy serwer nie zna kwoty
faktycznej płatności, interfejs pokazuje brak kwoty zamiast wymyślonego zera.

## Windows Hello na zaufanym komputerze

Wybranie „Windows Hello — zaufany komputer” w zabezpieczeniach rejestruje klucz
instalacji po zalogowaniu konta i potwierdzeniu natywnym Hello. Kolejne uruchomienie
aplikacji pokazuje automatycznie Windows Hello zamiast formularza konta. Poprawnie
podpisane jednorazowe wyzwanie zaufanej instalacji tworzy sesję 20 minut bez
ponownego kodu Authenticatora. Zwykłe logowanie Google/hasłem nadal wymaga 2FA.
Po nim nie wyświetlamy dodatkowo Hello jako kolejnej blokady. Anulowanie Hello
pozostawia aplikację zamkniętą z możliwością ponowienia lub użycia innej metody.
Wyłączenie Hello odwołuje zapisany klucz; serwer nadal sprawdza limit i zaufanie
urządzenia centralnego. Flaga w żądaniu klienta nie może pominąć MFA.
