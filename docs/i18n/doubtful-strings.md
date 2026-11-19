# Strings a native speaker should look at

Nothing here was "improved" by a machine. This is a list of strings that were **written in the 2026-11 hardening run** (so nobody has read them
yet) and of terms where the translation is a choice. The existing Ukrainian and Norwegian text was not re-reviewed in this run; the full review
package is `docs/i18n/review-uk-nb.csv` (`npm run i18n:export`).

## Written in this run (uk and nb are my translations of the English)

| Key | English | Why it needs a look |
| --- | --- | --- |
| `errorPage.title` | Something went wrong | Tone: this is the whole page's heading when an unexpected error happens |
| `errorPage.text` | An unexpected error stopped this page. Your lists are safe. Try again, or go back to the home page. | "Your lists are safe" is a reassurance; check it reads naturally and not as a promise |
| `errorPage.retry` | Try again | Button |
| `legal.privacy.s2Logs` | Server logs: our hosting provider, Vercel, processes technical request data such as your IP address, the time, the address requested and the result, and keeps logs to run and secure the service. [NEEDS LEGAL REVIEW] How long Vercel keeps these logs. | Legal register; the `[NEEDS LEGAL REVIEW]` mark must stay in English |
| `legal.privacy.s7P1` | ... Sign-in sessions expire on their own and are deleted afterwards. Request counters are removed by a daily clean-up, so they are kept for about a day at most. | "clean-up" (uk: "очищення", nb: "opprydding") and "about a day" (nb: "ett døgn") |
| `legal.privacy.s8Export` | ... gives you your name, email, language, picture address (if you signed in with Google), sign-up date and lists as a file ... | "picture address": uk "адресу зображення", nb "bildeadresse" |

## Terms that are a choice (check against how collectors say it)

| English | uk | nb | Question |
| --- | --- | --- | --- |
| pressing | видання | utgivelse | Collectors may say "пресинг" / "pressing" |
| master (album) | альбом | album | Discogs calls it "master release"; the UI says "album" |
| Wishlist / Collection | Бажане / Колекція | Ønskeliste / Samling | Check the first |
| condition grades (M, NM, VG+ ...) | shown as the Goldmine codes | same | Kept as codes on purpose; check that the explanation text is clear |
| "Waiting for Discogs" | see `discogsStates` | see `discogsStates` | Shown with a countdown whenever the shared limit is hit; should read as "wait a moment", not as an error |
