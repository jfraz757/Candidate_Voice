// CandidateVoice — Employer SEO Page Generator
// Run from repo root: node generate-employer-pages.js
// Requires: npm install node-fetch (if Node < 18, otherwise fetch is built in)
//
// What this does:
//   1. Queries Supabase for all approved reviews
//   2. Aggregates stats per employer
//   3. Writes a static HTML file to /employers/{slug}.html for each employer
//   4. Writes /employers/sitemap.xml listing every employer page
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
    "interview_invite","interview_rounds","salary_disclosed"
  ].join(",");

  let all = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/reviews?select=${fields}&status=eq.approved&order=date_applied.desc&limit=${limit}&offset=${offset}`;
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

function groupByEmployer(reviews) {
  const map = {};
  for (const r of reviews) {
    const key = r.employer_name.trim();
    if (!map[key]) map[key] = { name: key, website: r.employer_website, reviews: [] };
    map[key].reviews.push(r);
  }
  return Object.values(map).filter(e => e.reviews.length >= 1);
}

// ── Generate individual employer HTML ─────────────────────────────────────────

function buildEmployerPage(employer) {
  const { name, website, reviews } = employer;
  const slug      = slugify(name);
  const score     = avgScore(reviews);
  const band      = dominantBand(reviews);
  const ghost     = ghostRate(reviews);
  const days      = avgResponseDays(reviews);
  const hires     = hiresReported(reviews);
  const streak    = ghostingStreak(reviews);
  const total     = reviews.length;
  const { bg, text } = scoreColor(band);
  const faviconUrl = website
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(website)}&sz=32`
    : null;

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

  const description = `See ${total} candidate review${total !== 1 ? "s" : ""} of ${name}'s hiring process. ${ghost}% ghosting rate. Submitted by real job applicants on CandidateVoice.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name} Hiring Experience Reviews | CandidateVoice</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${name} Hiring Reviews | CandidateVoice" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${SITE_URL}/employers/${slug}.html" />
  <meta property="og:type" content="website" />
  <link rel="canonical" href="${SITE_URL}/employers/${slug}.html" />
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
    }
    .nav a:hover { background: rgba(255,255,255,0.12); }
    .container { max-width: 760px; margin: 2rem auto; padding: 0 1.25rem; }
    .header {
      background: #fff; border: 1px solid #e8eaf0; border-radius: 16px;
      padding: 1.75rem; margin-bottom: 1.25rem;
      display: flex; align-items: center; gap: 1rem;
    }
    .header img { width: 40px; height: 40px; border-radius: 8px; }
    .header h1 { font-size: 1.5rem; font-weight: 700; color: #0d2d6b; }
    .header .review-count { font-size: 14px; color: #6b7280; margin-top: 4px; }
    ${streakBadge ? `.streak-badge {
      background: #fee2e2; color: #dc2626; font-size: 13px; font-weight: 600;
      padding: 8px 14px; border-radius: 10px; margin-bottom: 1.25rem;
      border: 1px solid #fca5a5;
    }` : ""}
    .stats-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
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
    .cta {
      background: #fff; border: 1px solid #e8eaf0; border-radius: 16px;
      padding: 1.5rem; text-align: center; margin-bottom: 1.25rem;
    }
    .cta p { font-size: 15px; color: #374151; margin-bottom: 1rem; }
    .btn-primary {
      display: inline-block; background: #f5a623; color: #fff;
      font-weight: 600; font-size: 14px; padding: 10px 22px;
      border-radius: 20px; text-decoration: none; margin: 0 6px;
    }
    .btn-secondary {
      display: inline-block; background: #1a4fa0; color: #fff;
      font-weight: 600; font-size: 14px; padding: 10px 22px;
      border-radius: 20px; text-decoration: none; margin: 0 6px;
    }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; padding: 2rem 0; }
    .footer a { color: #6b7280; text-decoration: none; }
  </style>
</head>
<body>

<nav class="nav">
  <a href="${SITE_URL}/index.html">
    <img src="${SITE_URL}/assets/Logo_w_name.png" alt="CandidateVoice.org" />
  </a>
  <a href="${SITE_URL}/index.html">← All Reviews</a>
  <a href="${SITE_URL}/leaderboard.html">Leaderboard</a>
  <a href="${SITE_URL}/submit.html">+ Share Your Experience</a>
</nav>

<div class="container">

  <div class="header">
    ${faviconUrl ? `<img src="${faviconUrl}" alt="${name} logo" />` : ""}
    <div>
      <h1>${name}</h1>
      <div class="review-count">${total} candidate review${total !== 1 ? "s" : ""} submitted</div>
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

  <div class="cta">
    <p>Read all ${total} candidate review${total !== 1 ? "s" : ""} or share your own experience applying to ${name}.</p>
    <a class="btn-secondary" href="${SITE_URL}/company.html?name=${encodeURIComponent(name)}">Read All Reviews</a>
    <a class="btn-primary" href="${SITE_URL}/submit.html">Share Your Experience</a>
  </div>

</div>

<footer class="footer">
  © 2025 CandidateVoice.org &nbsp;|&nbsp;
  <a href="${SITE_URL}/about.html">About</a> &nbsp;|&nbsp;
  <a href="${SITE_URL}/terms.html">Community Guidelines</a>
</footer>

</body>
</html>`;
}

// ── Generate sitemap ──────────────────────────────────────────────────────────

function buildSitemap(employers) {
  const today = new Date().toISOString().split("T")[0];
  const urls = employers.map(e => `
  <url>
    <loc>${SITE_URL}/employers/${slugify(e.name)}.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/index.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/leaderboard.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>${urls}
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

  let written = 0;
  for (const employer of employers) {
    const slug = slugify(employer.name);
    const html = buildEmployerPage(employer);
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.html`), html, "utf8");
    written++;
  }
  console.log(`  ${written} employer pages written to /employers/`);

  const sitemap = buildSitemap(employers);
  fs.writeFileSync(path.join(OUT_DIR, "sitemap.xml"), sitemap, "utf8");
  console.log("  sitemap.xml written to /employers/");

  console.log("\nDone. Next steps:");
  console.log("  git add employers/");
  console.log('  git commit -m "Regenerate employer SEO pages"');
  console.log("  git push");
  console.log("\nThen submit your sitemap to Google Search Console:");
  console.log("  https://search.google.com/search-console");
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
