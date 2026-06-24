# CandidateVoice.org — Technical Reference for Claude Sessions

**Purpose:** This document gives Claude full working context before making any changes to CandidateVoice.org. Read this before writing any code, editing any file, or making any Supabase recommendations. Every architectural decision here is intentional.

---

## 1. Project Overview

CandidateVoice.org is an anonymous job application experience review platform. Job seekers submit reviews of hiring processes (not jobs themselves). Reviews are scored, moderated, and displayed publicly. The platform is built and operated by Education to Action LLC (Joe Frazier, Louisville, KY).

**Live URL:** candidatevoice.org
**GitHub Repo:** github.com/jfraz757/Candidate_Voice
**Branch:** main (auto-deploys to GitHub Pages on push)
**DNS/CDN:** Cloudflare (proxied)

---

## 2. Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript — no frameworks, no build step
- **Database:** Supabase (PostgreSQL) — accessed via REST API only
- **Hosting:** GitHub Pages
- **Fonts:** Google Fonts (Inter)
- **Favicon lookup:** Google Favicon API (`https://www.google.com/s2/favicons?domain=X&sz=32`)

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
├── CNAME               # candidatevoice.org
└── .gitignore          # Excludes admin.html
```

**admin.html is NOT in the repo.** It is gitignored, run locally only, never deployed. It lives at `C:\Users\jfraz\Candidate_Voice\admin.html` on Joe's machine.

---

## 4. Supabase Database Schema

### Two tables: `reviews` and `submissions`

These are separate tables with different purposes. Do not conflate them.

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
| review_general | text | |
| review_best | text | |
| review_worst | text | |
| submitter_email | text | Never displayed publicly |
| status | text | pending / approved / rejected — column default is `'pending'` (fixed June 2026 via SQL: `ALTER TABLE submissions ALTER COLUMN status SET DEFAULT 'pending'`) |
| created_at | timestamp with time zone | |
| industry | text | |
| update_notes | text | Used to flag edits — format: "Update to review ID {id}" |

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

**Critical:** admin.html uses the service role key (`SUPABASE_ADMIN_KEY`) for all fetch calls, which bypasses RLS entirely. The RLS policies above govern only what the public anon key can do. If you tighten or change any policy, test the public submission form (anon key path) AND the admin workflow (service role path) separately. A 401 on admin reads almost always means the service role key is wrong or missing in admin.html — not an RLS issue.

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

---

## 7. Page-by-Page Reference

### index.html
- Fetches `reviews` where `status = 'approved'`
- Supports search, pagination, status filter (ghosted/formal_rejection/interviewing/got_the_job), score band filter, industry filter
- Industry pills are dynamically built from live DB values (not hardcoded)
- Has an employer autocomplete (fetches approved `employer_name` + `employer_website` from `reviews`)
- Contains an inline "Share Your Experience" modal that submits to `submissions` (same logic as submit.html)
- Stats bar: total reviews, ghosted count, employer count — fetched from `reviews`
- Honeypot field: `sub_company_confirm` (hidden, bots fill it, humans don't)

### submit.html
- Standalone submission form — same fields as the index.html modal
- Has its own employer autocomplete (fetches from `reviews` where `status = 'approved'`)
- Posts to `/rest/v1/submissions` with `status: "pending"`
- Had a **critical bug (fixed June 2026):** duplicate `const SUPABASE_KEY` declaration in the same script block caused a silent SyntaxError that killed the entire script (no autocomplete, no submit). Fixed by removing the duplicate declaration.
- Honeypot field: `company_confirm`

### entry.html
- Fetches single review by ID from `reviews` where `status = 'approved'`
- Displays score badge with hover tooltip showing score breakdown by field
- Upvote ("Me Too") button — PATCHes `upvotes` on `reviews`, uses localStorage to prevent double-voting
- "Edit / Update" modal — submits to `submissions` with `update_notes: "Update to review ID {id}"` — goes through moderation before applying
- Share button uses Web Share API with clipboard fallback

### company.html
- URL param: `?name=CompanyName`
- Fetches all approved reviews for that employer
- Calculates and displays: total reviews, ghosted rate %, hires reported, avg response time (days), avg experience score
- Ghosting streak badge: shows if 3+ most recent reviews (by date_applied) are all ghosted
- Position filter (client-side, no DB call)

### leaderboard.html
- Fetches all approved reviews in one call (limit 1000): `/rest/v1/reviews?select=*&status=eq.approved`
- Aggregates client-side into company objects
- Four tabs: Worst Offenders (lowest avg score, min 3 reviews), Most Reviewed, Best Experience (highest avg score, min 3 reviews), Ghosting Rate (highest %, min 2 reviews)

### admin.html (LOCAL ONLY — NOT IN REPO)
- Password-protected (hardcoded password in file — reason it's gitignored)
- Three tabs: Pending, Approved, Rejected
- Pending tab reads from `submissions` where `status = 'pending'`
- Approved/Rejected tabs read from `reviews`
- Approve button: reads submission, checks `update_notes` for edit flag, either PATCHes existing review or POSTs new review, then marks submission as approved
- Reject button: PATCHes submission `status = 'rejected'`
- Verify toggle: PATCHes `verified = true/false` on `reviews`
- Stats tab: pulls counts from both tables
- **All fetch calls use `SUPABASE_ADMIN_KEY` (service role key)** — both reads and writes. The anon key (`SUPABASE_KEY`) is defined in the file but unused. The service role key bypasses RLS entirely.

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

15. **Do not add inline anchor tags to employer names on index.html cards.** Wrapping the employer name in an `<a>` tag to link to the employer profile page caused a card layout crash — the card grid jumbled and the display broke. The safe navigation path is the "Read All Reviews" button on each employer's static page and the company.html rollup. Do not revisit inline card linking without a fundamentally different implementation strategy.

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
