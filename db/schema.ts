import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const queueEntries = sqliteTable('queue_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  queueNumber: text('queue_number').notNull().unique(),
  joinKey: text('join_key').unique(),
  houseCode: text('house_code').notNull(),
  nickname: text('nickname').notNull(),
  groupSize: integer('group_size').notNull(),
  status: text('status').notNull().default('waiting'),
  joinedAt: integer('joined_at').notNull(),
  completedAt: integer('completed_at'),
}, (table) => [
  index('idx_queue_house_status_joined').on(table.houseCode, table.status, table.joinedAt),
  index('idx_queue_house_status_id').on(table.houseCode, table.status, table.id),
]);

export const houseSettings = sqliteTable('house_settings', {
  houseCode: text('house_code').primaryKey(),
  status: text('status').notNull().default('open'),
  lastEnteredAt: integer('last_entered_at'),
});
