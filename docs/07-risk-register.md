# 07 — Security, privacy & compliance risk register

_Source: independent read-only security review of the codebase (2026-11-16) + architecture audit._
_Status: **Open** · **Fixed (built)** = fixed and tested on the branch, **not deployed** · **Live** = fixed in production._
_Software controls do not by themselves establish legal compliance; items marked ⚖ need counsel._

## Security findings

| ID | Severity | Finding | Status | Fix / evidence |
|---|---|---|---|---|
| H1 | High | Resubmitting the form with someone's email + phone overwrote their lead and **TCPA consent record**, returned a new booking token and allowed cancelling their appointment | **Fixed (built)** | Every submission is a new lead linked via `duplicate_of`; append-only `consents` table + DB triggers block edits to consent evidence (migration 5, backfilled). Tests: _links repeat submissions…_, _makes consent evidence immutable…_ Migration rehearsed on production-version data: 6/6 consent rows preserved byte-for-byte. |
| H2 | High | `/api/events` accepted unbounded `props`; events never pruned → disk exhaustion would stop lead capture | **Fixed (built)** | ≤ 10 keys and ≤ 1 KB per event; daily pruning (≈ 13 months) + 500k-row backstop. Test: _rejects oversized analytics payloads…_ |
| H3 | High | Lead form can email arbitrary addresses (spam/reputation) and burn the email quota | **Partly fixed (built)** | Per-recipient cap (3 per 24 h), global daily customer-email cap (`EMAIL_DAILY_CUSTOMER_LIMIT`, default 80), team alerts never capped, reschedule limit (4 per lead per day). **Open:** Cloudflare Turnstile on the form (needs site key ⚑). |
| M1 | Medium | Behind Cloudflare + Render, `req.ip` may be a proxy address → shared rate limits, wrong `consent_ip` | **Open** | Verify with a one-off log of `req.ips` in production; then trust `CF-Connecting-IP` only for requests from Cloudflare ranges and lock the origin to Cloudflare. |
| M2 | Medium | Team inbox addresses published in page data and `/api/markets/:slug` | **Fixed (built)** | `publicMarket()` strips `notifyEmails`. Test: _never publishes internal team inboxes_. |
| M3 | Medium | No deletion/retention; privacy notice overstated ("anonymous", no processors named) | **Partly fixed (built)** | Notice corrected (linkage disclosed, processors named, retention described accurately); event retention automated. **Open:** admin delete/anonymize + `data_requests` workflow (Phase 5). |
| M4 | Medium | One actor can reserve many slots via fake leads | **Partly fixed** | Reschedule limit; **Open:** Turnstile, per-day booking caps per market. |
| M5 | Medium | Single shared admin; stateless sessions can't be revoked; no MFA; per-IP login limiting only | **Open** | Phase 5: `users`, `sessions` (revocable), TOTP, global failed-login throttle, scrypt N ≥ 2^17. |
| M6 | Medium | No backups; single 1 GB disk; deploys cause ~1 min downtime | **Open** | Nightly `VACUUM INTO` snapshot shipped off-site + documented restore drill (⚑ destination); staging service; Postgres at Phase 5. |
| L1 | Low | `$&`/`$'` in admin-entered text corrupted server-rendered head | **Fixed (built)** | Function-form replacement. Test. |
| L2 | Low | Lone `\r` could inject `.ics` properties | **Fixed (built)** | Escapes `\r\n`, `\r`, `\n`. |
| L3 | Low | `javascript:` URLs accepted for provider links; invalid timezones crashed a market | **Fixed (built)** | http(s)-only URLs; IANA timezone validation. Test. |
| L4 | Low | Admin responses cacheable; logout without CSRF header | **Fixed (built)** | `Cache-Control: no-store` on admin API; logout requires header. Test. |
| L5 | Low | PII (recipient, subject) in logs when email is not configured; error logs could echo addresses | **Fixed (built)** | Logs carry email kind and counts only. |
| L6 | Low | CSV export silently capped at 200 rows | **Fixed (built)** | Export up to 10,000 rows. |
| L7 | Low | `saveMarket` echoed raw errors | **Fixed (built)** | Only known validation messages are returned; others logged. |
| L8 | Low | Container runs as root with dev dependencies, `tsx` at runtime; `ADMIN_EMAIL` defaults to `admin@example.com` | **Open** | Multi-stage Dockerfile (compiled JS, non-root, prod deps); require `ADMIN_EMAIL` in production (check the live value first so the deploy can't fail). |
| L9 | Low | Anyone can post funnel events to skew analytics | Accepted (low impact) | Server-recorded conversions (leads, bookings) are authoritative; client events are directional. |
| L10 | Low | `node:sqlite` is experimental | Accepted (pilot) | Pin Node 22 in Docker; Postgres at Phase 5. |

**Preserve (done well):** parameterized SQL everywhere; Zod strips unknown fields; 256-bit booking tokens stored hashed and compared in constant time; `BEGIN IMMEDIATE` booking transactions; signed HttpOnly/SameSite=Strict/Secure cookies + CSRF header; production refuses weak secrets; escaped email templates and JSON-in-HTML; CSV formula-injection guard; idempotent email outbox.

## Compliance & legal review ⚖ (not resolved by software)

| ID | Area | Risk | Current control | Needed |
|---|---|---|---|---|
| C1 | **TCPA** (calls/texts) | Contacting leads by call/SMS, especially automated | Explicit unchecked-by-default consent checkbox, versioned wording, immutable consent evidence (IP, UA, time) | Counsel review of consent wording, especially "automated technology"; one-to-one consent per seller rules; quiet hours; 10DLC registration before any SMS; DNC scrub process |
| C2 | **CAN-SPAM** | Marketing email | Only transactional email today | Any marketing email needs separate consent, unsubscribe and physical address |
| C3 | FTC Act / Michigan Consumer Protection Act | Savings and pricing claims | No guaranteed savings; data-quality labels; hypothetical scenarios labelled | Review of savings copy, comparison methodology page and "from $X" claims |
| C4 | **Energy brokerage** (Michigan PSC alternative-electric-supplier rules) | Marketing electric supply, broker licensing, disclosures | Not built | Legal determination before any electricity offer or comparison goes live |
| C5 | **Solar** marketing & financing | Savings/financing representations, lending disclosures | Not built | Counsel review; screening-only flow until approved |
| C6 | Provider brand use / authorization | Using "Omni Fiber" name and pricing; partner disclosure | Independent-partner disclosure on every page; no logos | Written marketing authorization from each provider; record in `provider_partnerships` |
| C7 | Referral compensation disclosure | Broker conflicts of interest | Commission-blind ranking (built) | Publish `/how-we-make-money`; counsel-approved disclosure text |
| C8 | State privacy laws | Obligations differ by state and change frequently; expansion beyond Michigan adds more | Data minimization; notice; no sale | Counsel to confirm current Michigan obligations and each new state's before launch there; "Do not sell/share" handling |
| C9 | Accessibility (ADA) | Inaccessible flows | WCAG-oriented build; Lighthouse a11y 100 | Manual audit with assistive tech before launch |
