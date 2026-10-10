# Amanorsac Studio — Store Submission Standard

**Version 1.0 · October 2026 · Applies to every Amanorsac app that is submitted to Apple's App Store or Google Play, and to every desktop app the day it gets a phone or tablet edition.**

This is how a build earns a place in a store without being sent back. It
sits beside the Release Standard (`release-standard.md`), which says how
a finished build reaches the website, the Hub and the buyers. Everything
in the Release Standard still applies to a store build; this adds what the
store's reviewer will check that the website never did.

The words **MUST** and **MUST NOT** mark requirements. Everything else is
explanation.

**The one rule.** A store build is not submitted until every line of the
checklist in §5 is ticked by a person who opened the build on a real
device and tried it. A rejection costs a week; the checklist costs an
hour.

**How to put this in an app repo.** Save this file as
`docs/store-submission-standard.md` beside the Release Standard and add one
line to the repo's `CLAUDE.md`:

```
Store builds follow docs/store-submission-standard.md. Before any App Store or Google Play submission, do §5 of it in order and report every line, pass or fail, before building the archive.
```

---

## 1. Why this exists

The studio's apps were born on the desktop and sold from the website: a
buyer pays on amanorsac.studio, gets a licence key in My Apps, and the
Hub installs the app. None of that was ever reviewed by anyone but the
studio. A store is different. A reviewer who has never heard of the
studio opens the app cold, for a few minutes, with a checklist, and
rejects anything that looks unfinished, misleading, or like it is routing
money or data around the store's rules.

The twelve things below are the ones that catch small studios most often.
Each is a store rule, the studio's answer to it, and where that answer
lives so the next release does not undo it.

---

## 2. The twelve, and the studio's answer to each

