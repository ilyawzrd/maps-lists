---
name: research
description: Use when the user wants places in a city or neighbourhood (bakeries, coffee, restaurants, bars, brunch, natural wine…) researched or put on a Google Maps list, which they show by naming a list or saying list, save, Maps or research, however briefly ("bakeries in San Francisco, quick, list zz-sf", "make me a list of coffee in Lisbon", "research ramen in Tokyo"). Researches local favourites and still-good classics (tourist traps, viral TikTok places and closed places filtered out; local press, Reddit and Telegram checked; any language), opens a review page, then saves via maps-lists:import. "Quick" means a quick research pass. Not for a plain question with none of those signals ("best coffee in Lisbon?"): answer that normally.
argument-hint: <what> in <where> ["List name"] [--quick|--deep] [--opus|--sonnet] [--more-gems|--gems] [--yes] [--lang <tag>]
effort: medium
---

# Research → places file → Google Maps list

The optional first step in front of `maps-lists:import`. By default the research runs through the
`deep-research` skill (parallel research agents, like desktop Research mode). You then filter the
result into `research/<slug>.json` and open the review page, where the user ticks places and edits
notes. The page writes the places file, which you hand to `maps-lists:import`. Import resolves it and
passes it to `maps-lists:run` for the Chrome part. Nothing is written to Maps until the user picks Save to Maps there.

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

`$ARGUMENTS`, e.g. `bakeries in Lisbon "Lisbon Bakeries" --yes`:

- **What:** one or more categories (eat, drink, coffee, bakeries, natural wine, brunch…).
- **Where:** a city or neighbourhood. If it's missing, ask with `AskUserQuestion`. Beyond that, ask
  only step 0's depth and model.
