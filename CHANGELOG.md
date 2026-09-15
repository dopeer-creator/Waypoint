# Changelog

All notable changes to Waypoint. Newest first.

## v0.4.0
Queue control, safety checks, and more ways to add links.

- **Disk space guard** — the Start-downloads dialog shows free space against the batch size and warns when it won't fit.
- **Delete archives after extract** — a per-batch toggle (and a default in Settings) removes the original `.rar`/`.zip` files once a set extracts cleanly.
- **Queue reordering** — move queued files up or down; Waypoint also nudges aria2's own queue to match.
- **Import from file** — pull links out of a `.txt`, `.csv`, or `.html` file.
- **Clipboard consent** — copying links now asks before adding them, instead of grabbing silently.
- **Speed graph** — a live download-speed chart with a peak readout in the Downloads toolbar.

## v0.3.0
A proper welcome and smarter batches.

- **Animated launch splash** — the logo's parts ease in to form the mark, hold, then break apart and fade to the app (respects reduced motion).
- **Batch grouping by app** — multi-part archives and their extras (soundtrack, crack, `fg-` files) go into one batch named after the game; pasting several games offers one batch per game, each in its own folder.
- Fixes: guard the download poll against an unexpected state, and release internal relay state when downloads finish or are removed.

## v0.2.0
- **Themes page** — themes moved out of Settings into their own sidebar page, holding the core themes, the animated destination themes, and the custom-wallpaper controls.

## v0.1.6
Premium, animated themes.

- **Five destination themes** — Ragnarök, Jackdaw, Night City, Tsushima, and Wasteland, each with its own colours, fonts, chrome, and a code-drawn animated background (Matrix code rain, neon glow, ink that follows the cursor, drifting embers, and more).
- **Custom wallpapers** — drop an image into `%APPDATA%\Waypoint\themes` (e.g. `nightcity.jpg`) and that theme uses it behind a readable scrim you can dim. Images stay on your PC.
- The four light, quick core themes remain and are cycled from the sidebar.

## v0.1.5
- **Accurate batch ETA** — a batch's estimate is never shorter than the files inside it; it uses the slowest active file when that finishes later.

## v0.1.4
Resolve in your own browser, and reliable resume.

- **"In your browser" resolve mode** — links open as ordinary tabs in your Brave/Chrome/Edge. You pass the Cloudflare check and click Download, and the bundled **Waypoint browser extension** hands the file to the app automatically. No automation touches the check.
- **Resume fix (range relay)** — some hosts ignore the end of a byte range, which made aria2 fail with "Invalid range header" after a pause or restart. Downloads from those hosts now route through a local relay that trims each response, so pause/resume and restarts work.
- Automatic resolve mode for handling Cloudflare Turnstile.
- Expired download links are re-resolved automatically.

## v0.1.3
Smarter link grabbing.

- **Reads links behind copied text** — copy links straight off a page and Waypoint pulls the real URLs from behind the file-name text (paste or drag-drop).
- Keeps a file name carried in a URL `#fragment` until the resolved name is known.
- Clear message when pasted text contains no links.

## v0.1.2
Stability and icon fixes.

- Fixed a crash ("Object has been destroyed") when reopening Waypoint after closing the window — no more killing it from Task Manager.
- Closing the window now quits the app cleanly; Close-to-tray keeps it running in the background.
- Fixed the taskbar showing a generic icon instead of the Waypoint logo.

## v0.1.1
First public release.

- Paste a batch of links; Waypoint extracts the URLs, de-dupes, and lists them.
- Resolves each link in a real browser, one tab at a time, past Cloudflare checks.
- Downloads in parallel with aria2 — several at a time, multi-connection, with pause/resume per file and per batch.
- Extracts multi-part RAR/ZIP/7z archives with WinRAR when a batch finishes.
- Windows installer with automatic updates from GitHub Releases.
