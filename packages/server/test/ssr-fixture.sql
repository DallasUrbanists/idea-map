-- Synthetic fixture for a disposable idea_map_test_ database only.
INSERT INTO contacts (id, normalized_email) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'private-contact@example.invalid');
INSERT INTO ideas (id, author_contact_id, publication_state) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'approved'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'private'),
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'approved');
INSERT INTO idea_revisions (id, idea_id, version, content, review_state) VALUES
  ('aaaaaaaa-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 1, '{"title":"A safer crossing","description":"A synthetic public idea.","privateNote":"private-contact@example.invalid"}', 'approved'),
  ('aaaaaaaa-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 1, '{"title":"Private idea","description":"private-contact@example.invalid"}', 'approved'),
  ('aaaaaaaa-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 1, '{"title":"Unapproved revision","description":"private-contact@example.invalid"}', 'waiting');
INSERT INTO approved_revisions (idea_id, revision_id) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-3333-4333-8333-333333333333');
