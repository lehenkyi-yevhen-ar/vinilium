# Draft email to Discogs (optional, sent by the owner, never by the agent)

**Do you need to send it?** No. The API Terms of Use (read from the source on 2026-11-23, "Last Updated: May 27th, 2025") and the
Application Name and Description Policy (effective 2019-12-11) were compared with the app (`docs/discogs-compliance.md`) and no conflict was
found. The three questions below are only the points the written terms leave open for a free, public hobby site. Sending them is a courtesy
and a way to get an answer in writing; not sending them changes nothing in the code.

**Where to send it.** The owner named `api@discogs.com`. The Terms themselves say "please contact us via Our Help Center" (section "API Use
and Restrictions") and "Submit A Request" for reports, so if the email bounces, use the Help Center (https://support.discogs.com) and paste the
same text. **Unverified:** that `api@discogs.com` is read by a person; this was not tested.

**Before you send:** replace the three `<...>` placeholders, read it once, and do not add anything the terms do not say. Do not mention
secrets, keys or tokens.

---

**Subject:** Question about image display, attribution and rate limits for a small free application (Vinilium)

Hello,

I run a small, free, non-commercial hobby website called Vinilium (https://vinilium.vercel.app). It helps people find a specific vinyl
pressing and keep a private wishlist and collection. It has no advertising, no payments and no affiliate links, and it links only to
discogs.com. I am a private individual; my contact address is <your contact email>. The Discogs developer application is registered as
"Vinilium" (<your Discogs username>).

I read the API Terms of Use (last updated May 27, 2025) and the Application Name and Description Policy and tried to follow them. A few
points are not covered by the written text, so I would rather ask than guess:

1. **Images.** The Terms list "Images" as Restricted Data. Our server fetches a release's cover from your image host with our own
   application credentials and passes it to the signed-in visitor's browser, with a short `Cache-Control` of at most 4 hours (never longer
   than 6 hours). We do not store the image files and we offer no bulk or offline download of them. Is serving covers this way to signed-in visitors of
   a free site acceptable, or would you prefer a different approach?

2. **Attribution.** We show the prescribed notice ("This application uses Discogs' API but is not affiliated with, sponsored or endorsed by
   Discogs. 'Discogs' is a trademark of Zink Media, LLC.") in the footer of every page, and "Data provided by Discogs." with a plain link
   (no `nofollow`) to the matching discogs.com page directly next to every block of Discogs data (every search result group, every
   pressing list, every release card, every wishlist or collection item). Is that what you expect for pages that list many items?

3. **Rate limits.** We use one set of application credentials, a single shared request budget that follows the `X-Discogs-Ratelimit`
   headers (60 per minute when authenticated), a descriptive `User-Agent` (`Vinilium/0.1 (+https://vinilium.vercel.app/en/contact)`),
   a retry with back-off when we receive a 429, and per-visitor limits on our own side. Is there anything you would like us to do
   differently?

Thank you for your time, and for the API.

<your name or nickname>
<your contact email>

---

## What the draft deliberately does not say

* It does not claim that Discogs has approved anything; it asks.
* It does not claim "non-commercial use is required": the Terms say "Commercial use ... is generally permitted" and forbid commercial use
  only of Restricted Data and for specific cases. The mail only describes what the site is.
* It does not quote the exact numbers of our internal limits (those are in `docs/operations.md`, sections 6 and 17) beyond the 60 per
  minute that the developer documentation states for authenticated requests.

## If Discogs answers

Put the answer (date, who, what) in `docs/discogs-compliance.md` under "Answers to the open questions", and change the code only if the
answer asks for it. If they say images must not be proxied, the image proxy route is the single place to switch off (docs/operations.md,
section 6: what to do when Discogs revokes or restricts access).
