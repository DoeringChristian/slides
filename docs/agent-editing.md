# Agent editing — design

Status: phase 1 built (see **Phases**). The "rich embedded displays" half of
the BACKLOG's LLM entry is a later phase built on this.

## Goal

Let an agent **generate** a deck from a brief and **edit** an existing deck on
request — including the part that makes this app different from a slide tool:
animation, which here is keyframes (an element keeps its `id` across slides and
playback interpolates it).

## The core decision: the agent runs in the browser

The agent loop runs in the editor tab, with **the user's own model key**,
stored in that browser only. It drives the deck through the same store
actions the UI uses.

| Consequence | Why it matters |
| --- | --- |
| No public server endpoint spends model credit | Agent work does not wait on server auth; the server never sees an API key (the one exception, the ChatGPT-plan relay, answers this machine only) |
| Works in every storage mode | Store actions are dual-path: local/filesystem decks change in memory, server decks change through Yjs |
| Collaborators watch live | In a server room, agent edits are ordinary local Yjs writes, so every peer sees them as they happen |
| Sees exactly what the user sees | `render_slide` uses the shared renderer in the same tab — fonts, MathJax, label masks included |
| Bring your own model | A provider adapter sits under the loop; the deck tools do not know which model is calling |

Trade-offs accepted:

- The agent works only while the tab is open. It is an assistant you watch,
  not a background job.
- API keys live in `localStorage`. A script-injection bug in the editor could
  read them. They are the user's own keys, never written into the deck, the
  Yjs doc, exports or any request to our server; the settings UI says so.
  ChatGPT plan tokens are the exception: OpenAI requires them out of the
  browser, so the local slides server holds them (see below).
- External agents (MCP: Claude Code driving a deck) need a process outside the
  browser. Deferred; see **Later**.

Rejected: an agent loop on the server (needs auth and a server-held key first),
and driving the UI by computer use (slow, and blind to ids and keyframe
identity).

## Architecture

```
 AgentPanel (chat, settings, Stop, Undo turn)
      │ prompt
      ▼
 agentLoop ── provider adapter ──► model API (user's key, direct from browser)
      │ tool calls
      ▼
 deck tools ── read:  store snapshot → compact JSON / PNG (render_slide)
            └─ write: presentationStore actions (dual-path) inside agentWrite()
                         │
                         ├─ local/filesystem: Zustand state
                         └─ server: Yjs doc → room → peers, LevelDB
```

Modules live in `src/agent/`:

| module | role |
| --- | --- |
| `providers/types.ts` | provider-neutral transcript, tool and stream types |
| `providers/anthropic.ts` | Claude adapter (`@anthropic-ai/sdk`, browser mode, streaming, prompt caching) |
| `providers/openai.ts` | OpenAI Responses adapter: API key direct, or ChatGPT plan via the local server |
| `server/chatgpt.js` | Sign in with ChatGPT: loopback OAuth, token storage, relay |
| `agentSettings.ts` | provider, keys, model per provider, persisted per browser |
| `agentLoop.ts` | the turn loop: stream, validate tool input, run tools, repeat |
| `tools.ts` | tool definitions, schemas and implementations |
| `deckView.ts` | compact JSON views of deck and slides (defaults omitted) |
| `renderSlide.ts` | slide (or mid-transition frame) → PNG through the shared renderer |
| `turnHistory.ts` | one agent turn = one undo step, in both store paths |
| `agentStore.ts` | chat state for the panel |
| `systemPrompt.ts` | how this app's keyframe model works, for the model |

### Writes go through the store

Tools call `presentationStore` actions — never `ySchema` directly. The store is
the one place that already keeps the JSON and Yjs paths equivalent, so the
agent cannot drift from the editor. Rule for new tools: *if the editor has an
action for it, call the action; if it has none, add a dual-path action first.*

`agentWrite(fn)` wraps every write and turns off two editor-UI behaviours that
key off the user's current selection:

- **multi-slide mirroring** (`mirrorTargets`): with several slides selected, a
  UI edit fans out to all of them. An agent edit must touch only the slide it
  names.
- **auto-draw** (`beforeMutation`): editing the active slide spawns a new
  keyframe. The agent adds keyframes explicitly with `add_slide`.

### A turn is one undo step

A turn may make dozens of writes; Cmd+Z should revert the turn, not its last
write. `turnHistory.ts` brackets each turn:

- **JSON path (zundo):** pause history at the start, keep the pre-turn state,
  and on finish push it as a single past state.
- **Yjs path (`Y.UndoManager`):** note the undo-stack depth at the start; on
  finish merge every stack item added since into one, with the same
  `mergeDeleteSets` Yjs uses for its own capture window.

Edits the *user* makes locally during a running turn fall into the same step.
Remote peers' edits never do (the manager tracks local origin only).

### Seeing its own work

