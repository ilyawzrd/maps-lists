import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ARTIFACTS } from "./maps.js";
import { MAX_LIST_NAME } from "./plan.js";
import { openInDefault } from "./platform.js";

/**
 * Review page for a maps-lists:research result. Serves research/<slug>.json on 127.0.0.1 as a page
 * with a checkbox and an editable note per place; "Continue" posts the choices back, which become
 * research/<slug>.places.md (the input maps-lists:import already reads). No dependencies.
 *
 *   npm run review -- research/<slug>.json            # opens the browser, waits for Continue
 *   npm run review -- research/<slug>.json --resume   # after exit 3: same port + token, no new tab
 *   npm run review -- --check research/<slug>.json    # validate only
 *
 * Exit codes: 0 submitted · 1 bad input · 2 cancelled in the page · 3 still waiting (--wait hit;
 * the page keeps its state and reconnects) · 4 page gone (no heartbeat for --idle seconds).
 */

const HttpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), { message: "only http(s) links" });
const SourceSchema = z.object({ title: z.string().min(1), url: HttpUrl });
const ItemSchema = z.object({
  section: z.string().default(""),
  name: z.string().min(1),
  area: z.string().default(""),
  /** The note that goes to Maps (maps-lists:import's note style). */
  note: z.string().default(""),
  /** Why it's in, what to order, caveats. Plain text; [markdown](links) are rendered. */
  details: z.string().default(""),
  sources: z.array(SourceSchema).default([]),
  keep: z.boolean().optional(),
});
/** The page's labels for a language without a built-in table; missing ones fall back to English. */
const UiSchema = z
  .object({
    hint: z.string(), filtered: z.string(), details: z.string(), hide: z.string(), placeholder: z.string(),
    keep: z.string(), noteFor: z.string(), cancel: z.string(), allBranches: z.string(), nothing: z.string(),
    reconnecting: z.string(), sending: z.string(), sent: z.string(), cancelled: z.string(), close: z.string(),
    mapsList: z.string(), filteredNote: z.string(), sources: z.string(), discard: z.string(), discardYes: z.string(),
    discardNo: z.string(), safe: z.string(), untickAll: z.string(), tickAll: z.string(), jumpTo: z.string(), toTop: z.string(),
    undo: z.string(), yourNote: z.string(), addedBack: z.string(), sentNext: z.string(), reasonTrap: z.string(), reasonViral: z.string(), reasonClosed: z.string(),
    reasonBad: z.string(), reasonThin: z.string(), reasonUnconfirmed: z.string(), reasonClassic: z.string(),
    /** Counts, with {n} (picks, leftOut, sumKept, sumOff, sumEdited) or {a} and {b} (of: "12 of 15"). */
    picks: z.string().includes("{n}"), leftOut: z.string().includes("{n}"), sumKept: z.string().includes("{n}"),
    sumOff: z.string().includes("{n}"), sumEdited: z.string().includes("{n}"), of: z.string().includes("{a}").includes("{b}"),
    /** The Continue button per plural category of `lang` (Intl.PluralRules: one, few, many, other…), with {n}. */
    go: z.record(z.enum(["zero", "one", "two", "few", "many", "other"]), z.string().includes("{n}")),
  })
  .partial()
  .strict();

export const ResearchSchema = z.object({
  version: z.literal(1),
  /** Language of the review page and of the notes the research wrote: any BCP 47 tag (en, ru, es, ca, pt-BR). */
  lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "a language tag like en, es, ca or pt-BR").default("en"),
  /** Labels for a `lang` other than en/ru, translated by Claude. */
  ui: UiSchema.optional(),
  list: z.string().min(1).max(MAX_LIST_NAME, `Maps cuts list names at ${MAX_LIST_NAME} characters; shorten it`),
  places: z.array(ItemSchema).min(1),
  /** Filtered out by the research (trap, viral, bad, closed, thin evidence, unconfirmed); shown unticked. */
  excluded: z.array(ItemSchema.extend({ reason: z.string().min(1) })).default([]),
});
export type Research = z.infer<typeof ResearchSchema>;
type Item = Research["places"][number] & { reason?: string };

const ChoicesSchema = z.object({
  items: z.array(z.object({ id: z.string(), keep: z.boolean(), note: z.string().max(2000) })).max(1000),
});
export type Choice = z.infer<typeof ChoicesSchema>["items"][number];

/** Places are p0…, filtered-out ones x0…. Places start ticked, filtered-out ones unticked. */
const entries = (r: Research) => [
  ...r.places.map((it, i) => ({ id: `p${i}`, it: it as Item, keep: it.keep ?? true })),
  ...r.excluded.map((it, i) => ({ id: `x${i}`, it: it as Item, keep: it.keep ?? false })),
];

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The choices from the page merged into the research file (keep + note per item). */
export function applyChoices(r: Research, choices: Choice[]): Research {
  const byId = new Map(choices.map((c) => [c.id, c]));
  const merge = <T extends Item>(it: T, id: string): T => {
    const c = byId.get(id);
    return c ? { ...it, keep: c.keep, note: oneLine(c.note) } : it;
  };
  return {
    ...r,
    places: r.places.map((it, i) => merge(it, `p${i}`)),
    excluded: r.excluded.map((it, i) => merge(it, `x${i}`)),
  };
}

