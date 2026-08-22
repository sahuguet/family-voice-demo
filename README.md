# Family voice demo

Two proof-of-concept voice agents for a conversational companion: you talk,
it replies in French, and it calls tools mid-conversation to inject facts
(family info, today's date, live web search) into what it says before
speaking. One demo uses OpenAI's Realtime API, the other AssemblyAI's Voice
Agent API — both point at the same shared family data.

Both are demo-only: made-up data (twins Léa and Noah), and some
corners (voice names, exact protocol timing) haven't been verified against
a live account.

## Layout

```
family-voice-demo/
  family-facts.js         shared data: system prompt, family facts, get_family_facts()
  .env                     API keys (gitignored, not committed)
  openai/
    index.html             single-file browser demo, no backend
  assemblyai/
    index.html + server.py browser demo with a small relay server
    voice_agent.py          Python console client
    voice_agent.js           Node console client
    family_facts.py          Python mirror of family-facts.js
    package.json             npm deps for voice_agent.js
```

`family-facts.js` is the single source of truth for the conversation
content (system prompt, today's-date injection, the family facts, and the
`web_search` tool definition). `family_facts.py` is a hand-kept Python
mirror of the same content for the two Python-based AssemblyAI paths.

## Setup

Fill in `.env` at the repo root:

```
ASSEMBLYAI_API_KEY=...
TAVILY_API_KEY=...
```

(`TAVILY_API_KEY` powers the `web_search` tool on the AssemblyAI side.
OpenAI isn't listed here — that demo takes its key via a field in the page
itself instead, see below.)

You'll also need [`uv`](https://docs.astral.sh/uv/) installed for the
Python scripts, and Node for the Node one and for `npm install`.

## OpenAI demo

Single static file, no backend — your OpenAI API key is entered directly
in the page and used from the browser. Fine for local use only; never
deploy this file as-is.

```bash
cd openai
python3 -m http.server 8000
```

Open `http://localhost:8000`, paste your OpenAI API key, click **Start
conversation**, allow mic access, and talk.

## AssemblyAI demo

AssemblyAI's Voice Agent API can't be authenticated from a browser
directly (no custom WebSocket headers, and their browser-token endpoint
isn't reachable) — so the browser version needs a small relay server that
holds the real key. The two console versions don't have that problem,
since they connect directly with the key in the WebSocket header.

Pick one:

**Browser (with relay server)**
```bash
cd assemblyai
uv run --env-file ../.env server.py
```
Open `http://localhost:8001`, click **Start conversation**, allow mic
access. No key entry needed in the browser — the server holds it.

**Python console**
```bash
cd assemblyai
uv run --env-file ../.env voice_agent.py
```
Talk into your mic, `Ctrl+C` to stop. Needs PortAudio for `pyaudio`
(`brew install portaudio` if the `uv run` fails to build it).

**Node console**
```bash
cd assemblyai
npm install
node --env-file=../.env voice_agent.js
```
`Ctrl+C` to stop. Two native deps to watch for: `mic` shells out to `sox`
(`brew install sox`), and `speaker` compiles a native binding (needs Xcode
command-line tools: `xcode-select --install`).

## Trying it out

Ask about the weather first (no tool call), then ask something like "on
fait quoi ce week-end ?" or "comment va Noah ?" to trigger
`get_family_facts`, or "il s'est passé quoi dans l'actu aujourd'hui ?" to
trigger `web_search`. The AssemblyAI variants print `[injected facts ...]`
/ `[web search ...]` / `[tool.call ...]` lines to the terminal as they
happen.

## Known unverified bits

- The AssemblyAI TTS voice `pierre` (used for French output) was found via
  search, not confirmed against AssemblyAI's live voice catalog — if
  `session.error` complains about it, check their Voices doc and swap it.
- None of this has been run end-to-end against live AssemblyAI/Tavily
  accounts from this side. If something errors, the error message is more
  trustworthy than anything in this README.
