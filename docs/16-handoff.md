# 16 — Customer-to-representative handoff

**Status (2026-11-17): built and tested, not deployed.** Includes database migration 8 (additive), rehearsed on a database created by the live commit `13882f8`. Reaches customers at the next deploy, including any saved Render setting.

**Principle:** the website creates the opportunity; a representative verifies the details. Nothing here quotes a price, confirms availability, or sells.

## What the customer sees

1. On the home page, as soon as a bill is typed, the illustrative preview appears with **Get My Exact Pricing** and "See my full preview".
2. The request form opens in place: **first name, phone, ZIP, consent**. Email, street address, contact method and best time are optional and hidden until asked for. Bills are never typed again.
3. After the server confirms the lead is saved: **"Your Pricing Review Has Been Requested"**, who has it (a representative's first name only if one was really assigned, otherwise "The Tucker team"), how they will be contacted, and a link to the full preview built from the same bills. No response time or appointment is promised.
4. If sending fails, everything typed stays and the same request can be sent again safely.
5. The results page uses the same wording and the same short details (last name and email are now optional there), and keeps its option to book a time.

## Existing pieces reused

| Need | Reused |
|---|---|
| Lead record, consent evidence, duplicates | `leads`, append-only `consents`, `duplicate_of` (`server/repo.ts`) |
| Preview maths | `quickPreview` and the benchmarks (`shared/platform/benchmarks.ts`); full analysis via `buildAnalysis` |
| What the household asked about | `assessments` and `opportunities` (a home-page request creates both from the bills) |
| Alerts | Email outbox with retries and delivery status (`server/notify`) |
| Scheduling | Existing slot booking (`server/scheduling.ts`) |
| Team area | Existing admin; representatives are a restricted sign-in to the same screens |
| Analytics | First-party `events` table and `track()` |

No new dependency, database or lead system was added.

## Data stored with each request

On the lead: contact details given, ZIP and city (from the served area), preferred contact and best time, source (`platform_handoff` or `platform_assessment`), campaign tags and click id, session id, timestamp, assessment id, and a **preview snapshot** (`leads.preview`, JSON, integer cents):

- per service: stated current bill, what it was compared with, and the difference
- totals: stated monthly spending, illustrative monthly and annual difference
- always `illustrative: true`, `verified: false`, with the benchmark version

The server recomputes the preview from the bills; totals sent by a browser are ignored. A benchmark comparison becomes an opportunity marked "needs an advisor quote · estimate", never a priced one.

## Routing (`shared/platform/routing.ts`)

Pure and deterministic; the outcome and reason are stored on the lead and in its history.

1. ZIP not in a served area → **unsupported**: recorded for review, nobody assigned, the customer is told options need review.
2. Same phone already has an open lead with an active representative → **same representative**.
3. Otherwise, among representatives who are active, **accepting** (a switch set by a person, never inferred), cover the location and at least one requested service, and are under their open-lead limit: fewest open leads, then longest since last assignment, then id.
4. Nobody eligible → **queued** (Leads → Unassigned), with the reason.

Configured in Admin → Representatives: locations, services, accepting, open-lead limit, active. Provider-level authorisation is not modelled separately yet; it is expressed through the services a representative handles.

**Repeat requests:** the same form sent twice (retry, double tap) returns the first lead (`request_key`). A later request from the same phone becomes a new lead linked to the first and goes to the same representative; the first is never overwritten. A request after a lead was closed starts fresh.

## Lead lifecycle

New → Assigned → Contact attempted → Contacted → Appointment scheduled → Qualified → Converted, plus Not interested, Unserviceable, Closed. (Install scheduled / Installed remain for internet orders.) Stored values keep their old names where they existed (`sold` shows as Converted, `lost` as Closed).

Only two changes are automatic, both tied to a real event: routing sets Assigned, a booking sets Appointment scheduled. Everything else is set by a person. Every status change and assignment is written to `lead_history` with who and when; the first "Contacted" time is kept for speed-to-contact.

## Representative workspace

- Admin → **Representatives**: add people, set coverage, switch accepting, set a password.
- A representative signs in on the same team page and sees **only leads assigned to them**: list, lead page, status, notes, opportunities, and their own accepting switch. Every other team route returns 403, and other leads look missing (404). Deactivating a representative ends their session on the next request.
- Lead page: assignment, "What they previewed" with the **not verified pricing** warning, consent status (contact and marketing separately), source, timestamps, history.
- Leads list: "Assigned to" column and filter, including the unassigned follow-up queue.

## Consent and communication

- Required: permission to be contacted about the request by call or text. Exact wording, version (`handoff-2026-11-17`), time, IP and browser are stored append-only.
- Optional and separate: marketing permission (`marketing-2026-11-17`), stored as its own consent record and a flag on the lead. **No marketing messages are sent by this system.**
- No text messages are sent at all: there is no SMS integration. Representatives call or text from their own phones.
- Opt-outs are not tracked in software yet; they must be honoured by the team by hand.
- **Legal review of both wordings is outstanding.**

## Integrations: what is real

| Integration | Status |
|---|---|
| Internal lead record | **Working.** Saved before anything else happens |
| Team and representative email alerts | **Built, not sending in production**: needs `RESEND_API_KEY` and a verified sending domain. Until then alerts are logged and shown as "not sent" on the lead |
| Customer "we got your request" email | Same as above; skipped when no email was given |
| Scheduling | **Working** (existing booking on the results page). Not offered inside the short home-page form |
| CRM | **Not connected.** `server/integrations/crm.ts` defines the adapter; the team area reports "not configured". Nothing is pushed anywhere |
| SMS | **None** |
| Ad-platform conversion tracking | **None.** Events are first-party only |

## Analytics events

Browser: `preview_view`, `handoff_cta_view`, `handoff_cta_click`, `handoff_start`, `handoff_error`. Server (ignored if a browser sends them): `handoff_submit`, `rep_assigned`, `appointment_booked`, `lead_qualified`, `lead_converted`. No name, phone, address or bill amount is put in an event.

Admin → Leads shows the funnel for the last 30 days: previews, taps, requests, assigned, contacted, appointments, qualified, converted, queue size and average time to first confirmed contact.

## Safeguards

Server-side validation with the shared schema; rate limit of 10 requests per 15 minutes per connection; hidden-field bot trap; idempotent submissions; restricted representative access; passwords stored as scrypt hashes; no contact details in logs or events; consent records cannot be edited.

## Tests (2026-11-17)

- `tests/handoff.test.ts`: 19 tests (routing rules, minimal request, consent, server-side preview, idempotency, repeat requests, queue, unsupported ZIP, email failure and retry, alert content, bots, representative access, admin management, funnel, event filtering).
- Browser: home preview → request with keyboard only → simulated network failure and retry → confirmation → admin queue → add representative → assign → representative signs in and works the lead. Accessibility checks (axe) on the form, confirmation, lead page and representatives page; no horizontal scroll at 320 px.
- Totals: 198 unit/API/DB tests and 21 browser tests pass; build passes.

## Known limits and setup still needed

1. Add at least one representative (Admin → Representatives) and switch them to accepting; until then every request waits in the queue.
2. Set a team alert email for the location and turn on email (Resend key, verified domain), or check the queue by hand.
3. Legal review of the consent wording before paid traffic.
4. No CRM, SMS or ad-platform conversion tags.
5. No bot challenge beyond the rate limit and hidden field.
6. Opt-out tracking is manual.
7. One admin account; representatives cannot reset their own password.
