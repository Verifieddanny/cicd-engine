import path from "node:path";
import { decrypt } from "../lib/encryption.js";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { CustomError } from "../shared/types.js";
import { db } from "../db/index.js";
import { buildLogs, buildTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { DefaultEventsMap, Server } from "socket.io";

interface projectInterface {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  branch: string;
  buildCommand: string;
  repoUrl: string;
  webhookId: string;
  userId: number;
  user: {
    id: number;
    username: string;
    email: string;
    avatar: string;
    githubToken: string;
    githubId: number;
    createdAt: Date;
    updatedAt: Date;
  };
  secrets: {
    id: number;
    createdAt: Date | null;
    projectId: number | null;
    key: string;
    value: string;
  }[];
}

interface buildInterface {
  id: number;
  branch: string;
  status: "queued" | "running" | "passed" | "failed";
  commit: string;
  commitAuthor: string;
  exitCode: number | null;
  projectId: number;
  startedAt: Date;
  finishedAt: Date | null;
}

export const runBuild = async (
  project: projectInterface,
  repoUrl: string,
  branch: string,
  newBuild: buildInterface,
  io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>,
) => {
  const buildId = Date.now();
  const folder = `${project.name}-${buildId}`;
  const buildPath = path.join(process.cwd(), "temp", folder);

  fs.mkdirSync(buildPath, { recursive: true });

  const projectSecrets = project.secrets || [];

  let envContent = "";

  if (projectSecrets.length > 0) {
    const envLines = projectSecrets.map((s) => {
      const plainValue = decrypt(s.value);
      return `${s.key}=${plainValue}`;
    });

    envContent = envLines.join("\n");

    const envFilePath = path.join(buildPath, ".env");

    fs.writeFileSync(envFilePath, envContent);

    console.log(`[CI]: Secrets injected for ${project.name}`);
  } else {
    console.log(
      `[CI]: No secrets found for ${project.name}. Skipping .env creation.`,
    );
  }

  const authenticatedRepoUrl = repoUrl.replace(
    "https://",
    `https://x-access-token:${project.user.githubToken}@`,
  );

  const cloner = spawn(
    "git",
    ["clone", "--branch", branch, authenticatedRepoUrl, "."],
    {
      cwd: buildPath,
    },
  );

  cloner.stderr.on("data", (data) => console.error(`[CLONE ERROR]: ${data}`));

  const [cloneExitCode] = await once(cloner, "close");
  if (cloneExitCode !== 0) {
    const error: CustomError = new Error("Git clone failed");
    throw error;
  }

  const dockerfilePath = path.join(buildPath, "Dockerfile");

  if (!fs.existsSync(dockerfilePath)) {
    console.log(
      `[CI]: No Dockerfile found. Generating a default Node.js one...`,
    );

    const defaultDockerfile = `
          FROM node:20-slim
          WORKDIR /app
          COPY package*.json ./
          RUN npm install
          COPY . .
          CMD ${project.buildCommand} 
        `.trim();

    fs.writeFileSync(dockerfilePath, defaultDockerfile);
  }

  await db
    .update(buildTable)
    .set({ status: "running" })
    .where(eq(buildTable.id, newBuild.id));

  const imageTag = project.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");

  const builder = spawn("docker", ["build", "-t", imageTag, "."], {
    cwd: buildPath,
  });
  const logBuffer: { lineNumber: number; log: string; buildId: number }[] = [];

  let i = 1;
  builder.stdout.on("data", async (data) => {
    const logString = data.toString();

    io.to(project.userId.toString()).emit("build_logs", {
      projectId: project.id,
      log: data.toString(),
      lineNumber: i,
    });
    logBuffer.push({
      lineNumber: i++,
      log: logString,
      buildId: newBuild.id,
    });

    console.log(`[BUILD LOG]: ${logString}`);
  });

  builder.stderr.on("data", async (data) => {
    const logString = data.toString();

    io.to(project.userId.toString()).emit("build_errors", {
      projectId: project.id,
      log: data.toString(),
      lineNumber: i,
    });
    logBuffer.push({
      lineNumber: i++,
      log: logString,
      buildId: newBuild.id,
    });

    console.log(`${i} [BUILD LOG ERROR]: ${data}`);
  });
  builder.on("close", async (code) => {
    if (logBuffer.length > 0) {
      await db.insert(buildLogs).values(logBuffer);
      console.log(`Saved ${logBuffer.length} log lines to DB.`);
    }

    if (code !== 0) {
      console.error(`[CI]: Build ${newBuild.id} failed with code ${code}`);
      await db
        .update(buildTable)
        .set({ status: "failed", finishedAt: new Date() })
        .where(eq(buildTable.id, newBuild.id));
    } else {
      console.log(`[CI]: Build ${newBuild.id} successful!`);
      logBuffer.length = 0;
      const runner = spawn(
        "docker",
        [
          "run",
          "--rm",
          "--env-file",
          ".env",
          imageTag,
          "sh",
          "-c",
          project.buildCommand,
        ],
        { cwd: buildPath },
      );

      let j = 1;
      runner.stdout.on("data", async (data) => {
        const logString = data.toString();
        io.to(project.userId.toString()).emit("run_logs", {
          projectId: project.id,
          log: data.toString(),
          lineNumber: j,
        });
        logBuffer.push({
          lineNumber: j++,
          log: logString,
          buildId: newBuild.id,
        });
        console.log(`[TEST LOG]: ${data}`);
      });

      runner.stderr.on("data", async (data) => {
        const logString = data.toString();

        io.to(project.userId.toString()).emit("run_error", {
          projectId: project.id,
          log: data.toString(),
          lineNumber: j,
        });
        
        logBuffer.push({
          lineNumber: j++,
          log: logString,
          buildId: newBuild.id,
        });
        console.log(`[TEST LOG]: ${data}`);
      });

      runner.on("close", async (code) => {
        try {
          if (logBuffer.length > 0) {
            await db.insert(buildLogs).values(logBuffer);
            console.log(`Saved ${logBuffer.length} log lines to DB.`);
          }

          if (code === 0) {
            console.log("✅ CI PASSED: Code is healthy!");
            await db
              .update(buildTable)
              .set({ status: "passed", finishedAt: new Date() })
              .where(eq(buildTable.id, newBuild.id));
          } else {
            console.log("❌ CI FAILED: Tests did not pass.");
            await db
              .update(buildTable)
              .set({ status: "failed", finishedAt: new Date() })
              .where(eq(buildTable.id, newBuild.id));
          }

          fs.rmSync(buildPath, { recursive: true, force: true });
        } catch (err) {
          const error: CustomError = new Error(`[CLEANUP ERROR]: ${err}`);
          throw error;
        }
      });
    }
  });
};
