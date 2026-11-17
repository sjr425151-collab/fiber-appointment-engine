# 19 · Agent Workspace

Status: **Built & tested, not deployed** (pushed with `[skip render]`; migration 13 rehearsed on a database created by the live commit `c91d2b3`).

The representative experience inside the existing team area (`/admin`). It uses the same sign-in, lead records, routing, consent and chat transcripts as before; nothing is a second CRM.

## Roles (server-enforced on every route)
| Role | Who | Sees | Can |
|---|---|---|---|
| Representative | a representative with role `rep` | only leads assigned to them; their own follow-ups | edit contact details, record dispositions, notes, follow-ups, service details |
| Sales manager | a representative with role `manager` (Admin → Representatives → Role) | every lead and follow-up | everything above, plus reassign (one or many), reopen closed leads, lift Do Not Contact with a reason, confirm verified wins |
| Admin | the owner account | everything | everything above, plus configuration screens |

Anything outside a person's scope answers "not found". Hiding a button is never the only protection.

## Screens
- **Overview** (`/admin/work`, where representatives and managers land): next best actions, follow-ups due, notifications, recently viewed leads, and KPIs with their definitions.
- **Leads** (`/admin/leads`): queues (new, uncontacted, follow-up due, interested, qualified, consultations, awaiting provider verification, won, lost, and unassigned for managers), search by name, phone, email or lead ID, filters, sort, server-side paging. Managers can bulk-assign; admins can export CSV. The view is kept in the address and remembered on the device.
- **Lead profile** (`/admin/leads/:id`):
  - header with stage, latest disposition, qualification, outcome, owner, last activity, next follow-up, main service and illustrative savings
  - actions: Call, Text and Email open the phone's own apps (nothing is sent or logged automatically), plus Add note, Follow-up and Update status
  - contact details edited in place, with a version check: a conflicting edit is shown and never silently overwritten
  - household services: what the customer typed, the illustrative comparison from that moment, and what the representative recorded, kept separate
  - notes with categories, pinning, search, edit and archive (never deleted)
  - follow-ups, and a filterable activity timeline
  - chat transcript, possible duplicates, appointments, opportunities, assessment, consent, emails and source
  - on phones the main actions sit in a bar at the bottom; on desktop there are shortcuts (D status, F follow-up, N note) and "Next lead" walks the list the person came from
- **Follow-ups** (`/admin/follow-ups`): overdue, due today, upcoming and completed (14 days), in the viewer's time zone, with Done, Reschedule and Open lead.
- **Notifications**: in-app bell for representatives and managers; a lead assignment notifies its new owner once.

## Lead facts and dispositions
Five separate fields (rules in `shared/team/workspace.ts`, `applyDisposition`):
1. **Stage** (`status`, the existing pipeline). Dispositions only move it forward.
2. **Latest disposition**: contact, interest, qualification, outcome and administrative groups.
3. **Qualification**: not assessed, pending, serviceability check needed, qualified, not qualified, ineligible.
4. **Outcome**: open, won, lost, duplicate, invalid, spam. A closed lead takes no more dispositions until a manager reopens it, with a reason.
5. **Follow-up state**: the earliest open follow-up (`next_follow_up_at`).

Safeguards:
- **Wins need verification.** "Provider order submitted" needs the provider's reference. "Activation confirmed" and "Closed – won" also need a manager or admin.
- **Do Not Contact** blocks call, message and appointment follow-ups and hides Call and Text. Only a manager can lift it, with a reason.
- **Follow-up times.** "Callback requested", "Consultation scheduled" and "Representative follow-up needed" require a date and time. Other dispositions suggest a next step that the representative can accept or dismiss.
- **No double saves.** Every save carries a request ID, so a double tap or a retry after a dropped connection is applied once.

## Data (migration 13, additive)
- `leads` gets:
  - `preferred_name`, `household_notes`
  - `disposition` and `disposition_at`
  - `qualification` and `qualified_at`
  - `outcome` and `outcome_at`
  - `do_not_contact`, `next_follow_up_at`, `last_activity_at`
  - `version`, which goes up on every change
  - indexes on owner + next follow-up, disposition and email
- Existing leads are backfilled:
  - closed stages get a Lost outcome
  - qualified and later stages are marked qualified
  - converted and installed leads are **not** marked won, because no verification was recorded
- `lead_events`: an append-only timeline (an update trigger refuses changes). It holds dispositions, contact edits (before and after), note edits and archives, follow-ups, service details, reopenings and Do Not Contact changes. Each row has the actor and whether it was a person or the system. The pair (lead_id, request_id) is unique.
- `lead_notes` gets kind (person or system), category, pinned, and edited and archived fields. Earlier system lines are labelled as system.
- `tasks` gets type, priority, notes, the time zone it was scheduled in, and a reschedule count.
- `lead_services`: what a representative recorded per service (provider, monthly cents, plan, concerns and validated details).
- **Reassignment rule:** open follow-ups belong to the lead's owner. When a lead changes hands, they move with it and the new owner is notified, whether the change comes from routing, one lead or bulk.

## KPIs
Every KPI has a definition shown on the Overview (`KPI_DEFINITIONS`).
- Counts are unique leads from stored data.
- Conversion rates use the cohort of leads assigned in the period: contacted → qualified → verified win.
- A positive conversation is never counted as a sale.
- Next best actions follow fixed, documented rules and show the rule that put each item in the list. There is no invented score.

## Not built yet (deliberately)
- Calling, SMS and email sending: no telephony or messaging service is connected. The buttons open the device's own apps and do not log anything; the representative records what happened.
- Message templates, opt-out handling and quiet hours, which come with a messaging integration.
- Merging duplicates: suspected duplicates (same last 10 phone digits or same email) are listed for review and never merged automatically.
- Saved custom views beyond the remembered filters; a unified conversations inbox; team-level manager scope (managers currently see every lead); management reports by source, response time and lead aging; configurable routing rules in the UI.
- The team area keeps its existing dark theme; moving it to the white and blue public style is a separate change.

## Tests
- `tests/workspace.test.ts`: disposition rules, verification, time-zone buckets including daylight saving, the full acceptance scenario through the API, contact edit conflicts, note permissions and history, Do Not Contact, reopen, reassignment moving follow-ups and notifying, search and duplicates, service details, scope and role refusals.
- `tests/e2e/workspace.e2e.ts`: the acceptance scenario in a browser, with a representative on a phone and a manager on a desktop, accessibility checks and no horizontal scroll.
