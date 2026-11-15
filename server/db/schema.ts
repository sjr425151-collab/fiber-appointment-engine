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