- **Optional list name:** quoted (`"Lisbon Bakeries"`), or said in words at the end of the request:
  `list <name>`, `in the list <name>`, `to the list <name>`, `called <name>`, `name it <name>`
  ("bakeries in SF, list zz-sf"; "restaurants in San Francisco, put them in the list San Francisco").
  Take the words after it up to the next flag, trim them, and cut to 40 characters
  (`MAX_LIST_NAME` in `${CLAUDE_PLUGIN_ROOT}/src/plan.ts`). "list" with no name after it ("make me a
  list of coffee in Lisbon") is not a name. Name before the word ("put them in my San Francisco
  list"): add a question to step 0's card with your guess ("San Francisco") first, the same way as
  the gems question below. Nothing said: make one up, short, e.g. "Lisbon Bakeries" or "Tokyo Eat & Drink".
- **Depth, optional:** `--quick` (or "quick", "fast" in the request) does one research pass
  yourself (step 1b); `--deep` (or "deep", "thorough") runs `deep-research` (step 1). Not given →
  step 0 asks.
- **Model, optional:** `--opus` / `--sonnet` (or "with Opus", "on Sonnet" in the request). Not
  given → step 0 asks.
- **Balance of classics and lesser-known places, optional.** Three settings; read the request
  for which one the user means:
  - **Mix** (default, nothing said): local finds plus the classics locals still rate.
  - **`--more-gems`** ("include hidden gems", "also underrated spots", "more lesser-known
    places", «и неочевидные места тоже», «побольше локальных»): the user wants gems *added*, not
    classics removed. Keep classics, at most about 3 per category (the clearest must-sees), and dig
    harder for lesser-known places (step 1).
  - **`--gems`** ("hidden gems only", "no famous places", "skip the classics", «только
    неочевидные», «без известных мест»): leave the classics out (step 2).

  "Hidden gems" with no "only"/"also" is ambiguous: add a third question to step 0's card,
  header `Classics` (`Классика`): **Mix in the classics (Recommended)** / **Only lesser-known
  places** (in Russian **Вместе с классикой (рекомендуется)** / **Только неочевидные**), where
  "mix" means `--more-gems`.
- **Optional `--yes`:** passed through to `maps-lists:import`.
- **Optional `--lang <tag>`:** see "Language" below. Without it, use the language the user writes
  in, whatever it is.
- Anything else (budget, vegetarian, near a hotel, open late) is a constraint for the research.

## Language

The conversation language is `--lang <tag>` if given, otherwise the language the user writes in,
whatever it is (Spanish, Catalan, German, Japanese…). Everything the user sees is in it: your
messages and questions, and in the research JSON `"lang": "<tag>"` plus `section`, `note`,
`details` and the text of each `reason`. Strings in this skill are given in English, some with a
Russian version as a worked example; in any other language, translate them yourself. These stay as
they are, because code and the next skill read them:
`area: "all branches"` (the review page shows it as «все филиалы»), the reason prefixes `trap:`,
`viral:`, `closed:`, `bad:`, `thin evidence:`, `unconfirmed:`, `classic:`, place names as the sources write them, and the file slug
(ASCII, transliterated: `research/moskva-pekarni-20261019.json`). Brief `deep-research` in English
or the user's language, but ask for the report's notes and details in the user's language. Pass
`--lang <tag>` to `maps-lists:import` for anything but English. The language is the user's, not the
city's: a Russian speaker's Lisbon list gets Russian notes, a Catalan speaker's Tokyo list Catalan
ones; the sources follow the city (below).

## Sources

Every research pass covers these, per category:

- **Local press and guides:** city food publications, local food bloggers, Eater /
  The Infatuation / Time Out where they exist, Michelin Bib Gourmand. Local-language sources
  count (search in the local language too).
- **Michelin Guide status:** for each pick that serves food (restaurants, bistros, street food
  and hawker stalls; not coffee or bakeries unless a source mentions Michelin), whether the
  Michelin Guide lists it: stars (1 to 3), Bib Gourmand, or Selected, and the **guide year**
  (the edition, e.g. 2026). Read it from search snippets of guide.michelin.com
  (`site:guide.michelin.com <name> <city>`; the site itself can't be fetched, it answers bots with
  an empty page) or from an article on that year's awards, never from memory (stars change every
  year). Not found → say nothing.
- **Reddit:** local subreddit first (r/lisbon, r/portugal), then r/travel, r/solotravel,
  r/<country>travel. Vary angles: "locals", "hidden gem", "avoid", "overrated", "tourist trap",
  "went downhill", this year. Upvotes, "I live here" and specificity (dish, street, price) raise a
  comment's weight. Reddit blocks `WebFetch` and anonymous reads, so there are two ways in:
  - **Threads**, when the Reddit reader is ready (step 0): step 1c reads whole threads, comments
    and their scores included, with `maps-lists reddit`.
  - **Search snippets** otherwise (reader not set up, or the user said No): at least two
    `site:reddit.com <city> <category>` searches per category, with different angles, plus
    articles that quote threads. Don't `WebFetch` reddit.com. A snippet you rely on goes into the
  place's `sources` with the thread URL from the search result
  (`{title: "r/<sub>: <thread title>", url}`), like a thread read in step 1c; a place whose
  details mention Reddit has a Reddit source. "No" to the Reddit question only
    means no threads: Reddit snippets are never skipped, in a quick pass too, and they are often
    the second source a place needs in step 2.
- **Telegram channels**, for every city: find local food and city channels with
  `site:t.me <city> <category>` (and the same in the local language), then read recent posts
  through the public web preview `https://t.me/s/<channel>` with `WebFetch` (no login). If a
  preview won't load, work from the snippets and don't retry it. A local author with a track
  record counts like local press; a channel that's mostly paid posts («реклама», `#ad`, promo
  codes, "partner") doesn't count as a source in step 2. Telegram weighs most where it's the main local food
  medium (Russian-speaking cities and the rest of the CIS, Israel, Iran…) and least where Reddit
  and local press are rich.
