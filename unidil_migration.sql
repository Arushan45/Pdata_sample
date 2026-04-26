BEGIN;

TRUNCATE TABLE production_data, plant_schemas RESTART IDENTITY CASCADE;

ALTER TABLE production_data
ADD COLUMN IF NOT EXISTS production_date DATE DEFAULT CURRENT_DATE;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    plant_id INTEGER NOT NULL DEFAULT 3
);

INSERT INTO plant_schemas (plant_id, plant_name, form_schema)
VALUES (
    3,
    'UNIDIL',
    '{
      "fields": [
        { "name": "planned_corrugator_mt", "label": "1. Planned: Corrugator (MT)", "type": "number" },
        { "name": "planned_tuber_qty", "label": "1. Planned: Tuber (Qty)", "type": "number" },
        { "name": "actual_corrugator_mt", "label": "2. Actual: Corrugator (MT)", "type": "number" },
        { "name": "actual_printing_mt", "label": "2. Actual: Printing (MT)", "type": "number" },
        { "name": "actual_finishing_mt", "label": "2. Actual: Finishing (MT)", "type": "number" },
        { "name": "actual_tuber_qty", "label": "2. Actual: Tuber (Qty)", "type": "number" },
        { "name": "yield_corrugator_pct", "label": "3. Yield: Corrugator (%)", "type": "number" },
        { "name": "yield_tuber_pct", "label": "3. Yield: Tuber (%)", "type": "number" },
        { "name": "rejections_corrugator_mt", "label": "4. Rejections: Corrugator (MT)", "type": "number" },
        { "name": "rejections_tuber_qty", "label": "4. Rejections: Tuber (Qty)", "type": "number" },
        { "name": "stoppages_corrugator_min", "label": "5. Stoppages: Corrugator (min)", "type": "number" },
        { "name": "stoppages_printing_h", "label": "5. Stoppages: Printing (h)", "type": "number" },
        { "name": "stoppages_tuber_min", "label": "5. Stoppages: Tuber (min)", "type": "number" }
      ]
    }'::jsonb
);

COMMIT;