| # | What gets the app rejected | The rule behind it | The studio's answer |
|---|---|---|---|
| 1 | **Selling the licence inside the app through Stripe or Paystack.** A card form, a "Buy for $24" button that opens Stripe, or a link that says "cheaper on our website". | Apple 3.1.1: digital goods and unlocks inside the app go through In-App Purchase. Google Play Payments policy: the same, through Play Billing. Both allow a user to **use** something bought elsewhere; neither allows the app to **sell** it elsewhere, outside the regions and conditions in §3. | A store build MUST NOT contain a card form, a price, a buy button, or a link to the website's checkout, except as §3 allows. It MAY offer the same product through the store's own purchase, and it MUST accept a licence key or a sign-in that unlocks what was bought on the website. The words on the unlock screen are "Enter your licence key" or "Sign in", never "Buy on amanorsac.studio". |
| 2 | **Offering Google or Facebook sign-in without Sign in with Apple.** | Apple 4.8: an app that offers any third-party or social login MUST also offer Sign in with Apple (or another login that collects only name and email, lets the user hide the email, and does not track). Google Play has no equivalent rule. | The studio's accounts are email and password only, so nothing is owed today. The day a Google, Facebook or other social sign-in is added anywhere a store build can reach it, Sign in with Apple is added in the same commit. |
| 3 | **No way to delete the account from inside the app.** "Email us to delete" is not enough. | Apple 5.1.1(v): an app that lets people create an account MUST let them start deleting it inside the app, and the deletion MUST remove the account, not just disable it. Google Play: the same inside the app, **plus** a public web page where deletion can be requested without the app, declared in the Data safety form. | The website MUST carry an account deletion page that works from a phone browser, and the Worker MUST delete the auth user and every row that hangs off it when asked (purchases are kept only as the anonymised sales record the privacy policy §6 describes). Every store build MUST link that page from its account screen under the words "Delete account", and MUST sign the user out when it completes. Until the page exists, no account-creating app is submitted. |
| 4 | **A website in a box.** A WebView that loads amanorsac.studio, or an app whose screens are the website's pages. | Apple 4.2 (minimum functionality): the app must do something a website cannot. Google Play has the same rule for webview-only apps under its Minimum functionality policy. | A store build MUST be the app, built for the device: it reads MIDI, plays stems, records, draws. The website appears only through the system browser (Safari or Chrome), never inside the app, and only from Help, Account and Privacy links. If a screen could be the website, it is the website. |
| 5 | **The reviewer cannot sign in.** The demo account does not exist, has expired, has no licence, or needs a code sent to the studio's phone. | Apple 2.1 (app completeness) and the App Review Information fields; Google Play's "App access" declaration. | Every submission MUST carry a reviewer account on the studio's Supabase project: a real email the studio owns, a password that never expires, no two-factor step, owning every app with a licence granted by the admin Codes page and `expires_at` empty. The same account is used every time and MUST be tested on the day of submission. The review note MUST say what the app does in two sentences, what hardware it needs (a MIDI keyboard, a second phone), and how to see each paid screen without that hardware (a demo mode, a bundled sample). |
| 6 | **The iPad layout is broken.** Text cut off, a phone layout stretched, a screen that only works in portrait on a device that is held in landscape. | Apple 2.4.1 and 4.0: an iPhone app that runs on iPad must work there, in every orientation it allows; Google Play's large-screen quality guidelines for tablets and foldables. | A store build is either **tested on an iPad and a tablet**, screenshot by screenshot, or it is marked iPhone-only (Apple: untick iPad in the target's supported destinations; Google: declare phone-only form factors). "It probably scales" is not a third option. |
| 7 | **The screenshots are from an older version.** The store listing shows a toolbar the app no longer has, a feature that was renamed, a price that changed. | Apple 2.3.3 (accurate metadata); Google Play's Metadata policy. | Screenshots are taken from the build being submitted, per the Release Standard §5, on the day of submission, and MUST show the version being submitted. A release that changes a screen replaces that screenshot in the same submission. Captions on the screenshots describe only what the screen shows. |
| 8 | **"Coming soon" inside the app.** A greyed-out tab, a "Phase 2" screen, a feature that shows a toast saying it is not ready. | Apple 2.1: no placeholders, no beta, no "under construction". Betas go to TestFlight. Google Play: the same under Minimum functionality, with open and closed testing tracks for betas. | A store build MUST NOT contain a screen, tab, menu item or setting that does not work. A feature that is not finished is removed from the build (not hidden with a flag that a reviewer can find), and goes to TestFlight or a Play testing track until it is. The catalog's `status: "coming soon"` is for the website; it never ships inside an app. |
| 9 | **A link that does not work.** The support URL 404s, the privacy policy URL is the home page, a Help link opens a page that says "coming soon". | Apple 1.5 (support URL) and 5.1.1 (privacy policy link, in the app and in the listing); Google Play's User Data policy. | Before every submission the support URL, the privacy policy URL, the terms URL and every link inside the app are opened from the device and MUST return the right page. The studio's are `https://amanorsac.studio/<app>`, `https://amanorsac.studio/privacy`, `https://amanorsac.studio/legal`, with the mailto `hello@amanorsac.studio`. A link to a page that is not finished is removed, not left for later. |
| 10 | **Content from other people with no way to report it.** A store of creator packs, comments, a shared playlist, with no Report button. | Apple 1.2 (user-generated content): a way to report, a way to block, a filter, and a published contact. Google Play's User Generated Content policy asks for the same. | Anywhere a store build shows something another user made (PerformLive's creator packs, a review, a name) there MUST be a **Report** action within one tap, a **Block this creator** action, and the studio's email. Reports land in the admin review queue and are answered within a day. The studio's packs are reviewed before they are published, and the app says so, but that does not replace the Report button. |
| 11 | **Restore purchases is broken.** A new phone, a reinstall, a second device, and the purchase is gone. | Apple 3.1.1: an app with In-App Purchase MUST have a working Restore Purchases control. Google Play: Play Billing restores on sign-in, and the app MUST honour it. | A store build that sells through the store MUST carry a **Restore purchases** button on the unlock screen and on the Account screen, and it MUST be tested with a second device signed into the same store account. A build unlocked by a licence key is restored by entering the key again or signing in; the unlock screen MUST say so in one line, and the two-computer count in `max_devices` counts a phone as a computer. |
| 12 | **Screenshots that show paid features as if they were free.** A free app whose listing shows the locked screens with no sign that they cost money. | Apple 2.3.1 and 3.1.1: do not mislead about what is free. Google Play's Metadata policy and Monetisation disclosures. | A listing for a free or trial build MUST label every paid screen in its caption ("Record, with the full version"), and MUST NOT lead with a paid screen. The store's price and the website's price for the same product MUST be the same on the same day, allowing only for the store's own price tiers. |

