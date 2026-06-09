# QNAP Manager — Design Spec

**Date:** 2026-06-09
**Status:** Approved (design phase)

## Purpose

A local-only desktop app for one user that replaces a hand-rolled python "temporary tag"
deletion script. It manages limited NAS storage by letting the user browse their Sonarr (TV)
and Radarr (movies) libraries, see what each item costs on disk, tag items as `temporary`,
and delete items (files + library entry) — manually, with an explicit confirmation step.

This is a single-user tool running on the user's own machine. The build is kept lean
accordingly: no multi-user concerns, no auth beyond the *arr API keys, lightweight testing.

## Scope

### In scope (v1)
- Desktop app built with **Tauri + Rust backend + React frontend** (TanStack Table).
- Connect to **Sonarr** and **Radarr** via their v3 REST APIs.
- Browse the **full combined library** in one unified, sortable table.
- Per-item: show **size on disk**, **date added**, computed **age** (sortable),
  **toggle the `temporary` tag**, **delete now** (removes files + library entry via the
  *arr API, with confirmation).
- **Bulk select + act**: select many items and tag or delete them in one action.
  Selection is manual — click rows, shift-click for ranges, and a "select all (filtered)"
  checkbox in the header that selects everything currently visible under the active filter.
  "Everything over X GB" is achieved by sorting the Size column descending and range-selecting;
  there is no dedicated size-threshold filter in v1.
- Always-available filter chips: `All / TV / Movies / temporary` + title search.
- Settings screen with per-service "Test connection".

### Out of scope (v1)
- Automatic / scheduled cleanup (manual review-and-delete only).
- Plex / Overseerr integration and watched-status (no Plex in v1).
- Age-based or watched-based auto-eligibility rules.
- Undo (deletion is permanent by nature of the *arr API).
- Multi-user, remote access, mobile.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Tauri App                                     │
│  ┌─────────────────┐  commands   ┌──────────┐  │
│  │ React frontend  │ ──────────► │  Rust     │ │
│  │ (TanStack Table │ ◄────────── │  backend  │ │
│  │  + UI state)    │   results   │           │ │
│  └─────────────────┘             └────┬──────┘  │
└───────────────────────────────────────┼─────────┘
                                         │ HTTPS + API key
                         ┌───────────────┴───────────────┐
                         ▼                               ▼
                   Sonarr API (v3)                 Radarr API (v3)
                   TV library                      movie library
