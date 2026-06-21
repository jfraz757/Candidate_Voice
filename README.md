# CandidateVoice.org

**Exposing the Ghosters. Finding the Humans.**

CandidateVoice.org is an anonymous candidate experience review platform that gives job seekers honest, firsthand information about what it's actually like to apply to an organization. Built and operated by [Education to Action LLC](https://educationtoaction.net), Louisville, KY.

---

## What It Does

Job seekers submit anonymous reviews of their hiring experiences — what was required, how long it took, whether they heard back, and what the process felt like. The platform scores each experience, aggregates data by company, and surfaces patterns that help the next candidate walk in prepared — or choose to walk away.

**Live site:** [candidatevoice.org](https://candidatevoice.org)

---

## Features

- **Anonymous review submission** — no account required, email optional
- **Experience scoring** — proportional 0–100% score based on outcome, salary disclosure, application friction, and more
- **Company pages** — aggregate stats including ghosting rate, average score, response time, and hiring count
- **Leaderboard** — four tabs: Worst Offenders, Most Reviewed, Best Experience, Ghosting Rate
- **Ghosting streak tracker** — flags companies with 3+ consecutive ghosted reviews
- **Industry filter** — dynamic pills built from live database values
- **Employer autocomplete** — fuzzy search with favicon and review count on submission forms
- **"Me Too" button** — lets visitors signal shared experiences
- **Share a review** — Web Share API with clipboard fallback
- **Update your review** — submit an edit that goes through moderation before going live
- **Score breakdown tooltip** — hover the score badge to see exactly how each field contributed
- **Response time** — calculates and displays days between application and rejection where known
- **Honeypot bot protection** — on all submission forms
- **Admin panel** — local-only, password-protected moderation queue with approve/reject/verify workflow

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Database | Supabase (PostgreSQL) |
| Hosting | GitHub Pages |
| DNS / CDN | Cloudflare |
| Favicon lookup | Google Favicon API |

No frameworks. No build step. No dependencies beyond Google Fonts and the Supabase REST API.

---

## Project Structure

```
Candidate_Voice/
├── index.html          # Main directory — search, filters, card grid
├── entry.html          # Individual review detail page
├── company.html        # Company rollup page with aggregate stats
├── submit.html         # Standalone submission form
├── about.html          # About the platform and scoring methodology
├── leaderboard.html    # Hall of Shame & Honor — four ranked tabs
├── terms.html          # Community guidelines
├── tos.html            # Terms of service
├── assets/
│   ├── Logo_w_name.png
│   └── Logo_w_o_Name.png
└── CNAME               # candidatevoice.org
```

> **Note:** `admin.html` is excluded from this repository via `.gitignore`. The admin panel is run locally and never deployed publicly.

---

## Database Schema (Supabase)

Two tables: `reviews` (public-facing, approved records) and `submissions` (holding queue, never public).

**Key columns on `reviews`:**

| Column | Type | Description |
|---|---|---|
| employer_name | text | Company or recruitment agency |
| employer_website | text | Used for favicon display |
| position_applied | text | Job title |
| date_applied | date | |
| date_rejected | date | |
| ghosted_status | text | ghosted / formal_rejection / interviewing / got_the_job |
| salary_disclosed | text | yes / no / dont_remember |
| cover_letter_required | text | yes / no / optional |
| take_home_assignment | text | yes / no |
| essay_responses | text | yes / no |
| resume_reentry | text | yes / no |
| experience_score | numeric | 0–100, auto-calculated by trigger |
| score_band | text | poor / fair / good / excellent |
| industry | text | One of 17 defined industry categories |
| verified | boolean | Manually set via admin panel |
| status | text | approved / pending / rejected |
| upvotes | integer | "Me Too" count |

Scoring is handled by a PostgreSQL function (`calculate_experience_score`) that fires on insert and update via trigger (`set_experience_score`).

---

## Scoring Methodology

Scores are proportional — only answered fields count toward the total. Skipped and "don't remember" responses are excluded.

| Factor | Points if Positive | Max Points |
|---|---|---|
| Outcome: Got job / Interviewing | 25 | 30 |
| Outcome: Formal rejection (≤14 days) | 20 | 30 |
| Outcome: Ghosted | 0 | 30 |
| Salary disclosed | 15 | 15 |
| No cover letter required | 10 | 10 |
| Cover letter optional | 6 | 10 |
| No take-home assignment | 10 | 10 |
| No essay responses | 10 | 10 |
| No resume re-entry | 10 | 10 |

**Bands:** Poor < 25% · Fair 25–49% · Good 50–74% · Excellent 75%+

A ghosted-only entry scores Poor (0%). A timely formal rejection with no other data scores Good (~67%). Excellent requires a positive outcome plus multiple favorable application conditions.

---

## Running Locally

No build step required. Clone the repo and serve it over HTTP:

```bash
git clone https://github.com/jfraz757/Candidate_Voice.git
cd Candidate_Voice
python -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

> **Important:** Do not open the HTML files directly via `file://` — cross-origin restrictions will block Supabase API calls. Always use a local server.

---

## Deployment

The site deploys automatically to GitHub Pages on every push to `main`. Cloudflare handles DNS and CDN for `candidatevoice.org`. No CI/CD pipeline needed.

To deploy:

```bash
git add .
git commit -m "Your message"
git push
```

---

## Security Notes

- The Supabase anon key is intentionally public — it is designed to be exposed in client-side code and is scoped appropriately via Row Level Security on the `reviews` table
- The `submissions` table has RLS disabled; security is handled by the admin moderation queue
- `admin.html` is excluded from the repo and never deployed
- Honeypot fields on all submission forms provide basic bot protection
- Cloudflare Proxied mode provides additional DDoS and bot mitigation at the DNS layer

---

## Contact

**Education to Action LLC**
Louisville, Kentucky
education2action@gmail.com
[educationtoaction.net](https://educationtoaction.net)

---

## License

This project is the intellectual property of Education to Action LLC. The codebase is not open source. Do not reproduce, distribute, or repurpose without permission.
