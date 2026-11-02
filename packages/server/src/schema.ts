import { sql } from 'drizzle-orm'
import { boolean, check, customType, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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
}, table => [uniqueIndex('identities_provider_subject_key').on(table.provider, table.subject), uniqueIndex('identities_id_user_key').on(table.id, table.userId), index('identities_user_idx').on(table.userId)])
// Role assignment and revocation are restricted operator actions, not user input.
export const moderatorAssignments = pgTable('moderator_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  grantedBy: uuid('granted_by').notNull().references(() => users.id),
  grantedAt: createdAt(),
  grantReason: text('grant_reason').notNull(),
  revokedBy: uuid('revoked_by').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: text('revoke_reason'),
}, table => [
  uniqueIndex('moderator_assignments_active_user_key').on(table.userId).where(sql`${table.revokedAt} IS NULL`),
  check('moderator_assignments_grant_reason', sql`length(trim(${table.grantReason})) > 0 AND octet_length(${table.grantReason}) <= 1000`),
  check('moderator_assignments_revoke_fields', sql`(${table.revokedAt} IS NULL AND ${table.revokedBy} IS NULL AND ${table.revokeReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedBy} IS NOT NULL AND ${table.revokeReason} IS NOT NULL AND length(trim(${table.revokeReason})) > 0 AND octet_length(${table.revokeReason}) <= 1000)`),
])
// Legal-hold authority is distinct from moderation and granted only by a reviewed operator process.
export const legalHoldAssignments = pgTable('legal_hold_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  authority: text('authority').notNull(),
  authorizationReference: text('authorization_reference').notNull(),
  grantedBy: uuid('granted_by').notNull().references(() => users.id),
  grantedAt: createdAt(),
  revokedBy: uuid('revoked_by').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: text('revoke_reason'),
}, table => [
  uniqueIndex('legal_hold_assignments_active_user_key').on(table.userId).where(sql`${table.revokedAt} IS NULL`),
  uniqueIndex('legal_hold_assignments_active_director_key').on(table.authority).where(sql`${table.authority} = 'executive_director' AND ${table.revokedAt} IS NULL`),
  check('legal_hold_assignments_authority', sql`${table.authority} IN ('executive_director','delegate')`),
  check('legal_hold_assignments_reference', sql`length(trim(${table.authorizationReference})) > 0 AND octet_length(${table.authorizationReference}) <= 300`),
  check('legal_hold_assignments_revocation', sql`(${table.revokedAt} IS NULL AND ${table.revokedBy} IS NULL AND ${table.revokeReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedBy} IS NOT NULL AND ${table.revokeReason} IS NOT NULL AND length(trim(${table.revokeReason})) > 0 AND octet_length(${table.revokeReason}) <= 1000)`),
])
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
// One record covers one idea and one documented case; different cases may overlap.
export const legalHolds = pgTable('legal_holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull().references(() => ideas.id),
  caseReference: text('case_reference').notNull(),
  reason: text('reason').notNull(),
  placedBy: uuid('placed_by').notNull().references(() => users.id),
  placementAuthorityId: uuid('placement_authority_id').notNull().references(() => legalHoldAssignments.id),
  placedAt: createdAt(),
  releasedBy: uuid('released_by').references(() => users.id),
  releaseAuthorityId: uuid('release_authority_id').references(() => legalHoldAssignments.id),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releaseReason: text('release_reason'),
  legalReviewReference: text('legal_review_reference'),
}, table => [
  uniqueIndex('legal_holds_active_case_idea_key').on(table.ideaId, table.caseReference).where(sql`${table.releasedAt} IS NULL`),
  check('legal_holds_case_reference', sql`length(trim(${table.caseReference})) > 0 AND octet_length(${table.caseReference}) <= 300`),
  check('legal_holds_reason', sql`length(trim(${table.reason})) > 0 AND octet_length(${table.reason}) <= 1000`),
  check('legal_holds_release', sql`(${table.releasedAt} IS NULL AND ${table.releasedBy} IS NULL AND ${table.releaseAuthorityId} IS NULL AND ${table.releaseReason} IS NULL AND ${table.legalReviewReference} IS NULL) OR (${table.releasedAt} IS NOT NULL AND ${table.releasedBy} IS NOT NULL AND ${table.releaseAuthorityId} IS NOT NULL AND ${table.releaseReason} IS NOT NULL AND length(trim(${table.releaseReason})) > 0 AND octet_length(${table.releaseReason}) <= 1000 AND (${table.legalReviewReference} IS NULL OR (length(trim(${table.legalReviewReference})) > 0 AND octet_length(${table.legalReviewReference}) <= 300)))`),
])
// A claim is evidence of an ownership transfer, not proof that a caller owns
// an email address. The server must verify that evidence before inserting it.
export const ownershipClaims = pgTable('ownership_claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull().references(() => ideas.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  verifiedIdentityId: uuid('verified_identity_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(),
}, table => [
  uniqueIndex('ownership_claims_idea_key').on(table.ideaId),
  index('ownership_claims_user_idx').on(table.userId),
  foreignKey({ columns: [table.ideaId, table.contactId], foreignColumns: [ideas.id, ideas.authorContactId] }),
  foreignKey({ columns: [table.verifiedIdentityId, table.userId], foreignColumns: [identities.id, identities.userId] }),
  check('ownership_claims_verified_pair', sql`(${table.verifiedIdentityId} IS NULL) = (${table.verifiedAt} IS NULL)`),
])
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
// Durable per-submission approval evidence is separate from expiring audit events.
export const approvalRecords = pgTable('approval_records', {
  ideaId: uuid('idea_id').primaryKey().references(() => ideas.id),
  revisionId: uuid('revision_id').notNull(),
  verifiedForTrust: boolean('verified_for_trust').notNull().default(false),
  excludedForViolation: boolean('excluded_for_violation').notNull().default(false),
}, table => [foreignKey({ columns: [table.ideaId, table.revisionId], foreignColumns: [ideaRevisions.ideaId, ideaRevisions.id] })])
export const approvalCorrections = pgTable('approval_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull().references(() => ideas.id),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  excluded: boolean('excluded').notNull(),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
}, table => [index('approval_corrections_idea_idx').on(table.ideaId)])
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
  assessmentId: text('assessment_id'),
  actorId: uuid('actor_id').references(() => users.id),
  state: reviewState('state').notNull(),
  reason: text('reason'),
  createdAt: createdAt(),
}, table => [index('moderation_events_revision_idx').on(table.revisionId),
  foreignKey({ columns: [table.assessmentId, table.revisionId], foreignColumns: [revisionAssessments.id, revisionAssessments.revisionId] }),
])
// Removal metadata is private and separate from durable trust state.
export const moderatorRemovals = pgTable('moderator_removals', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull().references(() => ideas.id),
  revisionId: uuid('revision_id').notNull(),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  classification: text('classification').notNull(),
  reason: text('reason').notNull(),
  projectionJobId: uuid('projection_job_id').notNull().references(() => jobs.id),
  createdAt: createdAt(),
}, table => [
  foreignKey({ columns: [table.ideaId, table.revisionId], foreignColumns: [ideaRevisions.ideaId, ideaRevisions.id] }),
  check('moderator_removals_classification', sql`${table.classification} IN ('violation','other')`),
  check('moderator_removals_reason', sql`length(trim(${table.reason})) > 0 AND octet_length(${table.reason}) <= 1000`),
])
// Assessment evidence and review holds are private server-side state.
export const reviewGates = pgTable('review_gates', {
  revisionId: uuid('revision_id').primaryKey().references(() => ideaRevisions.id),
  blocked: boolean('blocked').notNull().default(false),
})
// Holds are separate from other review blocks: releasing one must not clear another.
export const moderatorHolds = pgTable('moderator_holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  revisionId: uuid('revision_id').notNull().references(() => ideaRevisions.id),
  assessmentId: text('assessment_id'),
  kind: text('kind').notNull().default('hold'),
  ownerId: uuid('owner_id').references(() => users.id),
  placedBy: uuid('placed_by').notNull().references(() => users.id),
  placedAt: createdAt(),
  reason: text('reason').notNull(),
  releasedBy: uuid('released_by').references(() => users.id),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releaseReason: text('release_reason'),
}, table => [
  foreignKey({ columns: [table.assessmentId, table.revisionId], foreignColumns: [revisionAssessments.id, revisionAssessments.revisionId] }),
  uniqueIndex('moderator_holds_active_revision_kind_key').on(table.revisionId, table.kind).where(sql`${table.releasedAt} IS NULL`),
  check('moderator_holds_kind_owner', sql`(${table.kind} = 'hold' AND ${table.ownerId} IS NULL) OR (${table.kind} = 'escalation' AND ${table.ownerId} IS NOT NULL)`),
  check('moderator_holds_reason', sql`length(trim(${table.reason})) > 0 AND octet_length(${table.reason}) <= 1000`),
  check('moderator_holds_release_fields', sql`(${table.releasedAt} IS NULL AND ${table.releasedBy} IS NULL AND ${table.releaseReason} IS NULL) OR (${table.releasedAt} IS NOT NULL AND ${table.releasedBy} IS NOT NULL AND ${table.releaseReason} IS NOT NULL AND length(trim(${table.releaseReason})) > 0 AND octet_length(${table.releaseReason}) <= 1000)`),
])
export const revisionAssessments = pgTable('revision_assessments', {
  id: text('id').primaryKey(),
  revisionId: uuid('revision_id').notNull().references(() => ideaRevisions.id),
  fingerprint: text('fingerprint').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  deadline: timestamp('deadline', { withTimezone: true }),
  waitMilliseconds: integer('wait_milliseconds'),
  shortcutRequested: boolean('shortcut_requested').notNull().default(false),
  current: boolean('current').notNull().default(true),
}, table => [uniqueIndex('revision_assessments_current_key').on(table.revisionId).where(sql`${table.current}`),
  uniqueIndex('revision_assessments_id_revision_key').on(table.id, table.revisionId),
  check('revision_assessments_deadline', sql`(${table.deadline} IS NULL AND ${table.waitMilliseconds} IS NULL AND NOT ${table.shortcutRequested}) OR (${table.deadline} IS NOT NULL AND ${table.waitMilliseconds} IS NOT NULL AND ${table.waitMilliseconds} BETWEEN 0 AND 86400000 AND ${table.deadline} >= ${table.receivedAt})`),
])
// A request for changes blocks the whole idea, including later edits, until resolved.
export const moderatorChangeRequests = pgTable('moderator_change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull().references(() => ideas.id),
  requestedRevisionId: uuid('requested_revision_id').notNull(),
  requestedAssessmentId: text('requested_assessment_id'),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  requestedAt: createdAt(),
  reason: text('reason').notNull(),
  resolvedRevisionId: uuid('resolved_revision_id'),
  resolvedAssessmentId: text('resolved_assessment_id'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionReason: text('resolution_reason'),
}, table => [
  uniqueIndex('moderator_change_requests_active_idea_key').on(table.ideaId).where(sql`${table.resolvedAt} IS NULL`),
  foreignKey({ columns: [table.ideaId, table.requestedRevisionId], foreignColumns: [ideaRevisions.ideaId, ideaRevisions.id] }),
  foreignKey({ columns: [table.requestedAssessmentId, table.requestedRevisionId], foreignColumns: [revisionAssessments.id, revisionAssessments.revisionId] }),
  foreignKey({ columns: [table.ideaId, table.resolvedRevisionId], foreignColumns: [ideaRevisions.ideaId, ideaRevisions.id] }),
  foreignKey({ columns: [table.resolvedAssessmentId, table.resolvedRevisionId], foreignColumns: [revisionAssessments.id, revisionAssessments.revisionId] }),
  check('moderator_change_requests_reason', sql`length(trim(${table.reason})) > 0 AND octet_length(${table.reason}) <= 1000`),
  check('moderator_change_requests_resolution', sql`(${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL AND ${table.resolvedRevisionId} IS NULL AND ${table.resolvedAssessmentId} IS NULL AND ${table.resolutionReason} IS NULL) OR (${table.resolvedAt} IS NOT NULL AND ${table.resolvedBy} IS NOT NULL AND ${table.resolvedRevisionId} IS NOT NULL AND ${table.resolutionReason} IS NOT NULL AND length(trim(${table.resolutionReason})) > 0 AND octet_length(${table.resolutionReason}) <= 1000)`),
])
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Associate background work with the immutable input revision when relevant.
  revisionId: uuid('revision_id').references(() => ideaRevisions.id),
  kind: text('kind').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  assessmentId: text('assessment_id'),
  assessmentReceivedAt: timestamp('assessment_received_at', { withTimezone: true }),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  state: text('state').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: createdAt(),
}, table => [uniqueIndex('jobs_idempotency_key').on(table.idempotencyKey), index('jobs_revision_idx').on(table.revisionId),
  uniqueIndex('jobs_assessment_kind_key').on(table.kind, table.revisionId, table.assessmentId).where(sql`${table.assessmentId} IS NOT NULL`),
  check('jobs_assessment_identity', sql`(${table.assessmentId} IS NULL AND ${table.assessmentReceivedAt} IS NULL) OR (${table.assessmentId} IS NOT NULL AND ${table.assessmentReceivedAt} IS NOT NULL AND ${table.revisionId} IS NOT NULL AND ${table.scheduledAt} IS NOT NULL AND ${table.scheduledAt} >= ${table.assessmentReceivedAt})`),
])
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
  deliveryGeneration: integer('delivery_generation').notNull().default(0),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  createdAt: createdAt(),
}, table => [uniqueIndex('outbox_job_key').on(table.jobId), index('outbox_published_idx').on(table.publishedAt),
  check('outbox_dispatch_attempts_range', sql`${table.dispatchAttempts} between 0 and 5`),
  check('outbox_delivery_generation_nonnegative', sql`${table.deliveryGeneration} >= 0`),
  check('outbox_lease_pair', sql`(${table.leaseToken} IS NULL) = (${table.leaseUntil} IS NULL)`),
])
// Store only the provider identifiers and delivery state, never message content or recipients.
export const emailDeliveryEvents = pgTable('email_delivery_events', {
  eventId: text('event_id').primaryKey(),
  emailId: text('email_id').notNull(),
  eventType: text('event_type').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  receivedAt: createdAt(),
}, table => [index('email_delivery_events_email_idx').on(table.emailId, table.occurredAt)])
// Only an authorized publishing process may expose an approved preview.
export const mediaPreviews = pgTable('media_previews', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  objectName: text('object_name').notNull(),
  generation: text('generation').notNull(),
  contentType: text('content_type').notNull(),
  published: boolean('published').notNull().default(false),
  createdAt: createdAt(),
}, table => [
  foreignKey({ columns: [table.ideaId, table.revisionId], foreignColumns: [ideaRevisions.ideaId, ideaRevisions.id] }),
  uniqueIndex('media_previews_object_generation_key').on(table.objectName, table.generation),
  check('media_previews_generation_format', sql`${table.generation} ~ '^[1-9][0-9]*$'`),
  check('media_previews_content_type', sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`),
])
