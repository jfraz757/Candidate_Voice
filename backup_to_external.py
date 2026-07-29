"""
Back both website repos up to the external drive, including the files git does not track.

    python backup_to_external.py

Covers Candidate_Voice AND The_Peoples_Ledger -- it is a machine-level utility that happens
to live in this repo, not a Candidate Voice script.

WHY THIS EXISTS
GitHub already holds every tracked file, so this is not about the code. It is about the
files deliberately excluded from both repos, which exist on exactly one disk:

  * admin.html          -- both projects. Gitignored because it holds the service role key.
                           It also holds the July 2026 XSS fix, which therefore lives in no
                           repository. Nothing warns you if an older copy overwrites it.
  * .env                -- Anthropic, SerpApi and Supabase keys.
  * data/               -- The Peoples Ledger, ~700 MB of scraped CSVs, caches and
                           checkpoints. Rebuilding it costs paid SerpApi calls.
  * backups/            -- the Supabase JSON dumps. Until now the database backup and the
                           thing it protects against lived on the same disk, which protects
                           you from someone deleting the database but not from losing the
                           machine.

COPY, NOT MIRROR
Uses robocopy /E, not /MIR. /MIR deletes anything at the destination that is gone from the
source -- which would faithfully propagate the exact event a backup is meant to survive
(accidental or malicious deletion). /E only ever adds and updates. Files deleted locally
linger here, which is the correct bias for a backup and costs nothing at this size.

SECRETS ON A PORTABLE DISK
This copies admin.html and .env, so live service role keys and API keys land on the external
drive in plaintext. That is the point -- they are what most needs backing up -- but it means
losing the drive is equivalent to leaking those keys. If that is not an acceptable trade,
encrypt the drive (BitLocker) rather than excluding these files, because excluding them
defeats the purpose.
"""

import subprocess
import sys
from datetime import datetime
from pathlib import Path

DEST_ROOT = Path(r"D:\Website_Backups")

SOURCES = [
    Path(r"C:\Users\jfraz\Candidate_Voice"),
    Path(r"C:\Users\jfraz\The_Peoples_Ledger"),
]

# robocopy returns a bitmask, not a plain status. 0=nothing to do, 1=copied, 2=extra files
# present at destination, 4=mismatches, 8+=real failure. Anything under 8 is success.
ROBOCOPY_FAILURE_THRESHOLD = 8


def check_drive():
    """Fail loudly if the external drive is not mounted, rather than silently doing nothing."""
    drive = Path(DEST_ROOT.anchor)
    if not drive.exists():
        sys.exit(f"{drive} is not available. Connect the external drive and re-run.")
    try:
        DEST_ROOT.mkdir(parents=True, exist_ok=True)
        probe = DEST_ROOT / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError as e:
        sys.exit(f"{DEST_ROOT} is not writable: {e}")


def copy_repo(src, log_path):
    dest = DEST_ROOT / "repos" / src.name
    dest.mkdir(parents=True, exist_ok=True)

    # /E     include subdirectories, including empty ones (and everything gitignored)
    # /NFL /NDL  no per-file/per-dir spam; we only want the summary
    # /NP    no per-file percentage (it floods a captured stdout)
    # /R:2 /W:2  two retries, two-second wait -- an external drive hiccup should not hang
    # /XJ    skip junctions/symlinks, which can otherwise loop
    # /TEE   write to console and the log file
    result = subprocess.run(
        ["robocopy", str(src), str(dest), "/E", "/NFL", "/NDL", "/NP",
         "/R:2", "/W:2", "/XJ", "/TEE", f"/LOG+:{log_path}"],
        capture_output=True, text=True,
    )
    return result.returncode, dest


def main():
    check_drive()
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    log_path = DEST_ROOT / f"backup_log_{stamp}.txt"

    print(f"Destination: {DEST_ROOT}")
    failures = []

    for src in SOURCES:
        if not src.exists():
            print(f"  SKIP  {src.name} -- source not found")
            failures.append(src.name)
            continue

        code, dest = copy_repo(src, log_path)
        status = "OK" if code < ROBOCOPY_FAILURE_THRESHOLD else f"FAILED (robocopy {code})"
        if code >= ROBOCOPY_FAILURE_THRESHOLD:
            failures.append(src.name)

        files = sum(1 for _ in dest.rglob("*") if _.is_file())
        size_mb = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file()) / (1024 * 1024)
        print(f"  {status:22} {src.name:22} {files:>6} files  {size_mb:>8.1f} MB")

    # Confirm the files that exist nowhere else actually made it. A backup that silently
    # skipped admin.html would be worse than no backup, because you would trust it.
    print("\nUntracked-file check (these exist in no repository):")
    critical = [
        DEST_ROOT / "repos" / "Candidate_Voice" / "admin.html",
        DEST_ROOT / "repos" / "The_Peoples_Ledger" / "admin.html",
        DEST_ROOT / "repos" / "The_Peoples_Ledger" / ".env",
    ]
    for c in critical:
        if c.exists():
            print(f"  present  {c.relative_to(DEST_ROOT)}  ({c.stat().st_size:,} bytes)")
        else:
            print(f"  MISSING  {c.relative_to(DEST_ROOT)}")
            failures.append(str(c.name))

    print(f"\nLog: {log_path}")
    if failures:
        sys.exit(f"FAILED for: {', '.join(sorted(set(failures)))}")
    print("All sources backed up.")


if __name__ == "__main__":
    main()
