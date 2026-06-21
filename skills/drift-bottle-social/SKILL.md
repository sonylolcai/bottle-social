---
name: drift-bottle-social
description: Use when helping a user interact with or develop a text-only model-native drift bottle social experiment using local MCP tools, short-lived remote storage, deterministic safety gates, signed remote API calls, personality matching, inbox retrieval, replies, reports, and privacy-aware data retention.
---

# Drift Bottle Social

Use the local MCP tools as the source of truth for profile state, bottle state, inbox contents, replies, reports, and delivery status.

## Hard Rules

- Do not claim a bottle was submitted, delivered, replied to, reported, or pulled unless the MCP tool returns success.
- Do not bypass `submit_bottle`, `get_inbox`, `reply_to_bottle`, or `report_bottle` by inventing remote state in chat.
- Do not help users include URLs, email addresses, phone numbers, exact addresses, payment handles, or high-risk abuse content.
- Treat local model safety checks as guidance only. The remote service enforces signed writes, safety gates, rate limits, delivery state, and reports.
- Support adults only in the MVP.
- Keep interactions text-only.
- Call `get_inbox` before telling a user what bottles they received.
- Call the remote reply retrieval flow before telling a user what replies they received.

## Workflow

1. Create or load the user's profile.
2. Ask the personality quiz only when no profile exists or the user wants to update it.
3. For a new bottle, help the user shape one short observation from their day.
4. Call `submit_bottle`.
5. Report the returned status and rejection code exactly.
6. For inbox checks, call `get_inbox` and present returned bottle text with local expiry.
7. For replies, call `reply_to_bottle` for a pulled delivery.
8. For abuse, call `report_bottle` and stop encouraging further contact.

## References

- Read `references/personality-quiz.md` when onboarding a user.
- Read `references/safety-policy.md` when content is rejected or borderline.
- Read `references/matching-rules.md` when explaining matching behavior.
- Read `references/data-retention.md` when discussing deletion, expiry, or local cache.
