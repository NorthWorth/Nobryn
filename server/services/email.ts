/**
 * Provider-independent email dispatch for supplier notifications.
 *
 * The email provider is intentionally undecided. This module defines the
 * transport interface and ships a development/test transport that records
 * dispatched messages in memory so tests (and the buyer UI) can observe what
 * would be sent — without claiming a real inbox delivery.
 *
 * Production must configure a real transport through the same interface.
 * Until then, no email leaves the process.
 */

import { createHash } from "node:crypto";

export interface SentEmail {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  status: "sent" | "failed";
  error?: string;
  sentAt: Date;
}

const sentEmails: SentEmail[] = [];
let nextId = 1;

/** Clear recorded emails — used between test runs. */
export function resetSentEmails(): void {
  sentEmails.length = 0;
  nextId = 1;
}

/** Inspect recorded emails (test observability only). */
export function getSentEmails(): readonly SentEmail[] {
  return sentEmails;
}

/** Find a recorded email by recipient + subject (dedup / idempotency checks). */
export function findSentEmail(to: string, subject: string): SentEmail | undefined {
  return sentEmails.find(
    (e) => e.to.toLowerCase() === to.toLowerCase() && e.subject === subject
  );
}

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

export interface EmailTransport {
  send(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ ok: boolean; error?: string }>;
}

let transport: EmailTransport = createDevTransport();

/** Replace the transport (tests only — production wires a real provider here). */
export function setEmailTransport(t: EmailTransport): void {
  transport = t;
}

// ---------------------------------------------------------------------------
// Default development/test transport
// ---------------------------------------------------------------------------

function createDevTransport(): EmailTransport {
  return {
    async send(params) {
      const id = `email-${nextId++}`;
      // Development/test only: messages are recorded in memory so the buyer UI
      // and tests can observe the dispatch. No message is transmitted over SMTP
      // or any other real channel from this process.
      sentEmails.push({
        id,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        status: "sent",
        sentAt: new Date(),
      });
      console.log(
        `[nobryn] email(dispatch-only) to=${params.to} subject=${params.subject}`
      );
      return { ok: true };
    },
  };
}

/** Dispatch through the configured transport. */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  return transport.send(params);
}

// ---------------------------------------------------------------------------
// Supplier notification content
// ---------------------------------------------------------------------------

/** Intended-recipient safety notice. This is a warning, not email authentication. */
export const SUPPLIER_INTENT_WARNING =
  "Intended recipient: This email was sent to the person responsible for handling this transaction for {organization}.\n\nIf you are not the intended recipient, please ignore this email and do not open the transaction link or take any action.";

/** Supplier-facing access link URL (public route). */
export function supplierLinkUrl(token: string): string {
  // Public supplier route — no auth, token in the path.
  const base =
    process.env.VITE_API_URL?.trim() ||
    process.env.SERVER_URL?.trim() ||
    "";
  const url = base.replace(/\/+$/, "");
  return `${url}/supplier/transactions/${token}`;
}

export function supplierInviteEmail(params: {
  recipientEmail: string;
  counterpartyName: string;
  buyerOrg: string;
  poNumber: string;
  linkUrl: string;
}) {
  const { recipientEmail, counterpartyName, buyerOrg, poNumber, linkUrl } = params;
  const subject = `Action required: ${poNumber} — response needed`;

  const warningBlock = SUPPLIER_INTENT_WARNING.replace(
    "{organization}",
    counterpartyName
  );

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #06110d; background: #f3f5f7; margin: 0; padding: 24px; }
  .card { max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #d9e0dc; border-radius: 8px; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .meta { color: #647067; font-size: 14px; margin: 0 0 16px; }
  .warning { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #b91c1c; border-radius: 4px; padding: 12px 14px; font-size: 13px; color: #7f1d1d; margin: 16px 0; }
  .link { display: block; padding: 12px 16px; background: #06110d; color: #c8ff00; text-decoration: none; border-radius: 6px; text-align: center; font-weight: 600; margin: 16px 0; }
  .link:hover { background: #0a1a12; }
  .footer { font-size: 12px; color: #8e9892; margin-top: 16px; }
</style></head>
<body>
  <div class="card">
    <h1>${escapeHtml(buyerOrg)} — ${escapeHtml(poNumber)}</h1>
    <p class="meta">A new transaction requires your response. Please review and confirm the details.</p>

    <div class="warning">
      <strong>Intended recipient:</strong> This email was sent to the person responsible for handling this transaction for ${escapeHtml(counterpartyName)}.<br><br>
      If you are not the intended recipient, please ignore this email and do not open the transaction link or take any action.
    </div>

    <p style="font-size:14px; color:#3e4a43; margin:0 0 8px">Open the link below to view the transaction and submit your response:</p>
    <a class="link" href="${escapeHtml(linkUrl)}">View transaction and respond</a>

    <p class="footer">
      This link is unique to this transaction and expires 30 days after it was issued.
      Do not forward it. If you did not expect this email, ignore it.
    </p>
  </div>
</body>
</html>`;

  const text = [
    `${buyerOrg} — ${poNumber}`,
    "",
    "A new transaction requires your response. Please review and confirm the details.",
    "",
    "Intended recipient: This email was sent to the person responsible for handling this transaction for " +
      counterpartyName + ".",
    "If you are not the intended recipient, please ignore this email and do not open the transaction link or take any action.",
    "",
    "Open the link below to view the transaction and submit your response:",
    linkUrl,
    "",
    "This link is unique to this transaction and expires 30 days after it was issued. Do not forward it.",
  ].join("\n");

  return { to: recipientEmail, subject, html, text };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
