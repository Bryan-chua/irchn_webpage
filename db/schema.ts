import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const queueEntries = sqliteTable('queue_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  queueNumber: text('queue_number').notNull().unique(),
  houseCode: text('house_code').notNull(),
  nickname: text('nickname').notNull(),
  groupSize: integer('group_size').notNull(),
  status: text('status').notNull().default('waiting'),
  joinedAt: integer('joined_at').notNull(),
  completedAt: integer('completed_at'),
}, (table) => [
  index('idx_queue_house_status_joined').on(table.houseCode, table.status, table.joinedAt),
]);

export const houseSettings = sqliteTable('house_settings', {
  houseCode: text('house_code').primaryKey(),
  status: text('status').notNull().default('open'),
});
