// CandidateVoice — Employer SEO Page Generator
// Run from repo root: node generate-employer-pages.js
// Requires: npm install node-fetch (if Node < 18, otherwise fetch is built in)
//
// What this does:
//   1. Queries Supabase for all approved reviews
//   2. Aggregates stats per employer
//   3. Writes a static HTML file to /employers/{slug}.html for each employer, with its
//      reviews, a summary, and links to other employers in the same industry
//   4. Writes /employers/index.html listing every employer by industry
//   5. Writes /employers/sitemap.xml listing the main pages and every employer page
//
// After running: git add employers/ && git commit -m "Regenerate employer pages" && git push

const fs = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://lawteswyjpkovzagnshn.supabase.co";
const SUPABASE_KEY = "sb_publishable_piPBYVy1yGEj_Iv0RCLtnA_PGzdT1bz";
const SITE_URL     = "https://candidatevoice.org";
const OUT_DIR      = path.join(__dirname, "employers");

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function scoreColor(band) {
  const map = {
    poor:      { bg: "#fee2e2", text: "#dc2626" },
    fair:      { bg: "#fef3c7", text: "#d97706" },
    good:      { bg: "#d1fae5", text: "#059669" },
    excellent: { bg: "#fff7e6", text: "#f5a623" },
  };
  return map[band] || map.fair;
}

function avgScore(reviews) {
  const scored = reviews.filter(r => r.experience_score != null);
  if (!scored.length) return null;
  return Math.round(scored.reduce((s, r) => s + r.experience_score, 0) / scored.length);
}

function ghostRate(reviews) {
  const ghosted = reviews.filter(r => r.ghosted_status === "ghosted").length;
  return Math.round((ghosted / reviews.length) * 100);
}

function dominantBand(reviews) {
  const counts = {};
  reviews.forEach(r => {
    if (r.score_band) counts[r.score_band] = (counts[r.score_band] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "fair";
}

function avgResponseDays(reviews) {
  const timed = reviews.filter(r => r.date_applied && r.date_rejected);
  if (!timed.length) return null;
  const total = timed.reduce((s, r) => {
    const applied  = new Date(r.date_applied  + "T00:00:00");
    const rejected = new Date(r.date_rejected + "T00:00:00");
    return s + Math.max(0, (rejected - applied) / 86400000);
  }, 0);
  return Math.round(total / timed.length);
}

function hiresReported(reviews) {
  return reviews.filter(r => r.ghosted_status === "got_the_job").length;
}

function ghostingStreak(reviews) {
  const sorted = [...reviews].sort(
    (a, b) => new Date(b.date_applied + "T00:00:00") - new Date(a.date_applied + "T00:00:00")
  );
  let streak = 0;
  for (const r of sorted) {
    if (r.ghosted_status === "ghosted") streak++;
    else break;
  }
  return streak;
}

// ── Fetch all approved reviews ────────────────────────────────────────────────

async function fetchAllReviews() {
  const fields = [
    "id","employer_name","employer_website","ghosted_status","when_ghosted",
    "date_applied","date_rejected","experience_score","score_band","industry",
    "interview_invite","interview_rounds","salary_disclosed",
    "position_applied","review_general","review_best","review_worst"
  ].join(",");

  let all = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/reviews?select=${fields}&status=eq.approved&order=date_applied.desc.nullslast,id.desc&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    all = all.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return all;
}

// ── Group reviews by employer ─────────────────────────────────────────────────

// Grouped by slug, not exact name: "Mastercard" and "MasterCard" share one URL, and
// grouping by name wrote both pages to the same file, each run overwriting the other.
// The page uses the most common spelling (ties broken alphabetically, so it is stable).
function groupByEmployer(reviews) {
  const map = {};
  for (const r of reviews) {
    const name = r.employer_name.trim();
    const key = slugify(name);
    if (!key) continue;
    if (!map[key]) map[key] = { names: {}, website: null, reviews: [] };
    map[key].names[name] = (map[key].names[name] || 0) + 1;
    map[key].website = map[key].website || r.employer_website;
    map[key].reviews.push(r);
  }
  return Object.values(map).map(e => ({
    name: Object.entries(e.names).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    website: e.website,
    reviews: e.reviews,
  }));
}

// Every review value is escaped before it goes into a page: employer names, positions
// and review text all come from public submissions.
function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// JSON-LD for a page. "</" is escaped so a name can never close the script tag.
function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/<\//g, "<\\/")}</script>`;
}

function breadcrumbLd(crumbs) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
  };
}

