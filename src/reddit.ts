import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readConfig, updateConfig } from "./chrome-check.js";
import { which as whichBin } from "./platform.js";

/**
 * Optional Reddit reader for maps-lists:research, through rdt-cli (pinned) installed with uv. Reddit
 * blocks anonymous reads, so it runs on the user's own Reddit login, taken from their browser by
 * `rdt login` (macOS asks for Keychain access once). Only search and read are reachable from here:
 * rdt can also vote, save, subscribe and comment, and this wrapper has no path to any of those.
 *
 *   maps-lists reddit status                     # one JSON line: ready, installed, loggedIn, off, uv, brew
 *   maps-lists reddit setup                      # uv (Homebrew, else Astral's installer) + rdt-cli
 *   maps-lists reddit login                      # rdt login, then status
 *   maps-lists reddit off | on                   # remember in config.json whether the user wants it
 *   maps-lists reddit search '<query>' [-r <subreddit>] [-t year] [-n 10]
 *   maps-lists reddit read <post id or URL>… [-n 30]
 *
 * Search prints `{ok, posts}`, read one `{ok, post, comments, more}` line per post: rdt's output
 * trimmed to what research weighs (scores, dates, text, reply depth; no usernames). A raw thread
 * is ~60 KB for 15 comments. Errors keep rdt's envelope (`{ok: false, error}`).
 * Never prints or reads rdt's credential file (~/.config/rdt-cli/credential.json): it is the
 * user's Reddit session.
 */

export const RDT_VERSION = "0.4.1";

const UV_DIRS = [path.join(os.homedir(), ".local/bin"), path.join(os.homedir(), ".cargo/bin"), "/opt/homebrew/bin", "/usr/local/bin"];

const onPath = (bin: string) => whichBin(bin);
const EXE = process.platform === "win32" ? ".exe" : "";

/** uv on PATH, or where its installers put it (Claude's Bash PATH often lacks ~/.local/bin). */
export function findUv(dirs = UV_DIRS, which = onPath): string | undefined {
  return which("uv") ?? dirs.map((d) => path.join(d, `uv${EXE}`)).find((p) => existsSync(p));
}

function rdtBin(uv: string): string | undefined {
  try {
    const dir = execFileSync(uv, ["tool", "dir", "--bin"], { encoding: "utf8" }).trim();
    const bin = path.join(dir, `rdt${EXE}`);
    return existsSync(bin) ? bin : undefined;
  } catch {
    return undefined;
  }
}

/** The post id from a bare id, a reddit.com/…/comments/<id>/… link, or a redd.it/<id> link. */
export function postId(arg: string): string | undefined {
  const s = arg.trim();
  const m = s.match(/\/comments\/([a-z0-9]+)/i) ?? s.match(/redd\.it\/([a-z0-9]+)/i) ?? s.match(/^(?:t3_)?([a-z0-9]{4,10})$/i);
  return m?.[1]?.toLowerCase();
}

/** rdt's `status --json` envelope → logged in? */
export function parseStatus(json: string): boolean {
  try {
    return JSON.parse(json)?.data?.authenticated === true;
  } catch {
    return false;
  }
}

const TEXT_MAX = 1500;
const clip = (t: unknown, max = TEXT_MAX) => {
  const s = String(t ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const day = (utc: unknown) => (typeof utc === "number" ? new Date(utc * 1000).toISOString().slice(0, 10) : undefined);

type RawPost = { id?: string; subreddit?: string; title?: string; score?: number; num_comments?: number; created_utc?: number; selftext?: string; permalink?: string };

const post = (p: RawPost, textMax = TEXT_MAX) => ({
  id: p.id,
  subreddit: p.subreddit,
  title: p.title,
  score: p.score,
  comments: p.num_comments,
  date: day(p.created_utc),
  text: clip(p.selftext, textMax),
  url: p.permalink ? `https://www.reddit.com${p.permalink}` : undefined,
});

/**
 * rdt `search --json` → `{ok, posts}` with a short text preview each. rdt gives a post array with
 * `--compact` and Reddit's raw Listing without; the Listing also carries `modhash` (a session token),
 * which must not reach the output, so only post fields are copied.
 */
export function compactSearch(json: string): string {
  const env = JSON.parse(json);
  if (!env.ok) return JSON.stringify(env);
  const raw: RawPost[] = Array.isArray(env.data)
    ? env.data
    : (env.data?.data?.children ?? []).filter((c: { kind: string }) => c.kind === "t3").map((c: { data: RawPost }) => c.data);
  return JSON.stringify({ ok: true, posts: raw.map((p) => post(p, 300)) });
}

type Listing = { data?: { children?: { kind: string; data: Record<string, unknown> }[] } };

/** rdt `read --json` (Reddit's [post listing, comment listing]) → post, flat comments, unloaded count. */
export function compactThread(json: string): string {
  const env = JSON.parse(json);
  if (!env.ok || !Array.isArray(env.data)) return JSON.stringify(env);
  const [postListing, commentListing] = env.data as Listing[];
  const comments: { score: unknown; depth: number; date?: string; text: string }[] = [];
  let more = 0;
  const walk = (l: Listing | "" | undefined, depth: number) => {
    for (const ch of (l && l.data?.children) || []) {
      if (ch.kind === "more") more += Number(ch.data.count ?? 0);
      if (ch.kind !== "t1") continue;
      comments.push({ score: ch.data.score, depth, date: day(ch.data.created_utc), text: clip(ch.data.body) });
      walk(ch.data.replies as Listing | "", depth + 1);
    }
  };
  walk(commentListing, 0);
  const p = postListing?.data?.children?.[0]?.data as RawPost | undefined;
  return JSON.stringify({ ok: true, post: p && post(p), comments, more });
}

/** Options search and read pass on to rdt. Anything else is refused, so nothing but reads gets through. */
const SEARCH_FLAGS = new Set(["-r", "--subreddit", "-s", "--sort", "-t", "--time", "-n", "--limit", "--after"]);
const READ_FLAGS = new Set(["-s", "--sort", "-n", "--limit"]);

/** Splits `args` into flag pairs rdt accepts and positionals; throws on anything else. */
export function splitArgs(args: string[], allowed: Set<string>): { flags: string[]; rest: string[] } {
  const flags: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("-")) {
      rest.push(a);
      continue;
    }
    if (a === "--expand-more") {
      flags.push(a);
      continue;
    }
    if (!allowed.has(a) || args[i + 1] === undefined) throw new Error(`unsupported option ${a}`);
    flags.push(a, args[++i]!);
  }
  return { flags, rest };
}

