-- CandidateVoice.org — company_comments table
-- General company-level commentary, separate from individual application reviews.
-- Run this in the Supabase SQL editor for the CandidateVoice project
-- (lawteswyjpkovzagnshn).

create table public.company_comments (
  id bigint generated always as identity primary key,
  employer_name text not null,
  comment_text text not null check (char_length(comment_text) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- Speeds up the company.html query: employer_name + status = 'approved'
create index company_comments_employer_status_idx
  on public.company_comments (employer_name, status);

alter table public.company_comments enable row level security;

-- Public can read only approved comments — same shape as "Public read approved reviews"
create policy "Public read approved comments"
  on public.company_comments
  for select
  to anon, authenticated
  using (status = 'approved');

-- Public can submit new comments — same shape as "Public insert submissions"
-- The status column default ('pending') keeps these out of public view until approved.
-- The frontend also sends status: "pending" explicitly in the insert payload, so
-- this does not depend on the column default alone (see submissions.status note
-- in the technical reference — the Supabase UI default did not always commit reliably).
create policy "Public insert comments"
  on public.company_comments
  for insert
  to anon, authenticated
  with check (true);

-- No anon SELECT on pending/rejected rows, and no anon UPDATE/DELETE policy at all.
-- admin.html uses the service role key, which bypasses RLS entirely for approve/reject,
-- exactly like the reviews and submissions tables. Do not add an authenticated-only
-- SELECT policy here unless admin.html's Comments tab specifically needs it — the
-- service role key does not require one.

-- After running, verify the policies landed as expected:
-- select polname, polcmd, pg_get_expr(polwithcheck, polrelid) as with_check, polroles::regrole[] as roles
-- from pg_policy where polrelid = 'public.company_comments'::regclass;
