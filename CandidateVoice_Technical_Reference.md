# CandidateVoice.org — Technical Reference for Claude Sessions

**Purpose:** This document gives Claude full working context before making any changes to CandidateVoice.org. Read this before writing any code, editing any file, or making any Supabase recommendations. Every architectural decision here is intentional.

---

## 1. Project Overview

CandidateVoice.org is an anonymous job application experience review platform. Job seekers submit reviews of hiring processes (not jobs themselves). Reviews are scored, moderated, and displayed publicly. The platform is built and operated by Education to Action LLC (Joe Frazier, Louisville, KY).

**Live URL:** candidatevoice.org
**GitHub Repo:** github.com/jfraz757/Candidate_Voice
**Branch:** main (auto-deploys to GitHub Pages on push)
**DNS/CDN:** Cloudflare (proxied)
**Contact email:** contact@candidatevoice.org — a Google Workspace alias on joe@educationtoaction.net (candidatevoice.org added as a secondary domain, July 2026). MX records on Cloudflare point to Google; Cloudflare Email Routing is disabled and must stay disabled — re-enabling it would break mail delivery by reclaiming the MX records. DKIM (`google._domainkey`) and DMARC (`_dmarc`) TXT records live in Cloudflare DNS. Replies go out as contact@ via Gmail "Send mail as" + "Reply from the same address the message was sent to." Site mailto links pre-fill the subject "Candidate Voice" (`?subject=Candidate%20Voice`).

---

## 2. Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript — no frameworks, no build step
- **Database:** Supabase (PostgreSQL) — accessed via REST API only
- **Hosting:** GitHub Pages
- **Fonts:** Google Fonts (Inter)
- **Favicon lookup:** Google Favicon API (`https://www.google.com/s2/favicons?domain=X&sz=32`)
- **Analytics:** Cloudflare Web Analytics (automatic mode — zone is Cloudflare-proxied, no code required) + Microsoft Clarity (session recordings/heatmaps, project ID `xr6km3ywvh`). Clarity snippet is in every deployed page's `<head>` except `admin.html`. Added July 2026 to diagnose friction on `submit.html`.

**Supabase credentials (used in every deployed page):**
```
SUPABASE_URL = "https://lawteswyjpkovzagnshn.supabase.co"
SUPABASE_KEY = "sb_publishable_piPBYVy1yGEj_Iv0RCLtnA_PGzdT1bz"
```
The anon key is intentionally public — scoped by RLS policies. It is used in all deployed files (index.html, entry.html, submit.html, etc.) for public reads and the Me Too upvote.

**admin.html uses a two-key pattern (local only — never deployed):**
```
SUPABASE_KEY      = anon key (above) — no longer used in admin.html as of June 2026
SUPABASE_ADMIN_KEY = service role key (secret) — stored only in local admin.html, never in the repo
```
All fetch calls in admin.html use `SUPABASE_ADMIN_KEY` for both reads and writes. The service role key bypasses RLS entirely, which is safe because admin.html is gitignored and runs locally only. Never put the service role key in any deployed file.

---

## 3. File Structure

```
Candidate_Voice/
├── index.html          # Main page — review grid, search, filters, inline submit modal
├── entry.html          # Single review detail page (with score tooltip, upvote, edit)
├── company.html        # Company rollup — aggregate stats + all reviews for one employer
├── submit.html         # Standalone submission form page
├── leaderboard.html    # Four-tab leaderboard: Worst Offenders, Most Reviewed, Best, Ghosting Rate
├── about.html          # About page with scoring methodology breakdown
├── terms.html          # Community guidelines
├── tos.html            # Terms of service
├── assets/
│   ├── Logo_w_name.png
│   └── Logo_w_o_Name.png
├── add_referral_column.sql  # One-time migration: had_referral column on submissions + reviews (run July 2026)
├── CNAME               # candidatevoice.org
└── .gitignore          # Excludes admin.html
```

**admin.html is NOT in the repo.** It is gitignored, run locally only, never deployed. It lives at `C:\Users\jfraz\Candidate_Voice\admin.html` on Joe's machine.

---

## 4. Supabase Database Schema

### Three tables: `reviews`, `submissions`, and `company_comments`

These are separate tables with different purposes. Do not conflate them. `reviews` and `submissions` are the core review pipeline; `company_comments` is a separate, lighter feature added June 2026 for general company-level commentary (see below).

#### `reviews` — public-facing approved records
This is what the site displays. Only `status = 'approved'` rows are shown publicly.

| Column | Type | Notes |
|---|---|---|
| id | integer | Primary key, auto-increment |
| employer_name | text | |
| employer_website | text | Used for favicon |
| position_applied | text | |
| date_applied | date | Plain date — no timezone |
| date_rejected | date | Plain date — no timezone |
| ghosted_status | text | ghosted / formal_rejection / interviewing / got_the_job |
| when_ghosted | text | after_applying / after_interview_invite / after_interviewing / after_offer |
| interview_invite | text | yes / no |
| interview_rounds | integer | |
| salary_disclosed | text | yes / no / dont_remember |
| cover_letter_required | text | yes / no / optional / dont_remember |
| take_home_assignment | text | yes / no / dont_remember |
| essay_responses | text | yes / no / dont_remember |
| resume_reentry | text | yes / no / dont_remember |
| had_referral | text | yes / no — "Did you have a referral or reference when applying?" (added July 2026) |
| review_general | text | Free text |
| review_best | text | Free text |
| review_worst | text | Free text |
| upvotes | integer | "Me Too" count |
| experience_score | numeric | 0–100, auto-calculated by DB trigger |
| score_band | text | poor / fair / good / excellent — set by trigger |
| industry | text | One of 17 defined categories |
| verified | boolean | Manually set via admin panel |
| status | text | approved / pending / rejected |
| created_at | timestamp with time zone | |
| updated_at | timestamp with time zone | |
| date_submitted | date | |

**Scoring is handled by a PostgreSQL trigger**, not JavaScript. The trigger function `calculate_experience_score` fires on INSERT and UPDATE via `set_experience_score`. Touching `updated_at` in a PATCH forces the trigger to recalculate the score.

