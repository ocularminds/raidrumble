# RaidRumble

One raid. Three rounds. A reason to stay.

RaidRumble gives Twitch raiders and the host’s community a three-minute showdown: **Siege → Know Your Host → Fusion Boss**, followed by a shared end card and a five-minute Afterglow counter. Home Guard is **blue ●**; Raiders are **orange ▲**.

## Run it

Use Node **20.20.0** from `.nvmrc` and pnpm. The repository pins pnpm **10.20.0** through Corepack. If you switch Node versions after installing dependencies, rebuild `better-sqlite3` for the selected runtime before running the app.

```sh
pnpm i
pnpm dev
```

- Dashboard: <http://localhost:5174>
- Arena preview: <http://localhost:5173/overlay/demo?preview=1>
- OBS browser source: <http://localhost:5173/overlay/demo>
- Server health: <http://localhost:3000/health>

Click **Launch test raid**. No Twitch, OpenAI, or Decionis account is needed. The simulator sends 300 synthetic raiders and 20 home members through the same game modules used by EventSub. Fifteen raiders participate; all 20 home members participate. The crowd fights a boss scaled to the active participants.

```sh
pnpm sim
pnpm sim -- --scenario stranger-raid
pnpm sim -- --scenario hate-raid
pnpm sim -- --scenario collab
```

With `pnpm dev` running, these commands drive the actual dashboard and OBS overlay. A stranger waits for the host’s 10-second approval. An unwelcome raid is blocked. **End practice match** lets you try another scenario.

Without a server, `pnpm sim` runs a fast headless match and prints its actual results. To force this mode:

```sh
pnpm sim -- --headless --scenario normal
pnpm sim -- --headless --scenario stranger-raid
pnpm sim -- --headless --scenario hate-raid
pnpm sim -- --headless --scenario collab
pnpm sim -- --headless --json
```

Headless stranger mode includes an explicitly simulated host approval. `--speed 2` accelerates a visual simulation; it does not shorten the game’s logical round durations. Demo actions never send Twitch messages, create real rewards, or send shoutouts.

## OBS and live setup

1. Register a Twitch application and set its redirect URI to `http://localhost:3000/auth/callback` for local development. If the application already has a different callback, set `TWITCH_AUTH_URL` to that exact registered URI; see [callback setup](apps/server/src/live/README.md).
2. Copy `.env.example` to `.env`. Set the Twitch client ID, client secret, and the bot’s user ID. `TWITCH_AUTH_CLIENT` and `TWITCH_AUTH_SECRET` are supported aliases. One Twitch account can serve both roles in a local test, with separate role tokens.
3. Run `pnpm dev`. Connect the host, then the configured bot account in the dashboard.
4. Copy the host’s OBS URL into a Browser Source at **1920 × 1080**. The source is transparent while idle. The `?preview=1` parameter adds a background and idle screen for viewing in a browser.
5. A real raid enters the same policy gate and match runner. The host can also run a local test against their own overlay.

Host and bot identity are separate. OAuth state is browser-bound and single-use; host controls require the matching host session. Tokens stay in server memory, so reconnect after a server restart. An optional raider can authorize `/auth/raider` for temporary roster capture. Native source-channel chat is used for the roster; relayed Shared Chat messages are not added to it.

The Warlord link posted by the bot requires Twitch login as the raiding streamer and is bound to the active match. A local, labelled practice controller is available at <http://localhost:5174/warlord/demo>. Battering Ram and Boiling Oil each have one use during Siege. Eligible channels can explicitly approve a **100 Channel Point Reinforcements** reward; only fulfilled redemptions of that configured reward receive a bonus.

For planned collabs, connect Shared Chat and use **Start Shared Chat rumble** in the live dashboard. All session participants are checked by policy. If there are several visiting channels, choose the opposing community. Approvals become stale when session membership changes.

The read-only mirror is `/mirror/<matchId>` on the overlay server. It follows that match only. The rivalry map displays channel aggregates, and Afterglow counts **tagged raiders who chatted in the last two minutes**, not Twitch’s total concurrent viewers.

The [verification record](docs/verify.md) distinguishes confirmed account-backed checks from remaining real-raid checks. The automated suite uses mocked Twitch responses and real local policy evaluation. Default development listeners bind to loopback. A hosted deployment needs HTTPS, the matching OAuth redirect, and explicit server/dashboard/overlay origins; it is not deployed by this repository.

## Policy before action

The default authority is `LocalPolicyGate`, loading `policy/raidrumble.policy.yaml`. New live hosts begin in **Shadow Mode**; the demo begins in enforce mode so its scenarios are visible. Ordinary Shadow Mode decisions report what would happen while allowing the action. Operational errors and timeouts always use the action’s `onFailure` rule.

