# 18 · Website chat ("Chat with an Agent")

Status: **Live** as `c91d2b3` (deployed 2026-11-17). AI wording stays off until `ANTHROPIC_API_KEY` is set in Render; until then the rule-based assistant answers.

## What the customer sees
- A "Chat with an Agent" button at the bottom right of every public page (phone and desktop, safe-area aware). The chat code loads only when it is opened (about 4.7 kB gzipped); the button itself adds almost nothing to the page.
- The window is labelled **Tucker AI · AI assistant** and says "An AI, not a person." The first message says it is an AI.
- Customers can type several bills at once ("internet $110, phone $180 for 3 lines, tv $120"). The assistant asks only for what is missing. Before it compares electricity (solar) or home security it asks whether they own the home and whether they want extra-service pricing, the same rule as the form.
- A savings card shows each service, what they pay, the benchmark, the difference (a higher benchmark is shown as "$X/mo more" and left out of the total), combined monthly and yearly figures and the benchmark disclaimer. Each amount has a **Change** button; the server recomputes.
- **Talk to a Real Representative** opens a short form: first name, phone, ZIP, contact method (call, text, email), best time, the same consent text as the home page, optional marketing opt-in. After sending, the chat says the request is with the Tucker Team (Spotlight Marketing LLC) and that **no representative has joined the chat**. There is no live human chat; follow-up is by call, text or email.
- The chat survives page changes and reloads (stored on the device for up to 7 days); "Start over" clears it. If the connection drops, the message stays in the box and "Send" retries with the same id, so nothing is stored twice. If the chat cannot start, it points to the savings form.

## How it works
```
customer message
  → rules read bills and intent (shared/chat/extract.ts)        always
  → optional: Claude reads it too; its JSON is validated         only with ANTHROPIC_API_KEY
  → code decides the next step (shared/chat/conversation.ts)
  → figures from quickPreview(), the same calculation as the form
  → reply = code's text, or the model's wording if it has no figures or markup (safeReply)
```
- **The AI never computes anything.** It returns `understood` amounts, an intent and a short reply. Its output is checked against a schema twice (in `server/ai/chatModel.ts` and again in `server/chat.ts`); anything out of range counts as a failed call. Any reply containing `$`, `%`, a number of two or more digits or markup is replaced by the rule text. When a savings card is shown, the text is always the code's own.
- **Prompt injection:** the model has no tools, no database access and no secrets; it sees only the recent chat, what is known and the plan. Whatever it writes still goes through the checks above.
- **Without a key** (or when the model fails or times out after 12 s) the rule-based assistant answers every message. Failures are counted per chat.
- Model: `claude-opus-5-5` by default (`CHAT_MODEL`), low effort, structured JSON output, server-side fallback on refusals, one retry. The system prompt is cached.

## Data
Migration 12 (additive): `chat_sessions` (state, status open → previewed → handoff, lead link, message and AI counters, landing page and UTM) and `chat_messages` (role, text, card, client id unique per chat, whether the wording came from the AI). A chat is readable only with the random token given when it starts (stored as a SHA-256 hash). Chats that never became a lead are deleted after 90 days by the daily cleanup.

Limits: 20 new chats, 60 messages and 10 handoffs per minute per IP; 40 customer messages per chat; 800 characters per message.

## Handoff
Uses the same `handoffLead` as the home page (`docs/16-handoff.md`): same consent record, routing, duplicate protection (`requestKey`), alerts. Source is `platform_chat`. The lead gets a factual summary note built from the data (bills, illustrative difference marked "not verified", homeowner status, last question), and the full transcript appears on the lead page under **Website chat**.

## Team view
- **Admin → Chats** (admin only): last-30-day funnel (opened → sent a message → saw a preview → asked for a person, plus left mid-chat), AI calls, fallbacks, average response time, estimated AI cost per chat and per request (from token counts × `CHAT_PRICE_IN`/`CHAT_PRICE_OUT`; the invoice is the real figure), and every conversation with its transcript.
- **Lead page**: the transcript, for admins and the assigned representative.
- Events: `chat_open`, `chat_first_message`, `chat_preview`, `chat_handoff_click`, `chat_handoff_submit`.

## Cost
Each customer message is one model call: roughly 1,000–1,500 input tokens (mostly the cached system prompt and recent chat) and 60–150 output tokens. At the default list prices ($4 in / $20 out per million) that is about half a cent per message, so a typical 6–10 message chat costs about 3–6 cents. Turning the key off costs nothing and the chat still works.

## Turning it on (needs the owner)
1. Create an Anthropic API key with a monthly spend limit.
2. In Render, add `ANTHROPIC_API_KEY` (and optionally `CHAT_MODEL`). Saving an environment variable deploys the newest pushed commit.
The chat works without step 1–2, on rules only.

## Tests
`tests/chat.test.ts` (extraction, rules, API: multi-bill, full conversation with owner/extras questions, renter gating, negative differences, idempotent retries, invalid input, editing, handoff with lead and transcript, duplicate handoff, consent, length limit, admin-only access, AI merge, AI failure fallback, injected figures rejected, impossible model values ignored). `tests/e2e/chat.e2e.ts` runs the chat on a phone and a desktop with axe, then finds the transcript in the admin area.
