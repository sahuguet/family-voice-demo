// npm install (run once in this folder) then: ASSEMBLYAI_API_KEY=... node voice_agent.js
//
// Connects directly with the API key in the WebSocket header. No browser
// involved, so no CORS and no temporary-token dance is needed -- that
// requirement only exists for browser clients, which can't set custom
// WebSocket headers.
const WebSocket = require("ws");
const mic = require("mic");
const Speaker = require("speaker");
const { buildSystemPrompt, FAMILY_TOOL, WEB_SEARCH_TOOL, getFamilyFacts } = require("../family-facts.js");

const API_KEY = process.env.ASSEMBLYAI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
if (!API_KEY || !TAVILY_API_KEY) {
  console.error("Set ASSEMBLYAI_API_KEY and TAVILY_API_KEY first.");
  process.exit(1);
}

async function webSearch(query) {
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TAVILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, include_answer: true, max_results: 3 }),
  });
  const data = await resp.json();
  return {
    answer: data.answer,
    results: (data.results || []).map((r) => ({ title: r.title, content: r.content })),
  };
}

const SAMPLE_RATE = 24000; // required by AssemblyAI's audio/pcm format

const speaker = new Speaker({ channels: 1, bitDepth: 16, sampleRate: SAMPLE_RATE });
let pendingToolResults = [];
let replyDone = true;
let micInstance;

function sendToolResult(message) {
  if (replyDone) {
    ws.send(JSON.stringify(message));
  } else {
    pendingToolResults.push(message);
  }
}

async function handleToolCall(event) {
  let result;
  if (event.name === "get_family_facts") {
    const topic = event.arguments.topic || "";
    const facts = getFamilyFacts(topic);
    console.log(`[injected facts for "${topic}"]: ${facts.join(" ")}`);
    result = { facts };
  } else if (event.name === "web_search") {
    const query = event.arguments.query || "";
    result = await webSearch(query);
    console.log(`[web search for "${query}"]: ${result.answer}`);
  } else {
    result = { error: `unknown tool ${event.name}` };
  }
  sendToolResult({ type: "tool.result", call_id: event.call_id, result: JSON.stringify(result) });
}

const ws = new WebSocket("wss://agents.assemblyai.com/v1/ws", {
  headers: { Authorization: `Bearer ${API_KEY}` },
});

ws.on("open", () => {
  console.log("Connected. Configuring session...");
  ws.send(
    JSON.stringify({
      type: "session.update",
      session: {
        system_prompt: buildSystemPrompt(),
        greeting: "Bonjour ! Je suis là dès que tu as envie de discuter.",
        input: { format: { encoding: "audio/pcm" } },
        output: { voice: "pierre", format: { encoding: "audio/pcm" } },
        tools: [FAMILY_TOOL, WEB_SEARCH_TOOL],
      },
    })
  );

  micInstance = mic({ rate: String(SAMPLE_RATE), channels: "1", debug: false });
  const micStream = micInstance.getAudioStream();

  micStream.on("data", (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input.audio", audio: data.toString("base64") }));
    }
  });
  micStream.on("error", (err) => console.error("Microphone error:", err));

  micInstance.start();
  console.log("Microphone started. Speak away (Ctrl+C to stop).");
});

ws.on("message", (raw) => {
  const event = JSON.parse(raw);

  switch (event.type) {
    case "session.ready":
      console.log("Session ready.");
      break;

    case "reply.audio":
      speaker.write(Buffer.from(event.data, "base64"));
      break;

    case "tool.call":
      handleToolCall(event); // async - web_search is a real network call, unlike get_family_facts
      break;

    case "reply.started":
      replyDone = false;
      break;

    case "reply.done":
      // Per AssemblyAI's docs: send accumulated tool results only after
      // reply.done for the turn that triggered them, never immediately.
      // replyDone stays true afterwards so a tool call that resolves late
      // (e.g. a slow web_search) is sent as soon as it's ready instead of
      // being dropped in an already-flushed queue.
      replyDone = true;
      pendingToolResults.forEach((r) => ws.send(JSON.stringify(r)));
      pendingToolResults = [];
      break;

    case "transcript.user":
      console.log(`You: ${event.text}`);
      break;

    case "transcript.agent":
      console.log(`Assistant: ${event.text}`);
      break;

    case "session.error":
      console.error(`Error [${event.code}]: ${event.message}`);
      break;
  }
});

ws.on("error", (err) => console.error("WebSocket error:", err));
ws.on("close", () => console.log("Disconnected."));

function cleanup() {
  if (micInstance) micInstance.stop();
  if (ws.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
}

process.on("SIGINT", cleanup);