---

## 3. Money, in a store build

The studio sells lifetime licences from the website, and the website
keeps every dollar that Stripe and Paystack do not take. A store takes
its commission on anything bought inside the app. So:

1. **The website is still where the studio sells.** A store build is
   bought there too when the store allows it, but the website's price,
   the Hub and the licence key remain the way the studio's own buyers
   get in.
2. **Inside the app, the user either unlocks or buys through the store.
   Never a third way.** The unlock screen has at most three things: a
   licence key field, a Sign in button, and (if the product is sold
   through the store) the store's own purchase with its Restore button.
3. **External purchase links are a per-country decision, decided by the
   studio, not by the build.** In May 2025 Apple changed guideline 3.1.1
   for apps on the **United States** storefront, after a court order, so
   that a US app may carry a link or button to an outside purchase
   without a special entitlement. The European Union and a few other
   regions have their own terms with their own paperwork and fees.
   Everywhere else, no link. Google Play's position in the United States
   has been changing under its own court rulings. A build MUST NOT add an
   outside link until the studio has read the store's current text for
   each storefront the app is on, written the decision in the app's
   `handoff.md`, and limited the link to those storefronts in code.
4. **A free trial is not a second app.** Apple rejects near-duplicate
   apps as spam (4.3). The desktop "Free Trial edition" pattern becomes,
   on iOS, one app that is free to download and unlocks by key, sign-in
   or store purchase. On Google Play a separate trial app is tolerated
   but the same single-app pattern is used so the two stores match.
5. **Prices match.** The store price for a product is the website's price
   on the same day, rounded to the store's tier. A sale on the website is
   a sale in the store, started and ended the same day.

---

## 4. Data, privacy and the two forms

Both stores ask the studio to fill in a form about what the app collects,
and both compare that form with the privacy policy and with what the app
actually does on the network. The three MUST agree.

- **What the studio's apps collect** is already in the privacy policy §4:
  the email on the account, what was bought, a random device identifier
  for the two-device count, and nothing from inside the music. The Hub's
  usage notes switch is off by default and is the only analytics the
  studio has; a store build that carries it declares it as optional
  analytics, linked to the account, and names the switch in the form.
- **Apple's App Privacy form** ("nutrition label") and **Google's Data
  safety form** are filled from that list and from nothing else. Adding
  a crash reporter, an analytics library, an ad network or a login
  provider means adding it to privacy policy §5, to both forms and to
  the Release Standard §8 compliance table, in the same commit.
- **Apple's privacy manifest** (`PrivacyInfo.xcprivacy`) MUST be in the
  bundle, listing every "required reason" API the app or its libraries
  touch, and every third-party SDK on Apple's list MUST ship with its
  own manifest and signature.
- **Tracking.** The studio does not track anyone across other companies'
  apps or sites, so the App Tracking Transparency prompt is never shown
  and "Tracking" in the App Privacy form is "No". Nothing in a store
  build may change that without a decision written in `handoff.md`.
- **Encryption.** The apps use only the system's HTTPS, so the export
  compliance question is answered "standard encryption only" and
  `ITSAppUsesNonExemptEncryption` is `false` in the Info.plist, so the
  question stops appearing.
- **Age rating and children.** The studio's apps are rated for everyone
  and are not made for children. Sign-up keeps its "13 or older" box
  from the website; a store build MUST NOT be submitted to the Kids
  category or Google's Families programme, which have their own rules.
