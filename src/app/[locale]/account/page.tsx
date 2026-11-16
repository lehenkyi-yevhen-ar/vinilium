import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { redirect } from "@/i18n/navigation";
import { getDb, schema } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { DeleteAccount } from "@/components/DeleteAccount";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SignOutButton } from "@/components/SignOutButton";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("title") };
}

export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const locale = await resolveLocale(params);
  const session = await getSession();
  if (!session) redirect({ href: { pathname: "/sign-in", query: { next: "/account" } }, locale });

  const user = session!.user;
  const t = await getTranslations({ locale, namespace: "account" });

  // Does this user have a password (vs. Google only)? Decides whether delete asks for it.
  const credential = await getDb()
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential")))
    .limit(1);

  return (
    <div className="container x-page">
      <div className="x-narrow">
        <h1 className="t-h2">{t("title")}</h1>

        <section className="x-card x-section" aria-labelledby="profile-h">
          <h2 id="profile-h">{t("profile")}</h2>
          <p>{user.name}</p>
          <p className="x-kv">
            <span>{user.email}</span>
            <span className={user.emailVerified ? "badge badge--success" : "badge badge--warning"}>
              {user.emailVerified ? t("emailVerified") : t("emailUnverified")}
            </span>
          </p>
          <SignOutButton />
        </section>

        <section className="x-card x-section" aria-labelledby="lang-h">
          <h2 id="lang-h">{t("languageTitle")}</h2>
          <p className="x-lead">{t("languageHelp")}</p>
          <LocaleSwitcher signedIn variant="select" />
        </section>

        <section className="x-card x-section x-danger" aria-labelledby="danger-h">
          <h2 id="danger-h">{t("dangerTitle")}</h2>
          <p className="x-lead">{t("dangerText")}</p>
          <DeleteAccount hasPassword={credential.length > 0} />
        </section>
      </div>
    </div>
  );
}
