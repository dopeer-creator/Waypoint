# Waypoint — upcoming tasks

Working list. Newest thinking at the bottom of each item; tick things off as they ship.

---

## 1. Drag and drop text files with links

Dropping a `.txt` / `.csv` / `.html` file onto the Link Grabber should import the links inside it, the same way
**Import from file** already does. Today a drop only reads dragged *text*, not a dragged *file*.

- Reuse the existing import path so both routes behave identically.
- Accept the same extensions the import dialog accepts, and say so in the drop hint.
- Dropping a folder, or a file with no links in it, should say what happened rather than silently doing nothing.

## 2. Third host: filekeeper

**Investigated and measured; the fix is written but parked.** Not merged, because it couldn't be proven safe for
the hosts that already work.

What was measured (by driving a real link in the resolver's own browser, with `acceptDownloads: false` so nothing
large is written):

- **filekeeper is not slow and not complex.** Its download fires on the *main page* about **1.0s** after the
  click. There is no delivery popup and no long wait.
- **The blocker is a popunder ad.** The page loads a third-party script that calls `window.open` from a click
  handler; it swallows the click meant for `#download-button`, so the host's own handler never runs. Clicking
  again just feeds it another ad. This is why the host behaves in Brave, which blocks those scripts.
- **Blocking ad domains does not work.** Block one network and a different one takes over on the next load.
- **Refusing cross-site `window.open` does work** — same click, file in 1.0s, no popups.

Why it wasn't merged: it couldn't be verified against fuckingfast, whose only available link had expired (every
run failed identically with and without the change, on two profiles). The rule is inert on fuckingfast — that
host opens its popups from `target="_blank"` anchors, not `window.open` — but that is an argument, not a
measurement.

The work is parked on the local branch `filekeeper-popup-experiment` (`6dc7220`), with the findings in its commit
message. Recover with `git cherry-pick 6dc7220`.

To finish it: get a **live** fuckingfast link, run it with and without the rule, and merge only if the working
host is unaffected.

Two things to carry into any future attempt:

- **Run the thing, don't reason from logs.** Two plausible theories here ("slow host", "we close the delivery
  popup") were both wrong, and both survived several rounds of log-reading. One real run settled it.
- **Ad chains serve fake files named after the real one** (a `.zip` carrying the user's filename was observed).
  The resolver attaches download listeners to every popup, so it could capture one and hand a malware URL to
  aria2. Worth a guard regardless of how the clicking is solved.

Still true for any new host: write a fixture in `tests/fixtures`, baseline it against the **current** picker, then
change the picker and re-run `npm run test:picker`. A host is only done when the earlier hosts click the same
controls in the same order. Prefer the generic engine over a host adapter in `src/main/resolver/adapters.ts`, and
never let an auto-click land on a paid or account control.

## 3. Clipboard prompt is too aggressive

It offers to add links far too often, including when nothing useful was copied.

- Only offer for links on a known/plausible file host, not every URL that hits the clipboard.
- Don't re-offer links already in the list, already downloaded, or already dismissed once.
- Debounce rapid copies, and collapse a burst into one prompt.
- Consider an explicit off switch plus "don't ask again for this host".

## 4. Batch total size is wrong while downloading

The batch header shows something like `57.5 MB / 7.8 GB+` because only the files aria2 has actually started
report a size — the rest are unknown, so the total is a lower bound with a `+`.

- Get each file's size at resolve time (the host's response headers already carry it) and store it on the link.
- Then the batch total is real from the moment the batch is created, and the disk-space guard gets accurate too.
- Keep the `+` behaviour as the fallback for when a host won't tell us.

## 5. Clipping on the Downloads pane

The right-hand end of the download rows is cut off — the per-row actions (pause, open folder, delete) sit under
the edge of the pane at some widths. Check the row's grid/min-widths and the scroll container, and test narrow.

## 6. More work on themes

Keep building out the destination themes: more scenes, better motion, and per-theme polish on the tables and
toolbars rather than only the background. Worth a pass over how a user's own wallpaper interacts with each scene.

## 7. Logins — decide the shape before building

Open question, not a decision yet. If Waypoint is to hold host accounts (premium or otherwise), the storage model
comes first:

- **Local-only** — credentials stay on the user's PC, encrypted at rest with the OS keystore (Windows DPAPI via
  Electron's `safeStorage`). No server, no accounts, nothing to breach centrally. Fits an open-source desktop app.
- **Server-side** — needs a backend, a database, and real operational responsibility for other people's
  credentials. A much bigger commitment, and hard to square with "open source, runs on your machine".

Whichever way this goes: credentials never get committed to the repo, never get logged, and never leave the
machine except to the host they belong to. Being open source doesn't prevent storing secrets locally — it just
means the *method* is public, which is fine, as long as no secret is.

Worth deciding what the feature is actually for first (premium accounts? per-host sessions? syncing?), since the
answer changes the storage question entirely.