- **Russian-speaking cities** (Russia, Belarus, Kazakhstan, Kyrgyzstan, Georgia and Armenia for
  their Russian-language scenes…), whatever the user's language: search in Russian first. Add
  Russian-language food media and guides (Afisha Daily, The Village, Restoclub, regional city
  media, «Гастрономическая карта России», Michelin where present), Yandex Maps and 2GIS review
  snippets (weigh like Reddit comments: detailed local reviews count, star averages alone don't),
  and Telegram as a primary source. Reddit (r/moscow, r/russia, r/AskARussian, r/Kazakhstan…) is
  secondary there. Same filter rules, in Russian too: «туристическое место», «переоценено»,
  «испортилось», «хайповое», «из тиктока».
- **Region-specific sources** (Japan, Korea, China, Hong Kong, Thailand, Singapore, France, Italy,
  Spain, the Nordics, Turkey, Latin America): read
  `${CLAUDE_PLUGIN_ROOT}/skills/research/sources-by-region.md` and use the city's row on top of
  everything above, never instead of it. Any credible local source you find beyond the row counts
  too. Other regions use the sources above only.

## Flow

0. **Depth and model.** Research is the expensive step, so the user picks both before it starts.
   Skip whichever the arguments or the request already settle (a model the user names counts even
   if it's the one you're on). Ask the rest in one `AskUserQuestion` call, one question each:
   - Header `Depth` (`Глубина`): **Deep (Recommended)**: several research agents in parallel,
     5–10 min, about 15–25 places, uses noticeably more of the user's usage / **Quick**: one pass,
     1–2 min, about 8–12 places, much cheaper. (In Russian: **Глубоко (рекомендуется)** / **Быстро**,
     descriptions translated.)
   - Header `Model` (`Модель`): the model you are running on first, labelled `(current)`
     (`(текущая)`), then the other two of Opus, Sonnet and Haiku that apply. No option is marked
     Recommended. Descriptions, the same whichever is current:
     - **Opus:** best judgment on which sources to trust and what to filter out; costs more and
       uses limits faster.
     - **Sonnet:** good results, cheaper and faster.
     - **Haiku** (only when it's current): cheapest and fastest, weakest at judging sources.

   - **Reddit reader.** Run `maps-lists reddit status` with Bash first, without saying anything.
     It prints one JSON line. If `ready` or `off` is true, ask nothing about Reddit. Otherwise
     add a question to the same card, header `Reddit`, asked as whether the user has a Reddit
     account, since reading threads needs one: «Do you have a Reddit account? With one, the
     research can read whole Reddit threads. Reddit's terms don't allow automated reading; this
     uses your own login, at your own risk.» (in Russian: «У вас есть аккаунт Reddit? С ним
     исследование сможет читать треды Reddit целиком. Условия Reddit не разрешают автоматическое
     чтение; это использует ваш вход, на ваш риск.»). Options, in this order, neither marked
     Recommended: **No, skip Reddit threads**: Reddit only through search results, as before;
     won't ask again / **Yes, read threads**: "For when you're signed in at reddit.com in your
     browser: installs a small Reddit reader once (about 50 MB) and reads whole threads with
     their upvotes through your login." Keep "For when", so it reads as the condition, not a
     statement about the user. (In Russian: **Нет, без тредов Reddit** / **Да, читать треды**,
     descriptions translated.) Leave out "installs…" when `installed` is already true.
     - **Yes:** if `installed` is false, run `maps-lists reddit setup` (`timeout:
       600000`). On macOS, then say in one line: «macOS will ask whether **rdt** may use **Chrome
       Safe Storage**: type your Mac password and click **Always Allow**» (in Russian: «macOS
       спросит, можно ли **rdt** использовать **Chrome Safe Storage**: введите пароль от Mac и
       нажмите **Всегда разрешать**»); on Linux, that the system may ask to unlock its keyring.
       Then run `maps-lists reddit login` (`timeout: 120000`). Its JSON
       line has `loggedIn`. If it's false, the browser isn't signed in to Reddit: say in one line
       that signing in at reddit.com in Chrome and starting the next research again turns threads
       on, and use snippets this time. A failed `setup` → one line, snippets this time.
     - **No:** run `maps-lists reddit off`. Never suggest Reddit again unless the user asks.

     Do this before anything else in step 0's outcome, so a model switch doesn't lose it.

   Never give prices: they depend on the user's plan. If the chosen model is the one you're
   running on, start step 1 straight away. Otherwise you can't switch it yourself: say in one
   line «Type `/model <opus|sonnet>`, then say **continue**» (in Russian: «Введите
   `/model <opus|sonnet>` и напишите **продолжить**») and stop. When the user says continue, carry
   on from step 1 with everything already collected; ask nothing again.
1. **Research (deep).** Invoke the `deep-research` skill (listed as
   `anthropic-skills:deep-research`) and pass a self-contained brief, because its agents don't see
   this conversation:
   - The request: categories, city or neighbourhood, constraints, and any personal context the user
     gave (e.g. car-free, working from cafés).
   - The angles to cover: everything in "Sources" above, written out in the brief (its agents
     don't see this file): local press and guides (including local-language ones); Reddit (its
     agents can't load Reddit, so `site:reddit.com` search snippets and articles that quote
     threads; when the Reddit reader is ready you read the threads yourself in step 1c); Telegram channels via `t.me/s/<channel>`; for a Russian-speaking city, the Russian
     sources; the city's row from `sources-by-region.md`, copied in full (with how to read each
     platform), marked as additions to the other angles, not a limit; the city's famous names for the category (the institutions every guide lists),
     each with what locals and local press say about it *now*; places that are viral on TikTok or
     Instagram, or tourist traps; closures, moves and ownership changes in the current and
     previous year.
   - Not to leave a place out for being famous or busy: report every well-known candidate with
     the evidence for and against, and let step 2 decide.
   - Not to hold anything back: report every place found, including new openings and places
     with a single source, each with its sources listed, so step 2 can weigh them. No "watch
     list" or "too new to judge" bucket that stays out of the report.
   - With `--more-gems` or `--gems`: spend most of the effort on lesser-known places: searches
     for "underrated", "hidden gem", "locals only", "new opening", the local-language
     equivalents, and neighbourhoods away from the centre; Telegram and local bloggers over
     big guides.
   - The language for the report's notes and details (the user's language).
   - The output needed: for each recommended place, its name, the area or street that pins it
     down, why it's recommended, what to order or when to go, caveats and source links. Also a
     separate list of places to skip, with reasons (trap, viral, bad, closed), the famous names with
     their current local verdict, and a sources list. For each recommended place also its Michelin
     Guide status as its own line (stars, Bib Gourmand or Selected, with the guide year and the
     guide.michelin.com or article link), or "none found". "Michelin-listed" without the
     distinction and year isn't a status.
   - The criteria from step 2 below, so its report already flags what step 2 will drop.

   Tell it to write the report to `~/.maps-lists/reports/<title>.md` and its notes to
   `~/.maps-lists/research_notes/<title>/`, so they stay out of the user's folder and
   `maps-lists clean` removes them later. Let it ask its own follow-up questions and finish. Read the report, then continue
   with step 2. **If `deep-research` isn't in the skill list** (or there's no Agent tool to start
   agents with), say so in one line and do step 1b instead.

   **1b. Research (quick, with `--quick` or as the fallback).** Send searches in parallel (`WebSearch` standard mode; extended only when a
   result is thin or looks out of date), then `WebFetch` the best articles and Telegram previews.
   Prefer sources from the current and previous year. Cover everything in "Sources" above, and
   search the city's famous names for the category on purpose ("best <category> <city>", the
   classics every guide lists) with what locals say about them now. With `--more-gems` or
   `--gems`, add the lesser-known searches from step 1's brief. With the Reddit reader ready,
   leave Reddit to step 1c; otherwise the Reddit snippet searches from "Sources" are part of this
   pass (a quick pass is fewer searches, not fewer sources).

   **1c. Reddit threads (only when the Reddit reader is ready).** After step 1 or 1b, per
   category, with Bash:
   - Search 2–4 times, with specific queries (a bare category mostly finds unrelated posts):
     `maps-lists reddit search 'best <category>' -r <local subreddit> -t all -n 10`, the
     signature item (`'best pastel de nata'`), the local-language word, one angle like
     `'<category> overrated'` or `'tourist trap'`, and once without `-r` adding the city.
     Each line is `{ok, posts: [{id, title, score, comments, date, text, url}]}`. Searches
     run one at a time (the reader paces itself); keep the whole pass under about 15 searches.
   - Read the 3–6 threads with the most comments that are about the city and category:
     `maps-lists reddit read <id> <id>…` (default 30 top comments; `-n 60` for a big thread).
     One line per thread: `{ok, post, comments: [{score, depth, date, text}], more}`; `depth` 1+
     is a reply to the comment before it, `more` counts replies not loaded.
   - Take from them: places named, with each comment's score and whether the writer says they live
     there; pushback on candidates from step 1 ("overrated", "went downhill", "closed"); and the
     thread's date. A detailed comment from a resident with real upvotes counts as one strong local
     source in step 2. A place only Reddit names needs such a comment; a passing mention isn't enough.
   - Mark a place **Reddit favourite** (for its note, step 3) when locals clearly rate it: the
     top-scored recommendation in a thread about the city and category, or recommended in at
     least two separate threads, with no upvoted pushback ("overrated", "went downhill") that
     outweighs it. One passing mention, or praise only from visitors, isn't enough. Without
     step 1c (snippets only), the bar is a positive mention in at least three different threads.
   - Each thread you rely on goes into `sources` as
     `{title: "r/<sub>: <thread title>", url: "https://www.reddit.com/r/<sub>/comments/<id>/"}`.
   - If a command prints `"ok": false` (an expired login, `forbidden`, rate limited), stop
     the Reddit pass, fall back to snippets (one quick search per category), and say in one line
     that the Reddit login needs renewing next time. Don't retry.
