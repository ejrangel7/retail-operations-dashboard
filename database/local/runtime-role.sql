DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retail_app') THEN
    CREATE ROLE retail_app LOGIN PASSWORD 'retail_app';
  ELSE
    ALTER ROLE retail_app WITH LOGIN PASSWORD 'retail_app';
  END IF;
END $$;
