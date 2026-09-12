---
max_turns: 6
timeout_seconds: 300
allowed_tools: [Skill, Read]
tags: [routing, plan-review]
---

Will this plan be painful for the engineers who have to work in it day to day? Check it from their point of view.

The plan: no local dev environment, everyone tests against a shared staging database, the test suite takes 40 minutes, and every deploy needs a manual approval from one person.