#### `submissions` — moderation holding queue (never public)

| Column | Type | Notes |
|---|---|---|
| id | integer | Primary key |
| employer_name | text | |
| employer_website | text | |
| position_applied | text | |
| date_applied | date | |
| date_rejected | date | |
| ghosted_status | text | |
| when_ghosted | text | |
| interview_invite | text | |
| interview_rounds | integer | |
| salary_disclosed | text | |
| cover_letter_required | text | |
| take_home_assignment | text | |
| essay_responses | text | |
| resume_reentry | text | |
| had_referral | text | yes / no (added July 2026) |
| review_general | text | |
| review_best | text | |
| review_worst | text | |
| submitter_email | text | Never displayed publicly |
| status | text | pending / approved / rejected — column default is `'pending'` (fixed June 2026 via SQL: `ALTER TABLE submissions ALTER COLUMN status SET DEFAULT 'pending'`) |
| created_at | timestamp with time zone | |
| industry | text | |
| update_notes | text | Used to flag edits — format: "Update to review ID {id}" |

#### `company_comments` — general company-level commentary (added June 2026)

Separate, deliberately lightweight table for general remarks about an employer that are **not tied to one specific application**. This exists because reviews are strictly per-application (one person, one application, one scored experience), and general company commentary kept arriving mis-filed as edits to unrelated specific reviews (the "Sony ghost jobs" submission was the trigger — someone used the entry.html edit flow to overwrite an unrelated Director, D&I review with general commentary about Sony's hiring culture). Company comments give that impulse a correct home without corrupting individual reviews or the scoring model.

| Column | Type | Notes |
|---|---|---|
| id | bigint | Primary key, `generated always as identity` |
| employer_name | text | NOT NULL. Must match `reviews.employer_name` exactly (case + spacing) or the comment won't surface on that company's page — the company.html query filters on exact match |
| comment_text | text | NOT NULL, CHECK length between 10 and 1000 chars |
| status | text | pending / approved / rejected — column default `'pending'`, CHECK constraint enforces the three values. Frontend also sends `status: "pending"` explicitly in the insert payload, so display never depends on the column default alone (same lesson as `submissions.status`, Section 10 note 11) |
| created_at | timestamptz | default `now()` |

No scoring, no trigger, no edit/update branching — comments are simpler than reviews. There is no `submissions`-style holding queue for comments: a single table holds all three statuses, and the moderation split is done purely by `status` + RLS (public reads only `status = 'approved'`; admin reads pending via the service role key). Index: `company_comments_employer_status_idx` on `(employer_name, status)` to keep the company.html lookup fast.

Schema/migration SQL lives in `company_comments_schema.sql` (run once in the Supabase SQL editor for this project; safe to run as one script — all statements are additive).

---

## 5. RLS Policies (Row Level Security)

RLS is enabled on both tables. Current policies (as of June 2026):

### `reviews`
- **"Public read approved reviews"** — SELECT allowed for public where `status = 'approved'` — all public pages read through this
- **"Public patch upvotes"** — UPDATE allowed for anon + authenticated, scoped to `status = 'approved'` rows only — covers the Me Too upvote button on entry.html
- **"Allow admin insert reviews"** — INSERT restricted to `authenticated` role only — the service role key in admin.html bypasses this entirely for the approve workflow, so this policy is effectively a safety net against direct anon inserts
- No separate admin UPDATE policy on `reviews` — admin.html uses the service role key which bypasses RLS entirely, so all admin PATCHes (edit approvals, verified toggles) go through without a policy

### `submissions`
- **"Public insert submissions"** — INSERT allowed for anon + authenticated, `with_check = true` — covers submit.html and the index.html modal
- **"Allow select submissions"** — SELECT restricted to `authenticated` role only — admin.html reads the pending queue via service role key
- **"Allow update submissions"** — UPDATE restricted to `authenticated` role only — admin.html approve/reject workflow writes via service role key

### `company_comments`
- **"Public read approved comments"** — SELECT allowed for anon + authenticated where `status = 'approved'` — company.html reads approved comments through this
- **"Public insert comments"** — INSERT allowed for anon + authenticated, `with_check = true` — covers the "Add a comment" form on company.html
- No anon SELECT on pending/rejected rows, and no anon UPDATE/DELETE policy at all — admin.html approve/reject uses the service role key, which bypasses RLS. Same pattern as `submissions`: **anon can INSERT but cannot read back**, so the anon insert in company.html uses `Prefer: return=minimal` (do not switch it to `return=representation`, that reintroduces the Section 10 note 16 42501 failure). Do NOT add an anon SELECT policy to expose pending comments — the pending queue is meant to stay admin-only.

**Critical:** admin.html uses the service role key (`SUPABASE_ADMIN_KEY`) for all fetch calls, which bypasses RLS entirely. The RLS policies above govern only what the public anon key can do. If you tighten or change any policy, test the public submission form (anon key path) AND the admin workflow (service role path) separately. A 401 on admin reads almost always means the service role key is wrong or missing in admin.html — not an RLS issue.

### Verified policy snapshot — `submissions` (captured June 2026)

This is the authoritative dump of the `submissions` RLS policies, pulled directly from `pg_policy`. RLS on this table has caused repeated site issues, so when any submission write path breaks, re-run the query below and compare against this table FIRST before theorizing. `polcmd` values: `a` = INSERT, `r` = SELECT, `w` = UPDATE.

| polname | polcmd | permissive | with_check | roles |
|---|---|---|---|---|
| Public insert submissions | a (INSERT) | true | `true` | anon, authenticated |
| Allow select submissions | r (SELECT) | true | (none) | authenticated |
| Allow update submissions | w (UPDATE) | true | `status = ANY (ARRAY['pending', 'approved', 'rejected'])` | authenticated |

The single most important fact in this snapshot: **anon can INSERT into `submissions` but cannot SELECT from it.** That asymmetry is intentional. It keeps the moderation queue private. It is also the exact root cause of the `return=representation` failure in Section 10, note 16. Because anon cannot read this table, any anon write to it must use `Prefer: return=minimal`, never `Prefer: return=representation`, or PostgREST will try to read the row back, hit the missing SELECT policy, and fail with a misleading 401 / error 42501.

Query to regenerate this snapshot. Swap the table name to capture the equivalent dump for `reviews`, which has not yet been recorded verbatim. Do that the next time you are in the SQL editor and paste the result here.

```sql
select polname,
       polcmd,
       polpermissive,
       pg_get_expr(polwithcheck, polrelid) as with_check,
       polroles::regrole[] as roles
from pg_policy
where polrelid = 'public.submissions'::regclass;   -- swap to 'public.reviews' for the reviews dump
```

---

## 6. Data Flow — Submission to Publication

```
User fills form (index.html modal OR submit.html)
        ↓
POST to /rest/v1/submissions  (status: "pending")
        ↓
Joe logs into admin.html locally
        ↓
Admin reads /rest/v1/submissions?status=eq.pending
        ↓
    [APPROVE]                        [REJECT]
        ↓                                ↓
Check update_notes field         PATCH submissions
        ↓                        set status = "rejected"
  Is it an edit?
  (update_notes starts with
  "Update to review ID {id}")
        ↓
   YES: PATCH /rest/v1/reviews?id=eq.{reviewId}
        with only the changed fields
        touch updated_at to trigger score recalc
        ↓
   NO:  POST /rest/v1/reviews
        with all fields, status: "approved"
        ↓
   PATCH submissions set status = "approved"
        ↓
Review appears on live site
```

**Comments flow (`company_comments`) — separate and simpler:**
```
Visitor fills "Add a comment" form on company.html
        ↓
POST to /rest/v1/company_comments  (status: "pending", anon key, return=minimal)
        ↓
Joe logs into admin.html locally → Comments tab
        ↓
Admin reads /rest/v1/company_comments?status=eq.pending  (service role key)
        ↓
   [APPROVE]                          [REJECT]
        ↓                                 ↓
PATCH company_comments             PATCH company_comments
set status = "approved"            set status = "rejected"
        ↓
Comment appears on that employer's company.html Discussion section
(only if employer_name matches an existing employer's name exactly)
```
No edit/update branching, no second table, no score recalc — comments are one table, moderated purely by status.

---

## 7. Page-by-Page Reference

### index.html
- Fetches `reviews` where `status = 'approved'`
- Supports search, pagination, status filter (ghosted/formal_rejection/interviewing/got_the_job), score band filter, industry filter
- Industry pills are dynamically built from live DB values (not hardcoded)
- Has an employer autocomplete (fetches approved `employer_name` + `employer_website` from `reviews`)
- Contains an inline "Share Your Experience" modal that submits to `submissions` (same logic as submit.html)
- Stats bar: total reviews, ghosted count, employer count — fetched from `reviews`
- Cards are rendered by `buildCard(r)`; the whole card is an anchor to `entry.html?id=`. The employer name inside the card is a clickable `<span>` (not a nested anchor) that links to the **live company page (`company.html?name=`)** via the `goToEmployer` helper. **Changed June 2026:** this used to point at the static `employers/{slug}.html` SEO snapshot; it now goes to `company.html?name=` so visitors land one hop from a card on the interactive page where they can read all reviews AND leave a comment. The handler now takes the raw employer name (passed via a `data-employer` attribute, apostrophe/quote-safe) rather than the slug. `slugify()` is no longer called inside `buildCard` but is still defined in the file for `generate-employer-pages.js` parity. See Section 10, note 15.
- Honeypot field: `sub_company_confirm` (hidden, bots fill it, humans don't)

### submit.html
- Standalone submission form — same fields as the index.html modal
- Has its own employer autocomplete (fetches from `reviews` where `status = 'approved'`)
- Posts to `/rest/v1/submissions` with `status: "pending"`
- **Referral question (added July 2026):** "Did you have a referral or reference when applying?" — Skip/Yes/No select (`id="referral"`), full-width row at the bottom of the Application Details grid, maps to `had_referral`. Same question exists on the index.html modal (`sub-referral`) and the entry.html edit modal (`edit-referral`). See Section 10, note 20.
- Had a **critical bug (fixed June 2026):** duplicate `const SUPABASE_KEY` declaration in the same script block caused a silent SyntaxError that killed the entire script (no autocomplete, no submit). Fixed by removing the duplicate declaration.
- Honeypot field: `company_confirm`

### entry.html
- Fetches single review by ID from `reviews` where `status = 'approved'`
- Displays score badge with hover tooltip showing score breakdown by field
- Upvote ("Me Too") button — PATCHes `upvotes` on `reviews`, uses localStorage to prevent double-voting
- "Edit / Update" modal — submits to `submissions` with `update_notes: "Update to review ID {id}"` — goes through moderation before applying. **As of July 2026, the modal collects `when_ghosted`, `interview_invite`, and `interview_rounds`** (added after a user was ghosted post-interview and had no way to correct `interview_invite` through the normal edit flow — see Section 10, note 17). Fields sit directly under the Outcome dropdown: a When Were You Ghosted select, an Invited to Interview select, and an Interview Rounds number input, all defaulting to "No change" / empty so untouched fields stay null in the payload. **As of July 2026 the modal also collects `had_referral`** ("Referral or Reference?" — No change/Yes/No, `id="edit-referral"`, in the Application Details grid next to Resume Re-entry)
- Share button uses Web Share API with clipboard fallback
- Footer action row links: "🔗 Share", "✏️ Update this review", "💬 Discuss {Employer}" (added June 2026 — links to `company.html?name=...#comments`, jumping straight to the Discussion section — **renamed from "Company Notes" shortly after launch**), and "All {Employer} reviews →" (links to `company.html?name=...` with no fragment, landing at the top). The two company.html links are the same destination page but different scroll targets — Discuss goes to comments, All reviews goes to the top.

### company.html
- URL param: `?name=CompanyName`
- Fetches all approved reviews for that employer
- Calculates and displays: total reviews, ghosted rate %, hires reported, avg response time (days), avg experience score
- Ghosting streak badge: shows if 3+ most recent reviews (by date_applied) are all ghosted
- Position filter (client-side, no DB call)
- **Discussion section (added June 2026 as "Company Notes," renamed to "Discussion" shortly after launch — the `.section-title` text changed but the `id="comments"` anchor, CSS classes, and code comments still say "comments"/"comment", intentionally not renamed to avoid churn):** below the reviews list, `id="comments"` (the target of entry.html's `#comments` anchor, with `scroll-margin-top` so the sticky header doesn't overlap it). Reads approved rows from `company_comments` for this employer, renders them as `.comment-card`s, and offers a toggleable "+ Add a comment" form (10–1000 char limit, live char counter, honeypot field `comment_confirm`). Submits to `company_comments` with the anon key, `status: "pending"`, and `Prefer: return=minimal` (the `res.json()` parse is guarded so an empty 201 body doesn't throw a false failure — same fix as Section 10 note 16). Comments are moderated via the admin Comments tab before appearing. This section is live on `company.html` only — it is intentionally NOT on the static `employers/{slug}.html` SEO pages (those only update on manual regenerate, so live-only avoids another staleness source).
  - **Anchor-scroll timing fix:** the `#comments` fragment in the "Discuss" link initially did not scroll into view. Cause: the browser performs its one-time scroll-to-anchor on initial page load, but `reviews-list` starts as a short "Loading reviews..." placeholder and only reaches full height once `loadCompany()`'s async fetch resolves and injects the review cards — which happens *after* the browser's anchor jump, pushing the Discussion section further down without correcting the scroll position. Fix: `loadCompany()` and `loadComments()` are now awaited together (`Promise.all`), and only after both resolve does the page check `window.location.hash === "#comments"` and call `document.getElementById("comments")?.scrollIntoView({ behavior: "smooth", block: "start" })` manually. Any future section added below dynamically-loaded content that needs to support a URL anchor should follow this same pattern — don't rely on the browser's native anchor jump when content above the target loads asynchronously.

### leaderboard.html
- Fetches all approved reviews in one call (limit 1000): `/rest/v1/reviews?select=*&status=eq.approved`
- Aggregates client-side into company objects
- Four tabs: Worst Offenders (lowest avg score, min 3 reviews), Most Reviewed, Best Experience (highest avg score, min 3 reviews), Ghosting Rate (highest %, min 2 reviews). The min-3 floor on Worst and Best is enforced in the `.filter()` as of July 2026 — before that it was documented but not actually in code (see Section 10, note 19). Ties on avg score break by review count descending on both boards. `scorePill()` always renders the numeric score (`Avg Experience: {n}/100 · {band}`), including at 0 — do not reintroduce the `pct > 0` guard that hid it.

### admin.html (LOCAL ONLY — NOT IN REPO)
- Password-protected (hardcoded password in file — reason it's gitignored)
- Tabs: Pending, Approved, Rejected, **Comments** (added June 2026), Stats
- Pending tab reads from `submissions` where `status = 'pending'`
- Approved/Rejected tabs read from `reviews`
- **Comments tab** reads from `company_comments` where `status = 'pending'` (has its own pending-count badge, `comments-count`). `buildCommentCard()` renders each; `approveComment()` / `rejectComment()` PATCH `company_comments` status directly — no reviews-table branching, since comments aren't tied to a scored record. `loadComments()` runs as part of `loadAll()` on dashboard load.
- Approve button (submissions): reads submission, checks `update_notes` for edit flag, either PATCHes existing review or POSTs new review, then marks submission as approved
- Reject button: PATCHes submission `status = 'rejected'`
- Verify toggle: PATCHes `verified = true/false` on `reviews`
- Stats tab: pulls counts from both tables
- **All fetch calls use `SUPABASE_ADMIN_KEY` (service role key)** — both reads and writes, comments included. The anon key (`SUPABASE_KEY`) is defined in the file but unused. The service role key bypasses RLS entirely.

---

## 8. Date Handling — Critical Notes

`date_applied` and `date_rejected` are stored as plain `date` type in PostgreSQL (no timezone). When JavaScript renders them with `new Date("2026-06-22")`, it interprets the string as UTC midnight, then converts to local time (CDT = UTC-5), rolling the date back by one day.

**The fix (applied June 2026 to admin.html):** Append `T00:00:00` before passing to `new Date()`:
```javascript
// WRONG — rolls back one day for CDT users:
new Date(r.date_rejected).toLocaleDateString(...)

// CORRECT:
new Date(r.date_rejected + 'T00:00:00').toLocaleDateString(...)
```

This fix has been applied to admin.html and company.html. Check for this pattern in any file that renders `date_applied` or `date_rejected`. The `created_at` field is a full timestamp with timezone and does NOT need this fix.

**Date arithmetic (e.g. response time in days) has an additional risk.** When both `date_applied` and `date_rejected` are passed to `new Date()` without `T00:00:00`, each date rolls back one day, causing the diff to be off by up to 2 days per record. For short turnarounds (1–2 days), this produces negative response times. Always apply the suffix to both dates and guard against negatives:

```javascript
// WRONG — can produce negative days for short turnarounds:
Math.round((new Date(r.date_rejected) - new Date(r.date_applied)) / 86400000)

// CORRECT — T00:00:00 on both, negative guard drops bad data:
const validDays = rtReviews
  .map(r => Math.round((new Date(r.date_rejected + 'T00:00:00') - new Date(r.date_applied + 'T00:00:00')) / 86400000))
  .filter(d => d >= 0);
```

This bug caused company.html to display -20 days avg response time for National Audubon Society. Fixed June 2026.

---

## 9. Scoring System

Scores are calculated by a **PostgreSQL trigger** (`set_experience_score` calling `calculate_experience_score`), not by JavaScript. The trigger fires on INSERT and UPDATE to `reviews`. To force a rescore, PATCH `updated_at` with a new timestamp.

Score factors (proportional — skipped fields excluded from both numerator and denominator):

| Factor | Points |
|---|---|
| Got job / Interviewing | 25 / 30 |
| Formal rejection ≤14 days | 20 / 30 |
| Ghosted | 0 / 30 |
| Salary disclosed | 15 / 15 |
| No cover letter | 10 / 10 |
| Cover letter optional | 6 / 10 |
| Cover letter required | 2 / 10 |
| No take-home assignment | 10 / 10 |
| No essay responses | 10 / 10 |
| No resume re-entry | 10 / 10 |

Bands: Poor < 25% · Fair 25–49% · Good 50–74% · Excellent 75%+

---

## 10. Known Quirks and Gotchas

1. **Never declare `const SUPABASE_KEY` twice in the same script block.** It causes a silent SyntaxError that kills the entire script. This burned us once already in submit.html.

2. **`submissions` and `reviews` are separate tables for a reason.** Do not merge them or redirect form submissions to `reviews` directly. The two-table architecture is the moderation system.

3. **The scoring trigger lives in Supabase, not in the frontend.** Don't add JavaScript score calculations — they'll conflict with the DB trigger. To trigger a rescore, touch `updated_at`.

4. **admin.html is never pushed to GitHub.** It contains the admin password. It runs locally only. Do not suggest deploying it or adding auth to GitHub Pages for it.

5. **Date fields need `T00:00:00` suffix** when passed to `new Date()` in JavaScript, or they roll back one day for US Central time users.

6. **Industry pills on index.html are dynamic** — pulled from the live `reviews` table. Don't hardcode them.

7. **The `update_notes` field on `submissions`** is the mechanism for the edit workflow. Format must be exactly `"Update to review ID {id}"` — the admin approval logic parses this string to determine whether to PATCH an existing review or INSERT a new one.

8. **Upvotes use localStorage** to prevent double-voting (key: `voted_{id}`). This is browser-local only — not server-enforced.

9. **cv_entry.html and cv_index.html** appear to be older/alternate versions of entry.html and index.html. Confirm with Joe before editing these — they may be legacy files or test variants.

10. **Supabase PATCH to `reviews` returns 200 even when blocked by RLS.** If an admin approve fires and shows success but the review doesn't update on the live site, check that admin.html is using `SUPABASE_ADMIN_KEY` (service role key) on the PATCH call. The service role bypasses RLS entirely — no separate UPDATE policy on `reviews` is needed as of June 2026. If the service role key is correct and PATCHes still silently fail, check the RLS policies on `reviews`.

14. **admin.html uses a two-key pattern.** `SUPABASE_KEY` (anon) is defined but unused — kept for reference only. `SUPABASE_ADMIN_KEY` (service role) is used for every fetch call. If admin reads return 401, the service role key is wrong, missing, or the anon key was accidentally used instead. If public submission or Me Too upvote breaks, check that the deployed files still use the anon key — the service role key must never appear in any deployed file or the repo.

11. **`submissions.status` column default must be `'pending'`**, set via SQL: `ALTER TABLE submissions ALTER COLUMN status SET DEFAULT 'pending'`. The Supabase UI save may not commit this reliably — always verify with `SELECT column_default FROM information_schema.columns WHERE table_name = 'submissions' AND column_name = 'status'`. If edit submissions arrive as `approved` and bypass the Pending queue entirely, this default is the first thing to check.

12. **The admin patch object in admin.html must use `!= null` checks, not truthiness checks.** The original code used `if (s.field_name)` which silently drops valid falsy values. The fixed version uses `if (s.field_name != null)`. Also, the patch object must include all editable fields: `ghosted_status`, `when_ghosted`, `interview_invite`, `interview_rounds`, `salary_disclosed`, `cover_letter_required`, `take_home_assignment`, `essay_responses`, `resume_reentry`, `review_general`, `review_best`, `review_worst`, `date_applied`, `date_rejected`, `employer_name`, `employer_website`, `position_applied`, `industry`.

13. **admin.html must be run via a local server, not opened as a file:// URL.** Chrome blocks fetch calls from `file://` origins. Run `python -m http.server 8080` in Git Bash from the repo root and access admin at `http://localhost:8080/admin.html`.

15. **Employer names on index.html cards link to the employer SEO page, implemented June 2026 using a non-anchor span, NOT a nested `<a>`.** **⚠ UPDATED (later June 2026): the link target and the argument passed both changed — see the correction at the end of this note. The nested-anchor lesson below is still fully valid; only the destination and the slug-vs-name detail are superseded.** The whole card is already an anchor (`<a class="card" href="entry.html?id=...">`). The original attempt wrapped the employer name in its own `<a href="employers/...">`, which produced a nested anchor. Nested anchors are invalid HTML, so the browser parser auto-closed the outer card anchor at the inner one, the card content spilled out of its container, and the grid jumbled. That was the launch-day crash. The working fix does not use a second anchor at all: the name is a `<span class="card-employer card-employer-link" role="link" tabindex="0">` with an `onclick="goToEmployer(event, '${slug}')"` (and an Enter-key `onkeydown`). The `goToEmployer(e, slug)` helper calls `e.preventDefault()` and `e.stopPropagation()` before setting `window.location.href = "employers/" + slug + ".html"`, so clicking the name goes to the employer SEO page and clicking anywhere else on the card still opens `entry.html`. The slug is passed into the handler instead of the raw name, which keeps the inline attribute quote-safe even for names with apostrophes (Macy's, L'Oréal). **The `slugify()` function in index.html must stay byte-for-byte identical to the one in `generate-employer-pages.js`** or the links will point at filenames that do not exist. Do NOT go back to wrapping the name in an `<a>`.

    **⚠ CORRECTION (later June 2026):** The card employer link no longer points at `employers/{slug}.html`. `goToEmployer` now navigates to `company.html?name=` + the URL-encoded raw employer name, so a card click lands one hop away on the live company page (reviews + Discussion comments) instead of the static SEO snapshot. The handler signature changed from `goToEmployer(e, slug)` to `goToEmployer(e, name)`, and the name is now passed via a `data-employer` attribute read at click time (`this.dataset.employer`) rather than interpolated into the inline `onclick` — this is more robust than the old slug approach for apostrophes/quotes (Macy's, L'Oréal). `slugify()` is no longer called inside `buildCard`, but it remains defined in index.html and MUST still stay byte-for-byte in sync with `generate-employer-pages.js`, which uses it to name the static files. The nested-anchor prohibition above is unchanged and still critical: `goToEmployer` still navigates via `window.location.href` with `preventDefault()` + `stopPropagation()`, so the card's outer anchor is never nested. The static SEO pages still exist and still link onward to `company.html`; only the internal card link was repointed. Minor SEO tradeoff accepted: internal card links no longer pass link signal to the SEO pages, but those pages rank via the sitemap/Search Console path, which is primary.

16. **`Prefer: return=representation` on a `submissions` INSERT fails for anon with error 42501, even though the INSERT policy allows the row.** entry.html's edit/update flow (`submitEdit()`) POSTs to `submissions` with the anon key. It originally sent `Prefer: return=representation`, which tells PostgREST to read the just-inserted row back and return it in the response body. `submissions` has no anon SELECT policy (SELECT is restricted to `authenticated` so the moderation queue stays private, see Section 5), so the read-back half of the request is blocked by RLS and the whole statement fails. The response is a misleading `401 Unauthorized` carrying `proxy-status: PostgREST; error=42501` and the body `"new row violates row-level security policy for table submissions"`. That message reads like the INSERT policy rejected the row, but the INSERT policy is fine (permissive, `with_check = true`, anon allowed, confirmed in the Section 5 snapshot). What actually failed is the SELECT evaluated for the representation read-back. New submissions from submit.html and the index.html modal were never affected because both already use `Prefer: return=minimal` and never read the row back. **Fix (June 2026):** entry.html `submitEdit()` now sends `Prefer: return=minimal`, and the `const data = await res.json()` parse was moved inside the `if (!res.ok)` branch. This second change is mandatory, not cosmetic: with `return=minimal` a successful insert returns a `201` with an empty body, so an unconditional `res.json()` throws on the empty string, the `catch` block fires, and the user sees a false "Submission failed" even though the row landed. **Do NOT fix this by adding an anon SELECT policy on `submissions`.** That would expose the entire pending moderation queue to the public, the exact opposite of the private-queue design. The rule going forward: any anon write path to `submissions` uses `return=minimal`. Diagnosing this took a full session because the 401 status code and the `WWW-Authenticate: Bearer` header point at authentication, while the real signal was the PostgREST `error=42501` code (Postgres `insufficient_privilege`, the RLS denial code) buried in the `proxy-status` header. When a Supabase write returns 401, read the `proxy-status` header and response body before assuming a key problem.

17. **The edit modal's field list was never audited against the admin patch list, and it drifted.** admin.html's `approveSubmission()` patch object (note 12, above) has always included `when_ghosted`, `interview_invite`, and `interview_rounds` as approvable fields, but entry.html's edit modal never rendered inputs for them. A user who was ghosted after interviewing had no way to correct their `interview_invite` value through the normal edit flow and had to hand-edit the row directly in Supabase, bypassing moderation entirely. **Fix (July 2026):** added a When Were You Ghosted select, an Invited to Interview select, and an Interview Rounds number input to the edit modal, and wired all three into the `submitEdit()` payload. `interview_rounds` deliberately does not use the `value || null` pattern used elsewhere in the payload, because `0 || null` evaluates to `null` and would silently drop a legitimate "0 rounds" answer; it uses an explicit `!== ""` check with `parseInt` instead. The matching display fix in admin.html (note 18) has the same 0-rounds pitfall and is handled the same way. **The lesson going forward: any time a new field is added to the `reviews` schema and the admin patch object, check the entry.html edit modal in the same session** — the two are supposed to stay in sync but nothing enforces it, and the admin side being "ready" for a field gives no signal that the public side actually collects it.

18. **`buildSubmissionCard()` in admin.html only surfaced five of the fields the patch object could apply, so admins were approving edits blind to fields the modal didn't yet expose.** Added `Interviewed` and `Rounds` tags to the pending-submission card display (July 2026, alongside note 17). `Interviewed` reuses the existing `fieldTag()` helper, but `Rounds` does not, since `fieldTag()` treats any falsy value (including `0`) as absent and would hide a real "0 rounds" answer. `Rounds` uses an inline `s.interview_rounds != null` check instead. Same 0-vs-null lesson as note 17, now on both the collection side and the display side.

19. **The leaderboard's "min 3 reviews" rule for Worst Offenders and Best Experience was documented but never actually enforced in code, and the score display hid the very number it ranks by.** Three related leaderboard.html fixes landed together (July 2026):
    - **Missing minimum (the drift):** Section 7 and this doc long claimed Worst and Best required 3+ reviews, but the `switch` in the render function only filtered on `c.avgScore != null` with no count floor. A single 100%-ghosted review could take gold. A user flagged CarGurus (1 review) ranked #1 Worst Offender. Fixed by adding `&& c.count >= 3` to both the `worst` and `best` filters. Ghosting Rate already correctly enforced `count >= 2` and was left alone. The lesson: this doc is not self-enforcing — a documented threshold means nothing until you confirm the filter is actually in the code. When the ranking looks wrong, read the actual `.filter()` before trusting the spec.
    - **Score-at-0 suppression (the confusing symptom):** `scorePill()` used `pct > 0 ? "... · {pct}%" : "Avg Experience: {band}"`, so when a company's average score rounded to 0 (common for all-ghosted employers), the number was hidden and the pill showed only "Avg Experience: Poor." Every worst-offender row then looked identical, making the sort order appear arbitrary even though the underlying scores differed. This is why two "100% ghosted" companies could legitimately rank differently (ghosting only zeroes the 30-point outcome factor; the process factors — salary, cover letter, take-home, essays, resume re-entry — still vary), but the board gave no visible reason. Fixed by always rendering the number: `Avg Experience: {pct}/100 · {band}`.
    - **Count tiebreaker (the enhancement):** when average scores are equal, both Worst and Best now break the tie by review count descending (`.sort((a, b) => a.avgScore - b.avgScore || b.count - a.count)` on worst, `b.avgScore - a.avgScore || b.count - a.count` on best). More corroborating reviews ranks higher on both boards. This is a tiebreaker only, NOT confidence weighting — it moves rows only when scores are equal to the decimal. If near-but-not-equal scores (0.0 vs 0.4) still produce an ordering that feels wrong, that is the signal to consider a confidence-weighted ranking (IMDb-style), which was discussed and deliberately deferred as a larger change that would reorder the whole board.
    - Tab subtitle labels (`tabLabels`) for worst and best were updated to read "(3 reviews minimum)" so the rule is visible to users, matching how the ghosted tab already discloses "(min. 2 reviews)."

20. **`had_referral` field (added July 2026).** "Did you have a referral or reference when applying?" — yes/no, nullable, on both `submissions` and `reviews` (added via `add_referral_column.sql`: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS had_referral text` on each). Collected in three places: submit.html (`id="referral"`, Skip/Yes/No), the index.html submit modal (`id="sub-referral"`, Skip/Yes/No), and the entry.html edit modal (`id="edit-referral"`, No change/Yes/No). admin.html shows it as a field tag on submission cards, lists it in the edit-request "Changes submitted" summary, includes it in the approve-edit PATCH, and copies it into the new-review INSERT on approval — all four spots must stay in sync when adding any future field, or the value silently drops at moderation. The field is NOT part of the scoring trigger and is not yet displayed on entry.html, company.html, or the SEO pages — it is collected and stored only. Remember the SQL must run in Supabase BEFORE the frontend deploys, or inserts fail with an unknown-column error.

21. **Doubled-protocol website values (`https://https://...`) — root cause found and fixed (July 2026).** The website field on both submission forms pre-fills `https://` on focus (added earlier because bare domains broke downstream functionality). Users pasting a full URL landed it after the pre-fill, producing `https://https://example.com` — and every cleanup path only checked `startsWith("https://")`, which the doubled value passes, so nothing caught it. Fix: both forms (submit.html website field, index.html modal `sub-website` field) now collapse repeated protocols with `val.replace(/^(https?:\/\/)+(?=https?:\/\/)/i, "")` at three points — live on `input` (so pastes visibly self-correct), on `blur`, and again inside `submitReview()` as the safety net. Handles triple-stacking and mixed `https://http://`. Existing bad rows in `reviews` and `submissions` (5 at the time) were cleaned with a one-off `regexp_replace` UPDATE in the Supabase SQL Editor (`WHERE employer_website ~* '^(https?://){2,}'`). If a doubled value ever reappears, check that all three dedupe points survived in both files. This closes the "watch for double-scheme website values" maintenance item in Section 16.

---

## 11. Employer SEO Pages

Static per-employer HTML pages are generated by `generate-employer-pages.js` and live in the `/employers/` directory. These pages are committed to the repo and deployed via GitHub Pages.

**Script location:** `generate-employer-pages.js` (repo root)
**Output directory:** `/employers/` (committed to repo)
**Run command:**
```bash
node generate-employer-pages.js
```

**What the script does:**
1. Queries Supabase for all approved reviews (paginated, handles 1,000+ records)
2. Groups reviews by employer and aggregates stats (avg score, ghosting rate, avg response days, hires reported, ghosting streak)
3. Writes a static HTML file to `/employers/{slug}.html` for each employer
4. Writes `/employers/sitemap.xml` listing every employer page

**Slugify logic:** employer names are lowercased, non-alphanumeric characters replaced with hyphens, leading/trailing hyphens stripped. Example: "Brown-Forman Corporation" → `brown-forman-corporation`.

**Each employer page includes:**
- Employer name, favicon (Google Favicon API), review count
- Ghosting streak badge (shown if 3+ most recent reviews are all ghosted)
- Stats grid: ghosting rate %, avg experience score with band badge, avg response time in days, hires reported, total reviews
- CTA linking to `company.html?name=` for full review list and to `submit.html`
- Canonical URL and Open Graph meta tags for SEO

**Sitemap:** `/employers/sitemap.xml` lists every employer page plus `index.html` and `leaderboard.html`. Submit this sitemap to Google Search Console at `https://search.google.com/search-console` after each regeneration.

**Maintenance frequency:** Regenerate whenever new employers are added (i.e., after a batch of reviews is approved). Add to the post-approval checklist.

**After running:**
```bash
git add employers/
git commit -m "Regenerate employer SEO pages"
git push
```

**Node version note:** Script uses native `fetch` (Node 18+). If running an older Node version, install `node-fetch` and require it at the top of the script.

---

## 12. Design System

- **Primary blue:** `#1a4fa0`
- **Dark navy:** `#0d2d6b`
- **Accent orange:** `#f5a623`
- **Background:** `#f5f6fa`
- **Cards:** white with `#e8eaf0` border, `border-radius: 12–16px`
- **Font:** Inter (Google Fonts), weights 400/500/600/700
- **Nav links:** pill-shaped, `border-radius: 20px`
- **Primary CTA buttons:** orange (`#f5a623`)
- **Mobile breakpoint:** 640px — hamburger menu replaces nav

Score badge colors:
- Poor: `#fee2e2` / `#dc2626` (red)
- Fair: `#fef3c7` / `#d97706` (yellow)
- Good: `#d1fae5` / `#059669` (green)
- Excellent: `#fff7e6` / `#f5a623` (orange/gold)

---

## 13. Local Testing Protocol — REQUIRED Before Every Push

**Never push a change directly to GitHub without testing it locally first.** This applies to every file change on every page, no exceptions.

**Steps:**

1. Make your edit to the file
2. Open Git Bash, navigate to the repo root (`cd ~/Candidate_Voice`)
3. Start the local server:
   ```bash
   python -m http.server 8080
   ```
4. Open your browser to `http://localhost:8080/[changed-file].html`
5. Verify the change looks correct at full desktop width
6. Resize the browser window narrow (below 640px) to check mobile layout
7. Open browser console (F12 → Console tab) and confirm no red errors
8. Only after all checks pass: `git add`, `git commit`, `git push`

**Stop the local server** when done: Ctrl+C in Git Bash.

This process costs 2 minutes and prevents broken deploys to the live site. Skipping it cost a broken card layout on launch day.

**Known limitations of local testing:**

- The card grid on index.html requires live Supabase data to render correctly. Local testing will show no cards or a broken layout even when the code is fine. This is a false positive — layout verification for index.html must be done on the live site immediately after pushing.
- The browser console (F12) is still worth checking locally for JavaScript errors even if the visual layout looks wrong.

**If you edited a file locally but have NOT pushed it yet and want to discard the changes:**

```bash
git checkout -- index.html
```

Replace `index.html` with whichever file you want to restore. This throws away all local unpushed changes to that file and restores it to exactly what is on GitHub. Run this any time you have a modified file sitting in your local folder that you do not want to push.

---

## 14. Keeping This Document Current

This document is only useful if it reflects what actually happened. After any session where something significant is built, broken, fixed, or decided, update this file and commit it.

**Triggers for updating this document:**
- A new feature or script is added
- A bug is found and fixed (add it to Section 10)
- A known-bad approach is attempted and reverted (add a do-not-revisit note to Section 10)
- An architectural decision is made (RLS changes, schema changes, new tables)
- A new file is added to the repo

**One-off SQL fixes are NOT repo files.** For ad-hoc Supabase data corrections (like the doubled-protocol cleanup), show the SQL in the chat window for Joe to copy/paste into the SQL Editor — do not save it as a .sql file in the repo. Repo .sql files are reserved for schema changes that future sessions need (e.g., `add_referral_column.sql`). Document the fix itself in Section 10 instead.

**Commit it like any other file:**
```bash
git add CandidateVoice_Technical_Reference.md
git commit -m "Update technical reference"
git push
```

The version on GitHub is the source of truth. If your local copy and the repo diverge, the repo wins.

**Before pushing any update to the live site**, always follow the local testing protocol in Section 13. No exceptions — this includes documentation-only pushes that touch HTML files.

---

## 15. Checklist Before Making Changes

Before editing any file, confirm:

- [ ] **Local test completed** — ran `python -m http.server 8080`, verified visually at desktop and mobile width, no console errors
- [ ] Which table does this feature read from / write to? (`reviews` = public approved, `submissions` = pending moderation queue)
- [ ] Does the change affect the submission flow? Test both index.html modal AND submit.html
- [ ] Does the change affect the admin approval flow? Test approve, reject, and edit-approval paths
- [ ] Are any date fields rendered with `new Date()`? If so, append `T00:00:00` for plain date columns
- [ ] Does the change add or modify RLS policies? If so, test both anonymous public access AND admin access
- [ ] Is `const SUPABASE_KEY` declared only once per script block?
- [ ] Is admin.html being pushed to GitHub? (It should never be — it's gitignored)
- [ ] Does the scoring need to change? If so, update the PostgreSQL trigger, not the JavaScript
- [ ] Does the change affect admin.html fetch calls? All admin fetches must use `SUPABASE_ADMIN_KEY` (service role), not `SUPABASE_KEY` (anon)
- [ ] Does the change affect RLS policies? If so, test the anon key path (public submission form, Me Too) AND the service role path (admin approve/reject) separately
- [ ] Does the change add or modify a field on `reviews`/`submissions`? If so, confirm all three touch it: entry.html's edit modal collects it, admin.html's `approveSubmission()` patch object applies it, and `buildSubmissionCard()` displays it for review before approval. See Section 10, notes 17–18.

---

## 16. Recurring Maintenance Tasks

These are the tasks that keep the live site accurate over time. None are one-time. They are listed by how often they come up.

### After every batch of approvals (most important)
- **Regenerate the employer SEO pages.** Run `node generate-employer-pages.js` from the repo root, then `git add employers/`, `git commit -m "Regenerate employer pages"`, `git push`. The static `employers/{slug}.html` pages are frozen snapshots from the last run. The `company.html` rollup reads Supabase live, so any employer with reviews approved since the last regenerate will show stale or missing counts on its static page until you re-run this. This is the single most common drift source on the site. Treat it as the final step of the admin approval routine, not an occasional cleanup.
- After the regenerate adds new employer pages, **resubmit the sitemap to Google Search Console** at https://search.google.com/search-console. The sitemap lives at https://candidatevoice.org/employers/sitemap.xml. New employer pages will not get crawled promptly without this.

### Periodically (every few weeks, or when something looks off)
- **Spot-check a static page against its rollup.** Pick any employer, compare the review count on `employers/{slug}.html` against the count on `company.html?name=`. A mismatch means the pages are overdue for a regenerate. A mismatch that survives a regenerate means a name-mismatch instead (two reviews entered under slightly different employer names, e.g. "Ascension" vs "Ascension Health"), which is fixed by correcting the name in admin, not by regenerating.
- **Double-scheme website values — RESOLVED July 2026.** Both forms now strip doubled protocols on input/blur/submit, and existing DB rows were cleaned (see Section 10, note 21). If a `https://https://...` value ever appears again, the frontend dedupe has regressed — check both submit.html and the index.html modal.

### Verify, never assume
- **`submissions.status` default stays `'pending'`.** If edit submissions ever start skipping the pending queue, run `SELECT column_default FROM information_schema.columns WHERE table_name = 'submissions' AND column_name = 'status'` first. See Section 10, note 11.
- **Deployed files use the anon key; admin.html uses the service role key.** If public submit or Me Too breaks, confirm deployed files still use the anon key. If admin reads 401, confirm admin.html uses the service role key. See Section 5.

### Before every push, always
- **Run the local testing protocol in Section 13.** No exceptions, including documentation-only pushes that touch HTML. Note the known false positive: the index.html grid needs live Supabase data, so it will not render locally. Verify the grid on the live site immediately after pushing, and use the local run only to confirm a clean console.

### When the code changes
- **Keep `slugify()` in sync across files.** It exists in both `index.html` and `generate-employer-pages.js` and must stay byte-for-byte identical, or the card name links will point at filenames the generator never wrote. See Section 10, note 15.
- **Update this document.** Per Section 14, any feature, fix, reverted approach, or architectural decision gets recorded here and committed.
