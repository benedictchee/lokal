# Beegii — Consumer App

The consumer mobile client for the travel marketplace (subsystem #1). A faithful
Flutter port of the HTML design in `docs/user-app-design/`, targeting **iOS and
Android phones** (no web).

## What's here

A complete, navigable UI built from the design mockups with local mock data
(no backend wiring yet — the Consumer API is a separate, deferred subsystem).

| Tab / screen | File | Notes |
|---|---|---|
| **Explore** | `lib/screens/explore/` | Vertical snap reels feed, action rail, double-tap like, book sheet |
| **Search** (FAB) | `lib/screens/search/` | Live-filtered 3-column reel grid |
| **Plan → Trips** | `lib/screens/trips/` | Trip cards grouped Ongoing / Past |
| **Planner** | `lib/screens/planner/` | Day-by-day timeline + Plan & Stories bottom sheets |
| **Get Inspired** | `lib/screens/inspired/` | New-trip discovery → destination sheet → building loader → planner |
| **Shop** | `lib/screens/shop/` | Experience/product detail + related grid + buy/save footer |
| **Me / Profile** | `lib/screens/profile/` | Guide profile + Account mode (settings sub-screen) |

### Structure

```
lib/
  app.dart            # MaterialApp.router + providers + theme
  router.dart         # go_router: 4 tab branches + full-screen detail routes
  main.dart
  theme/              # colors, typography (DM Sans / Spectral / JetBrains Mono), tokens, gradients, theme
  state/              # AppState (accent, saved/liked), ShellController (dock/chat)
  data/               # models + mock_data (content transcribed verbatim from the mockups)
  widgets/            # BeegiiMedia (placeholder tiles), dock, nav icons, bee mascot, book sheet, toast, primitives
  screens/            # one folder per screen
```

The design system mirrors the CSS custom properties from `Beegii App.html`
(warm neutrals, honey accent, soft shadows, the bezier easings). Imagery uses
deterministic gradient placeholder tiles (`BeegiiMedia`) since the app ships
without photo assets — matching the mockups' fillable image slots.

## Run

```bash
cd apps/consumer-app
flutter pub get
flutter run                      # on a connected device or simulator
```

Build:

```bash
flutter build ios --release      # iOS
flutter build apk --release      # Android
```

## Dependencies

- `go_router` — declarative nav (StatefulShellRoute for the bottom dock)
- `provider` — lightweight app/shell state
- `google_fonts` — DM Sans, Spectral, JetBrains Mono

## Known notes

- **Emoji on the iOS *simulator*** render as empty boxes — a known Flutter
  iOS-simulator color-emoji bug. Flags and category emoji render correctly on
  real iOS and Android devices.
- No network / backend: all content is mock data in `lib/data/mock_data.dart`.
  Booking, save, cart, etc. show toasts (as the mockups do).
