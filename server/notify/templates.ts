import { BRAND, place } from '../../shared/content';
import type { Market } from '../../shared/market';
import type { Appointment, Lead } from '../../shared/schemas';

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

/** Everything that reaches HTML goes through here — lead fields are visitor input. */
const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Subject lines must stay on one line (no header injection via newlines). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

const fmtPhone = (p: string) => (p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p);

export function fmtWhen(iso: string, tz: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
  return { date, time, full: `${date} at ${time}` };
}

const address = (l: Lead) => [l.street, l.unit, `${l.city}, ${l.zip}`].filter(Boolean).join(', ');

function layout(o: { preheader: string; heading: string; body: string; footer: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0b1020;padding:20px 28px;font-size:20px;font-weight:700;color:#ffffff">Fiber <span style="color:#22d3ee">Connect</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0b1020">${esc(o.heading)}</h1>
${o.body}
</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;line-height:1.5;color:#64748b;border-top:1px solid #e2e8f0">${o.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${html}</p>`;
const box = (html: string) =>
  `<div style="margin:0 0 18px;padding:16px 18px;border-radius:12px;background:#ecfeff;border:1px solid #a5f3fc;font-size:15px;line-height:1.6">${html}</div>`;
const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#06b6d4;color:#0b1020;font-weight:700;text-decoration:none">${esc(label)}</a></p>`;
const rows = (pairs: [string, string][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;font-size:14px">${pairs
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`)
    .join('')}</table>`;

function customerFooter(m: Market) {
  return `${esc(BRAND.name)} is operated by ${esc(BRAND.agency)}, an independent marketing partner of ${esc(m.provider)}. You’re receiving this because you requested information about fiber internet service at your address.`;
}
const contactLine = (m: Market) => (m.phoneDisplay ? ` Call or text us at ${m.phoneDisplay}.` : ' Just reply to this email.');

// ---------------------------------------------------------------- customer --
export function customerConfirmation(lead: Lead, appt: Appointment, m: Market): Rendered {
  const when = fmtWhen(appt.startUtc, m.timezone);
  const subject = oneLine(`You're booked: fiber consultation on ${when.date}`);
  const body =
    p(`Hi ${esc(lead.firstName)},`) +
    p(`Thanks for booking your free fiber consultation. Here are the details:`) +
    box(`<strong>${esc(when.date)}</strong><br>${esc(when.time)}<br>${esc(address(lead))}`) +
    p(`<strong>What to expect:</strong> a local specialist will confirm ${esc(m.provider)} service at your exact address, walk you through the plans available to you, and answer any questions. There’s no cost and no obligation.`) +
    p(`Need to change the time?${esc(contactLine(m))}`) +
    p(`A calendar invite is attached so you can add it to your calendar.`);
  const text = [
    `Hi ${lead.firstName},`,
    '',
    'Thanks for booking your free fiber consultation.',
    '',
    `When: ${when.full}`,
    `Where: ${address(lead)}`,
    '',
    `A local specialist will confirm ${m.provider} service at your exact address, walk you through the plans available to you, and answer any questions. No cost, no obligation.`,
    '',
    `Need to change the time?${contactLine(m)}`,
    '',
    '—',
    `${BRAND.name} · operated by ${BRAND.agency}, an independent marketing partner of ${m.provider}.`,
  ].join('\n');
  return { subject, html: layout({ preheader: `${when.full} — free fiber consultation`, heading: 'Your consultation is booked', body, footer: customerFooter(m) }), text };
}

export function customerReminder(lead: Lead, appt: Appointment, m: Market): Rendered {
  const when = fmtWhen(appt.startUtc, m.timezone);
  const subject = oneLine(`Reminder: your fiber consultation is ${when.date} at ${when.time}`);
  const body =
    p(`Hi ${esc(lead.firstName)},`) +
    p(`Just a friendly reminder about your free fiber consultation:`) +
    box(`<strong>${esc(when.date)}</strong><br>${esc(when.time)}<br>${esc(address(lead))}`) +
    p(`If the time no longer works, let us know and we’ll find a better one.${esc(contactLine(m))}`);
  const text = [
    `Hi ${lead.firstName},`,
    '',
    'A friendly reminder about your free fiber consultation:',
    `When: ${when.full}`,
    `Where: ${address(lead)}`,
    '',
    `If the time no longer works, let us know.${contactLine(m)}`,
    '',
    `— ${BRAND.name}`,
  ].join('\n');
  return { subject, html: layout({ preheader: `See you ${when.full}`, heading: 'See you soon', body, footer: customerFooter(m) }), text };
}

export function customerLeadReceived(lead: Lead, m: Market): Rendered {
  const subject = oneLine(`We got your request — fiber in ${place(m)}`);
  const body =
    p(`Hi ${esc(lead.firstName)},`) +
    p(`Thanks for checking fiber availability at <strong>${esc(address(lead))}</strong>. A local specialist will reach out by ${esc(lead.preferredContact === 'text' ? 'text' : lead.preferredContact === 'email' ? 'email' : 'phone')} to confirm ${esc(m.provider)} service at your address and answer any questions.`) +
    p(`Prefer to talk now?${esc(contactLine(m))}`);
  const text = [
    `Hi ${lead.firstName},`,
    '',
    `Thanks for checking fiber availability at ${address(lead)}. A local specialist will reach out to confirm ${m.provider} service at your address and answer any questions.`,
    '',
    `Prefer to talk now?${contactLine(m)}`,
    '',
    `— ${BRAND.name}`,
  ].join('\n');
  return { subject, html: layout({ preheader: 'A local fiber specialist will be in touch shortly.', heading: 'We got your request', body, footer: customerFooter(m) }), text };
}

// -------------------------------------------------------------------- team --
function leadFacts(lead: Lead): [string, string][] {
  const source = [lead.utmSource || lead.source, lead.utmMedium, lead.utmCampaign].filter(Boolean).join(' / ');
  return [
    ['Name', `${lead.firstName} ${lead.lastName}`],
    ['Phone', fmtPhone(lead.phone)],
    ['Email', lead.email],
    ['Address', address(lead)],
    ['Area status', lead.areaStatus.replace('_', ' ')],
    ['Prefers', lead.preferredContact],
    ['Current provider', lead.currentProvider || '—'],
    ['Source', source || '—'],
  ];
}

const teamFooter = (m: Market) => `${esc(BRAND.name)} · ${esc(place(m))} team alert. Manage lead alerts in Admin → Locations.`;

export function teamNewLead(lead: Lead, m: Market, adminUrl: string, duplicate: boolean): Rendered {
  const subject = oneLine(`${duplicate ? 'Returning lead' : 'New lead'}: ${lead.firstName} ${lead.lastName} — ${m.name} (${lead.zip})`);
  const body =
    p(duplicate ? 'This lead submitted the form again (details refreshed).' : `A new lead just came in for <strong>${esc(place(m))}</strong>.`) +
    rows(leadFacts(lead)) +
    p(`<a href="tel:${esc(lead.phone)}" style="color:#0891b2">Call</a> · <a href="sms:${esc(lead.phone)}" style="color:#0891b2">Text</a> · <a href="mailto:${esc(lead.email)}" style="color:#0891b2">Email</a>`) +
    button(adminUrl, 'Open lead');
  const text = [
    `${duplicate ? 'Returning lead' : 'New lead'} — ${place(m)}`,
    '',
    ...leadFacts(lead).map(([k, v]) => `${k}: ${v}`),
    '',
    `Open lead: ${adminUrl}`,
  ].join('\n');
  return { subject, html: layout({ preheader: `${lead.firstName} ${lead.lastName} · ${fmtPhone(lead.phone)}`, heading: duplicate ? 'Returning lead' : 'New lead', body, footer: teamFooter(m) }), text };
}

export function teamBooking(lead: Lead, appt: Appointment, m: Market, adminUrl: string): Rendered {
  const when = fmtWhen(appt.startUtc, m.timezone);
  const subject = oneLine(`Booked: ${lead.firstName} ${lead.lastName} — ${when.date}, ${when.time}`);
  const body =
    box(`<strong>${esc(when.date)}</strong> · ${esc(when.time)}<br>${esc(address(lead))}`) +
    (appt.notes ? p(`<strong>Customer note:</strong> ${esc(appt.notes)}`) : '') +
    rows(leadFacts(lead)) +
    button(adminUrl, 'Open lead');
  const text = [
    `Appointment booked — ${place(m)}`,
    `When: ${when.full}`,
    `Where: ${address(lead)}`,
    appt.notes ? `Customer note: ${appt.notes}` : '',
    '',
    ...leadFacts(lead).map(([k, v]) => `${k}: ${v}`),
    '',
    `Open lead: ${adminUrl}`,
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  return { subject, html: layout({ preheader: `${when.full} · ${lead.firstName} ${lead.lastName}`, heading: 'Appointment booked', body, footer: teamFooter(m) }), text };
}
