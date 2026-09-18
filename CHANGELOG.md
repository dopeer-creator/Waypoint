# Changelog

All notable changes to Waypoint. Newest first.

## v0.7.3
Waypoint now explains its two resolve modes, and a new version downloading is no longer a secret.

- **A quick guide before the first automatic run.** The first time you resolve in automatic mode, a short
  popup explains what's about to happen: Waypoint opens its own Chrome window and clicks through for you,
  **don't click inside those tabs or close them**, and you're only needed if one asks for a Cloudflare check.
  It also mentions the other mode, and one click switches to it — the popup then explains that one instead.
  Tick **Don't show again** to skip it; **How it works** in Settings brings it back any time.
- **Switching mode tells you what changed.** Changing the resolve mode in Settings shows a short note on what
  the new mode does, with a link to the new **Resolve modes** section of the README. It fades out by itself.
- **Updates you can see.** While a new version downloads, the sidebar says so in the accent color —
  "Downloading v0.7.3 · 42%" with a progress bar — instead of muted text in the corner. When it's ready, the
  same spot restarts to install it.
- **Check for updates is a real button** now, kept low-key until there's news.

## v0.7.2
The speed graph reaches back a whole day, and can keep a record if you want one.

- **Ranges you can read.** The graph's buttons now say how far back it goes — **5m · 30m · 1h · 6h · 24h** —
  instead of the old 1s / 5s / 30s / 1m, which described the size of each point and topped out at 2 hours.
- **A full day in memory.** The 6h and 24h views work from per-minute averages, so a batch left running all
  evening can be looked back on without Waypoint holding a day of second-by-second samples.
- **Optional saved history.** A new **Save speed history** setting (off by default) keeps a per-minute record
  in a folder on your PC. With it on, the graph gets a picker for past days, drawn 00:00–24:00, with gaps
  where Waypoint wasn't running. Nothing leaves your computer, and only the last 30 days are kept.
- **Cleaner chart.** The line no longer dips to zero at "now", the scale uses one unit throughout, and the
  hover readout sits beside the line instead of covering it.

## v0.7.1
A proper speed graph, docked at the bottom of the Downloads page.

- **Speed panel.** A chart of total download speed now sits along the bottom of the Downloads page, the way
  torrent clients do it. It stays put while a long list scrolls underneath, and collapses to a one-line bar
  showing the current speed.
- **Minutes or hours at a glance.** Pick 1s, 5s, 30s or 1m per point to see the last 2 minutes, 10 minutes,
  hour, or 2 hours. The axes are in real units (MB/s) with gridlines, scaled to the busiest moment on screen.
- **Hover for detail.** Point at the line to read the speed at that moment and the time it happened.
- **Now, average and peak** are shown above the chart, and your speed limit, if you've set one, is drawn as a
  dashed line so you can see when downloads are hitting it.
- **History survives leaving the page.** Waypoint records the speed in the background, so the chart is already
  filled in when you open Downloads instead of starting from nothing.

## v0.7.0
Removing a batch can now take its downloaded files with it.

- **Delete the files, not just the list entry.** Removing a batch used to only forget it — the files stayed on
  disk, so clearing the list after a few big batches quietly left tens of gigabytes behind. The remove dialog
  now offers to delete them too, and says exactly what that means: "Also delete 19 downloaded files (38.2 GB)",
  measured on disk at the moment you ask.
- **Only what Waypoint downloaded.** Removal deletes the files it downloaded for that batch and nothing else.
  Extracted output, anything you put in the folder yourself, and the folder itself are never touched. A file
  that another batch still lists is kept, and nothing outside the batch's own folder is ever deleted.
- **Half-finished downloads go too**, along with aria2's `.aria2` progress files, which are useless on their own.
- **On by default, and remembered.** The toggle starts on; switch it off once and the dialog remembers that
  next time. It's still shown on every removal.
- Files are deleted permanently rather than sent to the Recycle Bin — Windows skips the bin for files this
  size anyway, and the point is usually to get the space back.

## v0.6.4
A clipboard prompt that only speaks when it's useful, and a way back from broken settings.

