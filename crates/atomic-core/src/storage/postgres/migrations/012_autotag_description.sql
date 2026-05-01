-- Optional guidance injected next to top-level auto-tag targets in the tagging prompt.
ALTER TABLE tags ADD COLUMN IF NOT EXISTS autotag_description TEXT NOT NULL DEFAULT '';