`render_slide(slideId, t?)` returns a PNG. It frames the slide with
`composeSlideFrame` (for `t`, the in-flight frame from the previous keyframe),
awaits `layoutForElement` for every text element so the layout cache is warm,
then renders the shared `renderPresenterElement` leaves with
`renderToStaticMarkup` — the same code path the presenter draws with — and
rasterises through `svgToPngDataURL`. Image elements use the exporter's
`<image>` path with resources inlined as data URLs, because an `<img>` inside a
`foreignObject` does not load when an SVG is rasterised. Optional `labels`
draws each element's id at its corner so the model can refer to what it sees.

Text boxes are never guessed: when a tool creates or changes free text, it
measures the box with `measureUserText`, the editor's own sizing.

### Tool surface (phase 1)

Ids are the model's vocabulary for keyframes: reusing an element id on the next
slide makes it animate, a new id makes it enter.

| tool | does |
| --- | --- |
| `get_deck` | title, size, slide list (id, index, element count, first text, notes excerpt, how many elements continue from the previous slide) |
| `get_slide(slideId)` | elements in z-order, compact (defaults omitted), background, notes, transition |
| `render_slide(slideId, t?, labels?)` | PNG of the slide, or of the transition into it at `t` |
| `explain_transition(slideId)` | what animates into the slide (property groups and easings), what enters, what exits; flags a cut where nothing carries over |
| `add_slide(afterSlideId?, mode?)` | `copy` (default) continues the previous slide as the next keyframe; `empty` is a cut |
| `delete_slide`, `move_slide` | |
| `add_elements(slideId, elements)` | text / shape / image-placeholder from compact specs with defaults |
| `update_elements(slideId, patches)` | partial changes by id; nested `style` merges |
| `delete_elements(slideId, ids)` | |
| `set_transitions(slideId, elementId, transitions)` | easing per transition group, plus options |
| `set_slide(slideId, background?, notes?, duration?)` | |
| `set_title` | |

**Keeping the model on the keyframe model.** Left alone, models build decks
as independent pages: every slide drawn from scratch, so nothing animates.
Three things push back: the system prompt is built around "a deck is one
animated scene; slides are keyframes; identity is the id", with a storyboard
step, patterns and a wrong/right example; `add_slide` copies by default; and
`add_elements` warns when a new element looks like an object on the previous
slide (same text, or same kind at nearly the same place and size), naming the
id to edit or reuse. `explain_transition` and the continuity counts in
`get_deck` let the model check the result.

Inputs are validated against each tool's schema before running; a bad input
returns an error result to the model rather than throwing.

### Provider adapters

`ModelProvider.stream({system, messages, tools, signal, onText})` returns the
assistant message in the neutral transcript format. Assistant messages keep the
provider's raw content alongside the neutral blocks, so thinking blocks and
signatures return to the same provider verbatim on the next request.

- **Claude** (built): `@anthropic-ai/sdk` with `dangerouslyAllowBrowser`;
  default model `claude-opus-5-5`; streaming; top-level automatic prompt
  caching (the system prompt and tool list are frozen, so the prefix caches
  across a turn); `eager_input_streaming` on the deck tools, which is safe
  because every input is validated before it runs.
- **OpenAI** (built, `providers/openai.ts`): the Responses API, stateless
  (`store: false`, transcript resent each request, reasoning carried forward
  as encrypted items with server ids stripped). Images returned by tools
  follow the tool outputs as a user message. Two transports:
  - **API key**: the browser calls `api.openai.com` directly with the
    user's OpenAI key, kept in this browser like the Claude key.
  - **ChatGPT plan** ("Sign in with ChatGPT", see below): requests go to
    the local slides server, which relays them with the user's tokens.

### ChatGPT plan usage (Sign in with ChatGPT)

