// Drizzle 스키마 — 기획서 10장 데이터 모델 그대로
// 드라이버는 postgres.js (ADR A7 · Drizzle ORM)
//
// 판단 두 가지:
//  1. 상태 컬럼은 pgEnum 이 아니라 `text().$type<...>()` 다. 5일 규모에서 enum 값 하나 늘릴 때마다
//     ALTER TYPE 마이그레이션을 도는 것은 순수한 부채다. 값 집합은 TS 유니온과 zod 가 지킨다.
//  2. items 를 컬렉션별 테이블로 쪼개지 않는다. JSONB 하나 + GIN 인덱스 (ADR A6).

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import type { AdapterSpec } from '../spec/spec'
import type { AdapterOrigin, AdapterStatus } from '../types/adapter'
import type { CollectionFilter } from '../types/api'
import type { CollectionSchemaJson, Visibility } from '../types/collection'
import type { ItemData, ItemProvenance, ItemRaw } from '../types/item'
import type { RunStatus, ValidationReport } from '../types/run'
import type { FetchMode, SourceStatus } from '../types/source'
import type { DeliveryStatus, SubscriptionChannel } from '../types/subscription'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

// ════════════════════════════════════════════════════════════════════════
// Auth.js 표준 4종 (ADR A10)
// 컬럼 이름·타입은 @auth/drizzle-adapter 의 defineTables 기본값과 정확히 같다.
// 여기가 틀리면 로그인이 조용히 안 붙는다.
// ════════════════════════════════════════════════════════════════════════

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<'oauth' | 'oidc' | 'email' | 'webauthn'>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

/** Passkey 는 5일 범위 밖이지만 어댑터가 선택적으로 기대하는 테이블이라 자리만 잡아둔다 */
export const authenticators = pgTable(
  'authenticators',
  {
    credentialID: text('credentialID').notNull().unique(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerAccountId: text('providerAccountId').notNull(),
    credentialPublicKey: text('credentialPublicKey').notNull(),
    counter: integer('counter').notNull(),
    credentialDeviceType: text('credentialDeviceType').notNull(),
    credentialBackedUp: boolean('credentialBackedUp').notNull(),
    transports: text('transports'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.credentialID] })],
)

// ════════════════════════════════════════════════════════════════════════
// 도메인 (기획서 10장)
// ════════════════════════════════════════════════════════════════════════

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    owner_id: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** URL 과 API 경로에 쓰인다 */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** 필드 정의 배열 */
    schema_json: jsonb('schema_json')
      .$type<CollectionSchemaJson>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 필드 삭제/타입 변경 시 증가 */
    schema_version: integer('schema_version').notNull().default(1),
    visibility: text('visibility').$type<Visibility>().notNull().default('private'),
    /** private 일 때 필수 */
    api_key_hash: text('api_key_hash'),
    created_at: ts('created_at').notNull().defaultNow(),
    updated_at: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('collections_owner_idx').on(t.owner_id)],
)

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    host: text('host').notNull(),
    entry_url: text('entry_url').notNull(),
    status: text('status').$type<SourceStatus>().notNull().default('ok'),
    /** cron 표현식 (기본 하루 1회) */
    schedule: text('schedule').notNull().default('0 6 * * *'),
    last_run_at: ts('last_run_at'),
    last_ok_at: ts('last_ok_at'),
    /** 어느 경로로 뚫렸는지 */
    fetch_mode: text('fetch_mode').$type<FetchMode>().notNull().default('html'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('sources_collection_idx').on(t.collection_id),
    index('sources_host_idx').on(t.host),
    // 시드 멱등성과 "같은 URL 두 번 붙이기" 방지
    unique('sources_collection_entry_url_uq').on(t.collection_id, t.entry_url),
  ],
)

