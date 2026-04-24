-- Seed default users (password: secret123 for all)
INSERT INTO users (id, email, name, password_hash, role) VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'alice@specora.dev', 'Alice Chen', '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO', 'security_admin'),
  ('550e8400-e29b-41d4-a716-446655440002', 'bob@specora.dev', 'Bob Martinez', '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO', 'viewer'),
  ('550e8400-e29b-41d4-a716-446655440003', 'carol@specora.dev', 'Carol Wu', '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO', 'viewer'),
  ('550e8400-e29b-41d4-a716-446655440004', 'david@specora.dev', 'David Park', '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO', 'viewer'),
  ('550e8400-e29b-41d4-a716-446655440005', 'eva@specora.dev', 'Eva Schmidt', '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO', 'viewer'),
  ('550e8400-e29b-41d4-a716-446655440006', 'frank@specora.dev', 'Frank Okafor', '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO', 'viewer'),
  ('550e8400-e29b-41d4-a716-446655440007', 'grace@specora.dev', 'Grace Li', '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO', 'viewer')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role;