- **Permissions.** Every permission the app asks for (microphone, MIDI
  over Bluetooth, local network for SecondOut's phone stream) MUST have
  its purpose string written for the person reading it on the device,
  in one sentence saying what the app does with it, and MUST be asked
  for at the moment it is needed, not at launch.

---

## 5. The submission checklist

Done on a real device with the exact build that will be uploaded, by a
person, on the day of submission. Every line is reported pass or fail in
`handoff.md` under a heading **Store submission**; a fail stops the
submission.

**Money**
- [ ] No card form, no price, no buy button, no checkout link in the build (except §3 point 3, decided and written down)
- [ ] Licence key or sign-in unlocks a website purchase; the unlock screen says how to restore
- [ ] If sold through the store: Restore purchases button present on the unlock screen and the Account screen, tested on a second device
- [ ] Store price equals the website price on the day

**Accounts**
- [ ] Email and password sign-in only, or Sign in with Apple is present beside any social login
- [ ] Delete account is reachable from the Account screen, completes, and signs the user out; Google: the web deletion page is declared in Data safety
- [ ] Reviewer account tested today: signs in, owns every app, no second factor, no expiry

**Completeness**
- [ ] Nothing greyed out, no "coming soon", no placeholder, no feature flag a reviewer could find
- [ ] Every link in the app opened on the device: support, privacy, terms, help, email
- [ ] The app is the app: no screen is the website in a WebView
- [ ] Permissions asked for when needed, each with a one-sentence purpose string

**Devices**
- [ ] iPad and tablet: tested in every orientation on a real device, or the build is declared phone-only
- [ ] Smallest supported phone: every screen read without cutting text

**Listing**
- [ ] Screenshots from this build, this version, this day; captions describe only what is shown
- [ ] Paid screens labelled in a free or trial listing; no paid screen leads
- [ ] Support URL, privacy URL and marketing URL return the right page
- [ ] App Privacy form / Data safety form match privacy policy §4 and §5 line for line
- [ ] Privacy manifest in the bundle; export compliance answered; age rating answered

**Other people's content**
- [ ] Report and Block within one tap of any creator pack, review or name; studio email shown
- [ ] Reports reach the admin review queue; someone is answering them

**Review note**
- [ ] Two sentences on what the app does, what hardware it wants, and how to see every paid screen without the hardware
- [ ] Reviewer account email and password in the App Review Information fields and the Play "App access" form, never in the listing

---

## 6. When a desktop app gets a phone edition

The studio's apps began on Windows and Mac, where none of this applied.
The day one of them is built for iPhone, iPad or Android, three things
change before the first line of the store listing is written:

1. **The product gets a store identity.** A bundle id and a Play package
   name that will never change, registered in App Store Connect and the
   Play Console under the studio's developer accounts (never a personal
   one), with the studio's D-U-N-S number and the studio's postal address
   from `worker.js`'s `POSTAL`.
2. **The catalog grows a platform.** `catalog.json` gains an `ios` or
   `android` entry under `installers` that points at the store listing
   instead of an R2 object. The catalog has no such shape yet
   (`catalog-notes.md` lists only the desktop platforms); the website's
   receiver adds it with the first phone edition, so the Hub and the
   app's page send phone visitors to the store and not to a zip.
3. **The Release Standard still runs.** "release <version>" in the repo
   produces the same package; the installers are the store's build
   numbers and the store links, the screenshots come from the device, and
   `handoff.md` carries the **Store submission** section from §5 with
   every line reported. The website chat updates the page from it as
   usual and still asks for the go-ahead and the price before anything
   goes live.

---

## 7. Sources

The rules above are the studio's reading of the stores' own texts, which
move. Before a submission, the current versions are checked at:

- Apple, App Store Review Guidelines: <https://developer.apple.com/app-store/review/guidelines/>
- Apple, account deletion requirement: <https://developer.apple.com/support/offering-account-deletion-in-your-app/>
- Apple, privacy manifests: <https://developer.apple.com/documentation/bundleresources/privacy-manifest-files>
- Google Play, Developer Policy Center: <https://play.google.com/about/developer-content-policy/>
- Google Play, account deletion: <https://support.google.com/googleplay/android-developer/answer/13327111>
- Google Play, Data safety: <https://support.google.com/googleplay/android-developer/answer/10787469>
