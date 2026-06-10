# QNAP Manager

A local-only desktop app for keeping a media NAS from filling up. It talks to
**Sonarr** (TV) and **Radarr** (movies) over their v3 APIs, shows your whole
library in one sortable table, and lets you tag, review, and delete things to
reclaim space — manually, with an explicit confirmation. It replaces a
hand-rolled "temporary tag" Python cleanup script with a visual, safer workflow.

Built with **Tauri 2** (Rust backend) + **React/TypeScript** (Vite). Single user,
runs on your own machine — there is no server, no auth beyond the *arr API keys.

## Features

- **Unified library** — TV + movies in one table, with always-on filter chips
  (`All / TV / Movies / temporary`) and title search.
- **Space-focused columns** — size on disk, date added, age, and series/movie
  **status** (Continuing / Ended / Upcoming · Announced / In Cinemas / Released),
  all sortable. Default sort is size-descending to surface the biggest offenders.
- **Status filter** — narrow to any status present in your library (e.g. **Ended**)
  and sort by size to find finished shows worth clearing.
- **`temporary` tag toggle** — flag items for cleanup; matched case-insensitively
  and created on the service if it doesn't exist.
- **Delete with confirmation** — single or bulk delete removes the files **and**
  the library entry via the *arr API. The confirm dialog itemizes exactly what
  goes and the total space reclaimed. Deletion is permanent (no undo).
- **Secrets in the OS keychain** — API keys are stored in the macOS Keychain, not
  in plaintext config. Service URLs live in the app config dir.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ (developed on 22)
- [Rust](https://rustup.rs/) 1.80+ (developed on 1.96)
- Platform deps for Tauri 2 — see the
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). (Currently
  targets macOS; the keychain backend is macOS-only.)

## Getting started

```bash
npm install
npm run tauri dev      # run the app
```

On first launch, open **Settings**, enter your Sonarr/Radarr URLs and API keys
(find each key in the service's *Settings → General*), hit **Test connection**
for a green check, then **Save**. The keys are written to the OS keychain; leave
a key field blank later to keep the stored one. The URLs default to a typical
LAN setup and are editable.

### Build a release bundle

```bash
npm run tauri build
```

## Configuration

| What | Where |
|------|-------|
| Sonarr / Radarr URLs, window state | app config dir (`config.json`) |
| API keys | OS keychain (`com.qnapmanager.app`) |

The app works with only one service configured — the other is simply absent.

## How deletion works (safety)

Deletes always go through the Sonarr/Radarr API with `deleteFiles=true`; the app
never touches the filesystem directly — the *arr is the source of truth for both
the database entry and the files. The itemized confirm dialog **is** the preview;
there is no undo, so it's deliberately explicit. Bulk deletes run per-item and
report any individual failures rather than aborting the whole batch.

## Testing

```bash
npm test                                         # frontend (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml  # backend (incl. wiremock integration)
```

## Project layout

```
src/                      React frontend
  api.ts                  typed wrappers over Tauri commands + shared types
  lib/format.ts           byte/age/status formatters
  components/             LibraryTable, ConfirmDeleteDialog, Settings
  App.tsx, App.css        app shell + styles
src-tauri/src/            Rust backend
  models.rs               LibraryItem + raw *arr deserialization/normalization
  client.rs               ArrClient implementing the MediaServer trait
  config.rs               config file + keychain
  commands.rs             Tauri commands (list, tag, delete, bulk, test)
  error.rs, lib.rs        typed errors + library entry point
```

## Status

Local single-user v1. Deferred for later: scheduled/automatic cleanup, Plex
watched-status integration, and surfacing config/save errors in the UI banner.
