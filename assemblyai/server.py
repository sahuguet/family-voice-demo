# /// script
# dependencies = ["flask", "flask-sock", "websocket-client", "tavily-python"]
# ///
"""Browser <-> AssemblyAI relay.

The browser can't set a custom Authorization header on a WebSocket, and
AssemblyAI's browser-token endpoint isn't reachable from here, so this
server holds the real API key and proxies the connection instead. It's
mostly a plain pass-through -- the browser builds every AssemblyAI message
itself (session.update, input.audio, get_family_facts's tool.result, ...)
-- except for the web_search tool, whose Tavily API key must stay
server-side, so that one tool.call is intercepted and answered here.
"""
import json
import logging
import os
import threading
import time

import websocket as ws_client
from flask import Flask, send_from_directory
from flask_sock import Sock
from tavily import TavilyClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("relay")

app = Flask(__name__, static_folder=".", static_url_path="")
sock = Sock(app)

API_KEY = os.environ["ASSEMBLYAI_API_KEY"]
tavily = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/family-facts.js")
def family_facts():
    return send_from_directory("..", "family-facts.js")


@sock.route("/relay")
def relay(browser_ws):
    closed = threading.Event()
    lock = threading.Lock()
    state = {"reply_done": True, "pending": []}

    def send_tool_result(upstream, call_id, result):
        message = json.dumps(
            {"type": "tool.result", "call_id": call_id, "result": json.dumps(result)}
        )
        with lock:
            if state["reply_done"]:
                upstream.send(message)
            else:
                state["pending"].append(message)

    def run_web_search(upstream, call_id, query):
        # Runs in its own thread: a real network call, unlike the instant
        # get_family_facts lookup, so it must never block the read loop.
        search = tavily.search(query, include_answer=True, max_results=3)
        result = {
            "answer": search.get("answer"),
            "results": [
                {"title": r["title"], "content": r["content"]}
                for r in search.get("results", [])
            ],
        }
        log.info("tool.result call_id=%s web_search answer=%r", call_id, result["answer"])
        send_tool_result(upstream, call_id, result)

    def on_message(upstream, message):
        try:
            event = json.loads(message)
        except ValueError:
            event = {}

        if event.get("type") == "tool.call":
            # Logged here regardless of which tool: get_family_facts is
            # computed by the browser, web_search by this server, but every
            # call passes through this relay either way.
            log.info(
                "tool.call name=%s call_id=%s arguments=%s",
                event.get("name"),
                event.get("call_id"),
                event.get("arguments"),
            )

        if event.get("type") == "tool.call" and event.get("name") == "web_search":
            query = event.get("arguments", {}).get("query", "")
            threading.Thread(
                target=run_web_search, args=(upstream, event["call_id"], query), daemon=True
            ).start()
        elif event.get("type") == "reply.started":
            with lock:
                state["reply_done"] = False
        elif event.get("type") == "reply.done":
            with lock:
                state["reply_done"] = True
                pending = state["pending"]
                state["pending"] = []
            for msg in pending:
                upstream.send(msg)

        try:
            browser_ws.send(message)
        except Exception:
            closed.set()

    upstream = ws_client.WebSocketApp(
        "wss://agents.assemblyai.com/v1/ws",
        header={"Authorization": f"Bearer {API_KEY}"},
        on_message=on_message,
        on_close=lambda *_: closed.set(),
        on_error=lambda *_: closed.set(),
    )
    threading.Thread(target=upstream.run_forever, daemon=True).start()

    for _ in range(50):  # wait up to 5s for the upstream connection
        if upstream.sock and upstream.sock.connected:
            break
        time.sleep(0.1)

    try:
        while not closed.is_set():
            message = browser_ws.receive()
            if message is None:
                break
            if upstream.sock and upstream.sock.connected:
                upstream.send(message)
    finally:
        upstream.close()


if __name__ == "__main__":
    app.run(port=8001, debug=True)
