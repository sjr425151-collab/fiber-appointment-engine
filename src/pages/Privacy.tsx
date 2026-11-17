import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BRAND, CONSENT_VERSION, consentText } from '../../shared/content';
import { useMarketState } from '../lib/market';
import { Spinner } from '../components/ui';
import { Logo } from '../components/ui';

/**
 * Plain-language privacy notice describing what this site actually does.
 * Have counsel review before launch.
 */
export default function Privacy() {
  // Provider wording follows the default location (embedded in the page, so normally instant).
  const state = useMarketState();
  useEffect(() => {
    document.title = `Privacy Notice — ${BRAND.name}`;
  }, []);
  if (state.status !== 'ready') {
    return (
      <div className="grid min-h-screen place-items-center text-slate-400">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  const m = state.market;

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link to="/" aria-label="Back to home">
          <Logo />
        </Link>
        <main className="mt-10 space-y-6 leading-relaxed text-slate-300 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white">
          <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">Privacy notice</h1>
          <p className="text-sm text-slate-400">Last updated {CONSENT_VERSION}</p>
          <p>
            This website ({BRAND.name}) is operated by {BRAND.agency}, an independent broker for household services such as internet, mobile, TV and electricity. We work as a marketing partner of providers including {m.provider}. This notice explains what
            information we collect when you use this site and how we use it.
          </p>

          <h2>What we collect</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong className="text-white">Information you give us:</strong> name, phone number, email, service address, preferred contact
              method, optional current provider, and any appointment notes.
            </li>
            <li>
              <strong className="text-white">Consent record:</strong> the consent wording you agreed to, when you agreed, and your IP address
              and browser type at that moment, so we can show that you asked to be contacted.
            </li>
            <li>
              <strong className="text-white">Visit information:</strong> the campaign link or website that referred you (for example,
              utm parameters or an ad click ID) and on-site events such as “checked a ZIP code” or “booked an appointment”. These use a random
              per-tab identifier instead of cookies and are not shared with advertising networks. If you submit the form, that identifier is
              saved with your request so we can see which page and campaign brought you to us.
            </li>
          </ul>

          <h2>How we use it</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>To prepare your savings preview and check which services are available at your address.</li>
            <li>To contact you about the services you asked about and any appointment you book, using the contact details you provide.</li>
            <li>To understand which campaigns bring people to this site, so we can improve it.</li>
          </ul>
          <p>
            We do not sell your personal information. We share it only as needed to confirm service and arrange installation with {m.provider}, or
            when required by law.
          </p>
          <p>
            We use service providers to run this site: Render (website hosting and data storage), Cloudflare (domain and network security) and
            Resend (sending appointment emails). They process information only to provide those services to us.
          </p>

          <h2>Calls and text messages</h2>
          <p>When you submit the form you agree to the following:</p>
          <blockquote className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">{consentText(m)}</blockquote>
          <p>Reply STOP to any text to opt out of texts. You can also ask us to stop calling or emailing you at any time.</p>

          <h2>Cookies</h2>
          <p>This site uses a single strictly-necessary cookie for team members who sign in to the admin area. Visitors are not tracked with cookies.</p>

          <h2>Security and retention</h2>
          <p>
            Your information is stored on access-controlled systems and transmitted over encrypted connections. We keep your request and the
            record of your contact consent while we’re helping you and as long as needed for legal and compliance purposes, and we delete or
            de-identify information when you ask us to unless we’re required to keep it. Basic site-visit events are automatically deleted
            after about 13 months.
          </p>

          <h2>Your choices</h2>
          <p>
            You can ask us to access, correct or delete your information, or to stop contacting you, by replying to any message we send you
            {m.phoneDisplay ? ` or by calling or texting ${m.phoneDisplay}` : ''}.
          </p>

          <p className="pt-6">
            <Link to="/" className="text-cyan-200 underline underline-offset-4">
              ← Back to the home page
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}
