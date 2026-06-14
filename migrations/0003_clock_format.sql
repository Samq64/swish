-- Per-user clock format preference.
ALTER TABLE users ADD COLUMN hour12 INTEGER NOT NULL DEFAULT 1; -- 1 = 12-hour (AM/PM), 0 = 24-hour