async function status(root: string) {
  const uv = findUv();
  const rdt = uv && rdtBin(uv);
  const loggedIn = !!rdt && parseStatus(spawnSync(rdt, ["status", "--json"], { encoding: "utf8" }).stdout);
  const off = (await readConfig(root)).reddit === "off";
  return { ready: loggedIn && !off, installed: !!rdt, loggedIn, off, uv: !!uv, brew: !!onPath("brew") };
}

function setup(): number {
  let uv = findUv();
  if (!uv) {
    console.error("Installing uv…");
    const r = onPath("brew")
      ? spawnSync("brew", ["install", "uv"], { stdio: ["ignore", 2, 2], env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ENV_HINTS: "1" } })
      // Astral's installer puts uv in ~/.local/bin; UV_NO_MODIFY_PATH leaves shell profiles alone.
      : process.platform === "win32"
        ? spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "ByPass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex"],
          { stdio: ["ignore", 2, 2], env: { ...process.env, UV_NO_MODIFY_PATH: "1" } })
        : spawnSync("/bin/sh", ["-c", "curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh"], { stdio: ["ignore", 2, 2] });
    uv = findUv();
    if (r.status !== 0 || !uv) {
      console.error("Couldn't install uv. See https://docs.astral.sh/uv/getting-started/installation/");
      return 1;
    }
  }
  console.error(`Installing rdt-cli ${RDT_VERSION} (uv fetches its own Python if needed)…`);
  const r = spawnSync(uv, ["tool", "install", `rdt-cli==${RDT_VERSION}`], { stdio: ["ignore", 2, 2] });
  return r.status ?? 1;
}

/** Runs rdt and prints its JSON through `shape`; returns rdt's exit code. */
function rdt(args: string[], shape: (json: string) => string): number {
  const uv = findUv();
  const bin = uv && rdtBin(uv);
  if (!bin) {
    console.log(JSON.stringify({ ok: false, error: { code: "not_installed", message: "run maps-lists reddit setup" } }));
    return 1;
  }
  // stderr carries rdt's hints ("More: rdt search … --after …"), which name commands we don't run.
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  try {
    console.log(shape(r.stdout));
  } catch {
    console.log(JSON.stringify({ ok: false, error: { code: "bad_output", message: clip(r.stdout, 300) } }));
    return 1;
  }
  return r.status ?? 1;
}

async function main() {
  const root = process.cwd();
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "status":
      console.log(JSON.stringify(await status(root)));
      return;
    case "setup":
      process.exitCode = setup();
      if (process.exitCode === 0) console.log(JSON.stringify(await status(root)));
      return;
    case "login": {
      const uv = findUv();
      const bin = uv && rdtBin(uv);
      if (!bin) {
        console.error("rdt-cli isn't installed: run maps-lists reddit setup first");
        process.exitCode = 1;
        return;
      }
      // rdt's login answers "Already authenticated" for any saved credential, even one Reddit now
      // rejects (403), and rereads the browser only after 7 days. A rejected one is dropped first, so
      // login takes fresh cookies; a working one is kept in case the Keychain prompt is denied.
      if (!(await status(root)).loggedIn) spawnSync(bin, ["logout"], { stdio: ["ignore", 2, 2] });
      // rdt prints the account it found; keep that on stderr, the JSON line on stdout.
      spawnSync(bin, ["login"], { stdio: ["inherit", 2, 2] });
      await updateConfig(root, { reddit: undefined });
      const s = await status(root);
      console.log(JSON.stringify(s));
      process.exitCode = s.loggedIn ? 0 : 1;
      return;
    }
    case "off":
    case "on":
      await updateConfig(root, { reddit: cmd === "off" ? "off" : undefined });
      console.log(JSON.stringify(await status(root)));
      return;
    case "search": {
      const { flags, rest } = splitArgs(args, SEARCH_FLAGS);
      if (rest.length !== 1) throw new Error("search takes one quoted query");
      process.exitCode = rdt(["search", rest[0]!, ...flags, "--json"], compactSearch);
      return;
    }
    case "read": {
      const { flags, rest } = splitArgs(args, READ_FLAGS);
      const ids = rest.map((a) => postId(a) ?? a);
      const bad = rest.filter((a) => !postId(a));
      if (!ids.length || bad.length) throw new Error(`not a Reddit post: ${bad.join(" ") || "(none given)"}`);
      const limit = flags.includes("-n") || flags.includes("--limit") ? [] : ["-n", "30"];
      // Stop at the first failure (expired login, rate limit): the rest would fail the same way.
      for (const id of ids) {
        process.exitCode = rdt(["read", id, "-s", "top", ...limit, ...flags, "--json"], compactThread);
        if (process.exitCode) break;
      }
      return;
    }
    default:
      console.error("usage: maps-lists reddit status|setup|login|off|on|search|read [args…]");
      process.exitCode = 64;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  await main().catch((e: Error) => {
    console.error(e.message);
    process.exit(64);
  });
}
