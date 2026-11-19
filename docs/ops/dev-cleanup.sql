-- =====================================================================================================================
-- Vinilium: remove ALL personal data from the DEV Neon branch (users, sessions, accounts, verification rows, lists,
-- and the rate-limit counters that carry IP addresses and user ids). Keeps the schema and the migration journal.
--
-- NOT RUN BY CLAUDE. You run it, in the Neon console > SQL Editor, on the branch you have just confirmed is DEV.
-- NEVER run it on the production branch: it deletes every account.
--
-- HOW TO USE (read all of it once):
--   1. Neon console > your project > select the DEV branch (the branch picker at the top). Open SQL Editor.
--   2. Run PART 1 alone (select it, run). It is read-only. It prints the branch id and the row counts.
--      Expected branch id:  br-empty-band-b9f6dxji
--      * If it prints a DIFFERENT id: STOP. You are on the wrong branch. Switch branch in the console and run PART 1 again.
--        Do not run PART 2.
--      * If the branch id is empty (NULL): this server does not expose it. Do not guess: check the branch NAME and ID in the
--        Neon console (Branches page, the id starts with "br-"). Only if it is br-empty-band-b9f6dxji, run the one line
--        marked OVERRIDE below, together with PART 2, in the same run.
--   3. Run PART 2 (the whole block, BEGIN to COMMIT, in one run). It stops with an error, and changes nothing, unless the
--      branch id matches (or you set the override). It is safe to run twice: the second run deletes nothing.
--   4. Run PART 3 (read-only): every count must be 0 except the tables listed as "kept".
--
-- What is deleted and why:
--   "user"        name, email, avatar url, language                  (personal data)
--   session       token, IP address, user agent                      (cascades from "user"; also deleted directly)
--   account       Google account id, password hash                   (cascades from "user"; also deleted directly)
--   verification  identifier is the person's EMAIL ADDRESS           (not linked to "user" by a key, so deleted directly)
--   user_items    the person's wishlist, collection, notes           (cascades from "user"; also deleted directly)
--   rate_limit    keys contain IP addresses and user ids             (counters only; they rebuild themselves)
-- What is kept:
--   discogs_cache   Discogs answers, TTL-bound, no personal data     (expires by itself within hours)
--   discogs_bucket  the shared request-budget counter, no personal data
--   drizzle.__drizzle_migrations  the migration journal (schema "drizzle")
--   the schema itself (no table, column or index is touched)
-- =====================================================================================================================


-- =====================================================================================================================
-- PART 1: READ-ONLY CHECK. Run this first, on its own.
-- =====================================================================================================================

-- Which branch am I on? (Neon exposes the branch id as a server setting; NULL if this server does not.)
select current_setting('neon.branch_id', true)            as branch_id,
       'br-empty-band-b9f6dxji'                           as expected_dev_branch_id,
       coalesce(current_setting('neon.branch_id', true) = 'br-empty-band-b9f6dxji', false) as is_expected_dev_branch,
       current_database()                                 as database_name;

-- Counts BEFORE (read-only).
select 'user' as table_name, count(*) as rows from "user"
union all select 'session', count(*) from session
union all select 'session (not expired)', count(*) from session where expires_at > now()
union all select 'account', count(*) from account
union all select 'verification', count(*) from verification
union all select 'user_items', count(*) from user_items
union all select 'rate_limit', count(*) from rate_limit
union all select 'discogs_cache (kept)', count(*) from discogs_cache
union all select 'discogs_bucket (kept)', count(*) from discogs_bucket
union all select 'migrations in the journal (kept)', count(*) from drizzle.__drizzle_migrations
order by 1;

-- Any table in the public schema that this script does not know about? (A table added later may hold personal data:
-- if this returns a row, read docs/data-inventory.md and extend PART 2 before running it.)
select table_name as unknown_table_check_this_before_running
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE'
   and table_name not in ('user', 'session', 'account', 'verification', 'user_items', 'rate_limit', 'discogs_cache', 'discogs_bucket');


-- =====================================================================================================================
-- PART 2: THE CLEAN-UP. Run the whole block (BEGIN ... COMMIT) in one run. Stops by itself on the wrong branch.
-- =====================================================================================================================

-- OVERRIDE (only if PART 1 showed branch_id = NULL and you confirmed in the console that this is br-empty-band-b9f6dxji).
-- Remove the two leading dashes to use it, in the same run as the block below:
-- select set_config('vinilium.dev_branch_confirmed_by_hand', 'yes', false);

begin;

do $guard$
begin
  if current_setting('neon.branch_id', true) is distinct from 'br-empty-band-b9f6dxji'
     and coalesce(current_setting('vinilium.dev_branch_confirmed_by_hand', true), '') <> 'yes' then
    raise exception 'STOP: this is not the DEV branch (branch id: %). Nothing was changed. See the notes at the top of this file.',
      coalesce(current_setting('neon.branch_id', true), 'unknown');
  end if;
end
$guard$;

-- Children first, then parents, so the order does not depend on the cascades.
delete from user_items;
delete from session;
delete from account;
delete from verification;
delete from rate_limit;
delete from "user";

commit;


-- =====================================================================================================================
-- PART 3: READ-ONLY CHECK AFTER. Every row below must show 0 except the three "kept" lines.
-- =====================================================================================================================

select 'user' as table_name, count(*) as rows from "user"
union all select 'session', count(*) from session
union all select 'account', count(*) from account
union all select 'verification', count(*) from verification
union all select 'user_items', count(*) from user_items
union all select 'rate_limit', count(*) from rate_limit
union all select 'discogs_cache (kept)', count(*) from discogs_cache
union all select 'discogs_bucket (kept)', count(*) from discogs_bucket
union all select 'migrations in the journal (kept)', count(*) from drizzle.__drizzle_migrations
order by 1;
