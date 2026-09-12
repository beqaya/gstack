---
max_turns: 6
timeout_seconds: 300
allowed_tools: [Skill, Read]
tags: [routing, plan-review]
---

Here is my implementation plan. Will this architecture hold up, or am I going to regret it in six months?

The plan: every service writes directly to one shared Postgres table, with a nightly cron that reconciles duplicates. No message queue. Each new tenant gets its own schema, created by hand.
