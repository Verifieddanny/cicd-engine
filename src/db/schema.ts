import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const buildStatusEnum = pgEnum("build_status", [
  "queued",
  "running",
  "passed",
  "failed",
]);
export const deployedStatusEnum = pgEnum("deployed_status", [
  "live",
  "rolled_back",
]);

export const userTable = pgTable("user", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  avatar: varchar("avatar", { length: 500 }).notNull(),
  githubToken: varchar("github_token", { length: 255 }).notNull(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectTable = pgTable("project", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull(),
  branch: varchar("branch", { length: 100 }).notNull(),
  installCommand: text("install_command").default("npm install"),
  buildCommand: text("build_command"),
  outputDirectory: varchar("output_directory", { length: 255 }).default("./"),
  repoUrl: varchar("repo_url", { length: 500 }).notNull(),
  webhookId: varchar("webhook_id", { length: 255 }).notNull(),
  productionUrl: varchar("deployed_url", { length: 500 }),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const buildTable = pgTable("build", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  status: buildStatusEnum("status").default("queued").notNull(),
  commit: varchar("commit", { length: 500 }).notNull(),
  branch: varchar("branch", { length: 100 }).notNull(),
  commitAuthor: varchar("commit_author", { length: 255 }).notNull(),
  commitHash: varchar("commit_hash", { length: 50 }).notNull(),
  exitCode: integer("exit_code"),
  projectId: bigint("project_id", { mode: "number" })
    .notNull()
    .references(() => projectTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

export const buildLogs = pgTable("build_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  lineNumber: integer("line_number").notNull(),
  log: text("log").notNull(),
  buildId: bigint("build_id", { mode: "number" })
    .notNull()
    .references(() => buildTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const deploymentTable = pgTable("deployment", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  status: deployedStatusEnum("status").notNull(),
  buildId: bigint("build_id", { mode: "number" })
    .notNull()
    .references(() => buildTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const secretsTable = pgTable("secrets", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number" }).references(
    () => projectTable.id,
    {
      onDelete: "cascade",
    },
  ),
  key: text("key").notNull(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userTableRelations = relations(userTable, ({ many, one }) => ({
  projects: many(projectTable),
}));

export const projectTableRelations = relations(
  projectTable,
  ({ many, one }) => ({
    secrets: many(secretsTable),
    user: one(userTable, {
      fields: [projectTable.userId],
      references: [userTable.id],
    }),
    builds: many(buildTable),
  }),
);

export const buildTableRelations = relations(buildTable, ({ one, many }) => ({
  project: one(projectTable, {
    fields: [buildTable.projectId],
    references: [projectTable.id],
  }),
  logs: many(buildLogs),
  deployment: one(deploymentTable, {
    fields: [buildTable.id],
    references: [deploymentTable.buildId],
  }),
}));

export const buildLogsRelations = relations(buildLogs, ({ one }) => ({
  build: one(buildTable, {
    fields: [buildLogs.buildId],
    references: [buildTable.id],
  }),
}));

export const deploymentTableRelations = relations(
  deploymentTable,
  ({ one }) => ({
    build: one(buildTable, {
      fields: [deploymentTable.buildId],
      references: [buildTable.id],
    }),
  }),
);

export const secretsTableRelations = relations(secretsTable, ({ one }) => ({
  project: one(projectTable, {
    fields: [secretsTable.projectId],
    references: [projectTable.id],
  }),
}));
