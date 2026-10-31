import { sql } from 'drizzle-orm'
import { check, customType, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

// Contact details and moderation records are private; access control belongs to
// server-side authorization and must not rely on these table definitions.
const geographyPoint = customType<{ data: string }>({ dataType: () => 'geography(point, 4326)' })
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
export const publicationState = pgEnum('publication_state', ['private', 'approved', 'withdrawn'])
export const reviewState = pgEnum('review_state', ['waiting', 'queued', 'reviewing', 'escalated', 'approved', 'rejected'])
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: createdAt(),
})
export const identities = pgTable('identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
}, table => [uniqueIndex('identities_provider_subject_key').on(table.provider, table.subject), index('identities_user_idx').on(table.userId)])
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  normalizedEmail: text('normalized_email').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(),
}, table => [index('contacts_email_idx').on(table.normalizedEmail)])
export const ideas = pgTable('ideas', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id),
  authorContactId: uuid('author_contact_id').notNull().references(() => contacts.id),
  publicationState: publicationState('publication_state').notNull().default('private'),
  location: geographyPoint('location'),
  createdAt: createdAt(),
}, table => [index('ideas_owner_idx').on(table.ownerId), index('ideas_author_contact_idx').on(table.authorContactId), index('ideas_location_gist_idx').using('gist', table.location), uniqueIndex('ideas_id_author_contact_key').on(table.id, table.authorContactId)])
// A claim is evidence of an ownership transfer, not proof that a caller owns
// an email address. The server must verify that evidence before inserting it.
export const ownershipClaims = pgTable('ownership_claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull().references(() => ideas.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  createdAt: createdAt(),
}, table => [uniqueIndex('ownership_claims_idea_key').on(table.ideaId), index('ownership_claims_user_idx').on(table.userId), foreignKey({ columns: [table.ideaId, table.contactId], foreignColumns: [ideas.id, ideas.authorContactId] })])
export const ideaRevisions = pgTable('idea_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull().references(() => ideas.id),
  version: integer('version').notNull(),
  content: jsonb('content').notNull(),
  reviewState: reviewState('review_state').notNull().default('waiting'),
  createdAt: createdAt(),
}, table => [uniqueIndex('idea_revisions_version_key').on(table.ideaId, table.version), uniqueIndex('idea_revisions_idea_id_key').on(table.ideaId, table.id)])
// The composite foreign key prevents pointing an idea at another idea's revision.
// An authorized transaction must verify approval before changing this pointer.
export const approvedRevisions = pgTable('approved_revisions', {
  ideaId: uuid('idea_id').primaryKey().references(() => ideas.id),
  revisionId: uuid('revision_id').notNull(),
}, table => [foreignKey({ columns: [table.ideaId, table.revisionId], foreignColumns: [ideaRevisions.ideaId, ideaRevisions.id] })])
// Update this counter atomically with acceptance of a guest submission.
export const guestSubmissionCounters = pgTable('guest_submission_counters', {
  browserId: text('browser_id').primaryKey(),
  acceptedCount: integer('accepted_count').notNull().default(0),
}, table => [check('guest_submission_count_range', sql`${table.acceptedCount} between 0 and 2`)])
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').references(() => ideas.id),
  actorId: uuid('actor_id').references(() => users.id),
  eventType: text('event_type').notNull(),
  createdAt: createdAt(),
}, table => [index('audit_events_idea_idx').on(table.ideaId)])
export const moderationEvents = pgTable('moderation_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  revisionId: uuid('revision_id').notNull().references(() => ideaRevisions.id),
  actorId: uuid('actor_id').references(() => users.id),
  state: reviewState('state').notNull(),
  reason: text('reason'),
  createdAt: createdAt(),
}, table => [index('moderation_events_revision_idx').on(table.revisionId)])
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Associate background work with the immutable input revision when relevant.
  revisionId: uuid('revision_id').references(() => ideaRevisions.id),
  kind: text('kind').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  state: text('state').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: createdAt(),
}, table => [uniqueIndex('jobs_idempotency_key').on(table.idempotencyKey), index('jobs_revision_idx').on(table.revisionId)])
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
}, table => [uniqueIndex('outbox_job_key').on(table.jobId), index('outbox_published_idx').on(table.publishedAt)])
