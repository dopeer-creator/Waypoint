<p align="center"><img src="docs/banner.png" alt="Waypoint — Open Source Downloader" width="720"></p>

Waypoint is a free, open-source download manager for Windows, in the spirit of JDownloader. It's built for
free file hosts — the ones with "Continue", "Free Download" and countdown pages, often behind a Cloudflare
check. Paste a pile of links, and Waypoint works through those pages for you, downloads every file in parallel,
and unpacks the archives at the end.

- [Install](#install)
- [How to use Waypoint](#how-to-use-waypoint) — step by step
- [Resolve modes](#resolve-modes) — Automatic vs. In your browser
- [Settings worth knowing](#settings-worth-knowing)
- [Troubleshooting](#troubleshooting)
- [Themes](#themes)
- [For developers](#development)

## Install

1. Download `Waypoint-Setup-<version>.exe` from the [latest release](https://github.com/dopeer-creator/Waypoint/releases/latest).
2. Run it. The installer isn't code-signed yet, so Windows SmartScreen may warn you: click **More info → Run
   anyway**.
3. Make sure you have **Google Chrome** or **Microsoft Edge** installed (Waypoint uses it to open the host
   pages), and **WinRAR** if you want archives unpacked automatically.

Waypoint updates itself. It checks for a new version when it opens and every few hours after; while one
downloads, the bottom of the sidebar says so in color, and **Restart to update** installs it.

## How to use Waypoint

### 1. Add your links

Open **Link Grabber** (the first page). Any of these works:

- **Paste** links into the big box — one per line, or any text that contains them — then click **Add links**
  (or press <kbd>Ctrl</kbd> + <kbd>Enter</kbd>).
- **Copy links straight off a web page** and paste. If you copied the link *text* (like a list of file names),
  Waypoint still finds the real addresses behind them.
- **Drop a `.txt`, `.csv` or saved `.html` file** of links onto the box, or use **Import from file**.
- **Clipboard watching** (off by default, in Settings): when you copy download links anywhere, Waypoint asks
  whether to add them. It only asks about links that look like files, asks once for a burst of copies, and you
  can mute a host with **Never for …**.

Duplicates are dropped, and each link shows up as **Pending**.

### 2. Choose how links get resolved

A host's share link isn't the file itself — someone has to click through its pages to reach the real download.
That's "resolving", and Waypoint can do it two ways (**Settings → Link resolving**):

- **Automatic** (the default) — Waypoint opens the links in its own Chrome window and clicks through for you.
- **In your browser** — links open as normal tabs in your own browser; you click Download, and a small
  Waypoint browser extension hands the file over. Needs a one-time extension install.

Not sure? Start with Automatic. [Resolve modes](#resolve-modes) explains both in more detail.

### 3. Resolve

Click **Resolve**. The first time, a short guide explains what's about to happen.

**In Automatic mode:**

- A Chrome window opens and Waypoint works through several links at once, clicking "Continue", "Free
  Download" and so on, and waiting out countdowns.
- **Don't click inside those tabs and don't close them** — a stray click can hit an ad and throw a link off.
  They close themselves.
- If a tab jumps to the front and Waypoint shows **Needs you**, it's a Cloudflare check: complete it, then leave
  the tab alone again.
- **Skip** gives up on the link being worked on; **Stop** ends the run (finished links are kept).

**In your browser mode:** each link opens as a tab in your browser. Pass any check, click the host's Download
button as usual, and Waypoint takes the file from there.

As links finish they turn **Resolved**. A link that fails can be retried with the retry button on its row.

### 4. Start the downloads

When links are resolved, click **Start downloads**. In the dialog:

- **Save to** — the folder to download into. Each batch gets its own subfolder, named after the batch.
- **Batch name** — Waypoint suggests one from the file names. If you pasted several games at once, **Separate
  batch per app** gives each its own batch and folder.
- **Extract archives after download** — unpacks the `.rar` / `.zip` / `.7z` sets with WinRAR once every file has
  arrived. **Delete archives after extract** removes the original archive files after a clean extraction.
- The dialog shows the batch size against your free disk space, and warns if it won't fit.

### 5. Watch and manage the downloads

The **Downloads** page lists each batch with its files underneath.

- **Pause / resume** a single file, a whole batch, or everything (**Pause all** / **Resume all**).
- **Move** queued files up or down to change what downloads next.
- The **Speed** panel at the bottom charts your download speed — pick **5m, 30m, 1h, 6h or 24h** to see that far
  back, and hover the line for exact numbers.
- Closing Waypoint mid-download is fine: downloads pick up where they left off next time. (With **Close to
  tray** on, closing the window keeps Waypoint downloading in the background.)
- If a host's download link expires partway, Waypoint fetches a fresh one by itself.

### 6. Extraction

When the last file of a batch arrives, Waypoint extracts each archive set once, starting from its first part.
The batch shows **Extracting**, then **Done**; the folder button opens it. If extraction fails (a missing part,
say), the error shows on the batch, and the archive button runs it again.

### 7. Clean up

The bin icon on a batch removes it. You'll be asked whether to **also delete the downloaded files** — the dialog
says exactly how many files and how much space. Only files Waypoint downloaded for that batch are deleted:
anything extracted from them, or anything else in the folder, stays. Deletion is permanent.

## Resolve modes

Resolving turns a host's share link into the real file URL that aria2 downloads. Waypoint can do that two ways;
switch between them in **Settings → Link resolving**.

### Automatic (default)

Waypoint opens each link in **its own Chrome (or Edge) window** — a separate profile, not your everyday browser —
and clicks through the host's pages to the download by itself, several links at a time.

- **Leave those tabs alone.** Don't click around in them and don't close them. A stray click can land on an ad
  and throw a link off; the tabs close themselves when they're done.
- **You're only needed for a Cloudflare check.** If a tab comes to the front asking for one, complete it, then
  let Waypoint carry on.

### In your browser

Links open as **normal tabs in your own browser** (Brave, Chrome or Edge), with your usual logins and cookies.

- In each tab, pass any check and **click Download** as you normally would.
- The **Waypoint browser extension** catches the download and hands it to Waypoint, which fetches the file — your
  browser doesn't keep a copy.
- The extension is installed once, from **Settings → Link resolving**, which walks you through it.

Use this mode when a host won't cooperate with the automatic window, or when you'd rather click yourself.

## Settings worth knowing

- **Simultaneous downloads** and **Connections per file** — how many files download at once, and how many
  connections each uses. Lower them if a host starts refusing you.
- **Speed limit** — caps total download speed (0 = unlimited). The speed graph draws the cap as a dashed line.
- **WinRAR** — Waypoint finds it automatically; set the path here if it can't.
- **Watch clipboard** — the ask-before-adding clipboard prompt described above. Muted hosts are listed here.
- **Save speed history** — keeps a per-minute speed record on your PC (last 30 days) so past days can be opened
  from the speed graph. Off by default; nothing leaves your computer.
- **Reset all** — puts every setting back to how Waypoint ships. Your links and downloaded files aren't touched.

## Troubleshooting

- **A link keeps failing in Automatic mode.** Some hosts don't cooperate with an automated window. Switch to
  **In your browser** mode and click Download yourself.
- **"Needs you" won't go away.** The tab waiting for you is in the Chrome window Waypoint opened — complete the
  check there. If nothing is shown, **Skip** moves on.
- **In your browser mode does nothing.** The extension probably isn't connected: **Settings → Link resolving**
  shows its status and walks you through installing it.
- **Extraction failed.** Usually a part is missing or damaged. Retry the failed file, then use the archive
  button on the batch to extract again.
- **Something else.** **Settings → Open logs** opens Waypoint's log folder — attach the latest log when you
  [open an issue](https://github.com/dopeer-creator/Waypoint/issues).

## Themes

The **Themes** page (in the sidebar) has four quick core themes — also cycled from the theme button at the bottom
of the sidebar — and five animated **destination** themes: Ragnarök, Jackdaw, Night City, Tsushima and Wasteland.
Each has its own colours, fonts and a code-drawn animated background.

Give a destination theme a photoreal look with your own wallpaper:

- Pick the theme, then **Choose image…** — or drop an image into `%APPDATA%\Waypoint\themes\` named after the
  theme, e.g. `nightcity.jpg` (`jpg`, `jpeg`, `png`, `webp`, `avif`, `gif`). **Open themes folder** opens it.
- The image shows behind a readable scrim (tune it with **Background dimming**) while the animation plays on top.
- Images stay on your PC. Waypoint never uploads them, and none ship with the app.

## Requirements

- Windows 10 or 11 (x64)
- Google Chrome or Microsoft Edge, used for resolving (Brave, Chrome or Edge for In your browser mode)
- WinRAR, for extraction. Waypoint finds it through the registry, or you can set its path in Settings.

aria2 1.37.0 ships inside the app, so you don't install it separately.

## Development

```bash
npm install
```

Recent npm versions block dependency install scripts unless you approve them. If `node_modules/electron/dist` is missing, or better-sqlite3 fails to load, run:

```bash
node node_modules/electron/install.js
```

```bash
npx electron-builder install-app-deps
```

Then start the app with hot reload:

```bash
npm run dev
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run typecheck` | Type-checks main, preload and renderer |
| `npm run build` | Production bundle into `out/` |
| `npm run icons` | Re-renders `build/icon.ico`, `resources/icons/*` and `docs/banner.png` from `design/brand/*.svg` |
| `npm run dist` | Builds the NSIS installer into `dist/` |
| `npm run release` | Builds and publishes the installer to GitHub Releases |

## Releasing and auto-update

Download the latest installer from [Releases](https://github.com/dopeer-creator/Waypoint/releases/latest).

The installed app checks GitHub Releases every time it opens, then every 6 hours. It downloads a new version in the background and installs it silently when you quit. Only the changed parts of the installer are downloaded, using the `.blockmap` file. The current version and a **Check for updates** button sit at the bottom of the sidebar. When an update is ready, a **Restart to update** button appears there too.

To ship a release, bump the version and push the tag:

```bash
npm version patch
```

```bash
git push --follow-tags
```

The `Release` GitHub Actions workflow then builds the installer on Windows. It publishes `Waypoint-Setup-<version>.exe`, its `.blockmap` and `latest.yml` to a release tagged `v<version>`. Use `npm version minor` or `npm version major` for bigger bumps.

To publish from your own machine instead, first create a draft release for the tag on GitHub. Then set `GH_TOKEN` to a GitHub token with `repo` scope and run `npm run release`, which uploads the files into that draft. Publish the draft when the upload finishes.

The installer is unsigned, so Windows SmartScreen warns on first install. Choose "More info → Run anyway", or sign the build with a code-signing certificate.

## Adding a host adapter

Every host goes through `src/main/resolver/generic.ts`, which detects a Cloudflare check, waits out countdowns, and clicks the most likely download control — following multi-step pages ("Continue" → "Free Download" → "Start Download") and never a paid or sign-in control. When a host needs special handling, add an adapter in `src/main/resolver/adapters.ts`:

```ts
export const exampleHost: HostAdapter = {
  ...genericAdapter,
  id: 'example-host',
  match: (url) => url.hostname.endsWith('example-host.com'),
  maxConnections: 1, // host bans parallel connections
  // Returns a label for what it clicked (it shows in the log), or null when nothing is clickable yet.
  triggerDownload: async (page) => {
    const button = page.locator('#download-button:not([disabled])')
    if (!(await button.isVisible())) return null
    await button.click()
    return 'download button'
  }
}
```

Adapters only decide how to verify and trigger. The resolver catches the resulting browser download, so adapters never parse direct links themselves.

Before changing how the picker clicks, run `npm run test:picker`: it replays recorded host pages from `tests/fixtures` against the real picker, so a change for one host can't quietly break another.

## Project layout

```
src/
  main/            Electron main process
    index.ts       window, tray, IPC, clipboard watcher
    db.ts          SQLite store (links, batches, settings)
    resolver/      Playwright resolver and host adapters
    aria2.ts       aria2c process and JSON-RPC client
    downloads.ts   batch scheduling, expiry handling, extraction
    extract.ts     WinRAR detection and archive-set grouping
    updater.ts     electron-updater / GitHub Releases
  preload/         typed contextBridge API
  renderer/        React UI (Link Grabber, Downloads, Settings)
  shared/          types and IPC contract
design/brand/      source SVGs for the logo and wordmark
resources/bin/     bundled aria2c.exe
```

App data (database, logs, resolver browser profile) lives in `%APPDATA%\Waypoint`.

## License

Waypoint is MIT licensed. The bundled `aria2c.exe` is a separate program under GPL-2.0 (see `resources/bin/aria2-COPYING.txt`). Its source is at https://github.com/aria2/aria2.
