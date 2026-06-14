-- Per-user preferences: colour theme and the day the week starts on.
ALTER TABLE users ADD COLUMN theme      TEXT    NOT NULL DEFAULT 'auto'; -- 'auto' | 'light' | 'dark'
ALTER TABLE users ADD COLUMN week_start INTEGER NOT NULL DEFAULT 0;      -- 0 = Sunday, 1 = Monday
