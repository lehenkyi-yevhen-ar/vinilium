/**
 * Text that comes from a person (a search phrase, a note, a filter) on its way to Discogs or the database.
 *
 * Postgres refuses the NUL character (U+0000) in text and in JSON ("invalid byte sequence", "unsupported Unicode escape"), which used to
 * turn `?q=%00` into a 500. Every other C0 control character is noise at best and a log or header injection at worst. This removes them
 * all except tab, line feed and carriage return, which callers either keep (notes) or collapse to a space (search).
 */
export const stripControl = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

/**
 * `s.slice(0, max)` that never cuts an astral character (an emoji, a rare script) in half: a lone surrogate is not valid text, it is
 * silently replaced when put in an address, so what was read back differed from what was kept. `max` counts UTF-16 units, as the
 * length limits of the API do.
 */
export const cut = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max).replace(/[\ud800-\udbff]$/, ""));
