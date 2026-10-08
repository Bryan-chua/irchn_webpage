import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const queueEntries = sqliteTable('queue_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  queueNumber: text('queue_number').notNull().unique(),
  joinKey: text('join_key').unique(),
  deviceTokenHash: text('device_token_hash'),
  houseCode: text('house_code').notNull(),
  nickname: text('nickname').notNull(),
  groupSize: integer('group_size').notNull(),
  status: text('status').notNull().default('waiting'),
  joinedAt: integer('joined_at').notNull(),
  completedAt: integer('completed_at'),
}, (table) => [
  index('idx_queue_house_status_joined').on(table.houseCode, table.status, table.joinedAt),
  index('idx_queue_house_status_id').on(table.houseCode, table.status, table.id),
  uniqueIndex('idx_queue_active_device_house')
    .on(table.houseCode, table.deviceTokenHash)
    .where(sql`${table.deviceTokenHash} IS NOT NULL AND ${table.status} IN ('waiting', 'skipped')`),
]);

export const houseSettings = sqliteTable('house_settings', {
  houseCode: text('house_code').primaryKey(),
  status: text('status').notNull().default('open'),
  lastEnteredAt: integer('last_entered_at'),
});

export const eventSettings = sqliteTable('event_settings', {
  id: integer('id').primaryKey(),
  status: text('status').notNull().default('open'),
  stationControlsLocked: integer('station_controls_locked', { mode: 'boolean' }).notNull().default(false),
  eventEndAt: integer('event_end_at'),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull().default('system'),
});

export const stationPresence = sqliteTable('station_presence', {
  houseCode: text('house_code').primaryKey(),
  lastSeenAt: integer('last_seen_at').notNull(),
  lastLoginAt: integer('last_login_at').notNull(),
});

export const moderatorLoginAttempts = sqliteTable('moderator_login_attempts', {
  attemptKey: text('attempt_key').primaryKey(),
  failureCount: integer('failure_count').notNull().default(0),
  windowStartedAt: integer('window_started_at').notNull(),
  lastFailedAt: integer('last_failed_at').notNull(),
}, (table) => [
  index('idx_moderator_login_attempts_last_failed').on(table.lastFailedAt),
]);

export const operationalEvents = sqliteTable('operational_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  category: text('category').notNull(),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull().default('info'),
  houseCode: text('house_code').notNull().default('ALL'),
  actor: text('actor').notNull().default('system'),
  message: text('message').notNull(),
  count: integer('count').notNull().default(1),
  occurredAt: integer('occurred_at').notNull(),
  lastOccurredAt: integer('last_occurred_at').notNull(),
  acknowledgedAt: integer('acknowledged_at'),
  acknowledgedBy: text('acknowledged_by'),
  resolvedAt: integer('resolved_at'),
}, (table) => [
  index('idx_operational_events_recent').on(table.lastOccurredAt),
  index('idx_operational_events_category').on(table.category, table.resolvedAt, table.acknowledgedAt),
  uniqueIndex('idx_operational_events_active_alert')
    .on(table.eventType, table.houseCode)
    .where(sql`${table.category} = 'alert' AND ${table.resolvedAt} IS NULL`),
]);
