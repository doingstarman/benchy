#!/usr/bin/env python3
"""A minimal benchy agent that speaks the full trace protocol.

Reads {"messages": [...], "model": "..."} on stdin, prints its trajectory as JSONL
on stdout: think -> tool (already run) -> model call -> answer tokens -> done.

Point a benchy agent target at it:  python examples/agents/demo.py
See docs/agent-protocol.md for the protocol.
"""
import sys, json, time, re


def emit(obj):
    print(json.dumps(obj), flush=True)


def main():
    req = json.loads(sys.stdin.read() or "{}")
    question = (req.get("messages") or [{}])[-1].get("content", "")

    t0 = time.time()
    emit({"type": "step", "id": "plan", "kind": "think",
          "name": "understand the task", "ms": int((time.time() - t0) * 1000)})

    # Pretend we ran a calculator tool. benchy just records it — it does not run it.
    numbers = [int(n) for n in re.findall(r"-?\d+", question)]
    total = sum(numbers) if numbers else 0
    emit({"type": "tool", "id": "calc", "parent": "plan", "name": "calculator",
          "args": {"numbers": numbers}, "result": str(total), "ms": 2})

    # A model call we made, with usage and a self-reported cost.
    emit({"type": "model", "id": "draft", "name": "demo-model",
          "usage": {"inputTokens": 24, "outputTokens": 8}, "cost": 0.0002, "ms": 120})

    answer = f"The numbers sum to {total}." if numbers else "No numbers found."
    for tok in answer.split(" "):
        emit({"type": "token", "text": tok + " "})
        time.sleep(0.02)

    emit({"type": "done", "usage": {"inputTokens": 24, "outputTokens": 8}})


if __name__ == "__main__":
    main()
