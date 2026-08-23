# Homestead — Customer Aftercare

Trigger: job **COMPLETED** (idempotent outbox `post_service.followup_due:<jobId>:<cycle>`).

Delay: service-aware minutes (locksmith short → painting longer) + quiet hours (America/Panama).

Channel: transactional email with secure `/experiencia/<token>` (Wave C).

First ask: satisfaction — not a review.

Responses: EXCELLENT / GOOD / NEUTRAL / NEEDS_HELP.
