# Project Prompt: Waypoint (Batch Download Manager, Electron/Windows App)

## Context

Build **Waypoint**, a Windows desktop application that replaces JDownloader for a specific personal use case: batch-downloading files from a handful of file-hosting sites that are protected by Cloudflare Turnstile bot verification. The app resolves captchas one at a time via a real Chrome tab, then downloads the resulting files in parallel batches, with optional archive extraction.

**Branding:** app name is "Waypoint," tagline "Open Source Downloader." Logo is an arrow/compass mark (light gray/white on black). Use this name consistently for the window title, installer product name, `package.json` name field, and repo name.

## Core Stack

- **Shell:** Electron (chosen over Tauri/pywebview because Playwright needs a Node/Chromium runtime anyway — Electron *is* that runtime, avoiding a sidecar process)
- **Browser automation:** Playwright (Node), using a **persistent Chrome profile** (not incognito/fresh context) to maximize Cloudflare Turnstile's natural self-solve rate
- **Downloads:** `aria2c`, spawned as a child process and controlled via its JSON-RPC interface, for multi-connection chunked/resumable downloads
- **Extraction:** shell out to **WinRAR** (`WinRAR.exe x -o+ "<archive>" "<dest_folder>"`), assume it's installed on the user's system
- **Local state/queue:** SQLite via `better-sqlite3`
- **UI:** Electron renderer process, plain HTML/CSS/JS (or React if it speeds things up) — functional over fancy, this is a personal tool
- **Packaging:** `electron-builder` → NSIS installer with install wizard (install location picker, shortcuts, uninstaller)
- **Auto-update:** `electron-updater` with the **GitHub Releases provider** — app checks the repo's latest release on launch, downloads and silently installs updates

## Functional Flow

### 1. Link intake
- User pastes a blob of URLs (e.g. 20 links) into a text area
- App parses, splits by newline, dedupes, validates as URLs
- Links appear in a queue table with status `Pending`

### 2. Captcha resolution (sequential, one tab at a time)
- User clicks "Resolve" to start
- App opens **one** Playwright-controlled Chrome tab for the first link
- Tab loads the page; app polls for Cloudflare Turnstile state
  - If it self-solves within a few seconds (common when using a persistent, human-like profile), proceed automatically
  - If not, the tab stays visible/focused for the user to manually click the verify checkbox
- Once verified, app extracts the **direct download link** (or the necessary session cookies/auth token) from the resulting page, closes the tab, and **automatically opens the next tab** for the next link in the queue
- Progress indicator shown throughout: `Resolving 7/20...`
- Each link's status updates to `Resolved` (with its direct link stored) or `Failed` if resolution errors out
- Once all links are resolved, app returns to the main queue view with a "Batch ready — X/Y resolved" summary

### 3. Destination & batch setup
- Before downloads start, prompt the user for:
  - A base folder path (native Windows folder picker)
  - A batch/job name → app creates `<base_folder>/<job_name>/` and downloads everything there
  - An extraction toggle: **"Extract archives after download?"** Yes/No (default: remember last choice)

### 4. Downloading
- User confirms → downloads start via aria2c, **4 concurrent at a time**, rest queued
- Per-file progress (speed, %, ETA) shown in the queue table, aggregated batch progress shown at top
- Support pause/resume per file and for the whole batch

### 5. Extraction (if enabled)
- Once all files in the batch folder have finished downloading, shell out to WinRAR to extract any archives (including multi-part RARs) into the same folder
- Leave both extracted contents and original archives unless the user later asks for a "delete originals after extract" option — don't build that toggle yet, just leave archives in place

## Non-functional requirements

- **App name:** Waypoint. Use it as the `package.json` `name`/`productName`, the Electron `BrowserWindow` title, the NSIS installer's product name, and the repo name (e.g. `waypoint` or `waypoint-downloader`)
- **Branding/theme:** dark UI (black/near-black background, white/light-gray text and accents) to match the logo's look — this isn't a hard requirement but is the natural default given the existing branding
- **Single Windows installer** (`.exe`) built via `electron-builder`, with a proper install wizard (NSIS)
- **Auto-update** via `electron-updater` pointed at GitHub Releases — new tagged releases should be detected and installed with minimal user friction
- Local-only app — no backend server, no telemetry, no external services beyond the hosts being downloaded from and GitHub (for updates)
- Should run comfortably on a 16GB RAM / RTX 4060 (6GB VRAM) machine — resource use isn't a hard constraint, but avoid anything wasteful (e.g., don't keep more than one Playwright browser context open at a time given the sequential-tab design)

## Suggested build order

1. Scaffold the Electron app (main process, renderer, basic window) + `electron-builder` config producing a working installer for a "hello world" build. Set the app name to "Waypoint" in `package.json`, window title, and installer config; app icon should use the Waypoint logo (arrow/compass mark) once available as `.ico`
2. Link intake UI + SQLite queue schema (id, url, status, direct_link, batch_id, etc.)
3. Playwright resolver module: open tab → detect Turnstile → wait/allow manual click → extract direct link → close tab → advance to next link
4. aria2c integration: spawn process, RPC calls to add/monitor downloads, concurrency capped at 4
5. Folder picker + batch folder creation logic
6. WinRAR extraction step, gated by the toggle
7. `electron-updater` + GitHub Releases wiring, verify with a real tagged release
8. Polish: progress UI, error states (failed resolve, failed download, extraction errors), pause/resume

## Open questions to resolve during build (not blocking, but flag if relevant)

- Exact DOM/selector strategy for detecting "Turnstile verified" state and extracting the direct download link will differ per host — the resolver should be written generically enough that per-host quirks can be isolated into small config/adapter objects rather than hardcoded throughout
- Whether Chromium/Playwright browser binaries ship bundled in the installer (larger install, works offline) or download on first run (smaller install, needs internet once) — default to bundling unless installer size becomes a real problem
