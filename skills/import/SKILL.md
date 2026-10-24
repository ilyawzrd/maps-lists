---
name: import
description: Use when the user names places to add to a Google Maps list ("add Tartine to my SF list"), or wants places from a file (.md, .txt, PDF, Word, a saved web page or email, a screenshot), from text pasted into the chat, or from a maps-lists:research places file added to a Google Maps saved list, or an existing list updated, with notes. Opens the review page (checkboxes, editable notes) for a file that wasn't reviewed yet, builds plan.json, then hands it to maps-lists:run to apply with the plugin's deterministic executor.
argument-hint: <places, a file or pasted text> ["List name"] [--yes] [--account <email>] [--lang <tag>]
model: sonnet
effort: medium
---

# A document → Google Maps list

You do the judgment work: parse, let the user review the places on the review page, resolve,
build `plan.json`. Then `maps-lists:run` (on a smaller
model) runs the executor (`maps-lists apply`), which only clicks.

## Data folder

`maps-lists` (on your Bash PATH while the plugin is enabled) runs the executor with
`~/.maps-lists/` as its working folder (`MAPS_LISTS_HOME` overrides it; `maps-lists home` prints
it). Every relative data path in this skill (`research/`, `artifacts/`, `plan.json`,
`.gmaps-state.json`) lives there, and `maps-lists` resolves them there itself. When you Read or
Write one of those files with your own tools, use the full path (`~/.maps-lists/plan.json`).
Pass data files by these relative names. Pass anything else (the user's `.md`, a queries file in
your scratchpad) as an absolute path.

If a `maps-lists` command fails with `NODE_MISSING`, Node.js 18+ is missing or too old. If the
message names an install command (`brew install node` with Homebrew, `winget install
OpenJS.NodeJS.LTS` on Windows), ask with `AskUserQuestion` (header `Node.js`): **Install it now**
(run that command with Bash, `timeout: 600000`, then retry; after winget, the user may have to
restart Claude Code so Node is on PATH) / **I'll install it myself** (link https://nodejs.org and
stop). Without one, give the link and stop.

## Input

`$ARGUMENTS`, e.g. `~/Downloads/la.md "LA Eats" --yes`:

