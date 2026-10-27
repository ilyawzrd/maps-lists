# maps-lists: advanced usage

The [README](../README.md) covers the everyday flow. This page has the details: how it works, the
options you can give Claude, connecting to Chrome, and (further down) working on the code.

## How it works

1. **Research** (optional): Claude researches local press, guides, Telegram and Reddit, keeps the
   classics locals still rate, filters out tourist traps, viral spots and closed places, and opens a
   **review page**. There you tick places and edit notes.
2. **Resolve**: Claude looks each place up on Google Maps and writes a `plan.json`.
3. **Apply**: a deterministic executor (Playwright attached to your Chrome over CDP) creates or updates
   the list, saves places, writes notes, then hard-reloads and checks the list against the plan.

Claude does the judgment work; the executor only clicks, the same way every time.

# Using the plugin

## Skills

You rarely need these names: asking in plain words picks the right one.

| Skill | What it does | Model |
|---|---|---|
| `/maps-lists:start` | asks research or a list you have, then what / where / list name | your session's |
| `/maps-lists:research` | asks depth + model, researches, filters, opens the review page | your choice (see below) |
| `/maps-lists:import` | a file or pasted list → review page → places looked up on Maps → `plan.json` | Sonnet |
| `/maps-lists:run` | saves to Maps in your Chrome, report, cleanup | Haiku |
| `/maps-lists:lists` | the lists you've made, their places and Maps links | Haiku |

Everything runs at **medium** effort.

One command from your shell works too:

```bash
claude '/maps-lists:import ~/Downloads/la.md "LA Eats"'           # list name is optional
claude '/maps-lists:research bakeries in Lisbon "Lisbon Bakeries"'  # research first, then the same flow
```

## Options

Add them to the request in words or as flags:

| Say | Flag | Effect |
|---|---|---|
| "quick" / "deep" | `--quick` / `--deep` | research depth; asked if you don't say |
| "with Opus" / "on Sonnet" | `--opus` / `--sonnet` | research model; asked if you don't say |
| "include hidden gems" | `--more-gems` | digs harder for lesser-known places; keeps about 3 classics per category |
| "hidden gems only" | `--gems` | classics go to the filtered-out section instead |
| "save without asking" | `--yes` | no Save to Maps question |
| "use my account you@gmail.com" | `--account you@gmail.com` | stop if Chrome is signed in to another account |
| (write in your language) | `--lang es` | the whole flow in that language (any language tag) |

### Depth and model

Research is the expensive step, so Claude asks before it starts, unless you already said:

- **Deep** runs the `deep-research` skill (parallel research agents, 5–10 minutes, about 15–25
  places). **Quick** is one pass by Claude itself (1–2 minutes, about 8–12 places, much cheaper).
  If `deep-research` isn't available, deep falls back to quick and says so.
- **Model:** your current one is listed first. A plugin can't switch Claude's model, so picking
  another one means typing `/model opus` (or `sonnet`) and saying "continue"; the research picks up
  with everything you already answered. Deep works on either model.

The look-up step always runs on Sonnet and the Chrome step on Haiku, whatever you pick: neither
needs judgment about sources.

### What the research keeps

