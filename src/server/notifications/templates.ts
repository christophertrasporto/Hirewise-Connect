/** Transactional email templates. Agent-facing templates never contain client financial terms (Section 9). */

function layout(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#f5f7fa;padding:24px;color:#12213a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e9edf3">
    <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#0b8663;font-weight:700;margin:0 0 12px">Hirewise Connect</p>
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
  staffInvite(url: string, roleName: string) {
    return {
      subject: "You have been added to Hirewise Connect",
      text: `You have been added to Hirewise Connect as ${roleName}. Set your password to get started: ${url}

This link expires in 7 days. If it has expired, use "Forgot password" on the sign-in page.`,
      html: layout("Welcome to Hirewise Connect", `<p>You have been added as <strong>${roleName}</strong>. Set your password to get started. The link expires in 7 days; after that, use "Forgot password" on the sign-in page.</p>${button(url, "Set my password")}`),
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