```

### Rust backend modules
- **`config`** — load/save connection settings. Non-secret config (service URLs, window
  state) lives in Tauri's app-config dir; **API keys live in the OS keychain** via the
  `keyring` crate (not plaintext).
- **`client`** — thin HTTP client wrappers for Sonarr and Radarr, both implementing a shared
  **`MediaServer` trait** (`list`, `update_tags`, `delete_with_files`, `list_tags`,
  `test_connection`). This trait is the load-bearing abstraction: everything above speaks in
  normalized items, not service-specific shapes. Adding a third *arr or Plex later = one new
  impl, nothing above changes.
- **`models`** — serde structs for the normalized **`LibraryItem`** (id, title, service,
  `size_on_disk`, `added` timestamp, tags, …) plus the raw Sonarr/Radarr response shapes, and
  the pure normalization functions (raw JSON → `LibraryItem`). `added` parses the *arr ISO
  format (`%Y-%m-%dT%H:%M:%SZ`); **age** is derived at render time (now − added), not stored.
- **`commands`** — the Tauri command layer the frontend calls: `list_library`,
  `toggle_temporary_tag`, `delete_item`, `bulk_delete`, `test_connection`, `get_config`,
  `save_config`. Thin orchestration only.

### Frontend
- One main **unified table view** + a **settings screen**.
- Sorting, filtering (chips + search), and row selection are **client-side** over the
  in-memory list — no re-fetch needed to sort/filter.
- React holds UI state; the backend holds no session state beyond cached config.

## Data flow

**Load:**
1. On start, `config` loads URLs + keys; frontend calls `list_library`.
2. Rust calls Sonarr `/api/v3/series` and Radarr `/api/v3/movie` **in parallel**, reads
   `sizeOnDisk` and `tags`, resolves tag IDs → names via each service's `/api/v3/tag`, and
   normalizes into one `Vec<LibraryItem>`.
3. Frontend renders the combined list; sort/filter/select are client-side.
4. App is usable with **only one service configured** — the missing one is simply absent.

**Tag toggle:** `toggle_temporary_tag(item)` PUTs the updated tag set back to the item.
The `temporary` tag is matched **case-insensitively** on its `label` (mirrors the existing
scripts). If no matching tag exists on that service, it is created first. Optimistic UI
update, reconciled on success.

**Delete (safety model):**
- Deletion always goes through the *arr API with `deleteFiles=true` and
  `addImportExclusion=false`. The app **never touches the filesystem directly** — the *arr is
  the source of truth for both DB entry and files.
- **Confirmation = preview.** Choosing delete opens a dialog listing exactly what will be
  deleted (titles, count, **total reclaimed size**) and requires an explicit confirm click.
  For bulk, the dialog shows the full itemized list. Confirmation friction: itemized dialog +
  single click (no typed confirmation).
- **Bulk deletes run sequentially**, collecting per-item success/failure; one failure does
  not abort the rest. A result summary reports successes and failures.
- **No undo** — permanent by design; the explicit confirm dialog is the safety net.

## Error handling
- All Rust commands return `Result` with a typed error enum: `Network`, `Auth`, `NotFound`,
  `Api { status, msg }`, `Config`.
- Frontend maps errors to clear inline messages (e.g. "Can't reach Sonarr at <url> — check
  it's running" vs "Sonarr rejected the API key").
- A failed load of one service does not blank the table; the other still renders, with a
  dismissible banner for the failed one.
- Bulk-delete failures surface per-item in the result summary.

## Config & secrets
- Settings screen: Sonarr URL + key, Radarr URL + key, each with a **"Test connection"**
  button (calls `/api/v3/system/status`) for a green check before saving.
- API keys → OS keychain (`keyring` crate). URLs + window state → Tauri app-config dir.

## Testing (lean, single-user tool)
- **Rust unit tests** for `models` normalization (recorded Sonarr/Radarr JSON fixtures →
  `LibraryItem`) and the tag-set diffing logic — pure functions.
- **Client tests** against a mock HTTP server (`wiremock`): list, tag update, delete, and the
  error-mapping paths.
- Command layer stays thin enough to not need dedicated tests.
- Frontend: light component tests on the table (sort/select/filter) and the confirm dialog.
- No e2e harness in v1.

## UI (approved layout)
Unified table (option A): single sortable list of TV + movies. Columns: select checkbox,
**Title**, **Type** (TV/Movie), **Tags**, **Date Added**, **Age** (e.g. `47d`), **Size**.
Always-present filter chips `All / TV / Movies / temporary` plus a title search box.
A selection bar shows count + total selected size and exposes **Tag temporary** and
**Delete** actions. Size and Age columns sortable (default sort: size descending, to surface
space hogs). Rows in the current selection are visually highlighted.

## Reference: existing setup (from the python scripts)

The repo's `temporary/` scripts (kept for reference, **git-ignored** because they contain
hardcoded keys) establish the real environment:

- **Sonarr (TV):** `http://192.168.40.103:8989`
- **Radarr (movies):** `http://192.168.40.103:7878`
- Both use the **pyarr** client against the v3 API: `get_series` / `get_movie`,
  `get_tag`, `del_series` / `del_movie`.
- Tag label is `temporary`, matched case-insensitively.
- Items expose `added` (ISO `%Y-%m-%dT%H:%M:%SZ`); the scripts' rule is delete 60 days after
  `added`. v1 surfaces Date Added + Age as columns but does **not** auto-delete.

The settings screen pre-fills these two URLs as defaults (editable). The hardcoded API keys
in the scripts should be **rotated** and are never copied into the new app's source — keys are
entered once in settings and stored in the OS keychain.

## Key decisions log
- **Tauri + Rust backend** (not TS-only / Electron): keeps API keys out of the webview,
  avoids local-network CORS, tiny binary.
- **`MediaServer` trait** as the normalization boundary over Sonarr/Radarr.
- **Delete via *arr API only**, never direct filesystem.
- **OS keychain** for API keys over plaintext config.
- **Manual-only v1**; automation, Plex, and rule-based eligibility deferred.
