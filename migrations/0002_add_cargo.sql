-- Separate cargo/trailer bikes from regular bikes. The GBFS 2-2 feed exposes
-- vehicle_types; cargo bikes are form_factor "cargo_bicycle" (vehicle_type_id 14
-- as of 2026). Previously they were silently folded into num_bikes_available and
-- inflated the "mechanical" count. Rows predating this default to 0.
ALTER TABLE observations ADD COLUMN cargo INTEGER NOT NULL DEFAULT 0;
