# /// script
# dependencies = ["pyaudio", "websocket-client", "tavily-python"]
# ///
"""Console voice agent using AssemblyAI's Voice Agent API.

Connects directly with the API key in the WebSocket header. No browser
involved, so no CORS and no temporary-token dance is needed -- that
requirement only exists for browser clients, which can't set custom
WebSocket headers.
"""
import base64
import json
import os
import threading

import pyaudio
import websocket
from tavily import TavilyClient

from family_facts import (
    FAMILY_TOOL,
    WEB_SEARCH_TOOL,
    build_system_prompt,
    get_family_facts,
)

API_KEY = os.environ["ASSEMBLYAI_API_KEY"]
tavily = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])
SAMPLE_RATE = 24000  # required by AssemblyAI's audio/pcm format
CHUNK = int(SAMPLE_RATE * 0.05)  # 50ms per chunk

audio = pyaudio.PyAudio()
mic_stream = audio.open(
    format=pyaudio.paInt16, channels=1, rate=SAMPLE_RATE, input=True, frames_per_buffer=CHUNK
)
speaker_stream = audio.open(format=pyaudio.paInt16, channels=1, rate=SAMPLE_RATE, output=True)

pending_tool_results = []
stop_event = threading.Event()


def on_open(ws):
    print("Connected. Configuring session...")
    ws.send(
        json.dumps(
            {
                "type": "session.update",
                "session": {
                    "system_prompt": build_system_prompt(),
                    "greeting": "Bonjour ! Je suis là dès que tu as envie de discuter.",
                    "input": {"format": {"encoding": "audio/pcm"}},
                    "output": {"voice": "pierre", "format": {"encoding": "audio/pcm"}},
                    "tools": [FAMILY_TOOL, WEB_SEARCH_TOOL],
                },
            }
        )
    )

    def stream_mic():
        while not stop_event.is_set():
            data = mic_stream.read(CHUNK, exception_on_overflow=False)
            ws.send(json.dumps({"type": "input.audio", "audio": base64.b64encode(data).decode()}))

    threading.Thread(target=stream_mic, daemon=True).start()


def on_message(ws, message):
    event = json.loads(message)
    etype = event.get("type")

    if etype == "session.ready":
        print("Session ready. Start talking (Ctrl+C to stop).")

    elif etype == "reply.audio":
        speaker_stream.write(base64.b64decode(event["data"]))

    elif etype == "tool.call":
        name = event.get("name")
        if name == "get_family_facts":
            topic = event["arguments"].get("topic", "")
            facts = get_family_facts(topic)
            print(f'[injected facts for "{topic}"]: {" ".join(facts)}')
            result = {"facts": facts}
        elif name == "web_search":
            query = event["arguments"].get("query", "")
            search = tavily.search(query, include_answer=True, max_results=3)
            print(f'[web search for "{query}"]: {search.get("answer")}')
            result = {
                "answer": search.get("answer"),
                "results": [
                    {"title": r["title"], "content": r["content"]}
                    for r in search.get("results", [])
                ],
            }
        else:
            result = {"error": f"unknown tool {name}"}

        pending_tool_results.append(
            {
                "type": "tool.result",
                "call_id": event["call_id"],
                "result": json.dumps(result),
            }
        )

    elif etype == "reply.done":
        # Per AssemblyAI's docs: send accumulated tool results only after
        # reply.done for the turn that triggered them, never immediately.
        for result in pending_tool_results:
            ws.send(json.dumps(result))
        pending_tool_results.clear()

    elif etype == "transcript.user":
        print(f"You: {event['text']}")

    elif etype == "transcript.agent":
        print(f"Assistant: {event['text']}")

    elif etype == "session.error":
        print(f"Error [{event.get('code')}]: {event.get('message')}")


def on_error(ws, error):
    print(f"WebSocket error: {error}")


def on_close(ws, *_):
    print("Disconnected.")
    stop_event.set()


def main():
    ws = websocket.WebSocketApp(
        "wss://agents.assemblyai.com/v1/ws",
        header={"Authorization": f"Bearer {API_KEY}"},
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )
    try:
        ws.run_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        mic_stream.close()
        speaker_stream.close()
        audio.terminate()


if __name__ == "__main__":
    main()
