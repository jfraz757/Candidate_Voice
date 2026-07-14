-- Add "Did you have a referral or reference when applying?" (yes/no)
-- Run once in the Supabase SQL Editor before deploying the updated pages.

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS had_referral text;
ALTER TABLE reviews     ADD COLUMN IF NOT EXISTS had_referral text;

-- Values: 'yes' / 'no' / NULL (skipped)
