import type { Page } from "@playwright/test";

/**
 * Browser-side measurements for the phone menus (language switcher, theme switcher, modals): where an open menu really is, whether
 * it is inside the viewport, what is on top of it, and which ancestors trap it (a containing block for fixed elements, or a stacking
 * context that puts it below the design system's scrim). Used by the evidence run (E2E_SHOTS) and by the real assertions.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MenuReport {
  viewport: { width: number; height: number };
  sheetMediaQuery: boolean;
  rootClasses: string;
  placedUp: boolean;
  menuPosition: string;
  trigger: Rect;
  menu: Rect;
  insideViewport: boolean;
  /** One entry per option: its box, its height (touch target) and what is on top at its centre. */
  options: Array<{ label: string; rect: Rect; heightOk: boolean; fullyInside: boolean; topElement: string; coveredBy: string | null }>;
  /** What is on top at the centre of the menu, and whether that is the menu itself (or inside it). */
  menuCentre: { topElement: string; isMenu: boolean };
  scrim: { exists: boolean; on: boolean; zIndex: string; rect: Rect | null };
  /** The menu's ancestors that matter: containing blocks for fixed descendants and stacking contexts. */
  ancestors: Array<{
    node: string;
    position: string;
    zIndex: string;
    transform: string;
    filter: string;
    backdropFilter: string;
    overflow: string;
    contain: string;
    willChange: string;
    containingBlockForFixed: boolean;
    stackingContext: boolean;
  }>;
  scrollLocked: boolean;
}

/** Runs in the page. `rootSelector` is the `.dd` element whose menu is open. */
export async function inspectOpenMenu(page: Page, rootSelector: string): Promise<MenuReport> {
  return page.evaluate((sel) => {
    const rect = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left });
    const name = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}` : "none");
    const root = document.querySelector(sel) as HTMLElement;
    const menu = root.querySelector(".dd__menu") as HTMLElement;
    const trigger = root.querySelector(".dd__trigger") as HTMLElement;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mr = menu.getBoundingClientRect();

    const topAt = (x: number, y: number) => document.elementFromPoint(Math.min(Math.max(x, 0), vw - 1), Math.min(Math.max(y, 0), vh - 1));

    const options = [...menu.querySelectorAll<HTMLElement>(".dd__opt")].map((o) => {
      const r = o.getBoundingClientRect();
      const top = topAt(r.x + r.width / 2, r.y + r.height / 2);
      const inside = !!top && (top === o || o.contains(top));
      return {
        label: (o.dataset.label ?? o.textContent ?? "").trim(),
        rect: rect(r),
        heightOk: r.height >= 44,
        fullyInside: r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw,
        topElement: name(top),
        coveredBy: inside ? null : name(top),
      };
    });

    const centreTop = topAt(mr.x + mr.width / 2, mr.y + mr.height / 2);

    const ancestors = [];
    for (let el: Element | null = menu.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const none = (v: string) => !v || v === "none" || v === "auto";
      const trap = !none(cs.transform) || !none(cs.filter) || !none(cs.backdropFilter) || !none(cs.perspective) || /paint|layout|strict|content/.test(cs.contain) || /transform|filter|perspective/.test(cs.willChange);
      const stack =
        (cs.position !== "static" && cs.zIndex !== "auto") || Number(cs.opacity) < 1 || !none(cs.transform) || !none(cs.filter) || !none(cs.backdropFilter) || cs.isolation === "isolate" || /paint|layout|strict|content/.test(cs.contain) || el === document.documentElement;
      if (trap || stack || cs.overflow !== "visible" || (cs.position !== "static" && cs.zIndex !== "auto")) {
        ancestors.push({ node: name(el), position: cs.position, zIndex: cs.zIndex, transform: cs.transform, filter: cs.filter, backdropFilter: cs.backdropFilter, overflow: `${cs.overflowX}/${cs.overflowY}`, contain: cs.contain, willChange: cs.willChange, containingBlockForFixed: trap, stackingContext: stack });
      }
    }

    const scrimEl = document.querySelector<HTMLElement>(".ds-scrim");
    const scrimCs = scrimEl ? getComputedStyle(scrimEl) : null;

    return {
      viewport: { width: vw, height: vh },
      sheetMediaQuery: matchMedia("(max-width: 640px)").matches,
      rootClasses: root.className,
      placedUp: root.classList.contains("is-up"),
      menuPosition: getComputedStyle(menu).position,
      trigger: rect(trigger.getBoundingClientRect()),
      menu: rect(mr),
      insideViewport: mr.top >= 0 && mr.left >= 0 && mr.bottom <= vh && mr.right <= vw,
      options,
      menuCentre: { topElement: name(centreTop), isMenu: !!centreTop && menu.contains(centreTop) },
      scrim: { exists: !!scrimEl, on: !!scrimEl && scrimEl.classList.contains("is-on"), zIndex: scrimCs?.zIndex ?? "", rect: scrimEl ? rect(scrimEl.getBoundingClientRect()) : null },
      ancestors,
      scrollLocked: document.documentElement.classList.contains("is-locked") || getComputedStyle(document.documentElement).overflow === "hidden" || getComputedStyle(document.body).overflow === "hidden",
    };
  }, rootSelector);
}
