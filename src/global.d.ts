import type { routing } from "@/i18n/routing";
import type messages from "@/messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}

/** The vanilla behaviour layer of the Ліс design system (public/ds/components/bundle.js). */
interface DSApi {
  init(scope?: ParentNode): void;
  toast(opts: {
    type?: "success" | "error" | "warning" | "info";
    title: string;
    text?: string;
    action?: { label: string; onClick?: () => void };
    duration?: number;
  }): { close(): void };
  modal(id: string): { open(opener?: HTMLElement): void; close(): void };
}

declare global {
  interface Window {
    DS?: DSApi;
  }
}
