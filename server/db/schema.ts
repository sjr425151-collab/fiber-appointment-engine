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
  {
    id: 9,
    name: 'team_portal',
    sql: `
      -- Team members. The representatives table becomes the directory of everyone
      -- who signs in to the team area (one table, no second user store).
      ALTER TABLE representatives ADD COLUMN role              TEXT NOT NULL DEFAULT 'rep';
      ALTER TABLE representatives ADD COLUMN status            TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE representatives ADD COLUMN team_id           TEXT;
      ALTER TABLE representatives ADD COLUMN rep_code          TEXT;
      ALTER TABLE representatives ADD COLUMN mfa_secret        TEXT NOT NULL DEFAULT '';
      ALTER TABLE representatives ADD COLUMN mfa_pending       TEXT NOT NULL DEFAULT '';
      ALTER TABLE representatives ADD COLUMN mfa_enabled       INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE representatives ADD COLUMN last_login_at     TEXT;
      ALTER TABLE representatives ADD COLUMN session_epoch     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE representatives ADD COLUMN failed_logins     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE representatives ADD COLUMN locked_until      TEXT;
      ALTER TABLE representatives ADD COLUMN email_verified_at TEXT;
      UPDATE representatives SET status = CASE WHEN active = 1 THEN 'active' ELSE 'deactivated' END;
      UPDATE representatives SET rep_code = 'R-' || (1000 + rowid);
      CREATE UNIQUE INDEX idx_reps_code ON representatives(rep_code) WHERE rep_code IS NOT NULL;
      CREATE INDEX idx_reps_team ON representatives(team_id);

      CREATE TABLE teams (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        manager_id  TEXT REFERENCES representatives(id),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- One-time links to activate an account or set a new password. Only the hash is stored.
      CREATE TABLE invitations (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES representatives(id) ON DELETE CASCADE,
        purpose     TEXT NOT NULL CHECK (purpose IN ('activate','reset')),
        token_hash  TEXT NOT NULL UNIQUE,
        expires_at  TEXT NOT NULL,
        used_at     TEXT,
        revoked_at  TEXT,
        created_by  TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_invitations_user ON invitations(user_id, created_at);

      -- Who did what. Rows can be added and never changed or removed.
      CREATE TABLE audit_events (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        actor          TEXT NOT NULL,
        actor_role     TEXT NOT NULL,
        action         TEXT NOT NULL,
        resource_type  TEXT NOT NULL DEFAULT '',
        resource_id    TEXT NOT NULL DEFAULT '',
        detail         TEXT NOT NULL DEFAULT '{}',
        ip             TEXT NOT NULL DEFAULT '',
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_audit_time ON audit_events(created_at);
      CREATE INDEX idx_audit_resource ON audit_events(resource_type, resource_id);
      CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
      CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;

      -- Things a person recorded as having happened with a customer (never generated).
      CREATE TABLE lead_activities (
        id           TEXT PRIMARY KEY,
        lead_id      TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        kind         TEXT NOT NULL CHECK (kind IN ('call','email','text','meeting','offer','other')),
        outcome      TEXT NOT NULL DEFAULT '',
        body         TEXT NOT NULL DEFAULT '',
        actor        TEXT NOT NULL,
        occurred_at  TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_activities_lead ON lead_activities(lead_id, occurred_at);

      -- Follow-ups.
      CREATE TABLE tasks (
        id           TEXT PRIMARY KEY,
        lead_id      TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        assignee_id  TEXT NOT NULL DEFAULT '',
        title        TEXT NOT NULL,
        due_at       TEXT NOT NULL,
        done_at      TEXT,
        done_by      TEXT NOT NULL DEFAULT '',
        created_by   TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_tasks_assignee ON tasks(assignee_id, done_at, due_at);
      CREATE INDEX idx_tasks_lead ON tasks(lead_id);

      -- In-app notifications. dedupe_key stops the same event alerting twice.
      CREATE TABLE user_notifications (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        kind        TEXT NOT NULL,
        title       TEXT NOT NULL,
        lead_id     TEXT,
        dedupe_key  TEXT NOT NULL UNIQUE,
        read_at     TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_user_notifications ON user_notifications(user_id, read_at, created_at);

      -- Internal catalog of providers and what they sell. Nothing here is shown
      -- to customers; public offers still come from Locations.
      CREATE TABLE providers (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL UNIQUE,
        categories          TEXT NOT NULL DEFAULT '[]',
        partnership_status  TEXT NOT NULL DEFAULT 'researching'
                            CHECK (partnership_status IN ('researching','contacted','negotiating','contracted','active','paused','terminated')),
        order_method        TEXT NOT NULL DEFAULT '',
        coverage            TEXT NOT NULL DEFAULT '',
        notes               TEXT NOT NULL DEFAULT '',
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE TABLE products (
        id                 TEXT PRIMARY KEY,
        provider_id        TEXT NOT NULL REFERENCES providers(id),
        category           TEXT NOT NULL,
        name               TEXT NOT NULL,
        price_cents        INTEGER NOT NULL,
        promo_price_cents  INTEGER,
        promo_months       INTEGER NOT NULL DEFAULT 0,
        fees_note          TEXT NOT NULL DEFAULT '',
        eligibility        TEXT NOT NULL DEFAULT '',
        effective_from     TEXT NOT NULL,
        effective_to       TEXT,
        active             INTEGER NOT NULL DEFAULT 1,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_products_provider ON products(provider_id, active);

      -- Opportunity pipeline. The older coarse status stays for existing screens.
      ALTER TABLE opportunities ADD COLUMN stage                   TEXT NOT NULL DEFAULT 'identified';
      ALTER TABLE opportunities ADD COLUMN provider_id             TEXT;
      ALTER TABLE opportunities ADD COLUMN product_id              TEXT;
      ALTER TABLE opportunities ADD COLUMN qualification           TEXT NOT NULL DEFAULT 'unverified';
      ALTER TABLE opportunities ADD COLUMN offer_source            TEXT NOT NULL DEFAULT '';
      ALTER TABLE opportunities ADD COLUMN offer_expires_on        TEXT;
      ALTER TABLE opportunities ADD COLUMN expected_activation_on  TEXT;
      ALTER TABLE opportunities ADD COLUMN notes                   TEXT NOT NULL DEFAULT '';
      ALTER TABLE opportunities ADD COLUMN created_by              TEXT NOT NULL DEFAULT 'customer';
      UPDATE opportunities SET stage = CASE status
        WHEN 'won' THEN 'activated' WHEN 'lost' THEN 'declined' WHEN 'not_eligible' THEN 'not_qualified'
        WHEN 'quoted' THEN 'offer_presented' WHEN 'contacted' THEN 'qualification_pending' ELSE 'identified' END;
      CREATE INDEX idx_opportunities_stage ON opportunities(stage, created_at);

      -- Commission rules gain effective dates, targets and the payout split.
      -- (The table existed unused since the first release; rows are never edited once used.)
      ALTER TABLE commission_rules ADD COLUMN category                TEXT NOT NULL DEFAULT '';
      ALTER TABLE commission_rules ADD COLUMN provider_id             TEXT;
      ALTER TABLE commission_rules ADD COLUMN product_id              TEXT;
      ALTER TABLE commission_rules ADD COLUMN rep_amount_cents        INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE commission_rules ADD COLUMN rep_share_bps           INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE commission_rules ADD COLUMN manager_override_cents  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE commission_rules ADD COLUMN effective_from          TEXT NOT NULL DEFAULT '2000-01-01';
      ALTER TABLE commission_rules ADD COLUMN effective_to            TEXT;
      ALTER TABLE commission_rules ADD COLUMN created_by              TEXT NOT NULL DEFAULT '';

      CREATE TABLE orders (
        id                       TEXT PRIMARY KEY,
        order_no                 TEXT NOT NULL UNIQUE,
        lead_id                  TEXT NOT NULL REFERENCES leads(id),
        opportunity_id           TEXT NOT NULL REFERENCES opportunities(id),
        rep_id                   TEXT,
        category                 TEXT NOT NULL,
        provider_id              TEXT NOT NULL REFERENCES providers(id),
        product_id               TEXT REFERENCES products(id),
        product_name             TEXT NOT NULL,
        monthly_price_cents      INTEGER,
        submission_channel       TEXT NOT NULL DEFAULT '',
        external_ref             TEXT NOT NULL DEFAULT '',
        status                   TEXT NOT NULL DEFAULT 'draft',
        submitted_at             TEXT,
        activated_at             TEXT,
        completed_at             TEXT,
        cancellation_reason      TEXT NOT NULL DEFAULT '',
        provider_confirmed       INTEGER NOT NULL DEFAULT 0,
        rule_id                  TEXT,
        expected_provider_cents  INTEGER,
        received_provider_cents  INTEGER,
        received_at              TEXT,
        received_ref             TEXT NOT NULL DEFAULT '',
        idempotency_key          TEXT,
        version                  INTEGER NOT NULL DEFAULT 0,
        created_by               TEXT NOT NULL,
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_orders_idem ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
      -- The same provider reference can never be recorded on two orders.
      CREATE UNIQUE INDEX idx_orders_extref ON orders(provider_id, external_ref) WHERE external_ref <> '';
      CREATE INDEX idx_orders_lead ON orders(lead_id);
      CREATE INDEX idx_orders_rep ON orders(rep_id, status);
      CREATE INDEX idx_orders_status ON orders(status, created_at);
      CREATE INDEX idx_orders_opportunity ON orders(opportunity_id);

      CREATE TABLE order_events (
        id           TEXT PRIMARY KEY,
        order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        from_status  TEXT NOT NULL DEFAULT '',
        to_status    TEXT NOT NULL,
        note         TEXT NOT NULL DEFAULT '',
        evidence     TEXT NOT NULL DEFAULT '',
        actor        TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_order_events ON order_events(order_id, created_at);

      -- Payout batches. A batch is approved and then recorded as paid by a person;
      -- the system never moves money.
      CREATE TABLE payout_batches (
        id                 TEXT PRIMARY KEY,
        batch_no           TEXT NOT NULL UNIQUE,
        period_from        TEXT NOT NULL,
        period_to          TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','void')),
        total_cents        INTEGER NOT NULL DEFAULT 0,
        approved_by        TEXT NOT NULL DEFAULT '',
        approved_at        TEXT,
        paid_at            TEXT,
        payment_reference  TEXT NOT NULL DEFAULT '',
        created_by         TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );

      -- Earnings ledger: one row per amount owed to (or taken back from) a person.
      -- Amounts are never edited; corrections are new rows.
      CREATE TABLE earnings (
        id              TEXT PRIMARY KEY,
        order_id        TEXT REFERENCES orders(id),
        beneficiary_id  TEXT NOT NULL,
        kind            TEXT NOT NULL CHECK (kind IN ('rep_commission','manager_override','bonus','adjustment','chargeback')),
        rule_id         TEXT,
        amount_cents    INTEGER NOT NULL,
        state           TEXT NOT NULL CHECK (state IN ('projected','pending','earned','approved','payable','paid','reversed')),
        reverses_id     TEXT,
        payout_id       TEXT REFERENCES payout_batches(id),
        note            TEXT NOT NULL DEFAULT '',
        created_by      TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_earnings_beneficiary ON earnings(beneficiary_id, state);
      CREATE INDEX idx_earnings_order ON earnings(order_id);
      CREATE INDEX idx_earnings_payout ON earnings(payout_id);
      -- One commission and one override per order per person: reprocessing can never double an earning.
      CREATE UNIQUE INDEX idx_earnings_once ON earnings(order_id, beneficiary_id, kind) WHERE kind IN ('rep_commission','manager_override');
      -- A paid commission can be charged back once.
      CREATE UNIQUE INDEX idx_earnings_chargeback ON earnings(reverses_id) WHERE reverses_id IS NOT NULL;
      -- An estimate ("projected") may follow the order's price; once it is pending or later the amount is fixed.
      CREATE TRIGGER earnings_amount_immutable BEFORE UPDATE OF amount_cents, order_id, beneficiary_id, kind ON earnings
        WHEN OLD.state <> 'projected' OR NEW.order_id IS NOT OLD.order_id OR NEW.beneficiary_id <> OLD.beneficiary_id OR NEW.kind <> OLD.kind
        BEGIN SELECT RAISE(ABORT, 'earning amounts are immutable; add an adjustment instead'); END;
      CREATE TRIGGER earnings_no_delete BEFORE DELETE ON earnings BEGIN SELECT RAISE(ABORT, 'earnings are never deleted'); END;
    `,
  },
  {
    id: 10,
    name: 'benchmark_versions',
    sql: `
      -- The national comparison benchmarks, one row per published set. The newest
      -- row is the one in use. Rows are never edited: restoring an old set
      -- publishes it again as a new row, so history stays complete.
      CREATE TABLE benchmark_versions (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        version                  TEXT NOT NULL UNIQUE,
        internet_cents           INTEGER NOT NULL,
        mobile_per_line_cents    INTEGER NOT NULL,
        tv_cents                 INTEGER NOT NULL,
        electricity_solar_cents  INTEGER NOT NULL,
        note                     TEXT NOT NULL DEFAULT '',
        published_by             TEXT NOT NULL,
        published_at             TEXT NOT NULL
      );
      INSERT INTO benchmark_versions (version, internet_cents, mobile_per_line_cents, tv_cents, electricity_solar_cents, note, published_by, published_at)
        VALUES ('2026-11-17.1', 5500, 4500, 7500, 20000, 'Starting values set by the owner', 'system', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      CREATE TRIGGER benchmark_versions_no_update BEFORE UPDATE ON benchmark_versions BEGIN SELECT RAISE(ABORT, 'benchmark versions are never edited'); END;
      CREATE TRIGGER benchmark_versions_no_delete BEFORE DELETE ON benchmark_versions BEGIN SELECT RAISE(ABORT, 'benchmark versions are never deleted'); END;
    `,
  },
  {
    id: 11,
    name: 'benchmark_security',
    sql: `
      -- Home security joins the benchmarks. Existing versions get the owner's $80 starting value.
      ALTER TABLE benchmark_versions ADD COLUMN security_cents INTEGER NOT NULL DEFAULT 8000;
    `,
  },
  {
    id: 12,
    name: 'chat_assistant',
    sql: `
      -- Website chat with Tucker's assistant. A visitor is anonymous until they
      -- ask for a representative; the session is readable only with its token.
      CREATE TABLE chat_sessions (
        id                 TEXT PRIMARY KEY,
        token_hash         TEXT NOT NULL,
        state              TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','previewed','handoff')),
        lead_id            TEXT REFERENCES leads(id) ON DELETE SET NULL,
        user_messages      INTEGER NOT NULL DEFAULT 0,
        ai_calls           INTEGER NOT NULL DEFAULT 0,
        ai_failures        INTEGER NOT NULL DEFAULT 0,
        ai_input_tokens    INTEGER NOT NULL DEFAULT 0,
        ai_output_tokens   INTEGER NOT NULL DEFAULT 0,
        ai_ms              INTEGER NOT NULL DEFAULT 0,
        landing_page       TEXT NOT NULL DEFAULT '',
        utm_source         TEXT NOT NULL DEFAULT '',
        utm_campaign       TEXT NOT NULL DEFAULT '',
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_chat_sessions_created ON chat_sessions(created_at);
      CREATE INDEX idx_chat_sessions_lead ON chat_sessions(lead_id);

      CREATE TABLE chat_messages (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
        body        TEXT NOT NULL,
        card        TEXT NOT NULL DEFAULT '',
        client_id   TEXT,
        source      TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);
      -- The same message sent twice (retry, double tap) is stored once.
      CREATE UNIQUE INDEX idx_chat_messages_client ON chat_messages(session_id, client_id) WHERE client_id IS NOT NULL;
    `,
  },
  {
    id: 13,
    name: 'agent_workspace',
    sql: `
      -- The five separate facts about a lead (see shared/team/workspace.ts), plus
      -- editable contact extras and a version number for safe concurrent edits.
      ALTER TABLE leads ADD COLUMN preferred_name     TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN household_notes    TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN disposition        TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN disposition_at     TEXT;
      ALTER TABLE leads ADD COLUMN qualification      TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE leads ADD COLUMN qualified_at       TEXT;
      ALTER TABLE leads ADD COLUMN outcome            TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN outcome_at         TEXT;
      ALTER TABLE leads ADD COLUMN do_not_contact     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE leads ADD COLUMN next_follow_up_at  TEXT;
      ALTER TABLE leads ADD COLUMN last_activity_at   TEXT;
      ALTER TABLE leads ADD COLUMN version            INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX idx_leads_followup ON leads(assigned_rep_id, next_follow_up_at);
      CREATE INDEX idx_leads_disposition ON leads(disposition);
      CREATE INDEX idx_leads_email ON leads(email);

      -- Existing leads: closed stages get a Lost outcome; qualification follows the stage and its history.
      -- Converted or installed leads are NOT marked won: no verification was recorded for them.
      UPDATE leads SET outcome = 'lost', outcome_at = updated_at WHERE status IN ('not_interested','unserviceable','lost');
      UPDATE leads SET qualification = 'qualified',
        qualified_at = COALESCE((SELECT MIN(h.created_at) FROM lead_history h WHERE h.lead_id = leads.id AND h.kind = 'status' AND h.to_value = 'qualified'), updated_at)
        WHERE status IN ('qualified','sold','install_scheduled','installed');
      UPDATE leads SET last_activity_at = updated_at;

      -- Everything that happens to a lead that is not already in lead_history: dispositions,
      -- contact edits, notes, follow-ups, reopenings. Append-only; request_id makes repeats harmless.
      CREATE TABLE lead_events (
        id          TEXT PRIMARY KEY,
        lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        code        TEXT NOT NULL DEFAULT '',
        title       TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT '',
        actor       TEXT NOT NULL,
        actor_type  TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','system')),
        request_id  TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_lead_events_lead ON lead_events(lead_id, created_at);
      CREATE INDEX idx_lead_events_kind ON lead_events(kind, code, created_at);
      CREATE UNIQUE INDEX idx_lead_events_request ON lead_events(lead_id, request_id) WHERE request_id IS NOT NULL;
      CREATE TRIGGER lead_events_no_update BEFORE UPDATE ON lead_events BEGIN SELECT RAISE(ABORT, 'lead events are append-only'); END;

      -- Notes: categories, pinning, edits and archiving (never deleted). System lines are told apart from people's notes.
      ALTER TABLE lead_notes ADD COLUMN kind         TEXT NOT NULL DEFAULT 'note';
      ALTER TABLE lead_notes ADD COLUMN category     TEXT NOT NULL DEFAULT 'general';
      ALTER TABLE lead_notes ADD COLUMN pinned       INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE lead_notes ADD COLUMN edited_at    TEXT;
      ALTER TABLE lead_notes ADD COLUMN edited_by    TEXT NOT NULL DEFAULT '';
      ALTER TABLE lead_notes ADD COLUMN archived_at  TEXT;
      ALTER TABLE lead_notes ADD COLUMN archived_by  TEXT NOT NULL DEFAULT '';
      UPDATE lead_notes SET kind = 'system' WHERE author = 'system' OR body LIKE 'Status changed:%' OR body LIKE 'Assigned to %' OR body LIKE 'Not assigned %'
        OR body LIKE 'Opportunity %' OR body LIKE 'Submitted the form again%' OR body LIKE 'Repeat submission%';

      -- Follow-ups: type, priority, notes and the time zone they were scheduled in.
      ALTER TABLE tasks ADD COLUMN kind        TEXT NOT NULL DEFAULT 'general';
      ALTER TABLE tasks ADD COLUMN priority    TEXT NOT NULL DEFAULT 'normal';
      ALTER TABLE tasks ADD COLUMN notes       TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN time_zone   TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN reschedules INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_tasks_open_due ON tasks(done_at, due_at);

      -- What a representative learned about each service (separate from what the customer typed into the preview).
      CREATE TABLE lead_services (
        lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        category       TEXT NOT NULL CHECK (category IN ('internet','mobile','tv','electricity','security')),
        provider       TEXT NOT NULL DEFAULT '',
        monthly_cents  INTEGER,
        plan           TEXT NOT NULL DEFAULT '',
        concerns       TEXT NOT NULL DEFAULT '',
        details        TEXT NOT NULL DEFAULT '{}',
        updated_by     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        PRIMARY KEY (lead_id, category)
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
