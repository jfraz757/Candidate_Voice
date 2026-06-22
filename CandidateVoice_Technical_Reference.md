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

**Supabase credentials (used in every page):**
```
SUPABASE_URL = "https://lawteswyjpkovzagnshn.supabase.co"
SUPABASE_KEY = "sb_publishable_piPBYVy1yGEj_Iv0RCLtnA_PGzdT1bz"
```
The anon key is intentionally public — scoped by RLS policies.

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
| status | text | pending / approved / rejected |
| created_at | timestamp with time zone | |
| industry | text | |
| update_notes | text | Used to flag edits — format: "Update to review ID {id}" |

---

## 5. RLS Policies (Row Level Security)

RLS is enabled on both tables. Current policies:

### `reviews`
- Public can SELECT where `status = 'approved'`
- Public can PATCH upvotes (used by "Me Too" / upvote feature)
- Admin can do full CRUD via the anon key (no separate admin role — security is via the local-only admin.html)

### `submissions`
- **"Public insert submissions"** — INSERT allowed for anon + authenticated — `with_check = true`
- **"Allow update submissions"** — UPDATE allowed (added June 2026) — needed for admin approval/reject workflow
- **"Allow select submissions"** — SELECT allowed (added June 2026) — needed for admin page to read pending queue

**Important:** If you add new RLS policies or modify existing ones, test both the public submission form AND the admin approval workflow. Both depend on these policies.

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

This fix has been applied to admin.html. Check for this pattern in any file that renders `date_applied` or `date_rejected`. The `created_at` field is a full timestamp with timezone and does NOT need this fix.

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

---

## 11. Design System

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

## 12. Checklist Before Making Changes

Before editing any file, confirm:

- [ ] Which table does this feature read from / write to? (`reviews` = public approved, `submissions` = pending moderation queue)
- [ ] Does the change affect the submission flow? Test both index.html modal AND submit.html
- [ ] Does the change affect the admin approval flow? Test approve, reject, and edit-approval paths
- [ ] Are any date fields rendered with `new Date()`? If so, append `T00:00:00` for plain date columns
- [ ] Does the change add or modify RLS policies? If so, test both anonymous public access AND admin access
- [ ] Is `const SUPABASE_KEY` declared only once per script block?
- [ ] Is admin.html being pushed to GitHub? (It should never be — it's gitignored)
- [ ] Does the scoring need to change? If so, update the PostgreSQL trigger, not the JavaScript