- **The clipboard prompt stops nagging.** It used to offer every URL that touched the clipboard, so copying a
  link on GitHub or a search result would pop the dialog. A copy now has to look like a file to be offered: an
  archive or media name in the URL, a file host Waypoint knows, or a host you have already added links from by
  hand. Ordinary browsing is silent.
- **One prompt per burst.** Copying five links one after another waits for the copying to stop and asks once,
  instead of interrupting after each one.
- **It remembers "no".** Turning a prompt down means those links aren't offered again, so re-copying the same
  page doesn't ask twice. There's also **Never for <host>** on the prompt itself, and the muted hosts are listed
  in Settings with an Unmute all next to them.
- **Reset to defaults.** Settings has a **Reset all** button that puts every preference back to how Waypoint
  ships — useful when settings have been fiddled into a state that no longer downloads. It confirms first and
  says exactly what it throws away, including the download folder and the WinRAR path. It's unavailable while a
  resolve run is going, since it would change the run's settings underneath it. Your links, batches and
  downloaded files are never touched.

## v0.6.3
Accurate batch sizes, a fix for cut-off rows, and drag-and-drop for link lists.

- **The batch size is right from the start.** A batch used to show something like `57.5 MB / 7.8 GB+`, because only the handful of files already downloading knew how big they were. Waypoint now reads each file's exact size as it resolves the link, so the total is the real figure straight away — and the disk-space check, which was comparing your free space against a fraction of the real size, is honest too.
- **Nothing is cut off on the Downloads page.** The columns added up to slightly more than the card on a 1320px-wide window, so the right-hand end of every row — including the remove button — was clipped. The columns now fit, with room to spare.
- **Drop a file of links onto the paste box.** A `.txt`, `.csv` or saved page can be dropped straight in, the same as using Import from file, which now also takes several files at once.
- A row with an unrecognised status no longer takes the whole window blank with it.

## v0.6.0
Hosts that make you click through several steps now resolve on their own.

- **Multi-step hosts.** Waypoint follows a host through "Continue to Download" → "Free Download" → "Start Download" instead of only recognising a single button, so hosts that split the free download over several pages resolve without you.
- **Countdowns are waited out, not clicked.** A button that says "Ready in 7s" or "Preparing your download" is left alone until it arms, so the wait no longer burns the link's click attempts.
- **Never clicks a paid control.** Anything reading as Premium, Upgrade, Torrent, a price, or a sign-in is excluded outright — auto-clicking must never wander into a purchase.
- **Six links at a time**, up from four, and six click attempts per link. Most of a multi-step host's time is spent waiting on its own countdown, so more of that now overlaps.
- **Fixed: a link could capture another link's file.** With several tabs on one host, a download from one tab could be picked up by another, so one part of an archive downloaded twice and another never arrived — an extraction that failed only at the end of a very large download. A link now refuses a file that plainly belongs to a different link and waits for its own.
- The log now names the control each auto-click landed on, which is what makes an unfamiliar host diagnosable.

## v0.5.0
Automatic resolving actually runs to the end now.

- **A whole batch resolves from one click.** The browser closing mid-run used to abort everything still in flight, so only the one link that had already finished survived and you had to press Resolve again for each file. Links in flight now go back to the queue, the browser reopens by itself, and the run carries on.
- **Chrome stops quitting mid-run.** Waypoint only ever needed the download's URL — aria2 fetches the file — but it was letting Chrome start the download and then cancelling, and Chrome exited about 200ms later, taking every other tab's link with it. It now declines the download up front.
- **Better download-button detection.** Ad links dressed up as "Download" are ignored, buttons wired purely to a JS click handler are found, and a control gets two attempts before it's passed over (some hosts open an ad on the first click and only start the download on the second).
- **One check at a time.** When a link does need you to pass a Cloudflare check, only that tab asks and comes to the front; the rest wait quietly and can't time out while you're busy with it.
- **Removed the Turnstile bypass.** Automatic mode detects a check and hands it to you instead of trying to solve it.
- Fixed a blank window on launch when the app re-rendered during the startup animation.

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