- **The source**, one of:
  - **places the user names in their own message** ("add Mr. Holmes Bakehouse and Tartine to
    zz-test", "save Morreig to Barcelona"): a direct add, see below;
  - a path to a file with places (headings, bullets or free text; see
    `${CLAUDE_PLUGIN_ROOT}/examples/places.example.md`). Dragging a file into the terminal pastes
    its path, often quoted or with `\ ` before spaces: strip those, expand `~`, make it absolute;
  - places pasted straight into the conversation (in `$ARGUMENTS` or the user's message);
  - neither: ask for it, in one line ("drag the file in here, or paste the list").
- **Optional list name** (quoted or the remaining words): overrides the file's title.
- **Optional `--yes`:** save without asking (passed to `maps-lists:run`).
- **Optional `--account <email>`:** the account guard (passed to `maps-lists:run`).
- **Optional `--lang <tag>`:** the conversation language. Without it, use the language the user
  writes in, whatever it is. Your messages, questions and `artifacts/plan-summary.md` are in it,
  `maps-lists resolve` gets `--lang <tag>` (names and addresses in that language for the summary),
  and `maps-lists:run` gets `--lang <tag>`, for anything but English. Strings below are given in
  English, some with a Russian version as a worked example; translate them for other languages.
  Notes keep the language of the source file in any case:
  never translate them.

The whole flow runs in this session, including the Chrome steps in `maps-lists:run`. On macOS those
need a session started from a terminal with Full Disk Access.

## Flow

0. **Get the source as Markdown.** Step 1 and the review page work from one `.md` file.
   - **`.md`:** use it as is.
   - **`.txt`, `.html`/`.htm`, `.eml`, PDF, image** (a screenshot of a list or a menu): read it
     with the Read tool (PDF: `pages` in chunks of 20).
   - **`.docx`, `.doc`, `.rtf`, `.odt`, `.pages`-exported text:** on macOS, convert with the
     built-in `textutil -convert txt -stdout "<file>"` and read the output. On Linux or Windows,
     use `pandoc -t plain "<file>"` if `pandoc` is installed (not `.doc`), else
     `soffice --headless --cat "<file>"` if LibreOffice is; with neither, ask for the file saved
     as PDF or for a copy-paste.
   - **Pasted text:** the text the user pasted.
   - Anything you can't read (a spreadsheet, an encrypted PDF, an unsupported format): say what
     you can read and ask for a copy-paste instead. Never guess at contents.

   For everything except an `.md` file, write what you read to
   `research/<slug>-<YYYYMMDD>.source.md` in the data folder, keeping the original wording and
   order (headings, bullets, the text around each place; drop page furniture like headers,
   footers and ads). The slug comes from the file's basename, or for pasted text from the list
   name or the city (ASCII). From here on, that file is "the file". Don't tell the user about this
   step beyond one line ("Read 23 places from lisbon.pdf").
1. **Parse the file** into places. Text attached to a place (the rest of its bullet or
   paragraph) becomes its `note`, trimmed to one or two short sentences. Order doesn't matter:
   leave `ordered` out (it defaults to false) unless the user asks for a ranked list.
   **Note style** (Maps shows notes in a narrow mobile sheet):
   - Plain text only: no `**bold**`, headings or links. Maps shows markdown as literal characters.
   - Don't repeat the place name, city or address. The row already shows them.
   - Concrete, usable info only: what to order, when to go, book ahead, closing day. No filler
     like "great atmosphere" or "authentic".
   - One or two sentences by default, never more than about six.
   - No source markers or rank numbers unless the user asked for a ranked list.
   - Michelin Guide status the file gives for a place (stars, Bib Gourmand, "Michelin
     recommended"/Selected) stays in the note, as its last sentence, in the form
     `maps-lists:research` uses: "Michelin star (2026).", "Two Michelin stars (2026).",
     "Three Michelin stars (2026).", "Michelin Bib Gourmand (2026).", "In the Michelin Guide (2026)."
     Translated with the note. The year only when the file gives one; never look it up or add it
     from memory.
   **A `*.places.md` from `maps-lists:research`** is already in this shape: `# ` is the list name,
   `## ` sections are categories, and each bullet is `**Name** (area): note`. Use its notes as
   written, put the `(area)` into the resolve query, and treat `(all branches)` as a chain
   (step 4: add every location).
2. **List name.** Use the name from the arguments if given. Otherwise use the file's
   top-level title, or ask the user if there is none. Ask for an emoji only if the user
   mentioned one. **At most 40 characters:** Maps cuts longer names, and the executor then
   can't find the list it just created. A longer title gets shortened to its core
   ("Where to Eat & Drink in Los Angeles (October 2026)" → "LA Eat & Drink (Oct 2026)";
   «Куда сходить поесть и выпить в Санкт-Петербурге (октябрь 2026)» → «Еда и бары СПб (окт 2026)»);
   say what you picked. A longer name from the arguments: ask for a shorter one.
3. **Review page.** Skip this step for a `*.places.md` (it comes from `maps-lists:research` and was
   already reviewed on this page) and for a **direct add** (below). Every other source goes through it.
   - Write `research/<slug>-<YYYYMMDD>.json`, with the slug from the file's basename (ASCII only,
     e.g. `research/la-eats-20261019.json`; for a `.source.md`, drop `.source`). The schema is `ResearchSchema` in `${CLAUDE_PLUGIN_ROOT}/src/review.ts`
     (sample: `${CLAUDE_PLUGIN_ROOT}/examples/research.example.json`), filled from step 1:
     - `lang`: the conversation language's tag; leave it out for English. It sets the page's
       language. For any language but English and Russian, also add `ui` with the page's labels
       translated, as described for the research file in `maps-lists:research` (the `en` table in
       `${CLAUDE_PLUGIN_ROOT}/src/review.ts` has the English wording; `go` per plural category with
       `{n}`).
     - `list`: the name from step 2.
     - `places[]`, in the file's order: `section` (the file's heading for it, or `""`), `name`,
       `area` (the street or neighbourhood the file gives, `all branches` for a chain the file
       doesn't pin to one branch, or `""`), `note` (in note style), `details` (the place's own text
       from the file when it says more than the note, otherwise `""`). Leave out `sources` and
       `excluded`.
   - Validate with `maps-lists review --check <json>` and fix any reported field.
   - Tell the user in one line that a page is opening in their browser to untick places and edit
     notes. Then run `maps-lists review <json>` with Bash, `timeout: 600000`, and act on the exit code:
     - `0`: the page wrote `research/<slug>-<YYYYMMDD>.places.md` and printed a summary
       ("Kept 11 of 13 …"). Repeat it in one line. From here on, work from that `.places.md`
       (its places and notes as written, `(area)` and `(all branches)` as in step 1), not from the
       original file.
     - `3`: the page is still open (a command can't run longer than 10 minutes). Run
       `maps-lists review <json> --resume` straight away, without saying anything, as often as
       needed. The page keeps its state and reconnects.
     - `2` (cancelled in the page) or `4` (tab closed): ask with `AskUserQuestion` (header
       `Review`, in Russian `Проверка`): **Reopen the page** (run it again without `--resume`) /
       **Stop** (in Russian **Открыть снова** / **Стоп**).
     - `1`: the JSON is invalid. Fix it and run again.
4. **Resolve every place to a `/maps/place/` URL** and put it in `url`. Use `query` only when
   the search will land on one unambiguous place. Anything ambiguous goes in a list for the
   user. Never guess a match. Resolve without Chrome: write one query per line
   (`<name> <area> <city>`) to a file in your scratchpad and run
   `maps-lists resolve <that file>` (add `--lang <tag>` for anything but English). It prints name | address | feature id per query, and
   `artifacts/resolve.json` has the ready `/maps/place/` URL for each candidate. Re-query
   single places with `maps-lists resolve --query "<name> <street> <city>"`.
   - **Chains: add every location.** If a place has several branches and the document doesn't
     single out one ("this address", a street address, "the award-winning one"), add one entry
     per branch in the relevant city, each with its own address `query` or URL. If the
     document names specific addresses, add exactly those (e.g. two addresses → two entries).
     Give all branches of one chain the **same note**, because the list view shows them with
     the same name and can't tell them apart. A search that returns several results for a name
     is often a chain: find its branch addresses, don't drop it.
5. **Write `plan.json`** in the data folder. If one already exists, copy it
   to `plan.<YYYYMMDD-HHMM>.json` first. The schema is in `${CLAUDE_PLUGIN_ROOT}/src/plan.ts` and a
   sample is in `${CLAUDE_PLUGIN_ROOT}/examples/plan.example.json`. Validate it with
   `maps-lists check-plan plan.json`.
6. **Write the handoff** to `artifacts/plan-summary.md`, Markdown that `maps-lists:run` shows as
   is, in the conversation language. The list is new unless `.gmaps-state.json` has it or the user
   says it exists. Shape:

   > ## 📋 Lisbon Bakeries · new list
   > **12 places** · 3 of them branches of one chain · 1 not found
   >
   > ### Pastelarias
   > - **Manteigaria** — Rua do Loreto 2, Lisboa
   > - **Manteigaria** — Rua Augusta 195, Lisboa
   >
   > ⚠️ **Not found:** Padaria X (two places with that name in Lisbon; skipped)

   - **New list:** every resolved place as `**Maps name** — address`, grouped under `###`
     headings as in the document. That's the preview before anything is saved.
   - **Update** (`existing list`): the counts line, the not-found line, then the two limits from
     "New list vs. update" below as a short ℹ️ note.
   - Each not-found place with what was found for it. Leave out lines with nothing to say.
   - Translate headings and labels (in Russian, e.g. «новый список», «12 мест · из них 3 филиала
     одной сети», «Не найдено»).
7. **Hand off to `maps-lists:run`.** Invoke the `maps-lists:run` skill with the plan path, plus
   `--apply` for a direct add, and `--yes`, `--account <email>` and `--lang <tag>` if they were given. It runs on a smaller model and does the
   rest: the Save to Maps question, Chrome checks, the run and the report.

## Direct add

When the user names the places themselves in their message, they've already decided, so don't
make them confirm it again. What counts: places typed by the user as the thing to add ("add X and Y
to Z"). What doesn't: a pasted list or article, a file, or research results; those are someone
else's picks and go through the review page.

- Skip steps 0 and 3. Step 1 takes the places from the message; a note only when the user gave one
  ("…with the note: get the morning bun"), in their words. Ask for the list name if there's none.
- Resolve as in step 4, using the city from the message, the list name or the list's other places.
  **Count the matches strictly.** A match is any candidate in that city whose name is the name the
  user gave or the same brand: for "Tartine Bakery" the lookup returns Tartine Bakery (600 Guerrero
  St), Tartine Bakery (351 California St), Tartine Manufactory and Tartine Inner Sunset, which is
  4 matches. Unrelated names in the results (Mariposa Baking, Uncle Tetsu) don't count. Exactly
  one match → save it. Two or more → ask, even when one is the famous original: which one the user
  means is their call, not yours. Skip the question only if the user pinned it (a street, a
  neighbourhood, "the original").
  Ask with `AskUserQuestion` (header `Which one?`). **Always** include **All of them** as the first
  option, labelled with the count (`All 4 locations`, in Russian `Все 4 места`), whether or not it
  looks like a chain; then one option per candidate as `Name · address`. The question takes at
  most 4 options, so with more than 3 candidates show the 3 likeliest and say in the question
  that another address can be typed under Other. "All" adds every candidate as its own entry with
  the same note (see "Chains" in step 4). Never pick one yourself. Nothing found:
  say so and ask for a street or neighbourhood.
- Write `plan.json` and a short summary as usual; then hand off with `--apply`, so the place is
  saved straight away with no Save question. Before that, say in one line what will be
  saved: `📍 Mr. Holmes Bakehouse · 1042 Larkin St → zz-test`.

## New list vs. update

If a list with that name already exists, this is an **update**: each place's own Save-dialog
checkbox decides whether it's already in the list (so chain branches are checked one by one),
new places are added, and new notes are appended (` · `, never overwritten). The summary
states two limits:

- Places removed from the source are **not** removed from Maps.
- With `ordered: true`, ranking is exact only for a list the executor creates. In an existing
  list, new places are ranked among themselves and existing ones keep their position.

## Rules

- Keep internals out of replies: no commands, file names, backups, validation results or exit
  codes. The user sees the summaries, the questions and anything they need to act on.
- Never delete places or lists, never change sharing. The executor has no code path for
  either.
- Ambiguous places become **unresolved**. Never guess.
- Don't write the `.places.md` yourself; the review page writes it from the user's choices.
- Never run `maps-lists apply` from this skill. That's `maps-lists:run`'s job, and it
  asks before saving unless it's a direct add. Use a throwaway list (e.g. `zz-executor-test`) when testing writes.
- Single-quote Maps URLs in zsh (`!` triggers history expansion in double quotes).
- If the user has several Google accounts in Chrome, suggest `--account <their email>` (or
  `GMAPS_ACCOUNT`). The run then stops before writing anything if Chrome is on the wrong account.
- Selectors live only in `${CLAUDE_PLUGIN_ROOT}/src/selectors.ts`. If Maps changed, re-run `maps-lists probe`.
