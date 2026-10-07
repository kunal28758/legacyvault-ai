import { createServer, type Server } from "node:http";

/**
 * A local stand-in for Resend's `POST /emails`, so a journey can read the
 * message LegacyVault actually sent — the release code, the access link — the
 * way a recipient would, without any test hook in the application.
 *
 * It is used only when the dev server was started with
 *   RESEND_BASE_URL=http://127.0.0.1:<port> RESEND_API_KEY=re_e2e EMAIL_FROM=…
 * (the Resend SDK reads RESEND_BASE_URL). Nothing leaves the machine.
 */
export interface CapturedMail {
  id: string;
  to: string[];
  subject: string;
  html: string;
}

export interface MailCapture {
  messages: CapturedMail[];
  /** Recipients whose mail the stand-in reports as bounced when asked. */
  bouncing: Set<string>;
  /** The newest message to `to` whose subject matches, polled until it arrives. */
  waitFor(to: string, subject: RegExp, timeoutMs?: number): Promise<CapturedMail>;
  close(): Promise<void>;
}

export function captureUrl(): URL | null {
  const base = process.env.RESEND_BASE_URL;
  if (!base) return null;
  const url = new URL(base);
  return ["127.0.0.1", "localhost"].includes(url.hostname) ? url : null;
}

export async function startMailCapture(port: number): Promise<MailCapture> {
  const messages: CapturedMail[] = [];
  const bouncing = new Set<string>();
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      if (request.method === "POST" && request.url?.startsWith("/emails")) {
        const parsed = JSON.parse(body || "{}") as {
          to?: string | string[];
          subject?: string;
          html?: string;
        };
        const id = `e2e_${messages.length + 1}`;
        messages.push({
          id,
          to: Array.isArray(parsed.to) ? parsed.to : [parsed.to ?? ""],
          subject: parsed.subject ?? "",
          html: parsed.html ?? "",
        });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id }));
        return;
      }
      // GET /emails/:id — what the delivery confirmation asks (notification.confirm).
      const lookup = request.method === "GET" && /^\/emails\/([^/?]+)/.exec(request.url ?? "");
      const found = lookup ? messages.find((mail) => mail.id === lookup[1]) : undefined;
      if (found) {
        const lastEvent = found.to.some((to) => bouncing.has(to)) ? "bounced" : "delivered";
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ object: "email", id: found.id, last_event: lastEvent }));
        return;
      }
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    messages,
    bouncing,
    async waitFor(to, subject, timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = [...messages]
          .reverse()
          .find((mail) => mail.to.includes(to) && subject.test(mail.subject));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`no email to ${to} matching ${subject}`);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The six-digit code in a code email (rendered as its own paragraph). */
export function codeIn(mail: CapturedMail): string {
  const match = mail.html.match(/>\s*(\d{6})\s*</);
  if (!match) throw new Error("no code in the email");
  return match[1];
}

/** The first link in an email that points at the given path. */
export function linkIn(mail: CapturedMail, path: string): string {
  const match = mail.html.match(new RegExp(`href="([^"]*${path.replace(/[?]/g, "\\?")}[^"]*)"`));
  if (!match) throw new Error(`no ${path} link in the email`);
  return match[1].replace(/&amp;/g, "&");
}
