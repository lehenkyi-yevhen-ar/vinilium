import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import nb from "@/messages/nb.json";
import uk from "@/messages/uk.json";

/**
 * The "nothing arrived?" note on every screen that sends an email (sign-up confirmation, verification resend, sign-in with an
 * unverified address, password reset). Verification emails often land in spam (the sender address cannot be authenticated), so
 * the note must name the spam / junk folder, say to mark the message as not spam, offer another try and a way to contact us, in
 * every language. It is the SAME text for everyone: it never depends on whether an account exists.
 */
const COPY = {
  en: { messages: en, words: ["spam or junk folder", "not spam", "try again"] },
  uk: { messages: uk, words: ["«Спам» або «Небажана пошта»", "«Не спам»", "спробувати ще раз"] },
  nb: { messages: nb, words: ["søppelpost- eller spam-mappen", "«ikke søppelpost»", "prøve igjen"] },
} as const;

describe("the nothing-arrived note", () => {
  for (const [locale, { messages, words }] of Object.entries(COPY)) {
    it(`${locale}: names the spam / junk folder, marking as not spam, trying again, and has a contact link text`, () => {
      const note = messages.auth.emailNotArrived;
      for (const w of words) expect(note, w).toContain(w);
      expect(messages.auth.emailNotArrivedLink.length).toBeGreaterThan(3);
      expect(note.endsWith("?"), "ends with the question that the contact link answers").toBe(true);
    });

    it(`${locale}: says nothing about whether an account exists`, () => {
      const all = [messages.auth.emailNotArrived, messages.auth.forgotSent, messages.auth.verifyLead];
      for (const text of all) expect(text.toLowerCase(), text).not.toMatch(/no account|not registered|does not exist|не існує|не знайдено|finnes ikke|ikke registrert/);
    });
  }

  it("the three languages carry the same placeholders (none) in the note", () => {
    for (const { messages } of Object.values(COPY)) expect(messages.auth.emailNotArrived).not.toMatch(/\{[^}]+\}/);
  });
});
