# React + TypeScript + Vite

## Panel deweloperski E-Teczki

Adres: http://127.0.0.1:5173/developer. Backend wymaga MOJATECZKA_DEV_PLANS=1 i środowiska innego niż production. Dostęp tylko z lokalnego komputera i interfejsu na porcie 5173.

Panel zapisuje konfigurację w backend/security/developer-plan-catalog.json. Limity i uprawnienia obowiązują lokalnie w trybie deweloperskim. Puste pole oznacza brak limitu, zero oznacza zerową pulę. Zmiana okresu próbnego wpływa też na koniec rozpoczętej próby. Zmniejszenie liczby urządzeń blokuje nowe połączenia; nie wylogowuje wcześniej połączonych urządzeń. Limit telefonów jest ustalany przy pobraniu nowego kodu parowania.

Ceny i promocje służą do projektowania oferty i podglądu. Nie aktualizują Stripe, Google Play ani cennika użytkownika. Daty w formularzu są lokalne, zapis w UTC. Początek promocji jest włączony, koniec wyłączony. Rabaty nie sumują się — obowiązuje największy aktywny rabat. Plan Firmowy pozostaje w przygotowaniu.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