export const adapters = pgTable(
  'adapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source_id: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    /** 어댑터 스펙 (기획서 11장) */
    spec_json: jsonb('spec_json').$type<AdapterSpec>().notNull(),
    origin: text('origin').$type<AdapterOrigin>().notNull(),
    status: text('status').$type<AdapterStatus>().notNull().default('candidate'),
    /** 이 버전이 통과한 검증 결과 (승격 근거) */
    validation_json: jsonb('validation_json').$type<ValidationReport>(),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('adapters_source_version_uq').on(t.source_id, t.version),
    index('adapters_source_status_idx').on(t.source_id, t.status),
  ],
)

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    source_id: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    /** 소스 내 고유 식별자 (원문 링크 또는 원본 id) */
    external_key: text('external_key').notNull(),
    /** 정규화된 값 — 스키마 필드 키 그대로 */
    data_json: jsonb('data_json').$type<ItemData>().notNull(),
    /** 원본 조각 (원문 대조용) */
    raw_json: jsonb('raw_json').$type<ItemRaw>(),
    /** 필드별 원본 경로 — { "deadline": "$.reqstEndDe" } */
    provenance_json: jsonb('provenance_json').$type<ItemProvenance>(),
    content_hash: text('content_hash').notNull(),
    first_seen_at: ts('first_seen_at').notNull().defaultNow(),
    last_seen_at: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    // ADR A13 — 신규 판정이 여기 걸려 있다. 시드 멱등성의 근거이기도 하다
    unique('items_source_external_key_uq').on(t.source_id, t.external_key),
    // ADR A6 — 별도 검색엔진 없이 JSONB 필터를 받는다
    index('items_data_json_gin_idx').using('gin', t.data_json),
    index('items_collection_first_seen_idx').on(t.collection_id, t.first_seen_at),
    index('items_collection_source_idx').on(t.collection_id, t.source_id),
  ],
)

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source_id: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    /** 어댑터를 고르기도 전에 실패할 수 있어 nullable */
    adapter_id: uuid('adapter_id').references(() => adapters.id, { onDelete: 'set null' }),
    started_at: ts('started_at').notNull().defaultNow(),
    finished_at: ts('finished_at'),
    status: text('status').$type<RunStatus>().notNull(),
    items_found: integer('items_found').notNull().default(0),
    items_new: integer('items_new').notNull().default(0),
    /** 필드별 null 비율, 타입 실패율 등 */
    validation_json: jsonb('validation_json').$type<ValidationReport>(),
    /** 사용자에게 보여줄 상태 문구 (내부 용어 금지 · B4) */
    error_summary: text('error_summary'),
  },
  (t) => [index('runs_source_started_idx').on(t.source_id, t.started_at)],
)

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<SubscriptionChannel>().notNull(),
    /** URL 또는 이메일 주소 */
    target: text('target').notNull(),
    /** 구독 조건 (표에서 건 필터 그대로) */
    filter_json: jsonb('filter_json')
      .$type<CollectionFilter>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    schedule: text('schedule').notNull().default('0 9 * * *'),
    last_sent_at: ts('last_sent_at'),
    created_at: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_collection_idx').on(t.collection_id),
    index('subscriptions_user_idx').on(t.user_id),
  ],
)

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscription_id: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    item_ids: uuid('item_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    sent_at: ts('sent_at').notNull().defaultNow(),
    status: text('status').$type<DeliveryStatus>().notNull().default('pending'),
  },
  (t) => [index('deliveries_subscription_sent_idx').on(t.subscription_id, t.sent_at)],
)

// ════════════════════════════════════════════════════════════════════════
// 관계
// ════════════════════════════════════════════════════════════════════════

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  collections: many(collections),
  subscriptions: many(subscriptions),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  owner: one(users, { fields: [collections.owner_id], references: [users.id] }),
  sources: many(sources),
  items: many(items),
  subscriptions: many(subscriptions),
}))

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  collection: one(collections, { fields: [sources.collection_id], references: [collections.id] }),
  adapters: many(adapters),
  items: many(items),
  runs: many(runs),
}))

export const adaptersRelations = relations(adapters, ({ one, many }) => ({
  source: one(sources, { fields: [adapters.source_id], references: [sources.id] }),
  runs: many(runs),
}))

export const itemsRelations = relations(items, ({ one }) => ({
  collection: one(collections, { fields: [items.collection_id], references: [collections.id] }),
  source: one(sources, { fields: [items.source_id], references: [sources.id] }),
}))

export const runsRelations = relations(runs, ({ one }) => ({
  source: one(sources, { fields: [runs.source_id], references: [sources.id] }),
  adapter: one(adapters, { fields: [runs.adapter_id], references: [adapters.id] }),
}))

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  collection: one(collections, {
    fields: [subscriptions.collection_id],
    references: [collections.id],
  }),
  user: one(users, { fields: [subscriptions.user_id], references: [users.id] }),
  deliveries: many(deliveries),
}))

export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [deliveries.subscription_id],
    references: [subscriptions.id],
  }),
}))

// ════════════════════════════════════════════════════════════════════════
// 행 타입 — 도메인 타입(types/*)과 같은 형태여야 한다
// ════════════════════════════════════════════════════════════════════════

export type UserRow = typeof users.$inferSelect
export type CollectionRow = typeof collections.$inferSelect
export type NewCollectionRow = typeof collections.$inferInsert
export type SourceRow = typeof sources.$inferSelect
export type NewSourceRow = typeof sources.$inferInsert
export type AdapterRow = typeof adapters.$inferSelect
export type NewAdapterRow = typeof adapters.$inferInsert
export type ItemRow = typeof items.$inferSelect
export type NewItemRow = typeof items.$inferInsert
export type RunRow = typeof runs.$inferSelect
export type NewRunRow = typeof runs.$inferInsert
export type SubscriptionRow = typeof subscriptions.$inferSelect
export type NewSubscriptionRow = typeof subscriptions.$inferInsert
export type DeliveryRow = typeof deliveries.$inferSelect
export type NewDeliveryRow = typeof deliveries.$inferInsert