OpenAI lets open-source and locally run apps spend a user's ChatGPT plan
([docs](https://developers.openai.com/siwc/token-sharing-open-source)). Its
rules: the OAuth redirect is an HTTP loopback callback on `127.0.0.1`, and
access/refresh/ID tokens stay out of browser storage. A static editor page can
do neither, so `server/chatgpt.js` does what OpenAI's docs assign to an app's
main process:

- registers the install once (`dynamic_agent_client`, a persisted
  `urn:uuid:` host id) and reuses the issued client id afterwards;
- runs Authorization Code + PKCE with the plan scopes
  (`offline_access resource.invoke chatgpt.tokens.use.direct`) and the
  `https://api.openai.com/v1` resource, callback
  `http://127.0.0.1:<port>/auth/callback`;
- verifies the ID token (RS256 against the issuer's JWKS, issuer, audience,
  nonce, expiry) and treats plan usage as granted only when the returned
  scope includes `chatgpt.tokens.use.direct`;
- stores tokens in `server/data/chatgpt/auth.json` (mode 0600, git-ignored),
  refreshes them one at a time (refresh tokens rotate), and clears them on
  a spent refresh token so the user signs in again;
- relays `POST /v1/responses` as a stream, forcing `store: false` and
  `stream: true` and dropping the parameters the plan route rejects.

Every `/api/chatgpt/*` route answers only requests from this machine
(loopback peer and loopback `Host`, against DNS rebinding) and from allowed
editor origins — local dev servers, the published editor, and
`SLIDES_AGENT_ORIGINS` — so another website open in the same browser cannot
spend the plan. A server other people reach over the network is a "remotely
hosted app" in OpenAI's terms and needs their approval; these routes refuse
it. Plan limits surface as readable errors (per-app caps are set in ChatGPT
settings).

### UI

A right-hand **Assistant** panel, toggled from the header:

- settings: provider (Claude key, OpenAI key, or ChatGPT plan), model,
  effort; for the ChatGPT plan a **Sign in with ChatGPT** button that opens
  OpenAI's consent page in a new tab and polls the local server until the
  sign-in lands, then lists the account's models;
- the conversation, with tool activity shown inline ("Edited slide 4");
- **Stop** (aborts the request and ends the turn cleanly);
- **Undo turn** for the last turn.

The panel says which slide the agent is working on; while it works, the editor
follows it to that slide.

## One conversation per project

The assistant keeps one conversation per deck (`agentStore.ts`): the model
transcript, the chat items, attachments and the undoable last turn. Each
message starts with an editor-context line — the slide the user is on and
the selection — so "this slide" resolves without splitting the conversation.
While the assistant works, the canvas follows it to the slide it edits
(setting "Follow").

One turn runs at a time, because turns share the undo history. Requests made
meanwhile — typed, or forwarded comments — queue and run in order; Stop ends
the running turn and drops the queue.

The conversation is saved per deck in this browser's IndexedDB
(`threadStorage.ts`) and restored when the deck opens, so a reload keeps it:
chat items, the model transcript (provider-private content such as thinking
signatures included, so the next request continues where it left off) and
attachments (stored as Blobs). Saving is debounced and also runs at the end of
every turn; it waits until the deck's stored copy has loaded, so an early
empty state never overwrites it. A turn cut off by a reload is repaired on
load — unanswered tool calls get an "interrupted" result, queued messages are
marked not sent. "Undo turn" does not survive a reload (the editor's undo
history does not either). Like model keys, conversations are per browser:
never in the deck, never sent to the slides server, so collaborators do not
see them. The 30 most recently used decks are kept.

## Review comments

Comments are deck data: `Slide.comments`, keyed by id, each pinned to an
element (`elementId`) or the slide, with replies (`parentId`) and a resolved
flag. They sync to collaborators through Yjs like any slide field, are
validated on load, are not copied into new keyframes, and are left out of
viewer exports (editable exports keep them). The store actions
(`addComment` / `updateComment` / `deleteComment`) are dual-path and bypass
auto-draw and multi-slide mirroring, since a comment is not slide content.

On the canvas (`CommentLayer.tsx`), an element with open threads gets a small
badge at its top-right corner; comments on the slide itself, or on an element
no longer on it, gather at the slide's corner. The selection bar has a
Comment button. The thread popover shows replies, resolve/reopen, and delete
for your own comments.

Posting a comment with **Ask the assistant** (on by default) forwards it to
the assistant (naming the comment's slide and element) and opens the panel. The assistant
does what it asks and answers in the thread with `reply_to_comment`
(authored "Assistant"), resolving it when done. `get_slide` lists a slide's
open threads, so the assistant can also take up collaborators' comments when
asked. Only the person who posts a comment can forward it: the assistant runs
in their browser on their key.

## Media in the chat

Images (PNG, JPEG, GIF, WebP) and PDFs can be attached by button, drag and
drop, or paste (`attachments.ts`). The model gets images downscaled to at most
1568 px on the long side; PDFs go as documents (Claude) or input files
(OpenAI). Attachments are described to the model by id, and
`insert_attachment` places an attached image on a slide from the original
file at full resolution, through the same image loader as an upload
(content-hash dedup into `resources`).

## Security

- The key never leaves the browser except to the provider's API.
- Tools touch only the open deck, through store actions. No filesystem, no
  network fetch other than the model API.
- Every turn is one undo step.
- Model output is data. Text it writes is rendered as text/LaTeX, never as
  HTML or script. Rich displays (LLM-written HTML/JS) stay out of scope until
  the sandbox decision in the BACKLOG entry.

## Phases

| phase | delivers |
| --- | --- |
| 1. Assistant (built) | settings + Claude adapter, chat panel, read/write tools, `render_slide`, one-turn undo |
| 1b. OpenAI (built) | Responses adapter; OpenAI API key; ChatGPT plan through the local server |
| 2. Comments, persistence, media (built) | comment badges and threads forwarded to the assistant; one saved conversation per project; image/PDF attachments |
| 3. Declarative slides | `write_slide(slideId, spec)` diffed into minimal edits, for fast generation |
| Later | MCP bridge for external agents; rich displays (BACKLOG) |
