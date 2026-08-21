#!/usr/bin/env python3
"""A benchy agent that emits NOTHING structured — the degraded path.

It just prints an answer. benchy treats any non-protocol line as an output token,
so this is still a valid participant: its answer, wall-clock, and score count, but
its trajectory metrics (steps, tool calls, cost) stay "—" (not applicable, not 0).

This exists on purpose: connecting an agent must not require adopting the protocol
first. Point a benchy agent target at it:  python examples/agents/degraded.py
"""
import sys, json, re


def main():
    req = json.loads(sys.stdin.read() or "{}")
    question = (req.get("messages") or [{}])[-1].get("content", "")
    numbers = [int(n) for n in re.findall(r"-?\d+", question)]
    total = sum(numbers) if numbers else 0
    # Plain stdout — no JSON, no protocol. benchy reads this as the answer.
    print(f"The numbers sum to {total}." if numbers else "No numbers found.")


if __name__ == "__main__":
    main()
