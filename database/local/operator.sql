INSERT INTO users (email, display_name, password_salt, password_hash, role) VALUES
  (
    'operator@retail.local',
    'Operations Manager',
    '8c603cc1f1d98e2ecbda4462785a6dc3',
    'c5cf7a87c25e2ca125c348379485d4785e9d5a9976f3df6fc0f185d771c0220f410e3cf76648612fbc9def6dbb76e0ef54b17467e9b40656e1f4193267e62c24',
    'operator'
  )
ON CONFLICT (email) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  password_salt = EXCLUDED.password_salt,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role;
