-- Restrict the anon role's UPDATE on `reviews` to the `upvotes` column only.
--
-- THE PROBLEM
-- The "Public patch upvotes" RLS policy grants UPDATE to anon, scoped to
-- `status = 'approved'` rows, so the Me Too button on entry.html works. But Postgres RLS
-- filters ROWS, not COLUMNS -- a policy cannot say "only the upvotes column". Column
-- scope is controlled by GRANT, and the grant was table-wide.
--
-- The publishable key is in the page source of every deployed page, so anyone could send:
--
--   curl -X PATCH "https://<project>.supabase.co/rest/v1/reviews?status=eq.approved" \
--        -H "apikey: <key from page source>" -H "Content-Type: application/json" \
--        -d '{"review_general":"arbitrary text"}'
--
-- Note the filter is `status=eq.approved`, not `id=eq.N` -- PostgREST applies that to
-- EVERY approved row in a single request. Any column was writable: review_general,
-- employer_name, experience_score, verified.
--
-- This bypasses moderation entirely. It is not a submission and never enters the pending
-- queue -- it is a direct write to already-published rows, with no log you would routinely
-- check. Manual approval cannot mitigate it.
--
-- BEFORE RUNNING: take a backup. `python backup_supabase.py`
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).

begin;

-- Drop the table-wide UPDATE, then re-grant only the one column the upvote needs.
-- Order matters: the REVOKE clears the blanket grant, the GRANT restores the narrow slice.
revoke update on public.reviews from anon;
grant  update (upvotes) on public.reviews to anon;

commit;


-- ---------------------------------------------------------------------------
-- VERIFY -- run this after the commit above. Expected result:
--   can_update_upvotes     = true   (Me Too button still works)
--   can_update_review_text = false  (content tampering blocked)
--   can_update_employer    = false
--   can_update_verified    = false
--
-- Do NOT use has_table_privilege here: it returns true when the role has UPDATE on ANY
-- column, so it stays true after this fix and looks like nothing changed.
-- ---------------------------------------------------------------------------

select has_column_privilege('anon', 'public.reviews', 'upvotes',           'UPDATE') as can_update_upvotes,
       has_column_privilege('anon', 'public.reviews', 'review_general',    'UPDATE') as can_update_review_text,
       has_column_privilege('anon', 'public.reviews', 'employer_name',     'UPDATE') as can_update_employer,
       has_column_privilege('anon', 'public.reviews', 'verified',          'UPDATE') as can_update_verified;


-- ---------------------------------------------------------------------------
-- END-TO-END CHECK (optional, from a terminal -- not the SQL editor)
--
-- 1. Upvote should still succeed (204). Use the publishable key from index.html:
--
--    curl -i -X PATCH "https://lawteswyjpkovzagnshn.supabase.co/rest/v1/reviews?id=eq.<some-approved-id>" \
--         -H "apikey: <publishable key>" -H "Authorization: Bearer <publishable key>" \
--         -H "Content-Type: application/json" -H "Prefer: return=minimal" \
--         -d '{"upvotes": 1}'
--
-- 2. Content tampering should now FAIL (403, "permission denied for column review_general"):
--
--    curl -i -X PATCH "https://lawteswyjpkovzagnshn.supabase.co/rest/v1/reviews?id=eq.<same-id>" \
--         -H "apikey: <publishable key>" -H "Authorization: Bearer <publishable key>" \
--         -H "Content-Type: application/json" \
--         -d '{"review_general":"tampered"}'
--
-- If step 1 fails, the column grant did not apply -- re-run the VERIFY query.
-- If step 2 succeeds, the fix did NOT take effect. Do not assume it worked.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- ROLLBACK -- only if the upvote button breaks and you need the old behaviour back.
-- This restores the vulnerability. Prefer fixing forward.
--
--   revoke update (upvotes) on public.reviews from anon;
--   grant  update on public.reviews to anon;
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- NOTES
--
-- * The "Public patch upvotes" RLS policy is left untouched. It still restricts anon to
--   `status = 'approved'` rows, which is correct and still needed. Rows and columns are
--   two separate controls; this file only changes the column half.
--
-- * `authenticated` still holds a table-wide UPDATE grant. That is not currently exploitable
--   -- there are no auth users, and the admin panel uses the service role key, which bypasses
--   RLS and grants entirely. If you ever add real user logins, apply the same two lines to
--   `authenticated` before you do.
--
-- * The upvote guard is client-side only (`localStorage.voted_<id>` in entry.html), so vote
--   counts remain trivially inflatable via incognito or curl even after this fix. That is a
--   data-quality issue, not a security one. The durable fix is a Postgres RPC that both
--   increments the counter and enforces one vote per caller, which would also let you drop
--   the anon UPDATE grant completely.
-- ---------------------------------------------------------------------------