The test is quality, not fame. A famous place stays if locals and local press still recommend it on
its merits; its details and its Maps note start with "Classic.", and the details say what to expect
(lines, the one thing to order, when to go). A place locals clearly rate on Reddit (the top-scored
pick in a thread, or recommended in two or more threads, without upvoted pushback) gets "Reddit
favourite." in its note, before any Michelin status. It's dropped as a **tourist trap** when its reputation is better than what it
serves (locals say overrated or "went downhill", touts, picture menus), as **viral** when the hype is
one photogenic item, as **bad** when reviews or locals say the food is poor now, and when it's
**closed**. Places need two independent sources or one strong local one; a contest ranking or a
single listicle counts as one source, except a podium: 1st to 3rd in a recognised contest
(Paris's baguette and croissant contests) in this or last year's edition keeps a place on its own. New openings follow the same bar, with the caveat in their
details. Places below it are filtered out as **thin evidence**, and each category aims for about
10–25 places, with contest podium places added on top. "Hidden gems" without "only" or "also" gets one extra question: mix in the classics, or
only lesser-known places. Every candidate ends up either kept or in the filtered-out section with its reason, so
you can tick any of them back in on the review page.

Sources: local press and guides (in the local language too), Reddit, Telegram channels through their public `t.me/s/<channel>` preview. In
Russian-speaking cities it searches in Russian first and adds Russian food media, Yandex Maps / 2GIS
review snippets and Telegram as a primary source.

**Reddit threads (optional).** Reddit blocks anonymous reads, so by default the research only sees
Reddit through search snippets. The first research asks whether you have a Reddit account; only
with one can it read whole threads. Yes installs [rdt-cli](https://github.com/public-clis/rdt-cli) (pinned) with
[uv](https://docs.astral.sh/uv/), which brings its own Python, about 50 MB once, and signs in with
your Reddit login from your browser: macOS asks once whether `rdt` may use "Chrome Safe Storage"
(Linux may ask to unlock the keyring; on Windows, uv comes from Astral's PowerShell installer, and
Chrome's newer cookie encryption may keep `rdt login` from finding the login, in which case research
uses snippets).
You need to be signed in to reddit.com in your browser. Claude reaches it only through
`maps-lists reddit`, which can search and read and nothing else (rdt itself can also vote and
comment). No (or no account) means snippets, and it doesn't ask again (`maps-lists reddit on` brings the
question back). The login is stored in `~/.config/rdt-cli/`; `rdt logout` removes it. When Reddit
rejects that stored login, `maps-lists reddit login` drops it and takes a fresh one from the browser.
When Reddit refuses search (it did in Oct 2026) but threads still open, research finds the threads
with `site:reddit.com` web searches and reads those.
Reddit's terms don't allow automated reading, and this uses your own login, so you use it at your own risk.

### Adding places you name

"Add Tartine and Morreig to zz-test" is a direct add: no review page and no Save question,
since you've already decided. Claude says in one line what it matched (`📍 Name · address → list`)
and saves. A name that matches several places, or a chain, gets a quick "which one?" question,
always with "All of them" as an option; a note only goes in if you give one. Pasted lists, files and
research still go through the review page.

### From a list you have

Give Claude a file (drag it into the terminal) or paste the list. Markdown is read as is; `.txt`,
PDF, HTML, saved emails and screenshots are read directly, and Word, RTF and ODT files are converted
with macOS's `textutil` (on Linux and Windows with `pandoc` or LibreOffice, when installed). Anything other than Markdown is first saved as
`research/<slug>-<date>.source.md` in the data folder, so the rest of the flow is the same. Notes keep
the source's language unless you ask for a translation.

Claude reads the places and notes from the file (see
[`examples/places.example.md`](../examples/places.example.md)) and opens the same review page as
research does (skipped for a `*.places.md`, which was already reviewed). Then it looks up each place
on Maps and flags anything ambiguous. Without a name, the list is named after the file's title;
names can be at most 40 characters (Maps cuts longer ones), so a longer title is shortened.

### Saving

- Before saving, Claude shows every place it found and asks **Save to Maps** or **Stop**. Saving
  checks each place's own Save-dialog checkbox, never saves a place twice, and skips closed and
  unresolved places, so it's safe for new and existing lists alike.
- There's no dry run in the normal flow: the summary already shows what will be saved, and saving
  only ever adds. Say "dry run" or "just check, don't save" if you want one anyway.
- Nothing is ever deleted, so a wrong place has to be removed by hand. Existing notes get the new
  note appended with ` · `, never overwritten. A short new note (up to 6 meaningful words) whose
  words the existing note already has ("get the morning bun" next to "Morning bun is the thing to
  order…") is skipped and reported as "Note not added"; longer notes are only skipped when the exact
  text is already there.
- Places removed from your file are **not** removed from Maps.

### Languages

Write in any language and every skill switches to it: questions, messages, the review page, the
notes, and the names and addresses in the summary. `--lang <tag>` forces it (`es`, `ca`, `pt-BR`).
The review page has built-in labels in English and Russian; for any other language Claude writes
translated labels into the research file (`ui`), and anything missing shows in English. Machine
tokens in the research file stay English (`area: "all branches"`, and the
`trap:`/`viral:`/`bad:`/`closed:`/`thin evidence:`/`unconfirmed:`/`classic:` reason prefixes).

This is only the conversation language. The Maps UI language is a separate thing, detected from your
Google account: the executor knows Maps' buttons in English, Spanish and Russian, and opens Maps in
English for its own visit when the account uses any other language. The list, the places (shown in
each viewer's language) and the notes don't depend on it.

## Your data

Everything lives in **`~/.maps-lists/`** (set `MAPS_LISTS_HOME` to move it), whatever folder you
start Claude in:

| Path | What |
|---|---|
| `research/<slug>-<date>.places.md` | each list's kept places and notes; never cleaned up |
| `research/<slug>-<date>.json` | the research behind a review page |
| `plan.json` | the resolved plan the executor runs |
| `artifacts/` | run report, failure screenshots and ARIA snapshots |
| `.gmaps-state.json` | every list the executor created or opened, with its Maps link |
| `config.json` | your Chrome choice (normal or separate window) and whether you turned the Reddit reader off; kept by cleanup |
| `reports/`, `research_notes/` | deep research's own report and notes |

`/maps-lists:lists` reads the places files and the state file. It shows what was saved through
maps-lists; changes you make by hand in Maps aren't in these files.

**Cleanup.** After a fully verified apply, Claude runs `maps-lists clean`: it removes `artifacts/`,
`plan*.json`, everything in `research/` except the `.places.md` files, `reports/` and
`research_notes/`, and drops `zz-*` test lists from the state file. Sessions closed midway never get
there, so each new research or import first removes leftovers untouched for 7 days (the state file
stays). Anything newer stays, so an unreviewed research file or a failed apply can still be picked up.

**State file.** A list recorded in `.gmaps-state.json` is never created again, which stops a
slow-to-appear new list from being created twice. If you delete a list in Maps, remove its entry
there before reusing the name.

The failure snapshots in `artifacts/` include your Google account name and email, so don't share
them publicly.

## Connecting to Chrome

Saving always goes through **Google Chrome**, whatever your default browser is: Safari and Firefox
can't be driven this way. Chrome only has to be installed (Claude says so if it isn't). The review
page opens in your default browser, and saved lists show up in any browser and on your phone. If
your own Chrome isn't open when it's time to save, Claude assumes it's not your everyday browser and
recommends the separate window below. Chromium browsers (Brave, Edge, Arc) work for the
"your normal browser" mode; the separate window always uses Google Chrome.

**Your main Chrome (default, Chrome 144+).** Switch on `chrome://inspect/#remote-debugging`. Chrome
asks you to **Allow** each connection and shows an "automated test software" banner while one is
attached. Switch the toggle off when you're done. The executor finds the connection details in
Chrome's `DevToolsActivePort` file (also for Chrome Beta/Canary, Brave, Edge and Arc; set
`GMAPS_CHROME_DIR` if yours is elsewhere). It looks in Chrome's user-data folder for your system
(`src/platform.ts`):

| System | Chrome's folder |
|---|---|
| macOS | `~/Library/Application Support/Google/Chrome` |
| Linux | `~/.config/google-chrome` (`$XDG_CONFIG_HOME`), `~/.config/chromium`, Snap's Chromium |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data` |

On Linux and Windows nothing else is needed: Full Disk Access is macOS only. On Windows, Claude
Code runs commands in Git Bash, which `bin/maps-lists` relies on.


- **macOS Full Disk Access:** reading that file needs it for the app macOS holds responsible for
  Claude's commands. Before connecting, Claude runs `maps-lists check-chrome`, which reports ready /
  remote debugging off / no access without showing the file, and names the app to switch on. macOS
  has no prompt for it, so Claude opens System Settings → Privacy & Security → Full Disk Access for
  you. After switching your terminal on, quit it with Cmd-Q, reopen it, start `claude`, and type
  `/maps-lists:run`.
- **Claude desktop app (Code tab):** macOS checks the desktop app's own Claude Code copy
  (`~/Library/Application Support/Claude/claude-code/<version>/…/claude.app`), not "Claude", and the
  path changes with every Claude Code update. So there the separate Chrome window is recommended;
  adding that path works until the next update, and Claude says so when an update breaks it.
- On macOS, editor extensions (VS Code) can't read the file at all (`EPERM`). There Claude prepares the plan
  and gives you the command to run in a terminal; `/maps-lists:run --report` reads the result.
- `403 Forbidden … Connection rejected` means the Allow dialog wasn't approved. Bring Chrome to the
  front, run it again, and click **Allow**.

**A separate Chrome window.** Works the same on every system, and needs no Full Disk Access on macOS: ask Claude to "use a separate Chrome
window", or pick it when it's offered. It starts a dedicated Chrome profile on `127.0.0.1:9333`
(`maps-lists chrome`, profile in `~/.gmaps-automation-profile`); sign into Google there once and the
profile remembers it. The choice is remembered in `~/.maps-lists/config.json`
(`maps-lists check-chrome --set main` switches back), and later runs open the window when it isn't
running. It doesn't ask you to Allow each connection.

**Signed in to several Google accounts?** Say which one (`--account you@gmail.com`, or
`export GMAPS_ACCOUNT=you@gmail.com`). Saving then stops before writing anything if Chrome
is on a different account.

# Development

## Working from a clone

```bash
git clone https://github.com/ilyawzrd/maps-lists && cd maps-lists && npm install
claude --plugin-dir .      # load this working copy as the plugin, without installing it
./start.sh                 # the terminal menu: language, research or an .md file, then the same skills
```

`./start.sh` asks its questions in the terminal (including the language, and Opus or Sonnet for
research, which it passes to `claude --model`), offers to move a place typed into What to Where
("bakeries in Lisbon"), then starts Claude with the clone loaded as the plugin. It uses
`~/.maps-lists` like an installed copy.

The plugin is `.claude-plugin/plugin.json`, and this repo is its own marketplace
(`.claude-plugin/marketplace.json`). The skills call `bin/maps-lists`, which Claude Code puts on
the Bash tool's PATH while the plugin is enabled. It runs `src/` with the data folder as its working
folder, so data-file names (`plan*.json`, `research/…`, `artifacts/…`) always resolve there; other
relative paths (a `.md` file) mean the caller's folder. On first run it installs `node_modules` if
Claude Code hasn't. Outside Claude, call it by its full path.

## Commands

`npm run …` works on the clone itself, with the repo folder as its data folder. `bin/maps-lists
<command>` runs the same scripts on `~/.maps-lists`.

```bash
npm run dry -- plan.json --cdp auto      # development: resolves every place, checks if it's already in the list, writes nothing
npm run apply -- plan.json --cdp auto    # saves places and notes, then verifies after a hard reload
npm run review -- research/<slug>.json   # (re)open the review page; --check validates only
npm run resolve -- --query "Langer's Deli Los Angeles"   # candidates with name, address and Maps URL, no Chrome
npm run resolve -- queries.txt [--lang ca]               # one query per line, names in any language; full results in artifacts/resolve.json
npm run clean -- --dry-run               # what cleanup would remove; --older-than 7 for the weekly sweep
npm run check-plan -- plan.json          # validate a plan
npm run chrome                           # dedicated Chrome profile on 127.0.0.1:9333 (then leave out --cdp auto)
bin/maps-lists check-chrome [--set main|separate]   # JSON: mode, ready / debugging-off / no-access / not-running, host app
bin/maps-lists reddit status|setup|login|off|on     # optional Reddit reader: JSON status, install (uv + rdt-cli), sign in from the browser
bin/maps-lists reddit search 'bakery lisbon' -r lisbon -t year   # rdt's JSON; read-only flags only
bin/maps-lists reddit read <post id or URL>… [-n 60]             # post + top comments with scores
```

> **zsh:** put Maps URLs in **single quotes**. Inside double quotes, zsh expands the `!` in
> `data=!4m6!3m5…` into commands from your shell history.

Executor flags (`dry`, `apply`):
- `--cdp <url>`: default `http://127.0.0.1:9333` (the dedicated profile; the main Chrome toggle uses 9222, reached through `auto`). `auto` reads `DevToolsActivePort` (main Chrome).
- `--state <file>`: default `.gmaps-state.json`.
- `--account <email>`: stop if Chrome is signed in to a different account.
- `--lang auto|en|es|ru`: Maps UI language. `auto` (default) opens Maps without `hl` and reads
  `<html lang>`, which follows the Google account's language. Spanish and Russian keep the exact
  tag (`es`, `es-419`, `ru`) as `hl`; anything else forces `hl=en`. `report.json` records it as `mapsLanguage`.
- `--list-order newest-first|oldest-first`: you shouldn't need this. Maps shows the most recently
  modified place first, and editing a note counts as a change; `apply` already accounts for that.

Output: a console summary plus `artifacts/report.json`. The exit code is `2` if verification
found missing places or notes. A tab that loads about 70 Maps places gets its renderer killed
("Page crashed"), so `apply` opens a fresh tab every 25 places.

## Check for Maps UI changes

`ui-check` walks what `apply` does, read-only, with the executor's own code and selectors, and
reports each step:

```bash
npm run ui-check -- --cdp auto --setup     # once: creates the throwaway list zz-ui-check (2 places)
npm run ui-check -- --cdp auto             # ✓/✗ per step; add --lang es or --lang ru for those tables
```

A step that fails prints which accessible names disappeared (−) or appeared (+) since its last pass,
which is usually the label Google renamed. Fix that in `src/selectors.ts`, or probe (below) for the
full picture. Snapshots live in `ui-check/<language>/`, with the account button removed.

## Calibrate selectors (whenever Maps changes)

The selectors in `src/selectors.ts` match live snapshots (see `CLAUDE.md`). If Maps changes its UI,
re-run the probe:

```bash
npm run probe -- 'https://www.google.com/maps/place/<any place>' '<an existing list name>' --cdp auto
```

This is read-only. It writes ARIA snapshots and screenshots to `artifacts/`. If something doesn't
match, give the `aria-*.yaml` files to Claude and it'll fix `selectors.ts`. Each UI language has its
own table (`TEXT.en`, `TEXT.es`, `TEXT.ru`); to calibrate Spanish or Russian, probe with an account in
that language (or add `--lang es` / `--lang ru`).

## Releasing

Users only get an update when `version` in `.claude-plugin/plugin.json` goes up; commits without a
bump don't reach them. To release: bump `version` (and `package.json` to match), commit, push to `master`, and check that
the CI run on GitHub is green. When the release touches `src/selectors.ts`, `src/maps.ts` or
`src/run.ts`, run `npm run ui-check -- --cdp auto` first (all ✓); otherwise once a month is enough. Users with auto-update on get it within a few minutes of their next session, and it loads
on the next start or `/reload-plugins`. Others run `/plugin marketplace update maps-lists`.

## Guarantees

- Never deletes places or lists, never touches sharing.
- Idempotent: places already in the list are skipped, and existing notes are appended to with
  ` · `, never overwritten.
- Ambiguous `query` places are reported as **unresolved**, never guessed.
- Order is ignored by default. With `ordered: true`, ranking is exact only for lists the executor
  creates; existing lists keep their current order.

## Tests

```bash
npm run typecheck
npm test          # list-row parsing, title matching, plan schema, place lookup, review page + server, cleanup, lists, Reddit wrapper
npm run test:hooks   # the Clawd hooks module (hooks/buddy.tsx), through `claude plugin test`
```
