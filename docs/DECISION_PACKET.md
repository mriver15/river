# The decision packet and the trigger queue

How River's mind is woken and what it is shown. Implemented in `src/brain/` (pure, tested) and `src/server/agent.ts`.

## What wakes it

The world runs on its own clock; the model is asked to decide only when something warrants it.

| Kind | Priority | Raised by | Lives (world time) | Minimum spacing |
|---|---|---|---|---|
| `danger` | 0 | an attack, fire, a charging animal, a wound; an activity stopped by danger | 1 min | 3 s (a second threat never waits) |
| `contact` | 1 | a human speaks, approves, denies or gifts | 10 min | none |
| `need` / `failure` | 2 | a need crossing a threshold (with hysteresis); an activity that did not work | 5 min / 2 min | 30 s / 2 s |
| `completion` | 3 | an errand that ended with nobody waiting for it (e.g. after a restart) | 2 min | none |
| `emotion` / `novelty` | 4 | a strong feeling; something perceived | 1 min / 30 s | 20 s |
| `idle` | 5 | a quiet stretch after the last decision: `followUpSeconds` (2 s) after one that acted, `thinkSeconds` (8 s) after one that did nothing; both stretched as the budget fills | 10 s | none |

Triggers with the same key merge while they wait (their texts join; the most urgent priority wins). A trigger that expires before it is taken is dropped, not acted on late. All pending, eligible triggers are taken **as one batch**, so one decision answers a burst. Reflexes (fire, a wound, a charging animal, a collapse) act without waiting for any of this.

## What it is shown

A fresh summary each time, not a transcript. Fixed and never trimmed: identity and abilities (system prompt and tool list). The rest divides what remains of `packetTokens` (default 7,000 input tokens):

| Section | Share | Contents |
|---|---|---|
| Where things stand | 20 | time and place, wounds and clothes, needs, how the body and heart feel, who River says it is, desires, interests, what it carries |
| What is happening | 25 | why it was woken, what it did last and how that went, news and messages, what it can sense, what is around it (ids it can use), the last few events |
| Memories that surfaced | 20 | the five most relevant memories (by meaning, place, importance, recency), clipped |
| (reserve for the answer) | 10 | |

Within a section, **critical** items (danger, a human's words, where it is, its needs, why it was woken) are always kept, even over the share; the others are admitted by salience until the share is used. The packet never carries earlier conversation: a decision that asks for information may make one follow-up call, and any action ends the decision.

## What it costs, and who may spend it

Every model call is recorded with its consumer (`decision`, `reflection`, `dream`, `story`, `forge`), its reason, tokens in/out/cached and latency; every decision is logged in `brain_decisions` (what woke it, calls, tokens, packet size, tools, anything dropped). The **Brain** tab and `/api/brain` show them.

The hourly allowance keeps the last `reservePct` (20%) for `danger` and `contact`. When it is spent, either the world waits at the next decision (`budgetPause`, on by default; it thaws by itself when tokens free up and never overrides a human's own pause) or it carries on without new decisions. Activities and reflexes continue in both cases, and River is not put to sleep for want of budget.

## Cancellation and stale answers

A request in flight is aborted when a new life begins, on reset, or when the brain halts. Answers carry the life generation they started in and are discarded (and logged) if it changed, for decisions, reflections, dreams, stories and appraisals alike.