An enforced escalation produces no match until the named host approves. The executor claims the approval grant immediately before the action, once only. Blocked/generated text is replaced by an authored fallback even in Shadow Mode. Every Helix write, including EventSub subscription creation, goes through `PolicyExecutor.executeHelix`; the test suite scans TypeScript syntax for bypasses.

`POLICY_GATE=decionis` selects the hosted adapter for real channels. It uses the [confirmed Decionis API contract](https://docs.decionis.com/.well-known/openapi.json), applies local prerequisites, binds grants to the action, claims them once, and records execution receipts. A Twitch host click satisfies local approval; a hosted hold requires the authority's own verified approval. The local judge room stays independent of hosted credentials.

Set `DECIONIS_ORG_ID`, `DECIONIS_API_KEY`, and `DECIONIS_ENFORCE_API_KEY` as documented in [hosted authority setup](docs/authority.md). New hosted installs default to `DECIONIS_MODE=SHADOW`; `ENFORCEMENT` is explicit, and the legacy label `live` maps to it. The AgentSafe gateway is a separate reverse proxy, not an authority API base.

The adapter retains the **120 ms** stream budget. Account-backed probes verified signed dossiers and a grant → claim → receipt lifecycle, including a remotely refused replay. Observed requests took **153–834 ms**, so this environment currently exercises the specified failure paths at the production budget. Local fallbacks remain unsigned; they never borrow a hosted dossier ID. See [verification evidence](docs/authority.md#verification).

## Content and privacy

The game runs entirely on deterministic templates without an API key. With `OPENAI_API_KEY` and an explicitly configured `OPENAI_MODEL`, the content service uses the [Responses API’s structured output format](https://developers.openai.com/api/docs/guides/structured-outputs).

The model selects supplied channel facts and creates fictional boss flavour. Templates realize factual questions from the actual title/category/up-to-three supplied facts, so model prose cannot invent personal facts. There are no web searches. Every resulting question and boss text passes `content.render`; errors, moderation flags, malformed output, and blocked terms fall back to safe authored content.

Raw viewer messages stay on the server. Only recognized commands and gated display names enter the game. Roster and Afterglow identities are ephemeral. SQLite stores match aggregates, receipts and retention counts; regulars use per-channel salted hashes in a separate logical store. In local development, a host login/server session supplies a stream boundary when an actual Twitch stream ID is unavailable.

## Plug-in rounds

Every round is a single-responsibility, stateless class with the same lifecycle:

```ts
interface RoundModule<S> {
  readonly id: string;
  readonly durationMs: number;
  start(ctx: MatchContext): S;
  onInput(state: S, input: PlayerInput, ctx: MatchContext): S;
  tick(state: S, dtMs: number, ctx: MatchContext): S;
  view(state: S): RoundView;
  result(state: S): RoundResult;
}
```

Add the class and a `defineRound(new YourRound())` entry in `packages/engine/src/registry.ts`. The timeline needs no round-specific branches. It handles fixed input windows, round transitions, the end card, and fault isolation. The overlay renders the common view, with scene renderers for gate, quiz and boss data. See [the round guide](docs/rounds.md).

Siege, Know Your Host and Fusion Boss were generated in **overlapping sub-agent tasks in one Codex build chat**. [The build log](docs/codex.md) and [parallel task evidence](docs/parallel.json) record the observed red/green checkpoints. Build chat: `01a1930a-c3f4-7b53-b90a-a523ae252545`.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Tests cover attribution conflicts, Shared Chat, participation fairness, spam limits, deterministic round snapshots, policy modes/failures, grant replay, content fallbacks, EventSub reconnects, OAuth identity, live control routes, reward budgets, SQLite persistence, and retention. Authored source paths are checked for the 500-line limit and no hyphens. Required pnpm filenames are the tooling exception.

All visual art is original CSS/Canvas geometry. The demo footage is local simulation, labelled as such; no live retention results or signed authority claims are implied. See [demo notes](docs/demo.md).

The local deliverables are [the captioned demo](artifacts/demo.mp4), [captions](artifacts/demo.srt), [the provenance manifest](artifacts/manifest.json), and [the contact sheet](artifacts/contact.jpg). Captures and rendered media stay in the ignored `artifacts/` directory. The source/log segment shows the actual overlapping round tasks and their common interface. Recompose existing captures on macOS with `python3 tools/video/main.py`, then validate and generate the contact sheet with `python3 tools/video/check.py` (Pillow and FFmpeg required).
