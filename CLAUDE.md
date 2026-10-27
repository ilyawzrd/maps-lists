# maps-lists

Deterministic executor for Google Maps saved lists. It takes a `plan.json` (lists → places with
notes) and applies it through Playwright attached to Chrome over CDP. It creates the list, saves
places and writes notes, then hard-reloads and diffs the result against the plan.

Division of labour: the model does the judgment work (parse a source, ask for list names, resolve
each place to a `/maps/place/` URL, flag ambiguous ones). This executor only clicks, and it does so
the same way every time. It ships as a Claude Code plugin named `maps-lists` (this repo is also its
marketplace). Three plugin skills form the chain, split by how much judgment each
needs: `maps-lists:research` (optional: deep research by default, web + Reddit snippets →
`research/<slug>.json` → review page → a places file; session model, Opus or Sonnet via `start.sh`),
`maps-lists:import` (`model: sonnet`: document → resolved `plan.json`), and `maps-lists:run`
(`model: haiku`: runs `dry`/`apply` and reports), with `maps-lists:start` in front (asks research or a list the user has)
and `maps-lists:lists` beside it (`model: haiku`: shows saved lists and places).
All run at `effort: medium`. Each hands off to the next in the same turn, passing `--lang <tag>` along for any non-English conversation language (any BCP 47 tag; never the executor's Maps `--lang`). A skill's `model:` lasts
for the rest of that turn only, so a new user prompt goes back to the session model.

## Layout

- `.claude-plugin/plugin.json` + `marketplace.json` (`source: "."`). `version` gates updates: users get nothing until it's bumped
- `bin/maps-lists`: what the skills run (on Claude's Bash PATH while the plugin is enabled). Runs `src/` via the plugin's tsx with cwd `~/.maps-lists` (`MAPS_LISTS_HOME`), so all data paths below are relative to that folder in plugin use. Makes relative file args absolute first; `npm ci --omit=dev` if `node_modules` is missing. Subcommands: `dry apply resolve review clean probe lists check-plan check-chrome chrome reddit home` (`reddit` skips the path rewriting: its args are free text). `review`/`resolve` first run `clean --older-than 7` (plugin users never run `start.sh`). Node missing/too old → `NODE_MISSING:` on stderr; the skills offer `brew install node`
- `hooks/buddy.tsx` (`hooks/hooks.json` → `modules`; state contract `types/index.d.ts`, named as `types` in `plugin.json`): a Claude Code hooks module, merged in from the maps-buddy mod. While a maps-lists skill works, Clawd (theme color `claude`, orange) walks above the prompt holding a map (`warning`, red `✕`, route drawn in step by step; the small 🗺 version under ~30 columns or 4 rows), and the spinner line names the step (`artifacts/progress.json` counts while saving). Starts on `skill.prompt` (typed `/maps-lists:…` or the Skill tool), stays across the flow's turns, ends after a main-loop turn with no `maps-lists` in it or after `report`/`clean`/`lists`. Subagent `turn.complete`s (`agentId`) are ignored: research agents finishing used to hide him. Imports only `claude-code` and relative files. Tests: `npm run test:hooks` (`scripts/test-hooks.sh`: `claude plugin test` runs every `*.test.ts` under a folder and can't load `src/`'s node:test files, so it gets a copy of manifest + `hooks/` + `types/`). Type-check with `tsc -p .claude-plugin/types` once the engine has written that folder (gitignored by its own `.gitignore`)
- `skills/{start,research,import,run,lists}/SKILL.md`: the plugin skills. Reference repo files as `${CLAUDE_PLUGIN_ROOT}/src/…` (substituted in skill bodies; **not** an env var in Bash). Conversation language is inferred from the user's message; `--lang ru` still overrides
- `src/plan.ts`: zod schema for `plan.json` (`version: 1`, `lists[].{name, emoji?, ordered, places[].{name, url?|query?, note?}}`)
- `src/selectors.ts`: **every** Maps UI hook. Roles, aria-labels and names only, never CSS classes. Per-language name tables (`TEXT.en`, `TEXT.es`, `TEXT.ru`), picked by `setLocale`
- `src/maps.ts`: page operations: openPlace, isInList, saveToList, createListWithPlace, openList, readList, writeNote, setListIcon, hardReload
- `src/run.ts`: orchestration. `apply` opens each place once, resolving and saving it in the same visit, then does icon + notes in one list-view pass, then hard reload and verify. `--dry-run` resolves everything and reads each place's Save-dialog checkbox (exact for chain branches). Writes `artifacts/report.json`, exit code 2 on verify failure; `artifacts/progress.json` (`{step, list, done, total, current, at}`) while it runs, for anything showing progress
- `src/ui-check.ts`: `maps-lists ui-check [--cdp auto] [--lang en|es|ru]`. Has Maps changed? Read-only walk of what apply does, through the executor's own functions and selectors: signed in, place page + Save, Save dialog (fixture list ticked), a permanently closed place (Fragments, Rue des Tournelles), ☰ → Saved → list view, rows + notes, icon button; ✓/✗/– per step. Fixture list `zz-ui-check` (2 Tartine places, one with a note) made once by `--setup` (through apply). Each passing step's ARIA snapshot → `ui-check/<hl>/<step>.yaml` (account lines scrubbed, gitignored); a failing one prints `snapshotDiff` against it (− label gone, + new). `--signed-out` (CI) runs only place page + closed place. Exit 0 / 1 failed / 2 fixture missing. Run before a release that touches `selectors.ts`, `maps.ts` or `run.ts`, else monthly; with `--lang es|ru` after touching `TEXT.es|ru`
- `src/probe.ts`: read-only calibration that dumps ARIA snapshots (incl. the New-list form peek, `aria-2b-new-list-form.yaml`) and `rows.json` to `artifacts/`
- `src/resolve.ts`: `npm run resolve [-- --lang <any tag>]`. Chrome-free place lookup (see "Resolving places without Chrome"); prints candidates, writes `artifacts/resolve.json`
- `src/review.ts`: `npm run review -- research/<slug>.json`. `ResearchSchema` (zod; samples `examples/research.example.json`, `.ru.json`; `lang`: any BCP 47 tag; en/ru use the built-in `UI` tables, any other uses Claude's translated `ui` labels over English, Continue per `Intl.PluralRules` category) + a review page served on 127.0.0.1 with a random token, styled as a city weekly's listings page (display face Fira Sans Extra Condensed 800 from `assets/fonts`, SIL OFL, inlined as data URIs so the page stays offline): folding category bars pinned while they scroll, with live counts and Untick all; a Jump to index; per place a tick, red source credits, "Why it's here" details and a write-in note with Undo your edit; unticked names struck in red, never faded; "Left out" folded, with reason prefixes (`trap:` …) shown as tags; footer with "Stop, don't save" (inline confirm once anything changed) and Continue. Continue writes `<slug>.places.md` and the choices back into the JSON. Exit 0 submitted · 1 invalid · 2 cancelled · 3 still waiting (`--wait`, re-run with `--resume`: same port/token, page reconnects) · 4 no heartbeat (`--idle`). `--check` validates only
- `src/clean.ts`: `npm run clean [-- --dry-run]`. Removes `artifacts/*`, every untracked `plan*.json` (incl. `plan.retry.json`, dated backups, custom names), everything in `research/` except `*.places.md`, `reports/`, `research_notes/`. In `.gmaps-state.json` it drops only entries that can't match again (name > 40 chars, or `zz-*` test lists). Keeps git-tracked files and real list entries. `maps-lists:run` calls it after a fully verified apply only; `start.sh` runs `--older-than 7` on launch (only items untouched for 7 days, state file untouched) for sessions closed midway
- `start.sh`: `npm start`. For clones: loads the repo as the plugin (`claude --plugin-dir`). Preflight (claude, node ≥18, node_modules, Chrome, `bin/maps-lists clean --older-than 7`), then language (English / Русский → `--lang ru` on the skill; forces a UTF-8 locale so bash 3.2 counts Cyrillic letters; brace vars next to `«»`, bash 3.2 reads `$list»` as one name), then mode: **research** (lists the 5 questions with examples; what incl. preferences / where / list name ≤40, `"` stripped / depth / model; soft check moves a place typed into What to Where) → `claude --plugin-dir … --model <opus|sonnet> --effort medium "/maps-lists:research …"`, or **.md file** (path resolved against the caller's cwd, optional list name) → `claude --plugin-dir … --model sonnet --effort medium "/maps-lists:import …"`. User input travels as one argv element
- `src/chrome-check.ts`: `maps-lists check-chrome [--set main|separate]`. One JSON line `{mode, platform, status, host, chromeRunning, readyBefore?}` (`host` is only worked out on macOS, `{kind: "unknown"}` elsewhere, since Full Disk Access is macOS only) (`status: no-chrome` when Google Chrome isn't installed anywhere; `chromeRunning` = the user's own Chrome, not the profile, is open → if not, the run skill recommends the separate window): reads `DevToolsActivePort` only to test access, never prints it (Claude's own `ls`/`cat` of it is both unreliable, since `ls` succeeds without Full Disk Access, and blocked as credential access). `host` = who macOS checks: the desktop app's inner Claude Code copy (`CLAUDE_CODE_EXECPATH` under `Application Support/Claude/claude-code/<ver>/…/claude.app`; granting "Claude" doesn't help, and the path changes per update), else the outermost `.app` among ancestors (the terminal). Mode + last desktop copy with access in `config.json`
- `src/report-md.ts`: `maps-lists report [--lang ru]`. `artifacts/report.json` + the state file's list URL → the finished Markdown block (heading icon, counts table, Verify, not found / failed, skipped notes, 📍 link). The run skill shows it verbatim, so the layout doesn't depend on Haiku
- `src/lists.ts`: `maps-lists lists`. JSON of every list in `.gmaps-state.json` (Maps link) joined with the `research/*.places.md` files titled with its name, newest first, `zz-*` left out
- `src/reddit.ts`: `maps-lists reddit status|setup|login|off|on|search|read`. Optional Reddit reader for research: rdt-cli (pinned `RDT_VERSION`) installed with uv (Homebrew, else Astral's installer; uv brings its own Python), signed in by `rdt login` from the user's browser cookies (Keychain "Chrome Safe Storage" prompt). Anonymous Reddit reads are 403 (rdt, `curl`, `WebFetch`; Oct 2026). Only search/read with whitelisted flags pass through; rdt's vote/comment/subscribe have no path. `off` = `reddit: "off"` in `config.json`. `rdt status` already falls back to browser cookies, so status can log in by itself (and raise the Keychain prompt). Search/read output is trimmed (`compactSearch`, `compactThread`: no usernames; a raw thread is ~60 KB for 15 comments); rdt's raw search Listing carries `modhash`, which must never be printed. Never read `~/.config/rdt-cli/` (the user's Reddit session). Live search + read passed on r/Lisbon (Oct 2026); by Oct 27 Reddit answered `search` with 403 while `read` and subreddit listings still worked, so research step 1c finds thread links by web search then and reads them. rdt keeps a saved credential and rereads the browser only after 7 days, and its `login` stops at "Already authenticated" for any saved one, even one Reddit rejects: `maps-lists reddit login` runs `rdt logout` first when status isn't logged in
- `src/connect.ts`: `--cdp auto` (reads `DevToolsActivePort`), `http://…` discovery, or `ws://…`
- `src/platform.ts`: everything that differs on macOS / Linux / Windows: Chrome's user-data folders (`DevToolsActivePort`), where Chrome is installed, spotting the user's own Chrome among processes (`ps`; PowerShell CIM on Windows; Linux's `google-chrome` is a wrapper, so the running `chrome` binary is matched by name), `which`, opening a link (`open` / `xdg-open` / `rundll32`, never `cmd /c start`: `&` in the review URL). Pure helpers take the platform as an argument so `platform.test.ts` covers every OS. Linux passed in Docker (Debian Chromium under Xvfb: both modes, `connect`, resolve; Oct 2026). Windows runs in CI (GitHub's Windows runner: `bin/maps-lists` under Git Bash, Claude Code's shell there, finding Chrome, the separate profile, `connect`, signed-out `ui-check`; Oct 2026); the signed-in flow (save, notes, verify) and main-Chrome mode are still unrun on Windows
- `src/launch-chrome.ts`: `maps-lists chrome` (the separate profile on 9333, started detached) and `maps-lists chrome --main [url]` (the user's own Chrome, e.g. at `chrome://inspect/#remote-debugging`; `open -a` on macOS). The skills use it instead of `open -a "Google Chrome"`
- `skills/research/SKILL.md`: optional first step. "Bakeries in Lisbon" → the `deep-research` skill (or one quick pass with `--quick`) → step 1c reads Reddit threads via `maps-lists reddit` when it's ready (step 0 asks once whether the user has a Reddit account; no → `reddit off`, snippets) → filtered research (no tourist traps or viral places; sources: local press, Reddit threads or snippets, Telegram `t.me/s/` previews, Russian media + Yandex/2GIS for Russian-speaking cities; per-region platforms such as Tabelog or Naver in `skills/research/sources-by-region.md`, added to the general sources, never instead of them) → `research/<slug>-<date>.json` → review page (`maps-lists review`) → `.places.md` → apply. Step 0 asks depth + model with trade-offs (skips what the request says; a different model → user types `/model …` and says continue). Filter tests quality, not fame: still-rated famous places stay as `Classic.` (details and note start with it; locals' clear Reddit picks get "Reddit favourite." in the note, before Michelin); `--more-gems` ("include hidden gems") digs for lesser-known places and keeps ≤3 classics per category, `--gems` ("only") moves all of them to `excluded` (`classic:`); bare "hidden gems" → asked; traps, viral, bad and closed places are filtered; a place needs two independent sources or one strong local one (a contest ranking or one listicle counts as one source), else it goes to `excluded` as `thin evidence:` (`unconfirmed:` when it can't be told whether it's still open); new openings follow the same bar; ~10–25 per category; nothing is dropped silently
- `skills/import/SKILL.md`: Sonnet. Places the user names in their own message = direct add: no review page, ambiguous names asked via `AskUserQuestion` (never guessed), hand-off with `--apply` (run skips the Apply / Dry run question). A file (`.md`; `.txt`/PDF/HTML/`.eml`/image via Read; Word/RTF/ODT via `textutil`; anything but `.md` first saved as `research/<slug>-<date>.source.md`) or pasted text → review page (`research/<slug>.json`; skipped for a `*.places.md`) → resolved `plan.json` + `artifacts/plan-summary.md` → run. Sample input: `examples/places.example.md`
- `skills/run/SKILL.md`: Haiku. Shows the summary, asks Save to Maps / Stop (no dry run offered; only on request; `--apply`/`--yes` skip the question), checks Chrome, runs, reports from `report.json`, cleans up after a verified apply. `--report` only reads the last report. Chrome step starts with `check-chrome`: no access in a terminal → Full Disk Access pane (`x-apple.systempreferences:…?Privacy_AllFiles`) + Cmd-Q; in the desktop app → separate window recommended (remembered), or the inner copy's path, or Terminal
- `skills/lists/SKILL.md`: Haiku. `maps-lists lists` → table with Maps links, or one list's places merged across its places files; open the folder, copy to Downloads, hand off to research/import to add
- `.github/workflows/test.yml`: CI on every push, macOS + Linux (Xvfb) + Windows (Git Bash): typecheck, `npm test`, then a signed-out smoke run (`bin/maps-lists check-plan`/`check-chrome`, `maps-lists chrome`, `ui-check --signed-out`: place page + Save button, closed place). Also weekly (Mondays), to catch Maps changes between pushes. The only real Windows run we have. `test:hooks` stays local (needs the `claude` CLI)
- `README.md` is for non-technical users (plugin install, asking Claude, troubleshooting). Commands, flags and internals go in `docs/advanced.md`

## Commands

```bash
npm start                                                                # start.sh: research or .md → review → Maps
npm run resolve -- queries.txt | --query '<name city>'                  # no Chrome: candidates + /maps/place/ URLs
npm run review -- research/<slug>.json [--resume] [--no-open] | --check  # review page → research/<slug>.places.md
npm run clean [-- --dry-run]                                             # keep only research/*.places.md + state
npm run probe -- '<maps place url>' '<existing list name>' --cdp auto   # read-only
npm run ui-check -- --cdp auto [--lang es|ru] [--setup]                  # has Maps changed? read-only (--setup: make zz-ui-check once)
npm run dry   -- plan.json --cdp auto                                    # resolves + reads, writes nothing
npm run apply -- plan.json --cdp auto                                    # writes, then verifies
npm run chrome                                                           # dedicated Chrome profile on 9333 (src/launch-chrome.ts)
npm run typecheck
npm run test:hooks                                                       # Clawd hooks module (claude plugin test on a copy)
npm test                                                                 # pure logic: parseRows, title matching, plan schema, review page + server, clean, lists, reddit wrapper
```

## Connecting to Chrome

- **Main Chrome** with the `chrome://inspect/#remote-debugging` toggle on (port 9222). In this mode
  `/json/version` returns **404**, which is expected. Connect with `--cdp auto`, which reads the
  WebSocket path from `~/Library/Application Support/Google/Chrome/DevToolsActivePort`.
  - On macOS, reading that file needs **Full Disk Access** for the terminal. Without it the read
    fails with `EPERM` (TCC).
  - Chrome shows an **Allow** dialog on every new CDP connection, so the first action of each run
    waits for the user to click it.
- List rows of a place with no reviews have no children: `button "<title> <category>"` straight before its note control (`Tartine Bakery Bakery`); a selected row has `button "Delete"` (`rowDelete`) in between, and a bare row moved to the top sits after `Share` / `Add a place`, which must not be taken for rows. `parseRows` keeps them as `bare` rows, and `titleGroup` puts a bare row in the longest plan title it starts with (it was dropped before, so verify reported the place missing; Oct 2026).
- **Dedicated profile**: `npm run chrome` starts one on **9333** with normal HTTP discovery. Drop `--cdp auto`. Not 9222: the main Chrome toggle holds 127.0.0.1:9222, and a second Chrome on it binds only `[::1]`, so `127.0.0.1:9222` reaches the main Chrome (404) and the profile looks "not running" (seen Oct 2026). Desktop app Code tab → separate window → sign-in → apply + verify passed (Oct 2026). Closing its last window doesn't quit that Chrome, and a Chrome with no page fails `connectOverCDP` with `Browser.setDownloadBehavior: Browser context management is not supported`: `connect()` opens a tab first (`/json/new`), and never falls back to the main Chrome for an `http://` cdp.
- **Account guard** (optional): `--account you@gmail.com` or `GMAPS_ACCOUNT` makes `dry`/`apply` stop
  before anything else if the signed-in account (`button "Google Account: <Name> (<email>)"`) doesn't match.
  The error never prints the account it found.
- **zsh: always single-quote Maps URLs.** Inside double quotes, `!4m6!3m5…` triggers history expansion.
- Node + npm, not pnpm. Maps UI language: `--lang auto` (default) opens Maps without `hl` and reads
  `<html lang>` (follows the account). `es*` → `TEXT.es`, `ru*` → `TEXT.ru`, each with that exact tag as `hl`; anything else → `TEXT.en`
  with `hl=en`. `TEXT.es` was probed and passed an apply under `hl=es`
  (Oct 2026). Closed-place text and sign-in link seen by `ui-check`; still unseen: a closed row in a list, "Guardado (N)". The emoji picker stays English.
  `TEXT.ru` was probed and passed an apply under `hl=ru` (Oct 2026). Closed-place text and sign-in link seen by `ui-check`;
  still unseen: a closed row in a list, "Сохранено (N)". Clear icon is "Удалить значок".

## How the Maps UI behaves (from probe snapshots, Oct 2026)

- Place page: the place's own `main "<name>"` holds `h1` and `region "Actions for <name>" > button`
  `"Save" | "Saved" | "Saved (N)"` (N = number of lists it's in). A place URL copied from a list also
  opens that list in a **second** `main` with its own `h1`, so `placeTitle` is scoped to the place's main.
  A closed place shows "Permanently closed" there; `openPlace` treats it as unresolved.
- Save dialog: `menu "Save in your lists" > menuitemradio "<List> Private · 7 places" [checked]`,
  plus `button "New list"`. All lists render at once. List names always carry a subtitle (`Private|Shared|Public`).
  **A just-created list is missing from this menu for a while** (seen missing at +10 s), so
  `saveToList` reloads and retries for up to ~1 min.
- New list form: `dialog "New list" > textbox "List name"` (prefilled "Untitled list") + `button "Create"`.
  The dialog comes first in the DOM, so always scope to it (a page-wide `.last()` hit the place's Save button).
- Navigation: `search > button "Menu"` → `menu "Settings" > menuitem "Saved"` → `main "Your places"`
  → `button "<List> Private · N places"`. Right after a page load Maps ignores the Menu click, so
  `openSavedPanel` waits and clicks again until the menu opens.
- List view: `main` (unnamed) with `heading [level=1] "<List>"`, then **flat rows**:
  `button "<title> 4.7 stars …"` (first `text:` child = title), followed by `button "Add note"` or
  `textbox "Note"` (holds the note). A closed place's row has no children: `button "<title> Permanently closed"`.
  Rows are parsed from the panel's **ARIA snapshot** (`parseRows`), and note controls are reached
  through role locators. The DOM has hidden "Note" buttons that aren't clickable. A `button "Delete"`
  appears on hover. **Never click it.**
- The list **lazy-loads** as you scroll, slowly after a hard reload. `readRows` only stops after
  several scrolls in a row bring nothing new. Loaded rows stay rendered, so `writeNote` only scrolls
  the whole list when its row isn't loaded yet.
- Notes: click "Add note", then re-read **without scrolling** (scrolling blurs the empty box and it
  closes), fill, then `locator.blur()`. Saving on blur is verified. **Not Tab:** it focuses the next row,
  which selects it, and a selected row's card covers its own "Add note" button (clicks get intercepted).
- Icon: a list without an icon has header `button "Choose icon"`. One with an icon has `button "Edit icon"`
  → `menu > menuitemradio "Choose icon" | "Clear icon"` (**never Clear**). Either way you get
  `dialog "Emoji characters palette"` with every emoji as `option "<emoji>"`, all rendered at once.
- **Display order is most-recently-modified first:** saving a place *or editing its note* moves its
  row to the top (verified Oct 2026). It only matters with `ordered: true` (off by default); `apply`
  then saves the plan backwards and writes notes backwards too, so rank 1 ends up on top.
- `.gmaps-state.json` (gitignored) records every list the executor created or opened. A recorded list
  is never created again, even if the Save menu doesn't show it yet.

## Gotchas

- Reading `DevToolsActivePort` needs Full Disk Access for whatever started `claude`. Started from a
  terminal that has it, `claude '/maps-lists:import <file.md> "<List>"'` runs the whole flow itself.
  The VS Code extension gets `EPERM`, so there the user runs `dry`/`apply` in their terminal and
  Claude reads `artifacts/` afterwards.
- Every failure leaves `artifacts/<ts>-fail-<step>.png` **and** `.yaml` (ARIA snapshot). Read the
  yaml first, because it has exact accessible names. Snapshots contain the account name/email, so
  don't paste them anywhere.
- One tab doing ~70 Maps place loads gets its renderer killed ("Page crashed"), and reloads don't
  free the memory. `run.ts` opens a fresh tab every 25 places, before the list-view pass, and
  right after a crash (the crashed place gets one more try). In the dedicated profile (`connectedToOwnWindow`, HTTP discovery) the first tab is
  reused and that Chrome is quit at the end (`Browser.close`); in the main Chrome every tab is new and closed at the end.
- Never write named helper functions inside `page.evaluate`: tsx wraps them in `__name()`, which
  doesn't exist in the page. (The executor no longer uses `evaluate` for rows.)
- Resolving places without Chrome: Google's `/maps/search/?api=1&query=…` page links a
  `/search?tbm=map…` data URL that a plain `fetch` can read. It gives candidate names, addresses and
  feature ids (`0x…:0x…`), which go into `https://www.google.com/maps/place/<name>/data=!4m2!3m1!1s<id>`.

## Rules

- Never delete places or lists, and never change sharing. The executor has no code path for either; keep it that way.
- Notes are appended (` · `), never overwritten. `noteCovered` (maps.ts) skips a note already said: exact containment, or a short note (≤ 6 meaningful words, filler like get/the/go ignored) whose words the existing note has; reported as `notesSkipped`, and verify accepts it.
- Ambiguous `query` places become **unresolved**. Never guess a match.
- **Chains: add every location**, unless the document points to a specific one. Each branch is its
  own plan entry with its own address, and all branches get the same note. The executor handles
  same-name rows: it doesn't skip by name (each place's Save-dialog checkbox decides), pairs the
  k-th entry with the k-th same-name row for notes and verify (except a same-name group sharing one
  note, the normal chain case: every row of the group gets the note, re-reading after each write,
  since rows carry no address and new or edited rows jump to the top; Oct 2026), and drops entries that resolve to
  the same place id. "Same name" means exact title first (`titleGroup`), falling back to `sameTitle`
  prefix matching, so "Septime" and "Septime La Cave" never share a group.
- `dry` is for development only; the skills don't offer it (Oct 2026: it duplicated the summary and cost a full Chrome pass). Apply is safe for new and existing lists: it checks each
  place's Save-dialog checkbox, skips closed/unresolved places, and never saves twice. Writes
  can't be undone, but they only ever add.
- List names are capped at 40 characters (`MAX_LIST_NAME` in `plan.ts`): Maps cuts longer ones,
  and the executor then can't find the list it created.
  Use throwaway lists for testing writes.
- Keep all selectors in `selectors.ts`. When Maps changes, re-probe and diff the snapshots rather than guessing.
- Don't print or commit the contents of `DevToolsActivePort`. It grants control of the signed-in browser.
