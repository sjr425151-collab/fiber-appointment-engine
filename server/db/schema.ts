/**
 * Database schema. Migrations are append-only: add a new entry to MIGRATIONS,
 * never edit one that has already shipped.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE service_areas (
        zip         TEXT PRIMARY KEY,
        city        TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('available','verify','coming_soon','not_serviceable')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE leads (
        id                  TEXT PRIMARY KEY,
        first_name          TEXT NOT NULL,
        last_name           TEXT NOT NULL,
        email               TEXT NOT NULL,
        phone               TEXT NOT NULL,
        street              TEXT NOT NULL,
        unit                TEXT NOT NULL DEFAULT '',
        city                TEXT NOT NULL,
        zip                 TEXT NOT NULL,
        preferred_contact   TEXT NOT NULL DEFAULT 'phone',
        current_provider    TEXT NOT NULL DEFAULT '',
        status              TEXT NOT NULL DEFAULT 'new',
        area_status         TEXT NOT NULL DEFAULT 'unknown',
        source              TEXT NOT NULL DEFAULT 'landing_page',
        utm_source          TEXT NOT NULL DEFAULT '',
        utm_medium          TEXT NOT NULL DEFAULT '',
        utm_campaign        TEXT NOT NULL DEFAULT '',
        booking_token_hash  TEXT NOT NULL,
        consent_text        TEXT NOT NULL,
        consent_at          TEXT NOT NULL,
        consent_ip          TEXT NOT NULL DEFAULT '',
        consent_user_agent  TEXT NOT NULL DEFAULT '',
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_leads_status ON leads(status);
      CREATE INDEX idx_leads_created ON leads(created_at);
      CREATE INDEX idx_leads_email_phone ON leads(email, phone);

      CREATE TABLE lead_notes (
        id          TEXT PRIMARY KEY,
        lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        body        TEXT NOT NULL,
        author      TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_notes_lead ON lead_notes(lead_id);

      CREATE TABLE appointments (
        id          TEXT PRIMARY KEY,
        lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        start_utc   TEXT NOT NULL,
        end_utc     TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','completed','no_show','cancelled')),
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_appt_start ON appointments(start_utc, status);
      CREATE INDEX idx_appt_lead ON appointments(lead_id);

      CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      );

      -- Phase 2 foundation: sales, installs, commissions ---------------------
      CREATE TABLE commission_rules (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('flat','percent_first_month','percent_mrc')),
        amount_cents  INTEGER NOT NULL DEFAULT 0,
        percent_bps   INTEGER NOT NULL DEFAULT 0,
        applies_to    TEXT NOT NULL DEFAULT 'all',
        trigger_event TEXT NOT NULL DEFAULT 'installed' CHECK (trigger_event IN ('sold','installed')),
        active        INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE sales (
        id                   TEXT PRIMARY KEY,
        lead_id              TEXT NOT NULL REFERENCES leads(id),
        plan_name            TEXT NOT NULL,
        monthly_price_cents  INTEGER NOT NULL DEFAULT 0,
        sold_at              TEXT NOT NULL,
        order_number         TEXT NOT NULL DEFAULT '',
        install_status       TEXT NOT NULL DEFAULT 'pending'
                             CHECK (install_status IN ('pending','scheduled','installed','cancelled')),
        install_date         TEXT,
        installed_at         TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );
      CREATE INDEX idx_sales_lead ON sales(lead_id);

      CREATE TABLE commissions (
        id            TEXT PRIMARY KEY,
        sale_id       TEXT NOT NULL REFERENCES sales(id),
        rule_id       TEXT NOT NULL REFERENCES commission_rules(id),
        amount_cents  INTEGER NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','clawed_back')),
        created_at    TEXT NOT NULL
      );

      -- Phase 3 foundation: AI content calendar ------------------------------
      CREATE TABLE content_posts (
        id            TEXT PRIMARY KEY,
        channel       TEXT NOT NULL DEFAULT 'facebook',
        scheduled_for TEXT NOT NULL,
        body          TEXT NOT NULL,
        image_prompt  TEXT NOT NULL DEFAULT '',
        image_url     TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','published','rejected')),
        created_at    TEXT NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: 'attribution_and_events',
    sql: `
      ALTER TABLE leads ADD COLUMN utm_content  TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN utm_term     TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN click_id     TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN referrer     TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN landing_page TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN session_id   TEXT NOT NULL DEFAULT '';

      -- First-party conversion events (no third-party trackers, no cookies).
      CREATE TABLE events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        session_id    TEXT NOT NULL DEFAULT '',
        path          TEXT NOT NULL DEFAULT '',
        props         TEXT NOT NULL DEFAULT '{}',
        utm_source    TEXT NOT NULL DEFAULT '',
        utm_campaign  TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_events_name_time ON events(name, created_at);
    `,
  },
  {
    id: 3,
    name: 'markets',
    sql: `
      -- One row per launch location. \`config\` holds the full validated Market JSON;
      -- name/state/active/is_default are duplicated as columns for querying.
      CREATE TABLE markets (
        slug        TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        state       TEXT NOT NULL,
        config      TEXT NOT NULL,
        active      INTEGER NOT NULL DEFAULT 1,
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- Existing data belongs to the Monroe launch market.
      ALTER TABLE leads         ADD COLUMN market_id TEXT NOT NULL DEFAULT 'monroe';
      ALTER TABLE appointments  ADD COLUMN market_id TEXT NOT NULL DEFAULT 'monroe';
      ALTER TABLE service_areas ADD COLUMN market_id TEXT NOT NULL DEFAULT 'monroe';
      ALTER TABLE events        ADD COLUMN market_id TEXT NOT NULL DEFAULT '';
      CREATE INDEX idx_leads_market ON leads(market_id, created_at);
      CREATE INDEX idx_appt_market_start ON appointments(market_id, start_utc, status);
      CREATE INDEX idx_areas_market ON service_areas(market_id);
    `,
  },
  {
    id: 4,
    name: 'notifications_outbox',
    sql: `
      -- Email outbox. Rows are rendered and sent by a background worker so a slow
      -- or failing email provider never blocks a visitor, and every send is logged.
      CREATE TABLE notifications (
        id              TEXT PRIMARY KEY,
        kind            TEXT NOT NULL,
        lead_id         TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        appointment_id  TEXT,
        market_id       TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sending','sent','logged','skipped','failed')),
        send_after      TEXT NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        to_addr         TEXT NOT NULL DEFAULT '',
        subject         TEXT NOT NULL DEFAULT '',
        provider_id     TEXT NOT NULL DEFAULT '',
        error           TEXT NOT NULL DEFAULT '',
        sent_at         TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_notifications_due ON notifications(status, send_after);
      CREATE INDEX idx_notifications_lead ON notifications(lead_id);
    `,
  },
  {
    id: 5,
    name: 'append_only_consents_and_duplicate_leads',
    sql: `
      -- TCPA evidence: one immutable row per form submission. Existing consent
      -- data on leads is copied in so no history is lost.
      CREATE TABLE consents (
        id            TEXT PRIMARY KEY,
        lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        consent_text  TEXT NOT NULL,
        ip            TEXT NOT NULL DEFAULT '',
        user_agent    TEXT NOT NULL DEFAULT '',
        source        TEXT NOT NULL DEFAULT 'lead_form',
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_consents_lead ON consents(lead_id, created_at);
      INSERT INTO consents (id, lead_id, consent_text, ip, user_agent, source, created_at)
        SELECT lower(hex(randomblob(16))), id, consent_text, consent_ip, consent_user_agent, 'lead_form', consent_at FROM leads;
      CREATE TRIGGER consents_append_only BEFORE UPDATE ON consents
        BEGIN SELECT RAISE(ABORT, 'consent records are append-only'); END;
      -- The original consent captured on a lead can never be rewritten.
      CREATE TRIGGER leads_consent_immutable BEFORE UPDATE OF consent_text, consent_at, consent_ip, consent_user_agent ON leads
        BEGIN SELECT RAISE(ABORT, 'lead consent fields are immutable'); END;

      -- A repeat submission becomes its own lead linked to the earlier one,
      -- instead of overwriting it (which let anyone who knew a person's email +
      -- phone take over their lead and appointment).
      ALTER TABLE leads ADD COLUMN duplicate_of TEXT;
      CREATE INDEX idx_leads_duplicate_of ON leads(duplicate_of);
    `,
  },
  {
    id: 6,
    name: 'household_assessments',
    sql: `
      -- Parent-platform household assessments. Contains bill amounts and
      -- providers but no name, contact details or street address (those only
      -- exist on a lead, when the person asks to be contacted).
      CREATE TABLE assessments (
        id                       TEXT PRIMARY KEY,
        token_hash               TEXT NOT NULL,
        zip                      TEXT NOT NULL,
        market_id                TEXT NOT NULL DEFAULT '',
        categories               TEXT NOT NULL,
        answers                  TEXT NOT NULL,
        analysis                 TEXT NOT NULL,
        analysis_version         TEXT NOT NULL,
        assumptions_version      TEXT NOT NULL,
        include_samples          INTEGER NOT NULL DEFAULT 0,
        status                   TEXT NOT NULL CHECK (status IN ('complete','incomplete')),
        current_monthly_cents    INTEGER,
        potential_savings_cents  INTEGER NOT NULL DEFAULT 0,
        projection_basis         TEXT NOT NULL DEFAULT 'current_only',
        lead_id                  TEXT REFERENCES leads(id) ON DELETE SET NULL,
        session_id               TEXT NOT NULL DEFAULT '',
        utm_source               TEXT NOT NULL DEFAULT '',
        utm_campaign             TEXT NOT NULL DEFAULT '',
        landing_page             TEXT NOT NULL DEFAULT '',
        referrer                 TEXT NOT NULL DEFAULT '',
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );
      CREATE INDEX idx_assessments_created ON assessments(created_at);
      CREATE INDEX idx_assessments_lead ON assessments(lead_id);
      ALTER TABLE leads ADD COLUMN assessment_id TEXT;
    `,
  },
  {
    id: 7,
    name: 'opportunities',
    sql: `
      -- One row per service a household asked for help with, as they selected
      -- it on the results page. Figures are copied from the deterministic
      -- analysis at request time (integer cents) so later catalog changes never
      -- rewrite what the customer saw.
      CREATE TABLE opportunities (
        id                       TEXT PRIMARY KEY,
        lead_id                  TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        assessment_id            TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        market_id                TEXT NOT NULL DEFAULT '',
        category                 TEXT NOT NULL,
        offer_id                 TEXT NOT NULL DEFAULT '',
        plan_name                TEXT NOT NULL,
        kind                     TEXT NOT NULL CHECK (kind IN ('verified','pending_address','sample','advisor')),
        is_estimate              INTEGER NOT NULL DEFAULT 0,
        current_monthly_cents    INTEGER,
        proposed_monthly_cents   INTEGER,
        monthly_savings_cents    INTEGER,
        five_year_savings_cents  INTEGER,
        status                   TEXT NOT NULL DEFAULT 'new'
                                 CHECK (status IN ('new','contacted','quoted','won','lost','not_eligible')),
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );
      CREATE INDEX idx_opportunities_lead ON opportunities(lead_id);
      CREATE INDEX idx_opportunities_status ON opportunities(status, created_at);
    `,
  },
  {
    id: 8,
    name: 'representative_handoff',
    sql: `
      -- People who receive leads. They sign in with their own password and see
      -- only the leads assigned to them. \`accepting\` is switched by a person;
      -- availability is never inferred.
      CREATE TABLE representatives (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        email           TEXT NOT NULL UNIQUE,
        phone           TEXT NOT NULL DEFAULT '',
        password_hash   TEXT NOT NULL DEFAULT '',
        active          INTEGER NOT NULL DEFAULT 1,
        accepting       INTEGER NOT NULL DEFAULT 0,
        markets         TEXT NOT NULL DEFAULT '["*"]',
        categories      TEXT NOT NULL DEFAULT '[]',
        max_open_leads  INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      -- Assignment, routing result and the preview the customer saw, on the lead.
      ALTER TABLE leads ADD COLUMN assigned_rep_id   TEXT;
      ALTER TABLE leads ADD COLUMN assigned_at       TEXT;
      ALTER TABLE leads ADD COLUMN routing_outcome   TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN routing_reason    TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN preview           TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN best_time         TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE leads ADD COLUMN first_contact_at  TEXT;
      -- One lead per submitted form, however many times the request is retried.
      ALTER TABLE leads ADD COLUMN request_key       TEXT;
      CREATE UNIQUE INDEX idx_leads_request_key ON leads(request_key) WHERE request_key IS NOT NULL;
      CREATE INDEX idx_leads_assigned ON leads(assigned_rep_id, status);
      CREATE INDEX idx_leads_phone ON leads(phone);

      -- Structured history of status changes and assignments (for timelines and funnel metrics).
      CREATE TABLE lead_history (
        id          TEXT PRIMARY KEY,
        lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('status','assignment')),
        from_value  TEXT NOT NULL DEFAULT '',
        to_value    TEXT NOT NULL DEFAULT '',
        detail      TEXT NOT NULL DEFAULT '',
        actor       TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_lead_history_lead ON lead_history(lead_id, created_at);
      CREATE INDEX idx_lead_history_kind ON lead_history(kind, to_value, created_at);
    `,
  },
];

/**
 * Seed data for the Monroe, MI launch market.
 * IMPORTANT: statuses are placeholders. 'verify' means "inside the target
 * market — exact address must be confirmed". Update via the admin Service
 * Areas screen once Omni Fiber confirms real coverage. Do not mark a ZIP
 * 'available' without confirmation from Omni Fiber.
 */
export const SEED_SERVICE_AREAS: { zip: string; city: string; status: string }[] = [
  { zip: '48161', city: 'Monroe', status: 'verify' },
  { zip: '48162', city: 'Monroe', status: 'verify' },
  { zip: '48166', city: 'Newport', status: 'coming_soon' },
  { zip: '48117', city: 'Carleton', status: 'coming_soon' },
  { zip: '48145', city: 'La Salle', status: 'coming_soon' },
  { zip: '48133', city: 'Erie', status: 'coming_soon' },
  { zip: '48159', city: 'Maybee', status: 'coming_soon' },
  { zip: '48179', city: 'South Rockwood', status: 'coming_soon' },
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  'schedule.slotMinutes': '60',
  'schedule.capacityPerSlot': '2',
  'schedule.openDays': '1,2,3,4,5,6', // 0 = Sunday
  'schedule.dayStart': '09:00',
  'schedule.dayEnd': '19:00',
  'schedule.minLeadHours': '12',
  'schedule.maxDaysAhead': '21',
};
