INSERT INTO system_properties (key, value) VALUES
  ('security.password_policy', '{"minLength":8,"maxLength":128,"requireNumber":false,"requireSymbol":false,"requireUppercase":false,"requireLowercase":false}')
ON CONFLICT (key) DO NOTHING;