/** The ticked items as a places file: `# List`, `## Section`, `- **Name** (area): note`. */
export function buildPlacesMd(r: Research): string {
  const kept = entries(r).filter((e) => e.keep).map((e) => e.it);
  const sections = [...new Set(kept.map((it) => it.section))];
  const out = [`# ${r.list}`, ""];
  for (const s of sections) {
    if (s) out.push(`## ${s}`, "");
    for (const it of kept.filter((k) => k.section === s)) {
      const area = it.area ? ` (${oneLine(it.area)})` : "";
      const note = oneLine(it.note) ? `: ${oneLine(it.note)}` : "";
      out.push(`- **${oneLine(it.name)}**${area}${note}`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function summarize(before: Research, after: Research): string {
  const kept = after.places.filter((p) => p.keep ?? true).length;
  const added = after.excluded.filter((p) => p.keep).length;
  const edited = entries(after).filter((e, i) => e.keep && oneLine(e.it.note) !== oneLine(entries(before)[i]!.it.note)).length;
  return `Kept ${kept} of ${after.places.length}` +
    (added ? ` (+${added} from filtered out)` : "") +
    (edited ? `, ${edited} note${edited === 1 ? "" : "s"} edited` : "");
}

// ── page ─────────────────────────────────────────────────────────────────────

/** "1 place" / "3 места" / "5 мест": English has two forms, Russian three. */
export function plural(lang: "en" | "ru", n: number): string {
  if (lang === "en") return `${n} ${n === 1 ? "place" : "places"}`;
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? "место" : a >= 2 && a <= 4 && (b < 12 || b > 14) ? "места" : "мест"}`;
}

// Counts use "Label: {n}" so no language needs plural forms except the Continue button.
const UI = {
  en: {
    hint: "Untick what you don't want. Each note is yours to edit: it goes to Google Maps as you write it.",
    mapsList: "Your Google Maps list",
    picks: "Picks: {n}",
    leftOut: "Left out: {n}",
    filtered: "Left out",
    filteredNote: "Claude left these out. Open to see why; tick any to add it back.",
    details: "Why it's here",
    hide: "Hide",
    sources: "Sources",
    placeholder: "Add your note for Google Maps",
    keep: "Keep",
    noteFor: "Note for",
    undo: "Undo your edit",
    yourNote: "your note",
    addedBack: "Added back",
    cancel: "Stop, don't save",
    discard: "Discard your choices?",
    discardYes: "Yes, stop",
    discardNo: "Keep going",
    safe: "Nothing is saved yet. Claude adds these to Google Maps next.",
    allBranches: "all branches",
    untickAll: "Untick all",
    tickAll: "Tick all",
    of: "{a} of {b}",
    jumpTo: "Jump to",
    toTop: "Back to top",
    sumKept: "Kept: {n}",
    sumOff: "Unticked: {n}",
    sumEdited: "Notes edited: {n}",
    reasonTrap: "Tourist trap",
    reasonViral: "Viral",
    reasonClosed: "Closed",
    reasonBad: "Poor reviews",
    reasonThin: "Thin evidence",
    reasonUnconfirmed: "Can't confirm it's open",
    reasonClassic: "Classic",
    go: (n: number) => (n ? `Continue with ${plural("en", n)} →` : "Nothing selected"),
    nothing: "Nothing selected",
    reconnecting: "Reconnecting to Claude… your changes are kept.",
    sending: "Sending…",
    sent: "Sent to Claude",
    sentNext: "Back in Claude: it finds each place on Google Maps, then asks you once before saving them to your list.",
    cancelled: "Stopped. Nothing was saved.",
    close: "You can close this tab.",
  },
  ru: {
    hint: "Снимите галочки с лишнего. Каждая заметка ваша: она попадёт в Google Карты так, как вы её напишете.",
    mapsList: "Ваш список в Google Картах",
    picks: "Выбрано: {n}",
    leftOut: "Отсеяно: {n}",
    filtered: "Отсеяно",
    filteredNote: "Claude их не взял. Откройте, чтобы узнать почему; отметьте, чтобы вернуть.",
    details: "Почему здесь",
    hide: "Свернуть",
    sources: "Источники",
    placeholder: "Добавьте заметку для Google Карт",
    keep: "Оставить",
    noteFor: "Заметка для",
    undo: "Отменить правку",
    yourNote: "ваша заметка",
    addedBack: "Возвращено",
    cancel: "Остановить, не сохранять",
    discard: "Отменить ваш выбор?",
    discardYes: "Да, остановить",
    discardNo: "Продолжить",
    safe: "Пока ничего не сохранено. Дальше Claude добавит эти места в Google Карты.",
    allBranches: "все филиалы",
    untickAll: "Снять все",
    tickAll: "Отметить все",
    of: "{a} из {b}",
    jumpTo: "Перейти",
    toTop: "Наверх",
    sumKept: "Оставлено: {n}",
    sumOff: "Снято: {n}",
    sumEdited: "Заметок изменено: {n}",
    reasonTrap: "Туристическое место",
    reasonViral: "Вирусное",
    reasonClosed: "Закрыто",
    reasonBad: "Плохие отзывы",
    reasonThin: "Мало подтверждений",
    reasonUnconfirmed: "Не подтверждено, что работает",
    reasonClassic: "Классика",
    go: (n: number) => (n ? `Продолжить: ${plural("ru", n)} →` : "Ничего не выбрано"),
    nothing: "Ничего не выбрано",
    reconnecting: "Переподключаюсь к Claude… изменения сохранены.",
    sending: "Отправляю…",
    sent: "Отправлено в Claude",
    sentNext: "Дальше — в Claude: он найдёт каждое место в Google Картах и спросит вас перед сохранением в список.",
    cancelled: "Остановлено. Ничего не сохранено.",
    close: "Эту вкладку можно закрыть.",
  },
};
type Strings = (typeof UI)["en"];

/** Built-in table for en/ru; for any other lang, Claude's `ui` over English (go per plural category). */
export function strings(r: Pick<Research, "lang" | "ui">): Strings {
  const base = r.lang.split("-")[0];
  if (base === "en" || base === "ru") return UI[base];
  const { go, ...labels } = r.ui ?? {};
  const t: Strings = { ...UI.en, ...labels };
  if (!go) return t;
  const rules = new Intl.PluralRules(r.lang);
  const nothing = t.nothing;
  t.go = (n) => {
    if (!n) return nothing;
    const form = go[rules.select(n)] ?? go.other;
    return form ? form.replace("{n}", String(n)) : UI.en.go(n);
  };
  return t;
}

/** The page's lang attribute: English when a language without a built-in table brought no labels. */
const pageLang = (r: Research) => (["en", "ru"].includes(r.lang.split("-")[0]!) || r.ui ? r.lang : "en");

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

/** Escape, then bold / italic / code. Markdown backslash escapes (`\[1\]`) are dropped first. */
function fmt(s: string): string {
  return esc(s.replace(/\\([\[\]*_`()#.\-!$])/g, "$1"))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Inline markdown: `[text](url)` and bare http(s) URLs become links; only http(s) is ever linked. */
export function inline(s: string): string {
  const out: string[] = [];
  let last = 0;
  for (const m of s.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>)\]]+)/g)) {
    let url = m[2] ?? m[3]!;
    let tail = "";
    if (m[3]) {
      // A bare URL at the end of a sentence keeps its full stop outside the link.
      const p = url.match(/[.,;:]+$/)?.[0] ?? "";
      url = url.slice(0, url.length - p.length);
      tail = p;
    }
    out.push(fmt(s.slice(last, m.index)));
    out.push(`<a href="${esc(url)}" target="_blank" rel="noopener">${m[1] ? fmt(m[1]) : esc(url)}</a>${esc(tail)}`);
    last = m.index! + m[0].length;
  }
  out.push(fmt(s.slice(last)));
  return out.join("");
}

