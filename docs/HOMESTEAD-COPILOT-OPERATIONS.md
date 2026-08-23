# HOMESTEAD COPILOT OPERATIONS

## Config

| Env | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Optional for NL; brief works without it |
| `OPENAI_TEXT_MODEL` / `OPENAI_COPILOT_MODEL` | Model (default gpt-4o) |

## Limits

- Session TTL: 30 min
- Confirm TTL: 10 min
- Max tool calls / turn: 4
- OpenAI timeout: 25s

## Metrics (`copilot_metrics`)

`copilot_requests`, `copilot_success`, `copilot_failure`, `copilot_tool_calls`, `copilot_tool_failure`,  
`copilot_action_proposed`, `copilot_action_confirmed`, `copilot_action_denied`,  
`copilot_unauthorized_query`, `copilot_prompt_injection_detected`

## Audit events

`COPILOT_QUERY`, `COPILOT_TOOL_CALL`, `COPILOT_ACTION_PROPOSED`,  
`COPILOT_ACTION_CONFIRMED` / executed / denied

## OpenAI down

Deterministic brief + intent router still answer high-value questions.  
User sees a human message if free-form NL cannot be resolved.

## Deploy

1. Tag `pre-wave-g-*` + SQLite backup + integrity ok  
2. `deploy/vps/deploy-wave-g.sh`  
3. `deploy/vps/canary-wave-g.py`  

## After Wave G

**STOP.** No Wave H. Next: Homestead V1.0 Master Certification only.