// Writes only when the content differs, so unchanged pages keep their mtime (the
// sitemap's lastmod) and git only sees real changes. Line endings are normalised
// because git on Windows checks these out with CRLF.
function writeIfChanged(file, content) {
  let existing = null;
  try { existing = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"); } catch { /* new file */ }
  if (existing === content) return false;
  fs.writeFileSync(file, content, "utf8");
  return true;
}

function lastModified(file) {
  try { return fs.statSync(file).mtime.toISOString().split("T")[0]; }
  catch { return new Date().toISOString().split("T")[0]; }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2025-08-28" -> "Aug 2025" (no locale or timezone involved, so output is stable).
function monthYear(d) {
  const m = /^(\d{4})-(\d{2})/.exec(d || "");
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : "";
}

const STATUS_LABEL = {
  ghosted:          "👻 Ghosted",
  formal_rejection: "✉️ Formal rejection",
  interviewing:     "🤝 Interviewing",
  got_the_job:      "🎉 Got the job",
};
// Same labels as the live site's score badges; a ghosted review scores 0 and shows
// only its band.
const BAND_LABEL = { poor: "🔴 Poor", fair: "🟡 Fair", good: "🟢 Good", excellent: "⭐ Excellent" };
const WHEN_GHOSTED = {
  after_applying:         "after applying",
  after_interview_invite: "after an interview invite",
  after_interviewing:     "after interviewing",
  after_offer:            "after an offer",
};

// The most common industry across an employer's reviews.
function employerIndustry(reviews) {
  const counts = {};
  reviews.forEach(r => { if (r.industry) counts[r.industry] = (counts[r.industry] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
}

// A plain-language summary of the numbers, for readers and for search engines.
function employerSummary(employer) {
  const { name, reviews } = employer;
  const total = reviews.length;
  const ghosted = reviews.filter(r => r.ghosted_status === "ghosted").length;
  const rejected = reviews.filter(r => r.ghosted_status === "formal_rejection").length;
  const hires = hiresReported(reviews);
  const days = avgResponseDays(reviews);
  const score = avgScore(reviews);
  const industry = employerIndustry(reviews);
  const n = esc(name);
  const s = [];
  s.push(total === 1
    ? `One job applicant has shared their experience applying to ${n}${industry ? ` (${esc(industry)})` : ""} on CandidateVoice.`
    : `${total} job applicants have shared their experience applying to ${n}${industry ? ` (${esc(industry)})` : ""} on CandidateVoice.`);
  if (total === 1) {
    const r = reviews[0];
    s.push(r.ghosted_status === "ghosted" ? `They were ghosted: they never heard back${WHEN_GHOSTED[r.when_ghosted] ? " " + WHEN_GHOSTED[r.when_ghosted] : ""}.`
         : r.ghosted_status === "formal_rejection" ? "They received a formal rejection rather than being ghosted."
         : r.ghosted_status === "got_the_job" ? "They got the job."
         : r.ghosted_status === "interviewing" ? "They were still interviewing when they wrote their review." : "");
  } else {
    s.push(`${ghosted} of them (${ghostRate(reviews)}%) were ghosted, never hearing back, and ${rejected} received a formal rejection.`);
    if (hires) s.push(`${hires} reported getting the job.`);
  }
  if (days != null) s.push(`Applicants who got a decision waited ${days} day${days !== 1 ? "s" : ""} on average.`);
  if (score != null) s.push(`The average candidate experience score is ${score} out of 100.`);
  return s.filter(Boolean).join(" ");
}

function reviewCardHtml(r) {
  const details = [];
  const days = r.date_applied && r.date_rejected
    ? Math.max(0, Math.round((new Date(r.date_rejected + "T00:00:00") - new Date(r.date_applied + "T00:00:00")) / 86400000))
    : null;
  if (r.ghosted_status === "ghosted" && WHEN_GHOSTED[r.when_ghosted]) details.push(`Ghosted ${WHEN_GHOSTED[r.when_ghosted]}`);
  if (days != null) details.push(`Heard back in ${days} day${days !== 1 ? "s" : ""}`);
  if (r.interview_invite === "yes") details.push(r.interview_rounds ? `${r.interview_rounds} interview round${r.interview_rounds !== 1 ? "s" : ""}` : "Invited to interview");
  if (r.salary_disclosed === "yes") details.push("Salary disclosed");
  if (r.salary_disclosed === "no") details.push("Salary not disclosed");
  const text = [
    r.review_general && `<p class="review-text">${esc(r.review_general)}</p>`,
    r.review_best && `<p class="review-text"><strong>Best part:</strong> ${esc(r.review_best)}</p>`,
    r.review_worst && `<p class="review-text"><strong>Worst part:</strong> ${esc(r.review_worst)}</p>`,
  ].filter(Boolean).join("");
  const { bg, text: fg } = scoreColor(r.score_band);
  return `
    <article class="review">
      <div class="review-head">
        <h3 class="review-position">${esc(r.position_applied) || "Position not specified"}</h3>
        <span class="review-date">${monthYear(r.date_applied)}</span>
      </div>
      <div class="review-tags">
        ${STATUS_LABEL[r.ghosted_status] ? `<span class="review-status status-${esc(r.ghosted_status)}">${STATUS_LABEL[r.ghosted_status]}</span>` : ""}
        ${r.score_band ? `<span class="review-score" style="background:${bg};color:${fg};">${BAND_LABEL[r.score_band] || ""}${r.experience_score ? ` · ${Math.round(r.experience_score)}/100` : ""}</span>` : ""}
      </div>
      ${details.length ? `<div class="review-details">${details.join(" · ")}</div>` : ""}
      ${text}
      <a class="review-link" href="${SITE_URL}/entry?id=${encodeURIComponent(r.id)}">Full review →</a>
    </article>`;
}

// Shared page chrome for employer pages and the employer index.
function pageShell({ title, description, canonical, ld, extraCss, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${SITE_URL}/assets/share_card.png?v=2" />
  <link rel="canonical" href="${canonical}" />
  <link rel="icon" type="image/x-icon" href="/assets/favicon.ico" />
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f5f6fa; color: #1a1a2e; }
    .nav {
      background: #0d2d6b; padding: 0 1.5rem;
      display: flex; align-items: center; gap: 1rem; height: 56px;
    }
    .nav img { height: 32px; }
    .nav a {
      color: #fff; text-decoration: none; font-size: 13px; font-weight: 500;
      padding: 6px 14px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.3);
      white-space: nowrap;
    }
    .nav a.nav-logo { border: none; padding: 0; }
    .nav a:hover { background: rgba(255,255,255,0.12); }
    .container { max-width: 760px; margin: 2rem auto; padding: 0 1.25rem; }
    .crumbs { font-size: 12px; color: #6b7280; margin-bottom: 1rem; }
    .crumbs a { color: #1a4fa0; text-decoration: none; }
    .crumbs a:hover { text-decoration: underline; }
    .card {
      background: #fff; border: 1px solid #e8eaf0; border-radius: 16px;
      padding: 1.5rem; margin-bottom: 1.25rem;
    }
    .card h2 { font-size: 1rem; font-weight: 700; color: #0d2d6b; margin-bottom: 0.75rem; }
    .summary { font-size: 15px; line-height: 1.7; color: #374151; }
    .link-list { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; }
    .link-list a {
      display: inline-block; font-size: 13px; padding: 5px 12px; border-radius: 20px;
      color: #1a4fa0; text-decoration: none; border: 1px solid #c7d2fe; background: #f8faff;
    }
    .link-list a:hover { background: #1a4fa0; color: #fff; }
    .link-list .count { color: #6b7280; margin-left: 6px; font-size: 12px; }
    .link-list a:hover .count { color: #dbeafe; }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; padding: 2rem 0; }
    .footer a { color: #6b7280; text-decoration: none; }
    @media (max-width: 600px) {
      .nav { padding: 0 1rem; gap: 0.5rem; }
      .nav a { font-size: 12px; padding: 5px 10px; }
      .nav a.nav-hide-sm { display: none; }
    }
${extraCss || ""}  </style>
  ${ld.map(jsonLd).join("\n  ")}
</head>
<body>

<nav class="nav">
  <a class="nav-logo" href="${SITE_URL}/">
    <img src="${SITE_URL}/assets/Logo_w_name.png" alt="CandidateVoice.org" />
  </a>
  <a class="nav-hide-sm" href="${SITE_URL}/">← All Reviews</a>
  <a href="${SITE_URL}/employers/">Employers</a>
  <a class="nav-hide-sm" href="${SITE_URL}/leaderboard">Leaderboard</a>
  <a href="${SITE_URL}/submit">+ Share</a>
</nav>

<div class="container">
${body}
</div>

<footer class="footer">
  © 2025 CandidateVoice.org &nbsp;|&nbsp;
  <a href="${SITE_URL}/employers/">All Employers</a> &nbsp;|&nbsp;
  <a href="${SITE_URL}/about">About</a> &nbsp;|&nbsp;
  <a href="${SITE_URL}/terms">Community Guidelines</a>
</footer>

</body>
</html>`;
}

const EMPLOYER_CSS = `    .header {
      background: #fff; border: 1px solid #e8eaf0; border-radius: 16px;
      padding: 1.75rem; margin-bottom: 1.25rem;
      display: flex; align-items: center; gap: 1rem;
    }
    .header img { width: 40px; height: 40px; border-radius: 8px; }
    .header h1 { font-size: 1.5rem; font-weight: 700; color: #0d2d6b; }
    .header .review-count { font-size: 14px; color: #6b7280; margin-top: 4px; }
    .streak-badge {
      background: #fee2e2; color: #dc2626; font-size: 13px; font-weight: 600;
      padding: 8px 14px; border-radius: 10px; margin-bottom: 1.25rem;
      border: 1px solid #fca5a5;
    }
    .stats-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem; margin-bottom: 1.25rem;
    }
    .stat-card {
      background: #fff; border: 1px solid #e8eaf0; border-radius: 14px;
      padding: 1.25rem; text-align: center;
    }
    .stat-label { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #1a4fa0; line-height: 1; }
    .stat-unit { font-size: 1rem; font-weight: 400; color: #6b7280; }
    .score-band {
      display: inline-block; font-size: 11px; font-weight: 600;
      padding: 3px 10px; border-radius: 20px; margin-top: 6px; text-transform: capitalize;
    }
    .review { padding: 1rem 0; border-bottom: 1px solid #eef0f5; }
    .review:first-of-type { padding-top: 0; }
    .review:last-of-type { border-bottom: none; padding-bottom: 0; }
    .review-head { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; }
    .review-position { font-size: 15px; font-weight: 600; color: #1a1a2e; }
    .review-date { font-size: 12px; color: #9ca3af; white-space: nowrap; }
    .review-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .review-status, .review-score { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
    .review-status { background: #eef2ff; color: #1a4fa0; }
    .status-ghosted { background: #fee2e2; color: #dc2626; }
    .status-got_the_job { background: #d1fae5; color: #059669; }
    .review-details { font-size: 13px; color: #6b7280; margin-top: 8px; }
    .review-text { font-size: 14px; line-height: 1.65; color: #374151; margin-top: 8px; }
    .review-link { display: inline-block; font-size: 13px; font-weight: 600; color: #1a4fa0; text-decoration: none; margin-top: 8px; }
    .review-link:hover { text-decoration: underline; }
    .cta { text-align: center; }
    .cta p { font-size: 15px; color: #374151; margin-bottom: 1rem; }
    .btn-primary, .btn-secondary {
      display: inline-block; color: #fff; font-weight: 600; font-size: 14px;
      padding: 10px 22px; border-radius: 20px; text-decoration: none; margin: 4px 6px;
    }
    .btn-primary { background: #f5a623; }
    .btn-secondary { background: #1a4fa0; }
`;

// ── Generate individual employer HTML ─────────────────────────────────────────

function buildEmployerPage(employer, related) {
  const { name, website, reviews } = employer;
  const slug      = slugify(name);
  const n         = esc(name);
  const score     = avgScore(reviews);
  const band      = dominantBand(reviews);
  const ghost     = ghostRate(reviews);
  const days      = avgResponseDays(reviews);
  const hires     = hiresReported(reviews);
  const streak    = ghostingStreak(reviews);
  const total     = reviews.length;
  const industry  = employerIndustry(reviews);
  const { bg, text } = scoreColor(band);
  const pageUrl   = `${SITE_URL}/employers/${slug}`;
  const faviconUrl = website
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(website)}&sz=32`
    : null;
  const websiteHref = website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : null;

  const streakBadge = streak >= 3
    ? `<div class="streak-badge">🚨 Ghosting streak: ${streak} consecutive</div>`
    : "";

  const scoreStat = score != null
    ? `<div class="stat-card">
        <div class="stat-label">Avg experience score</div>
        <div class="stat-value" style="color:${text};">${score}<span class="stat-unit">/100</span></div>
        <div class="score-band" style="background:${bg};color:${text};">${band}</div>
       </div>`
    : "";

  const daysStat = days != null
    ? `<div class="stat-card">
        <div class="stat-label">Avg response time</div>
        <div class="stat-value">${days}<span class="stat-unit"> days</span></div>
       </div>`
    : "";

  const title = `${n} Hiring Process Reviews: ${ghost}% Ghosting Rate | CandidateVoice`;
  const description = `See ${total} candidate review${total !== 1 ? "s" : ""} of ${n}'s hiring process: ${ghost}% ghosting rate${days != null ? `, ${days}-day average response time` : ""}${score != null ? `, ${score}/100 experience score` : ""}. Submitted by real job applicants on CandidateVoice.`;

  const crumbs = [
    { name: "Employers", url: `${SITE_URL}/employers/` },
    ...(industry ? [{ name: industry, url: `${SITE_URL}/employers/#${slugify(industry)}` }] : []),
    { name, url: pageUrl },
  ];
  const ld = [{
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    ...(websiteHref ? { url: websiteHref, sameAs: [websiteHref] } : {}),
  }, breadcrumbLd(crumbs)];

  const relatedHtml = related.length ? `
  <div class="card">
    <h2>Other ${esc(industry)} employers</h2>
    <ul class="link-list">${related.map(e =>
      `<li><a href="${SITE_URL}/employers/${slugify(e.name)}">${esc(e.name)}<span class="count">${e.reviews.length}</span></a></li>`).join("")}</ul>
  </div>` : "";

  const body = `
  <nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) =>
    i === crumbs.length - 1 ? esc(c.name) : `<a href="${c.url}">${esc(c.name)}</a>`).join(" › ")}</nav>

  <div class="header">
    ${faviconUrl ? `<img src="${faviconUrl}" alt="${n} logo" />` : ""}
    <div>
      <h1>${n} Hiring Process Reviews</h1>
      <div class="review-count">${total} candidate review${total !== 1 ? "s" : ""} submitted${industry ? ` · ${esc(industry)}` : ""}</div>
    </div>
  </div>

  ${streakBadge}

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Ghosting rate</div>
      <div class="stat-value">${ghost}<span class="stat-unit">%</span></div>
    </div>
    ${scoreStat}
    ${daysStat}
    <div class="stat-card">
      <div class="stat-label">Hires reported</div>
      <div class="stat-value">${hires}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total reviews</div>
      <div class="stat-value">${total}</div>
    </div>
  </div>

  <div class="card">
    <h2>What applicants report about ${n}</h2>
    <p class="summary">${employerSummary(employer)}</p>
  </div>

  <div class="card">
    <h2>${total} candidate review${total !== 1 ? "s" : ""}</h2>
    ${reviews.map(reviewCardHtml).join("")}
  </div>

  <div class="card cta">
    <p>Applied to ${n}? Share your experience to help the next applicant, or join the discussion.</p>
    <a class="btn-primary" href="${SITE_URL}/submit">Share Your Experience</a>
    <a class="btn-secondary" href="${SITE_URL}/company?name=${encodeURIComponent(name)}#comments">Discuss ${n}</a>
  </div>
${relatedHtml}`;

  return pageShell({ title, description, canonical: pageUrl, ld, extraCss: EMPLOYER_CSS, body });
}

// ── Employer index (/employers/) ──────────────────────────────────────────────

function buildEmployerIndex(employers) {
  const url = `${SITE_URL}/employers/`;
  const groups = {};
  for (const e of employers) (groups[employerIndustry(e.reviews) || "Other"] = groups[employerIndustry(e.reviews) || "Other"] || []).push(e);
  const order = Object.keys(groups).sort((a, b) => (a === "Other") - (b === "Other") || groups[b].length - groups[a].length || a.localeCompare(b));
  const totalReviews = employers.reduce((s, e) => s + e.reviews.length, 0);
  const description = `Hiring process reviews for ${employers.length} employers from ${totalReviews} real job applicants: ghosting rates, response times, and candidate experience scores, by industry.`;
  const body = `
  <div class="card">
    <h1 style="font-size:1.5rem;color:#0d2d6b;margin-bottom:0.5rem;">Employer Hiring Reviews</h1>
    <p class="summary">${esc(description)} Jump to an industry:</p>
    <ul class="link-list" style="margin-top:0.75rem;">${order.map(g =>
      `<li><a href="#${slugify(g)}">${esc(g)}<span class="count">${groups[g].length}</span></a></li>`).join("")}</ul>
  </div>
${order.map(g => `
  <div class="card" id="${slugify(g)}">
    <h2>${esc(g)}</h2>
    <ul class="link-list">${groups[g].sort((a, b) => a.name.localeCompare(b.name)).map(e =>
      `<li><a href="${SITE_URL}/employers/${slugify(e.name)}">${esc(e.name)}<span class="count">${e.reviews.length}</span></a></li>`).join("")}</ul>
  </div>`).join("")}`;
  const ld = [{ "@context": "https://schema.org", "@type": "CollectionPage", name: "Employer Hiring Reviews", url, description },
              breadcrumbLd([{ name: "Employers", url }])];
  return pageShell({ title: "Employer Hiring Process Reviews & Ghosting Rates | CandidateVoice", description: esc(description), canonical: url, ld, body });
}

// ── Generate sitemap ──────────────────────────────────────────────────────────

// lastmod is each file's mtime: pages are only rewritten when their content changes,
// so it is the date the page last really changed (a lastmod that is always "today"
// teaches search engines to ignore it).
function buildSitemap(employers) {
  const page = (loc, file, freq, priority) => `
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastModified(file)}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  const urls = employers.map(e =>
    page(`${SITE_URL}/employers/${slugify(e.name)}`, path.join(OUT_DIR, `${slugify(e.name)}.html`), "weekly", "0.7")).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
  page(`${SITE_URL}/`, path.join(__dirname, "index.html"), "daily", "1.0")}${
  page(`${SITE_URL}/leaderboard`, path.join(__dirname, "leaderboard.html"), "daily", "0.8")}${
  page(`${SITE_URL}/employers/`, path.join(OUT_DIR, "index.html"), "weekly", "0.8")}${
  page(`${SITE_URL}/about`, path.join(__dirname, "about.html"), "monthly", "0.5")}${
  page(`${SITE_URL}/submit`, path.join(__dirname, "submit.html"), "monthly", "0.5")}${urls}
</urlset>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching reviews from Supabase...");
  const reviews = await fetchAllReviews();
  console.log(`  ${reviews.length} approved reviews fetched.`);

  const employers = groupByEmployer(reviews);
  console.log(`  ${employers.length} employers found.`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

  // Up to 8 other employers in the same industry, most-reviewed first.
  const byIndustry = {};
  for (const e of employers) {
    const ind = employerIndustry(e.reviews);
    if (ind) (byIndustry[ind] = byIndustry[ind] || []).push(e);
  }
  const relatedTo = e => (byIndustry[employerIndustry(e.reviews)] || [])
    .filter(o => o !== e)
    .sort((a, b) => b.reviews.length - a.reviews.length || a.name.localeCompare(b.name))
    .slice(0, 8);

  let written = 0;
  for (const employer of employers) {
    const slug = slugify(employer.name);
    if (writeIfChanged(path.join(OUT_DIR, `${slug}.html`), buildEmployerPage(employer, relatedTo(employer)))) written++;
  }
  if (writeIfChanged(path.join(OUT_DIR, "index.html"), buildEmployerIndex(employers))) written++;
  console.log(`  ${written} page(s) written to /employers/ (${employers.length} employers + index), the rest unchanged.`);

  // Remove pages for employers that no longer have approved reviews under that name
  // (renamed or merged in admin, or reviews removed), so stale pages stop being served.
  // Removed pages are git-tracked, so `git checkout` brings one back if needed.
  // Guard: if the fetch came back much smaller than the folder, remove nothing.
  const current = new Set(["index.html", ...employers.map(e => `${slugify(e.name)}.html`)]);
  const onDisk = fs.readdirSync(OUT_DIR).filter(f => f.endsWith(".html"));
  const orphans = onDisk.filter(f => !current.has(f));
  if (orphans.length && current.size < onDisk.length * 0.9) {
    console.log(`  !! ${orphans.length} page(s) have no matching employer, but only ${current.size - 1} employers ` +
                `were fetched for ${onDisk.length - 1} pages -- NOT removing anything. Check the fetch.`);
  } else if (orphans.length) {
    for (const f of orphans) fs.unlinkSync(path.join(OUT_DIR, f));
    console.log(`  ${orphans.length} page(s) removed for employers no longer listed: ${orphans.join(", ")}`);
  }

  if (writeIfChanged(path.join(OUT_DIR, "sitemap.xml"), buildSitemap(employers))) {
    console.log("  sitemap.xml written to /employers/");
  } else {
    console.log("  sitemap.xml unchanged.");
  }

  console.log("\nDone. Next steps:");
  console.log("  git add employers/");
  console.log('  git commit -m "Regenerate employer SEO pages"');
  console.log("  git push");
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
