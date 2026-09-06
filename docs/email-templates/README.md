# Auth email templates

The emails Supabase sends on the studio's behalf — confirm signup, reset
password, invite — styled to match the portal instead of Supabase's
plain default. They are not deployed from this repo; each one is pasted
into the Supabase dashboard once.

## Where to paste

Supabase → **Authentication → Email Templates**, then for each tab:

| Tab             | File                   | Subject line                              |
|-----------------|------------------------|-------------------------------------------|
| Confirm signup  | `confirm-signup.html`  | Confirm your email for Amanorsac Studio   |
| Reset password  | `reset-password.html`  | Reset your Amanorsac Studio password      |
| Invite user     | `invite-user.html`     | Your Amanorsac Studio account is ready    |

1. Open the file, select all, copy.
2. In the dashboard tab, replace the **Subject** with the one above.
3. Replace everything in **Message body** with the copied HTML.
4. Save. Send yourself a test (create a throwaway account, or use
   "Forgot it?" on the sign-in page) and check it in Gmail on a phone.

## Things worth knowing

- `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .SiteURL }}` are
  filled in by Supabase. Leave them exactly as written.
- Where the link *lands* is not set here — it follows **Authentication →
  URL Configuration** (Site URL and Redirect URLs), which must point at
  `https://amanorsac.studio`, never localhost.
- The sender name and address come from **Authentication → SMTP
  Settings** (Resend, `hello@amanorsac.studio`), not from the template.
- The small logo is loaded from `amanorsac.studio/portal/icons/icon-192.png`.
  Email clients don't render SVG, so it has to stay a PNG.
- Everything is inline-styled, table-based and light-only on purpose:
  that is what survives Gmail, Outlook and Apple Mail without breaking.
