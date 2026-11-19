/**
 * Privacy notice: plain language, describing what this site actually does today.
 * Approved by the founder on 2026-11-19. Keep it in step with the code: if the
 * site starts collecting something new (for example an advertising pixel),
 * update this page in the same change. Have counsel review periodically.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '../../../shared/content';
import { handoffConsentText, marketingConsentText } from '../../../shared/platform/handoff';

export const PRIVACY_UPDATED = '2026-11-19';
const phoneText = BRAND.phone.length === 10 ? `(${BRAND.phone.slice(0, 3)}) ${BRAND.phone.slice(3, 6)}-${BRAND.phone.slice(6)}` : '';

export default function Privacy() {
  useEffect(() => {
    document.title = `Privacy Notice – ${BRAND.name}`;
  }, []);
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 leading-relaxed text-pf-muted sm:px-6 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-pf-ink [&_li]:pl-1 [&_strong]:text-pf-ink">
      <h1 className="font-display text-3xl font-bold text-pf-ink sm:text-4xl">Privacy notice</h1>
      <p className="mt-2 text-sm text-pf-subtle">Last updated {PRIVACY_UPDATED}</p>

      <div className="mt-6 space-y-4">
        <p>
          {BRAND.name} is operated by {BRAND.agency}. We are an independent broker for household services such as internet, mobile, TV, electricity and home security: we compare what you pay with illustrative prices and,
          if you ask, a {BRAND.name} representative helps you find real options. {BRAND.name} may receive compensation from providers. This notice explains what information we collect on this website, how we use it and
          the choices you have.
        </p>

        <h2>What we collect</h2>
        <ul className="list-disc space-y-3 pl-6">
          <li>
            <strong>Bills you enter.</strong> The monthly amounts you type into the savings preview, the number of mobile lines and whether you own your home. You can see a preview without giving any contact details. If
            you choose “Remember my answers on this device” in the full preview, your answers are stored only in your browser.
          </li>
          <li>
            <strong>Contact details you give us.</strong> When you ask for a pricing review: your first name, phone number and ZIP code, and optionally your email, how and when you’d like to be contacted, and anything
            else you choose to tell us. A representative may add details you share with them, such as your current providers.
          </li>
          <li>
            <strong>Chat messages.</strong> If you use the website chat, we store the conversation so it can continue if you leave the page and, if you ask for a representative, so they don’t have to ask you again. The
            chat assistant is an AI, not a person.
          </li>
          <li>
            <strong>Your consent record.</strong> The exact consent wording you agreed to, when you agreed, and your IP address and browser type at that moment, so we can show that you asked to be contacted.
          </li>
          <li>
            <strong>Visit information.</strong> The campaign link or website that brought you here (for example utm tags or an ad click ID such as fbclid or gclid) and simple on-site events such as “viewed the preview”.
            These use a random identifier for the browser tab, not cookies, and are not shared with advertising networks. If you ask for a review, they are saved with your request so we know which page or campaign
            helped.
          </li>
        </ul>

        <h2>How we use it</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>To show your savings preview. Figures are illustrative comparisons, not offers or guarantees.</li>
          <li>To have a {BRAND.name} representative contact you about your request, in the way you chose, and help you compare and switch services if you decide to.</li>
          <li>To keep a record of your request and consent, and to meet our legal obligations.</li>
          <li>To understand which pages and campaigns work, so we can improve the site.</li>
        </ul>
        <p>We do not sell your personal information, and we do not use it to make automated decisions about you.</p>

        <h2>Who we share it with</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>{BRAND.name} representatives</strong> working on behalf of {BRAND.agency}, who see only the requests assigned to them.
          </li>
          <li>
            <strong>Service providers</strong> that run the site for us and may only use information to do so: Render (hosting and data storage), Cloudflare (domain and network security), Resend (sending emails) and,
            when the chat uses AI to word its replies, Anthropic (processing chat messages). Savings figures are always calculated by our own system, never by AI.
          </li>
          <li>
            <strong>Internet, phone, TV, energy or security providers</strong>, only when you ask us to help you get service from them, and only what they need.
          </li>
          <li>When required by law, or to protect our rights or someone’s safety.</li>
        </ul>

        <h2>Calls and text messages</h2>
        <p>When you ask for a pricing review, you agree to the following:</p>
        <blockquote className="rounded-xl border border-pf-line bg-pf-surface p-4 text-sm text-pf-ink">{handoffConsentText()}</blockquote>
        <p>If you also tick the optional box, you agree to this, separately:</p>
        <blockquote className="rounded-xl border border-pf-line bg-pf-surface p-4 text-sm text-pf-ink">{marketingConsentText()}</blockquote>
        <p>Reply STOP to any text to opt out of texts. You can ask us to stop calling or emailing you at any time, and we will record that you don’t want to be contacted.</p>

        <h2>Cookies and your browser</h2>
        <p>
          Visitors are not tracked with cookies, and this site does not currently use advertising pixels. If that changes, we will update this notice first. The only cookie is a strictly necessary one for team members
          who sign in. Your browser keeps small items for you on your own device: an open chat (for up to 7 days) and, if you choose, your saved preview answers. Clearing your browser’s site data removes them.
        </p>

        <h2>How long we keep it</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Your request, the representative’s notes and your consent record: while we are helping you and as long as needed for legal and compliance purposes.</li>
          <li>Chat conversations that did not become a request: deleted automatically after 90 days.</li>
          <li>Site-visit events: deleted automatically after about 13 months.</li>
        </ul>

        <h2>Security</h2>
        <p>
          Information is sent over encrypted connections and stored on access-controlled systems. Team members sign in with their own accounts, and representatives can only see the requests assigned to them. Changes to a
          request are recorded with who made them.
        </p>

        <h2>Your choices</h2>
        <p>
          You can ask us to show you, correct or delete your information, or to stop contacting you, by replying to any message we send you
          {phoneText ? (
            <>
              {' '}
              or by calling{' '}
              <a href={`tel:+1${BRAND.phone}`} className="font-semibold text-pf-brand underline underline-offset-4">
                {phoneText}
              </a>
            </>
          ) : null}
          . We may need to confirm it’s you first, and we may keep a consent record or other information when the law requires it.
        </p>

        <h2>Children</h2>
        <p>This site is for adults arranging household services. It is not directed to children under 18, and we don’t knowingly collect their information.</p>

        <h2>Changes to this notice</h2>
        <p>We will update this page when what we collect or how we use it changes, and change the date at the top.</p>

        <p className="pt-6">
          <Link to="/" className="font-semibold text-pf-brand underline underline-offset-4">
            ← Back to the home page
          </Link>
        </p>
      </div>
    </article>
  );
}