2. **Filter.** For each candidate, note who recommends it and any pushback. The test is quality,
   not fame: being famous, busy or in every guide is never on its own a reason to drop a place.
   - **Tourist trap** → drop: its reputation is better than what it serves. On or next to a top
     landmark with picture menus or touts; locals or Reddit or Telegram say "avoid", "overrated",
     "tourist trap", "went downhill"; praise comes mostly from one-time visitors. Long lines
     alone aren't a sign of a trap.
   - **Classic** → keep: famous, and locals or local press still recommend it on its merits now
     ("still the best morning bun", "worth the line on a weekday"). Start its `details` with
     `Classic.` (translated: `Классика.`, `Clàssic.`) and say frankly what to expect (lines, prices, the one
     thing worth ordering, when to go). Its `note` starts with `Classic.` too, then the practical
     part ("Classic. Go before 9 or on a weekday."). With `--more-gems`, keep at most about 3 classics per category and put the
     rest in `excluded[]` with reason `classic: <why it's famous>`; with `--gems`, put all of
     them there. Either way the user can tick them back in.
   - **Viral / TikTok** → drop: described mainly as "TikTok famous", "viral", "Instagrammable";
     the hype is one photogenic item; people queue for the photo. Keep it only if locals still
     recommend it on its own merits, and then say so in its `details`.
   - **Closed** (permanently or "closed since…") → drop.
   - **Bad** → drop: poor reviews, or locals and local press say the food or service is bad now.
     Reason `bad: <what's wrong>`.
   - **Keep** places with at least two independent sources, or one strong local one (a resident
     on Reddit with a detailed, upvoted comment, a local food critic's review, a local Telegram
     author who isn't paid for the post). One listicle, roundup or blog post alone is not enough,
     and neither is a contest or award ranking (a baguette or croissant contest, a "best of"
     list): it counts as one source, not a reason on its own. Several pages from the same outlet
     count once.
   - **New openings** follow the same bar: being new or having few reviews is never a reason to
     drop a place that meets it. Say the caveat in `details` ("Opened in 2026, few reviews yet").
   - **Thin evidence** → `excluded[]`, not dropped: everything below the bar, with reason
     `thin evidence: only <source>`. The user sees it under "Left out" and can tick it back in.
   - **Unconfirmed** → `excluded[]` only when you can't tell whether the place still exists or is
     open (a listing that may be stale, no trace in the current or previous year). Reason
     `unconfirmed: <what's unclear>`.
   - Aim for about 10–25 places per category. A tight list beats an exhaustive one: when more
     than about 25 pass the bar, keep the best-supported and move the rest to `excluded[]` as
     `thin evidence: <why it's weaker>`.
   - **No silent drops.** Every candidate the research surfaced, above all the well-known ones,
     ends up in `places[]` or in `excluded[]` with its reason. Before step 3, check the city's
     famous names for the category against both lists, and add any that's missing.
   - **Michelin check.** For the food categories, find the city's current Michelin selection
     once (one or two searches: `Michelin Guide <city> <year> Bib Gourmand`, `… stars`) and
     match it against `places[]`. Any place the research calls Michelin-listed, starred or Bib
     without a distinction or a year gets one search of its own
     (`site:guide.michelin.com <name> <city>`) to find both. Still no year → the note gets the
     fact without it ("Michelin Bib Gourmand."); still no distinction → "In the Michelin Guide."
3. **Write the research file** `research/<slug>-<YYYYMMDD>.json` in the data folder, with the slug from
   city + category, e.g. `research/lisbon-bakeries-20261018.json` (always ASCII). If that name
   is taken (the same research earlier the same day), use `-2`, then `-3`…
   (`research/lisbon-bakeries-20261018-2.json`); check with `ls` first, never overwrite, and say
   nothing about it. Schema:
   `ResearchSchema` in `${CLAUDE_PLUGIN_ROOT}/src/review.ts`; samples: `${CLAUDE_PLUGIN_ROOT}/examples/research.example.json`,
   `${CLAUDE_PLUGIN_ROOT}/examples/research.example.ru.json`.
   - `lang`: the conversation language's tag (`ru`, `es`, `ca`…); leave it out for English. It
     sets the review page's language. English and Russian have built-in labels. For any other
     language also add `ui` with the page's labels translated: `hint`, `mapsList`, `filtered`,
     `filteredNote`, `details` ("Why it's here"), `hide`, `sources`, `placeholder`, `keep`, `noteFor`,
     `undo`, `cancel` ("Stop, don't save"), `discard`, `discardYes`, `discardNo`, `safe`,
     `allBranches`, `untickAll`, `tickAll`, `jumpTo`, `toTop`, `reasonTrap`, `reasonViral`, `reasonClosed`,
     `reasonBad`, `reasonThin` ("Thin evidence"), `reasonUnconfirmed` ("Can't confirm it's open"), `reasonClassic`, `nothing`, `reconnecting`, `sending`, `sent`, `sentNext`,
     `cancelled`, `close`; the counts `picks`, `leftOut`, `sumKept`, `sumOff`, `sumEdited` as
     "Label: {n}" and `of` as "{a} of {b}" (no plural forms needed); and `go`: the Continue
     button per plural category of the language, with `{n}` for the count, e.g.
     `{"one": "Continua amb {n} lloc →", "other": "Continua amb {n} llocs →"}` (use the categories
     the language has: `one`, `few`, `many`, `other`…). The English wording of each is the `en`
     table in `${CLAUDE_PLUGIN_ROOT}/src/review.ts`; anything left out shows in English.
   - `list`: the list name (40 characters max).
   - `places[]`: one entry per pick, in the order to show them:
     - `section`: the category ("Coffee", "Bakeries").
     - `name`.
     - `area`: the neighbourhood or street that pins the place down, or `all branches` for a chain
       when no source singles out one branch.
     - `note`: the text that goes to Maps. Use the **note style** of `maps-lists:import`: plain
       text, no name, city or address, only concrete info (what to order, when to go, book ahead,
       closing day), one or two sentences, no sources or ranks. A contest placing isn't a note
       ("Baguette de tradition, 7th best in Paris 2026"): say what to get. Only a current-year
       win or top 3 may be mentioned, after the practical part. Three fixed sentences are the
       exception, facts about the place rather than source markers, each in the note itself, not
       only in `details`, translated like the rest:
       - **Classic** (step 2): the note **starts** with "Classic." (`Классика.`).
       - **Reddit favourite** (step 1c's bar): the sentence "Reddit favourite." (`Фаворит
         Reddit.`) comes right after the practical part, before any Michelin sentence. Its thread
         goes in `sources`.
       - **Michelin:** when a source from this run puts the place in the Michelin Guide, the
         note **must end** with that fact as its last sentence, in exactly one of these forms:
         "Michelin star (2026).", "Two Michelin stars (2026).", "Three Michelin stars (2026).",
         "Michelin Bib Gourmand (2026).", "In the Michelin Guide (2026)." (Selected). The year
         is the guide year from the source; leave it out only when the "Michelin check" in
         step 2 found none. Not at the start, not "Bib-rated" or "Michelin-listed". Never add it
         from memory. Put the Michelin link in `sources`.

       All three together: "Classic. Aligot-saucisse from the copper pot; book ahead. Reddit
       favourite. Michelin Bib Gourmand (2026)." Before writing the file, check every place:
       `details` starting with `Classic.` → the note starts with it; marked Reddit favourite →
       the note has that sentence; `details` or `sources` mentioning Michelin → the note ends
       with the fact.
     - `details`: what the user reads on the review page. Why it's in, who recommends it, what to
       order, caveats (lines, prices, laptop rules, hours). Two to four sentences of plain text;
       `[text](url)` links are fine. Blank lines separate paragraphs.
     - `sources`: `[{title, url}]`, the links behind the pick.
   - `excluded[]`: what step 2 dropped, one entry per place (never several names in one), each
     with the same fields plus `reason`
     (`trap: …`, `viral: …`, `bad: …`, `closed: …`, `thin evidence: …`, `unconfirmed: …`, or `classic: …` with `--gems`, one
     line). Leave `note` empty.
   - Say once, in a `details` or a `reason`, when Reddit or Telegram evidence comes only from
     search snippets (for Reddit: whenever step 1c didn't run).

   Validate with `maps-lists review --check <json>` and fix any reported field.
4. **Review.** Tell the user what the research found, as Markdown in the conversation language:

   > ## 🔎 Lisbon Bakeries · 18 places
   >
   > | Category | Kept | Classics | Filtered out |
   > |---|:-:|:-:|:-:|
   > | Bakeries | 11 | 2 | 4 |
   > | Coffee | 7 | 1 | 2 |
   >
   > **Filtered out:** 3 tourist traps, 2 viral, 1 closed (you can tick them back in)
   > 🌐 A review page is opening in your browser: untick places, edit notes, press **Continue**.

   Leave out the Classics column with `--gems`. Then run
   `maps-lists review <json>` with Bash, `timeout: 600000`. It serves the page on 127.0.0.1 and
   waits. The user unticks places, edits notes, can tick filtered-out ones back in, and presses
   **Continue**. Act on the exit code:
   - `0`: the page wrote `research/<slug>-<YYYYMMDD>.places.md` and printed a summary
     ("Kept 11 of 13 …"). Repeat the summary in one line and go to step 5.
   - `3`: the page is still open (a command can't run longer than 10 minutes). Run
     `maps-lists review <json> --resume` straight away, without saying anything, as often as
     needed. The page keeps its state and reconnects.
   - `2` (cancelled in the page) or `4` (tab closed): ask with `AskUserQuestion` (header `Review`):
     **Reopen the page** (run step 4 again without `--resume`) / **Stop** (the JSON stays;
     `maps-lists review <json>` reopens it later).
   - `1`: the JSON is invalid. Fix it and run again.
5. **Hand off.** Invoke the `maps-lists:import` skill with
   `research/<slug>-<YYYYMMDD>.places.md "<List name>"`, plus `--yes` and `--lang <tag>` if they
   were given. Import resolves
   every place, previews it, and asks before anything is saved.

## Rules

- Keep internals out of replies: no commands, file names, refused or retried writes, backups,
  validation results or exit
  codes. The user sees the summaries, the questions and anything they need to act on.
- Never invent a place. Every entry in the JSON has a source. After deep research, take places
  only from its report or from the threads step 1c read, never from memory.
- Reddit goes through `maps-lists reddit` only: never run `rdt` yourself (it can vote, comment and
  subscribe; the wrapper can't), and never read or print `~/.config/rdt-cli/`, which holds the
  user's Reddit login.
- Don't write the `.places.md` yourself; the review page writes it from the user's choices.
- Don't resolve places or touch Chrome here. That's `maps-lists:import` and `maps-lists:run`.
- All of `maps-lists:import`'s rules still apply (never delete, never guess a match, 40-char list names).