/** The research's reason prefixes (skills/research: trap:, viral:, bad:, closed:, thin evidence:, unconfirmed:, classic:) → a readable tag. */
function reasonHtml(reason: string, t: Strings): string {
  const m = reason.match(/^(trap|viral|bad|closed|unconfirmed|thin evidence|classic):\s*/i);
  if (!m) return inline(reason);
  const key = m[1]!.toLowerCase();
  const tag = { trap: t.reasonTrap, viral: t.reasonViral, closed: t.reasonClosed, bad: t.reasonBad, unconfirmed: t.reasonUnconfirmed, "thin evidence": t.reasonThin, classic: t.reasonClassic }[key]!;
  return `<strong class="tag">${esc(tag)}</strong> ${inline(reason.slice(m[0].length))}`;
}

/** "Time Out Lisbon: best pastéis de nata" → "Time Out Lisbon", for the credit line under a name. */
const shortSource = (title: string) => {
  const s = title.split(/:\s|\s[—–-]\s|\s\(/)[0]!.trim();
  return s.length > 40 ? s.slice(0, 39) + "…" : s;
};

/** The heavy condensed display face (assets/fonts, SIL OFL), inlined so the page stays offline. */
const FONT_CSS = (() => {
  const subsets: [string, string][] = [
    ["latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
    ["latin-ext", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF"],
    ["cyrillic", "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"],
    ["cyrillic-ext", "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F"],
    ["greek", "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF"],
    ["greek-ext", "U+1F00-1FFF"],
    ["vietnamese", "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB"],
  ];
  return subsets.map(([name, range]) => {
    const file = new URL(`../assets/fonts/fira-sans-extra-condensed-800-${name}.woff2`, import.meta.url);
    if (!existsSync(file)) return "";
    const data = readFileSync(file).toString("base64");
    return `@font-face{font-family:"Listing";font-weight:800;font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range};}`;
  }).join("\n");
})();

const ARROW = '<svg class="arr" viewBox="0 0 20 14" aria-hidden="true"><path d="M1 7h16M11 1.5 17 7l-6 5.5" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>';
/** A label's trailing "→" (in every language's Continue text) drawn as the ARROW, since the display face has no arrow. */
const withArrow = (label: string) => (/\s*→\s*$/.test(label) ? esc(label.replace(/\s*→\s*$/, "")) + " " + ARROW : esc(label));

const UP = '<svg class="up" viewBox="0 0 14 18" aria-hidden="true"><path d="M7 17V2M1.5 7.5 7 2l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>';

const CHEVRON = '<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

type Entry = { id: string; it: Item; keep: boolean };

function entry({ id, it, keep }: Entry, t: Strings): string {
  const details = it.details.split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${inline(p.trim())}</p>`).join("");
  const sources = it.sources.length
    ? `<p class="src-h">${esc(t.sources)}</p><ul>${it.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>`
    : "";
  const credits = it.sources.slice(0, 2).map((s) => `<a class="credit" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(shortSource(s.title))}</a>`);
  const more = details || sources
    ? `<button type="button" class="more" aria-expanded="false" aria-controls="d-${id}">${esc(t.details)}</button>`
    : "";
  const line = [...credits, more].filter(Boolean).join('<span aria-hidden="true"> · </span>');
  const area = it.area ? (it.area === "all branches" ? t.allBranches : it.area) : "";
  return `<li class="e${keep ? "" : " off"}" data-id="${id}" data-orig="${esc(it.note)}">
<label class="tk"><input type="checkbox" class="tick" id="c-${id}"${keep ? " checked" : ""} aria-label="${esc(t.keep)} ${esc(it.name)}"></label>
<div class="who">
<label class="nm" for="c-${id}"><span class="nm-t">${esc(it.name)}</span>${area ? ` <span class="ar">${esc(area)}</span>` : ""}</label>
${it.reason ? `<p class="out">${reasonHtml(it.reason, t)}</p>` : ""}
${line ? `<p class="cr">${line}</p>` : ""}
</div>
<div class="nt"><textarea class="note" rows="1" placeholder="${esc(t.placeholder)}" aria-label="${esc(t.noteFor)} ${esc(it.name)}">${esc(it.note)}</textarea><button type="button" class="undo" hidden>${esc(t.undo)}</button></div>
${details || sources ? `<div class="det" id="d-${id}" hidden>${details}${sources}</div>` : ""}
</li>`;
}

/** One category: a bar (fold, name, live count, Untick all) pinned while its entries scroll. */
function section(key: string, name: string, items: Entry[], t: Strings, filtered = false): string {
  const kept = items.filter((e) => e.keep).length;
  return `<section class="sec${filtered ? " left" : ""}" id="s-${key}" data-key="${key}">
<div class="bar">
<h2><button type="button" class="fold" aria-expanded="${!filtered}" aria-controls="l-${key}">${CHEVRON}<span>${esc(name)}</span></button></h2>
<span class="sum"${filtered ? "" : " hidden"}>${filtered ? esc(t.filteredNote) : ""}</span>
<span class="cnt">${esc(fill(t.of, { a: kept, b: items.length }))}</span>
${filtered ? "" : `<button type="button" class="all">${esc(t.untickAll)}</button>`}
</div>
<ul class="entries" id="l-${key}"${filtered ? " hidden" : ""}>
${items.map((e) => entry(e, t)).join("\n")}
</ul>
</section>`;
}

const CSS = `
:root { color-scheme:light dark; --paper:#f4f3ee; --ink:#141414; --red:#d23a22; --red-ink:#ad2c18; --on-red:#fff; --rule:#d6d2c6; --field:#fbfaf6;
  --check:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5' fill='none' stroke='%23f4f3ee' stroke-width='3'/%3E%3C/svg%3E");
  --display:"Listing","Arial Narrow",sans-serif; --text:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
@media (prefers-color-scheme: dark) { :root { --paper:#151514; --ink:#eeebe3; --red:#ff6a4d; --red-ink:#ff8a72; --on-red:#151514; --rule:#3a3934; --field:#1d1d1b;
  --check:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5' fill='none' stroke='%23151514' stroke-width='3'/%3E%3C/svg%3E"); } }
* { box-sizing:border-box; }
html { scrollbar-gutter:stable; scrollbar-color:var(--ink) var(--paper); }
body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 var(--text); caret-color:var(--red); }
::selection { background:var(--red); color:var(--on-red); }
:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
a { color:inherit; text-underline-offset:3px; overflow-wrap:anywhere; }
button { font:inherit; color:inherit; }
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.mast { max-width:1240px; margin:0 auto; padding:28px clamp(16px,4vw,72px) 0; }
.mast h1 { font:800 clamp(2.2rem,6vw,4.25rem)/.95 var(--display); text-transform:uppercase; letter-spacing:-.005em; margin:0; text-wrap:balance; overflow-wrap:anywhere; }
.meta { margin:10px 0 0; font-weight:600; font-size:.95rem; font-variant-numeric:tabular-nums; }
.hint { margin:0; padding:12px 0 14px; border-bottom:6px solid var(--ink); max-width:none; }
.layout { max-width:1240px; margin:0 auto; padding:0 clamp(16px,4vw,72px) 160px; display:grid; grid-template-columns:minmax(0,1fr) 220px; gap:40px; }
.sec { scroll-margin-top:12px; }
.bar { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:14px; background:var(--ink) padding-box; color:var(--paper); padding:6px 6px 6px 8px; border-bottom:8px solid var(--paper); margin-top:12px; min-height:60px; }
.bar h2 { margin:0; font:800 1.5rem/1 var(--display); text-transform:uppercase; letter-spacing:.03em; min-width:0; flex:0 1 auto; }
.fold { all:unset; display:flex; align-items:center; gap:10px; cursor:pointer; padding:6px 4px; overflow-wrap:break-word; }
.fold:focus-visible, .bar .all:focus-visible { outline:2px solid var(--paper); outline-offset:2px; }
.chev { width:14px; height:14px; flex:none; transition:transform .2s cubic-bezier(.2,.8,.2,1); }
.fold[aria-expanded="false"] .chev { transform:rotate(-90deg); }
.sum { font-size:.9rem; font-weight:500; min-width:0; }
.cnt { margin-left:auto; font:800 1.35rem/1 var(--display); letter-spacing:.03em; white-space:nowrap; font-variant-numeric:tabular-nums; }
.bar .all { flex:none; background:var(--paper); color:var(--ink); border:0; font-weight:700; font-size:.9rem; padding:8px 14px; min-height:36px; cursor:pointer; }
.sec.folded .bar, .sec.left .bar { position:static; }
.sec.folded .bar { background:var(--paper); color:var(--ink); box-shadow:inset 0 0 0 3px var(--ink); }
.sec.folded .bar .all { background:var(--ink); color:var(--paper); }
.sec.folded .fold:focus-visible, .sec.folded .all:focus-visible { outline-color:var(--ink); }
.entries { list-style:none; margin:0; padding:0; }
.e { display:grid; grid-template-columns:44px minmax(0,1fr) minmax(0,1.15fr); gap:0 20px; padding:12px 0; border-bottom:1px solid var(--rule); }
.tk { display:flex; justify-content:flex-start; padding-top:2px; cursor:pointer; min-height:44px; }
.tick { appearance:none; margin:0; width:26px; height:26px; border:2px solid var(--ink); background:var(--field); cursor:pointer; flex:none; }
.tick:checked { background:var(--ink) var(--check) center/20px no-repeat; }
.who { min-width:0; }
.nm { cursor:pointer; display:inline; }
.nm-t { font:800 1.3rem/1.15 var(--display); text-transform:uppercase; letter-spacing:.02em; background:linear-gradient(var(--red),var(--red)) no-repeat 0 58%/0% 3px; transition:background-size .24s cubic-bezier(.2,.8,.2,1); }
.e.off .nm-t { background-size:100% 3px; }
.ar { font-weight:700; font-size:.95rem; }
.out { margin:4px 0 0; font-size:.95rem; }
.tag { color:var(--red-ink); font-weight:800; }
.cr { margin:4px 0 0; font-size:.85rem; }
.credit { color:var(--red-ink); font-weight:700; text-decoration:none; }
.credit:hover { text-decoration:underline; }
.more { all:unset; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
.more:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
.nt { min-width:0; }
.note { display:block; width:100%; resize:none; overflow:hidden; font:inherit; font-size:.95rem; line-height:1.45; color:var(--ink); background:var(--field); border:1px solid var(--rule); border-bottom:2px solid var(--ink); border-radius:0; padding:7px 9px; min-height:38px; }
.note::placeholder { color:var(--ink); opacity:.72; }
.note:focus { outline:2px solid var(--ink); outline-offset:0; }
.undo[hidden] { display:none; }
.undo { display:block; margin:4px 0 0 auto; background:none; border:0; padding:2px 0; font-size:.85rem; font-weight:700; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
.det { grid-column:2 / -1; margin-top:10px; padding:12px 14px; border-left:1px solid var(--ink); font-size:.95rem; max-width:72ch; }
.det p { margin:0 0 8px; }
.det .src-h { font:800 1rem/1 var(--display); text-transform:uppercase; letter-spacing:.04em; margin:12px 0 6px; }
.det ul { margin:0; padding-left:18px; }
.det a { color:var(--red-ink); }
.index { position:sticky; top:16px; align-self:start; margin-top:20px; border-left:4px solid var(--ink); padding:4px 0 0 18px; }
.index h2 { font:800 1.15rem/1 var(--display); text-transform:uppercase; letter-spacing:.05em; margin:0; padding-bottom:8px; border-bottom:3px solid var(--ink); }
.index ol { list-style:none; margin:0; padding:0; }
.index a { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 8px; border-bottom:1px solid var(--rule); text-decoration:none; font:800 1.05rem/1.1 var(--display); text-transform:uppercase; letter-spacing:.03em; }
.index a .n { font:700 .85rem var(--text); font-variant-numeric:tabular-nums; letter-spacing:0; white-space:nowrap; }
.index a.cur { background:var(--red); color:var(--on-red); border-bottom-color:var(--red); }
.index .totop { display:flex; justify-content:flex-start; align-items:center; gap:8px; margin:12px 0 0; padding:8px; border:0; font:700 .9rem var(--text); text-transform:none; letter-spacing:0; text-decoration:underline; text-underline-offset:3px; }
.totop .up { width:.75em; height:.95em; flex:none; }
.upbtn { position:absolute; right:clamp(16px,4vw,72px); top:-62px; width:48px; height:48px; display:grid; place-items:center; background:var(--ink); color:var(--paper); border:2px solid var(--paper); }
.upbtn[hidden] { display:none; }
.upbtn .up { width:16px; height:20px; }
.upbtn:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
.index .tot { margin:10px 8px 0; font-size:.85rem; font-variant-numeric:tabular-nums; white-space:pre-line; }
footer { position:fixed; left:0; right:0; bottom:0; z-index:3; background:var(--paper); border-top:6px solid var(--ink); }
footer .fb { max-width:1240px; margin:0 auto; padding:12px clamp(16px,4vw,72px); display:flex; flex-wrap:wrap; align-items:center; gap:10px 24px; }
#status:empty { display:none; }
#status { flex-basis:100%; font-weight:700; }
.stop { background:none; border:0; padding:8px 0; font-size:.9rem; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
.safe { margin:0; flex:1 1 260px; font-size:.95rem; }
.confirm { flex:1 1 260px; display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; font-weight:700; }
.confirm[hidden] { display:none; }
.confirm button { border:2px solid var(--ink); background:var(--paper); padding:8px 14px; font-weight:700; cursor:pointer; min-height:40px; }
.confirm #yes { background:var(--ink); color:var(--paper); }
.go[hidden] { display:none; }
.arr { width:1.05em; height:.75em; vertical-align:-.02em; }
.go { margin-left:auto; background:var(--red); color:var(--on-red); border:0; font:800 1.3rem/1.1 var(--display); text-transform:uppercase; letter-spacing:.04em; padding:13px 22px; min-height:50px; cursor:pointer; }
.go:disabled { background:var(--rule); color:var(--ink); cursor:default; }
.done { max-width:760px; margin:0 auto; padding:18vh clamp(16px,4vw,72px) 80px; }
.done h1 { font:800 clamp(2.4rem,7vw,4.5rem)/.95 var(--display); text-transform:uppercase; margin:0 0 18px; }
.done h1:focus { outline:none; }
.done p { margin:0 0 10px; font-size:1.1rem; }
.done .what { font-weight:700; border-top:6px solid var(--ink); padding-top:14px; }
.done .what .arr { width:1em; height:.7em; }
.done h2 { font:800 1.3rem/1 var(--display); text-transform:uppercase; letter-spacing:.03em; background:var(--ink); color:var(--paper); padding:8px 10px; margin:26px 0 0; }
.done ul { list-style:none; margin:0 0 6px; padding:0; }
.done li { padding:9px 0; border-bottom:1px solid var(--rule); }
.done li b { font:800 1.15rem/1.15 var(--display); text-transform:uppercase; letter-spacing:.02em; }
.done li span { display:block; font-size:.95rem; }
.done li em { font-style:normal; font-weight:700; color:var(--red-ink); font-size:.85rem; }
@media (max-width:880px) {
  .layout { grid-template-columns:minmax(0,1fr); gap:0; }
  .index { position:static; order:-1; border-left:0; padding:0; margin-top:16px; }
  .index h2 { border-bottom-width:2px; }
  .index ol { display:flex; flex-wrap:wrap; gap:8px; padding:10px 0 2px; }
  .index li { flex:none; }
  .index a { border:2px solid var(--ink); padding:8px 10px; }
  .index .tot, .index .totop { display:none; }
  .e { grid-template-columns:40px minmax(0,1fr); gap:0 8px; }
  .nt { grid-column:2; margin-top:8px; }
  .det { grid-column:1 / -1; }
  .bar .all { padding:8px 10px; }
  .bar { flex-wrap:wrap; row-gap:2px; gap:2px 10px; }
  .bar h2 { flex:1 1 0; font-size:1.3rem; }
  .cnt { margin-left:0; font-size:1.2rem; }
  .sum:not([hidden]) { order:3; flex-basis:100%; padding:0 4px 6px 28px; }
  .confirm > span { flex-basis:100%; }
  footer .fb { gap:6px 12px; padding-top:8px; padding-bottom:10px; }
  .safe { flex-basis:100%; order:-1; font-size:.85rem; }
  .stop { font-size:.85rem; }
  .go { font-size:1.05rem; padding:11px 14px; min-height:46px; }
  .confirm { flex-basis:100%; }
}
@media (prefers-reduced-motion: reduce) { .nm-t, .chev { transition:none; } }
`;

// Runs in the browser, after renderPage's `var L = {...}` (the page strings). No \${} in here (this
// is a TS template literal), and no global named `status`: that's window.status, which only holds strings.
const SCRIPT = `
var T = new URLSearchParams(location.search).get("t");
var done = false;
var go = document.getElementById("go"), statusEl = document.getElementById("status"), live = document.getElementById("live");
function escH(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function label(s) { return /\\s*→\\s*$/.test(s) ? escH(s.replace(/\\s*→\\s*$/, "")) + " " + L.arrow : escH(s); }
var fmtN = function (s, v) { return s.replace(/\\{(\\w)\\}/g, function (m, k) { return k in v ? v[k] : m; }); };
function post(path, body) {
  return fetch(path + "?t=" + encodeURIComponent(T), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
}
function grow(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; }
function edited(e) { return e.querySelector(".note").value !== e.dataset.orig; }
function dirty() {
  return Array.prototype.some.call(document.querySelectorAll(".e"), function (e) {
    var c = e.querySelector(".tick"); return c.checked !== c.defaultChecked || edited(e);
  });
}
function refresh() {
  var kept = 0, places = 0, added = 0, edits = 0;
  document.querySelectorAll(".sec").forEach(function (s) {
    var es = s.querySelectorAll(".e"), k = 0, ed = 0;
    es.forEach(function (e) { if (e.querySelector(".tick").checked) k++; if (edited(e)) ed++; });
    if (s.classList.contains("left")) added += k;
    s.querySelector(".cnt").textContent = fmtN(L.of, { a: k, b: es.length });
    var all = s.querySelector(".all");
    if (all) all.textContent = k ? L.untickAll : L.tickAll;
    if (!s.classList.contains("left")) {
      var parts = [fmtN(L.sumKept, { n: k })];
      if (es.length - k) parts.push(fmtN(L.sumOff, { n: es.length - k }));
      if (ed) parts.push(fmtN(L.sumEdited, { n: ed }));
      s.querySelector(".sum").textContent = parts.join(" · ");
      places += es.length;
    }
    var ix = document.querySelector('.index a[href="#' + s.id + '"] .n');
    if (ix) ix.textContent = s.classList.contains("left") ? String(es.length) : k + "/" + es.length;
    kept += k; edits += ed;
  });
  var tot = document.getElementById("ix-tot");
  if (tot) tot.textContent = fmtN(L.sumKept, { n: fmtN(L.of, { a: kept, b: places + added }) }) + (edits ? "\\n" + fmtN(L.sumEdited, { n: edits }) : "");
  go.innerHTML = label(L.go[kept]);
  go.disabled = kept === 0 || done;
  live.textContent = L.go[kept];
}
document.querySelectorAll(".note").forEach(function (el) {
  grow(el);
  el.addEventListener("input", function () {
    grow(el);
    var e = el.closest(".e");
    e.querySelector(".undo").hidden = !edited(e);
    refresh();
  });
});
window.addEventListener("resize", function () { document.querySelectorAll(".note").forEach(grow); });
document.querySelectorAll(".undo").forEach(function (b) {
  b.addEventListener("click", function () {
    var e = b.closest(".e"), n = e.querySelector(".note");
    n.value = e.dataset.orig; grow(n); b.hidden = true; n.focus(); refresh();
  });
});
document.querySelectorAll(".tick").forEach(function (el) {
  el.addEventListener("change", function () { el.closest(".e").classList.toggle("off", !el.checked); refresh(); });
});
document.querySelectorAll(".more").forEach(function (b) {
  b.addEventListener("click", function () {
    var open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    b.textContent = open ? L.details : L.hide;
    document.getElementById(b.getAttribute("aria-controls")).hidden = open;
  });
});
function fold(s, open) {
  var b = s.querySelector(".fold");
  b.setAttribute("aria-expanded", String(open));
  s.querySelector(".entries").hidden = !open;
  s.classList.toggle("folded", !open);
  var sum = s.querySelector(".sum");
  if (!s.classList.contains("left")) sum.hidden = open;
}
document.querySelectorAll(".sec").forEach(function (s) {
  if (s.querySelector(".fold").getAttribute("aria-expanded") === "false") s.classList.add("folded");
  s.querySelector(".fold").addEventListener("click", function () {
    fold(s, s.querySelector(".fold").getAttribute("aria-expanded") !== "true");
  });
  var all = s.querySelector(".all");
  if (all) all.addEventListener("click", function () {
    var ticks = s.querySelectorAll(".tick"), any = Array.prototype.some.call(ticks, function (c) { return c.checked; });
    ticks.forEach(function (c) { c.checked = !any; c.closest(".e").classList.toggle("off", any); });
    refresh();
  });
});
document.querySelectorAll(".index a").forEach(function (a) {
  a.addEventListener("click", function () { var s = document.querySelector(a.getAttribute("href")); if (s) { fold(s, true); picked = s; markCurrent(); } });
});
// The current section: one picked in Jump to until the visitor scrolls themselves; otherwise the
// last section whose top has passed under the top of the screen, or at the page's end, the last one in view.
var picked = null, ticking = false;
function markCurrent() {
  ticking = false;
  var secs = Array.prototype.slice.call(document.querySelectorAll(".sec")), cur = picked;
  if (!cur) {
    var atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    secs.forEach(function (s) {
      var top = s.getBoundingClientRect().top;
      if (top <= 140 || (atEnd && top < innerHeight - 80)) cur = s;
    });
    cur = cur || secs[0];
  }
  document.querySelectorAll(".index a[href^='#s-']").forEach(function (a) {
    var on = a.getAttribute("href") === "#" + cur.id;
    a.classList.toggle("cur", on);
    if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
  });
}
function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(markCurrent); } }
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);
["wheel", "touchstart", "keydown"].forEach(function (ev) {
  window.addEventListener(ev, function (e) { if (picked && !(ev === "keydown" && e.target.closest && e.target.closest(".index"))) { picked = null; onScroll(); } }, { passive: true });
});
// Back to top and the ↑ button leave the picked section behind.
document.querySelectorAll(".totop, #upbtn").forEach(function (a) { a.addEventListener("click", function () { picked = null; onScroll(); }); });
markCurrent();
// The ↑ button shows whenever the Jump to index is off screen (on wide screens it stays pinned).
if ("IntersectionObserver" in window) {
  var up = document.getElementById("upbtn");
  new IntersectionObserver(function (list) { up.hidden = done || list[0].isIntersecting; }).observe(document.querySelector(".index"));
}
function online(ok) { if (!done) statusEl.textContent = ok ? "" : L.reconnecting; }
function ping() { if (done) return; post("/ping").then(function (r) { online(r.ok); }, function () { online(false); }); }
setInterval(ping, 10000); ping();
window.addEventListener("beforeunload", function (ev) { if (!done && dirty()) { ev.preventDefault(); ev.returnValue = ""; } });
function finishScreen(title, lines, groups) {
  var box = document.createElement("div"), h = document.createElement("h1");
  box.className = "done"; h.textContent = title; h.tabIndex = -1; box.append(h);
  lines.forEach(function (l) { var p = document.createElement("p"); if (l[2]) p.innerHTML = l[0]; else p.textContent = l[0]; if (l[1]) p.className = l[1]; box.append(p); });
  (groups || []).forEach(function (g) {
    var h2 = document.createElement("h2"), ul = document.createElement("ul");
    h2.textContent = g.name; box.append(h2, ul);
    g.items.forEach(function (it) {
      var li = document.createElement("li"), b = document.createElement("b");
      b.textContent = it.name; li.append(b);
      if (it.note) { var sp = document.createElement("span"); sp.textContent = it.note; li.append(sp); }
      if (it.edited) { var em = document.createElement("em"); em.textContent = L.yourNote; li.append(em); }
      ul.append(li);
    });
  });
  document.querySelector(".layout").replaceWith(box);
  document.querySelector(".mast").remove();
  document.querySelector("footer").remove();
  h.focus();
}
function send(path, body, ok) {
  done = true; go.disabled = true;
  statusEl.textContent = L.sending;
  post(path, body).then(function (r) {
    if (!r.ok) throw new Error(String(r.status));
    ok();
  }).catch(function () {
    statusEl.textContent = L.reconnecting;
    setTimeout(function () { send(path, body, ok); }, 2000);
  });
}
go.addEventListener("click", function () {
  var items = [], kept = 0, ed = 0, groups = [];
  document.querySelectorAll(".sec").forEach(function (s) {
    var g = { name: s.classList.contains("left") ? L.addedBack : s.querySelector(".fold span").textContent, items: [] };
    s.querySelectorAll(".e").forEach(function (e) {
      var k = e.querySelector(".tick").checked, note = e.querySelector(".note").value.trim();
      if (k) { kept++; if (edited(e)) ed++; g.items.push({ name: e.querySelector(".nm-t").textContent, note: note, edited: edited(e) }); }
      items.push({ id: e.dataset.id, keep: k, note: e.querySelector(".note").value });
    });
    if (g.items.length) groups.push(g);
  });
  var what = escH(fmtN(L.sumKept, { n: kept }) + (ed ? " · " + fmtN(L.sumEdited, { n: ed }) : "")) + " " + L.arrow + " " + escH(L.list);
  send("/submit", { items: items }, function () { finishScreen(L.sent, [[what, "what", true], [L.sentNext], [L.close]], groups); });
});
var confirmEl = document.getElementById("confirm"), safeEl = document.getElementById("safe"), stopEl = document.getElementById("cancel");
function stop() { send("/cancel", {}, function () { finishScreen(L.cancelled, [[L.close]]); }); }
stopEl.addEventListener("click", function () {
  if (!dirty()) { stop(); return; }
  confirmEl.hidden = false; safeEl.hidden = true; stopEl.hidden = true; go.hidden = true;
  document.getElementById("no").focus();
});
document.getElementById("yes").addEventListener("click", stop);
document.getElementById("no").addEventListener("click", function () {
  confirmEl.hidden = true; safeEl.hidden = false; stopEl.hidden = false; go.hidden = false; stopEl.focus();
});
refresh();
`;

export function renderPage(r: Research): string {
  const all = entries(r);
  const places = all.filter((e) => e.id.startsWith("p"));
  const filtered = all.filter((e) => e.id.startsWith("x"));
  const t = strings(r);
  const names = [...new Set(places.map((e) => e.it.section))];
  const groups = names.map((s, i) => ({ key: String(i), name: s || r.list, items: places.filter((e) => e.it.section === s) }));
  if (filtered.length) groups.push({ key: "x", name: t.filtered, items: filtered });
  // Client-side strings; "go" is precomputed for every count, so the page needs no plural rules.
  const L = {
    go: Array.from({ length: all.length + 1 }, (_, n) => t.go(n)),
    of: t.of, sumKept: t.sumKept, sumOff: t.sumOff, sumEdited: t.sumEdited, untickAll: t.untickAll, tickAll: t.tickAll,
    details: t.details, hide: t.hide, list: r.list, yourNote: t.yourNote, addedBack: t.addedBack, arrow: ARROW,
    reconnecting: t.reconnecting, sending: t.sending, sent: t.sent, sentNext: t.sentNext, cancelled: t.cancelled, close: t.close,
  };
  const meta = [t.mapsList, fill(t.picks, { n: places.length }), ...(filtered.length ? [fill(t.leftOut, { n: filtered.length })] : [])];
  return `<!doctype html>
<html lang="${pageLang(r)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.list)} · ${esc(t.mapsList)}</title><style>${FONT_CSS}
${CSS}</style></head>
<body>
<header class="mast" id="top">
<h1>${esc(r.list)}</h1>
<p class="meta">${meta.map(esc).join(" · ")}</p>
<p class="hint">${esc(t.hint)}</p>
</header>
<div class="layout">
<main>
${groups.map((g) => section(g.key, g.name, g.items, t, g.key === "x")).join("\n")}
</main>
<nav class="index" aria-labelledby="ix-h"><h2 id="ix-h">${esc(t.jumpTo)}</h2>
<ol>${groups.map((g) => `<li><a href="#s-${g.key}"><span>${esc(g.name)}</span><span class="n"></span></a></li>`).join("")}</ol>
<p class="tot" id="ix-tot"></p>
<a class="totop" href="#top">${UP}<span>${esc(t.toTop)}</span></a></nav>
</div>
<footer><a class="upbtn" id="upbtn" href="#top" aria-label="${esc(t.toTop)}" hidden>${UP}</a><div class="fb">
<span id="status" role="status"></span>
<button type="button" class="stop" id="cancel">${esc(t.cancel)}</button>
<p class="safe" id="safe">${esc(t.safe)}</p>
<div class="confirm" id="confirm" hidden><span>${esc(t.discard)}</span><button type="button" id="no">${esc(t.discardNo)}</button><button type="button" id="yes">${esc(t.discardYes)}</button></div>
<button type="button" class="go" id="go">${withArrow(t.go(places.length))}</button>
</div></footer>
<p class="sr" aria-live="polite" id="live"></p>
<script>var L = ${JSON.stringify(L).replace(/</g, "\\u003c")};
${SCRIPT}</script>
</body></html>
`;
}

// ── server ───────────────────────────────────────────────────────────────────

export type Outcome = { outcome: "submitted"; summary: string } | { outcome: "cancelled" | "timeout" | "closed" };

export async function loadResearch(file: string): Promise<Research> {
  return ResearchSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}

export const placesPath = (file: string) => file.replace(/\.json$/, "") + ".places.md";

/**
 * Serves the review page until it submits or cancels, or `waitMs` / `idleMs` (no heartbeat) runs
 * out. On submit, writes `<file>.places.md` and the choices back into `<file>`.
 */
export async function serve(opts: {
  file: string; port?: number; token: string; waitMs: number; idleMs: number;
  onListen?: (port: number) => void | Promise<void>;
}): Promise<Outcome> {
  const research = await loadResearch(opts.file);
  const page = renderPage(research);
  let lastSeen = Date.now();
  let finish!: (o: Outcome) => void;
  const result = new Promise<Outcome>((r) => (finish = r));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const host = req.headers.host ?? "";
    // Token on every route; the Host check stops DNS-rebinding pages from reaching it by name.
    if (url.searchParams.get("t") !== opts.token || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      res.writeHead(403).end();
      return;
    }
    lastSeen = Date.now();
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page);
      return;
    }
    if (req.method !== "POST") { res.writeHead(404).end(); return; }
    if (url.pathname === "/ping") { res.writeHead(204).end(); return; }
    if (url.pathname === "/cancel") { res.writeHead(204).end(); finish({ outcome: "cancelled" }); return; }
    if (url.pathname !== "/submit") { res.writeHead(404).end(); return; }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      body += c;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", async () => {
      try {
        const { items } = ChoicesSchema.parse(JSON.parse(body));
        const after = applyChoices(research, items);
        await fs.writeFile(placesPath(opts.file), buildPlacesMd(after));
        await fs.writeFile(opts.file, JSON.stringify(after, null, 2) + "\n");
        res.writeHead(204).end();
        finish({ outcome: "submitted", summary: summarize(research, after) });
      } catch (e) {
        res.writeHead(400, { "content-type": "text/plain" }).end((e as Error).message);
      }
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, "127.0.0.1", () => ok());
  });
  await opts.onListen?.((server.address() as { port: number }).port);

  const deadline = setTimeout(() => finish({ outcome: "timeout" }), opts.waitMs);
  const idle = setInterval(() => { if (Date.now() - lastSeen > opts.idleMs) finish({ outcome: "closed" }); }, 1000);
  const outcome = await result;
  clearTimeout(deadline);
  clearInterval(idle);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  return outcome;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      check: { type: "boolean" },
      resume: { type: "boolean" },
      "no-open": { type: "boolean" },
      wait: { type: "string", default: "540" },
      idle: { type: "string", default: "120" },
    },
  });
  const file = positionals[0];
  if (positionals.length !== 1 || !file!.endsWith(".json")) {
    console.error("usage: npm run review -- research/<slug>.json [--resume] [--no-open] | --check research/<slug>.json");
    process.exit(1);
  }
  let research: Research;
  try {
    research = await loadResearch(file!);
  } catch (e) {
    console.error(`${file} is not a valid research file:\n${e instanceof z.ZodError ? e.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n") : (e as Error).message}`);
    process.exit(1);
  }
  if (values.check) {
    console.log(`OK: "${research.list}", ${research.places.length} places, ${research.excluded.length} filtered out`);
    return;
  }

  const sessionFile = `${ARTIFACTS}/review-session.json`;
  let session = { file: file!, port: 0, token: randomBytes(16).toString("hex") };
  if (values.resume) {
    const saved = JSON.parse(await fs.readFile(sessionFile, "utf8").catch(() => "{}"));
    if (saved.file !== file) {
      console.error(`No review session to resume for ${file}. Run it without --resume.`);
      process.exit(1);
    }
    session = saved;
  }
  const outcome = await serve({
    file: file!,
    port: session.port || undefined,
    token: session.token,
    waitMs: Number(values.wait) * 1000,
    idleMs: Number(values.idle) * 1000,
    onListen: async (port) => {
      session.port = port;
      await fs.mkdir(ARTIFACTS, { recursive: true });
      await fs.writeFile(sessionFile, JSON.stringify(session));
      const url = `http://127.0.0.1:${port}/?t=${session.token}`;
      console.log(`Review page: ${url}`);
      if (!values.resume && !values["no-open"]) openInDefault(url);
    },
  });

  if (outcome.outcome === "timeout") {
    console.log("Still waiting for the review page. Run again with --resume (the page keeps its changes).");
    process.exit(3);
  }
  await fs.rm(sessionFile, { force: true });
  if (outcome.outcome === "submitted") {
    console.log(`${outcome.summary} → ${placesPath(file!)}`);
  } else if (outcome.outcome === "cancelled") {
    console.log("Review cancelled in the page.");
    process.exit(2);
  } else {
    console.log("The review page stopped responding (tab closed?).");
    process.exit(4);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) await main();
