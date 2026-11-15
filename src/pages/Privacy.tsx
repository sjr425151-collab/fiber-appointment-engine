import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BRAND, CONSENT_TEXT, CONSENT_VERSION } from '../../shared/content';
import { Logo } from '../components/ui';

/**
 * Plain-language privacy notice describing what this site actually does.
 * Have counsel review before launch.
 */
export default function Privacy() {
  useEffect(() => {
    document.title = `Privacy Notice — ${BRAND.agency}`;
  }, []);

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
            This website is operated by {BRAND.agency}, an independent marketing partner of {BRAND.provider}. This notice explains what
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
              utm parameters or an ad click ID) and anonymous on-site events such as “checked a ZIP code” or “booked an appointment”. These use
              a random per-tab identifier, not cookies, and are not linked to advertising profiles.
            </li>
          </ul>

          <h2>How we use it</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>To check whether fiber service is available at your address.</li>
            <li>To contact you about fiber service and your consultation, using the contact details you provide.</li>
            <li>To understand which campaigns bring people to this site, so we can improve it.</li>
          </ul>
          <p>
            We do not sell your personal information. We share it only as needed to confirm service and arrange installation with {BRAND.provider}, or
            when required by law.
          </p>

          <h2>Calls and text messages</h2>
          <p>When you submit the form you agree to the following:</p>
          <blockquote className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">{CONSENT_TEXT}</blockquote>
          <p>Reply STOP to any text to opt out of texts. You can also ask us to stop calling or emailing you at any time.</p>

          <h2>Cookies</h2>
          <p>This site uses a single strictly-necessary cookie for team members who sign in to the admin area. Visitors are not tracked with cookies.</p>

          <h2>Security and retention</h2>
          <p>
            Your information is stored on access-controlled systems and transmitted over encrypted connections. We keep it only as long as needed to
            serve you and meet legal obligations.
          </p>

          <h2>Your choices</h2>
          <p>
            You can ask us to access, correct or delete your information, or to stop contacting you, by replying to any message we send you
            {BRAND.phoneDisplay ? ` or by calling ${BRAND.phoneDisplay}` : ''}.
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
