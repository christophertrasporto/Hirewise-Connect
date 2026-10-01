import { getEnv } from "@/server/env";

/** Transactional email templates. Agent-facing templates never contain client financial terms (Section 9). */

/** Absolute URL for the brand artwork in public/brand; emails cannot reference relative paths. */
function brandLogoUrl() {
  try {
    return `${getEnv().APP_URL.replace(/\/$/, "")}/brand/hirewise-connect-logo-dark.png`;
  } catch {
    return "/brand/hirewise-connect-logo-dark.png";
  }
}

function layout(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#f5f7fa;padding:24px;color:#12213a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e9edf3">
    <div style="background:#0a1628;border-radius:12px;padding:14px 18px;margin:0 0 20px"><img src="${brandLogoUrl()}" alt="Hirewise Connect" width="260" style="display:block;max-width:100%;height:auto"></div>
    <h1 style="font-size:22px;margin:0 0 16px">${title}</h1>
    ${bodyHtml}
    <p style="font-size:12px;color:#7a8aa5;margin-top:32px">If you did not request this, you can ignore this email.</p>
  </div></body></html>`;
}

function button(href: string, label: string) {
  return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#0a1628;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${label}</a></p>
  <p style="font-size:13px;color:#4b5e7e;word-break:break-all">Or copy this link: ${href}</p>`;
}

export const templates = {
  magicLink(url: string) {
    return {
      subject: "Your Hirewise Connect sign-in link",
      text: `Sign in to Hirewise Connect: ${url}\n\nThis link expires in 15 minutes.`,
      html: layout("Sign in to Hirewise Connect", `<p>Use the button below to sign in. The link expires in 15 minutes.</p>${button(url, "Sign in")}`),
    };
  },
  verifyEmail(url: string) {
    return {
      subject: "Verify your email for Hirewise Connect",
      text: `Verify your email: ${url}\n\nThis link expires in 24 hours.`,
      html: layout("Verify your email", `<p>Confirm this address to continue setting up your account. The link expires in 24 hours.</p>${button(url, "Verify email")}`),
    };
  },
  passwordReset(url: string) {
    return {
      subject: "Reset your Hirewise Connect password",
      text: `Reset your password: ${url}\n\nThis link expires in 1 hour.`,
      html: layout("Reset your password", `<p>Choose a new password using the link below. It expires in 1 hour.</p>${button(url, "Reset password")}`),
    };
  },
};
