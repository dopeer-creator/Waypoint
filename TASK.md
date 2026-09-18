# Waypoint — upcoming tasks

Working list. Newest thinking at the bottom of each item; tick things off as they ship.

Numbers stay put as things ship, so the gaps are expected. Done so far: **1** drag-and-drop link lists,
**4** exact batch sizes and **5** the clipped Downloads rows (all v0.6.3); **3** the clipboard prompt and
**9** reset to defaults (v0.6.4); **10** deleting files on removal (v0.7.0); **8** the speed graph panel (v0.7.1); **11** longer ranges and saved history (v0.7.2); **12** visible update downloads and **13** the resolve-mode
guide (v0.7.3).

---

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
