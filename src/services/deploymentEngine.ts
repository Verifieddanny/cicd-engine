import fs from "node:fs";
import path from "node:path";
import type { DefaultEventsMap, Server } from "socket.io";
import type { CustomError } from "../shared/types.js";
import { db } from "../db/index.js";
import { deploymentTable } from "../db/schema.js";

export const deployProject = async (
  userId: number,
  projectId: number,
  buildId: number,
  buildPath: string,
  name: string,
  io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>,
  outputDir?: string | null,
) => {
  const folder = name.toLowerCase().replace(/\s+/g, "-");
  const deploymentPath = path.join(process.cwd(), "deployments", folder);
  fs.mkdirSync(deploymentPath, { recursive: true });

  const outputPath = outputDir
    ? path.join(buildPath, outputDir)
    : path.join(buildPath);

  if (!fs.existsSync(outputPath)) {
    const err: CustomError = new Error(
      `[DEPLOYMENT ERROR]: Output directory ${outputPath} does not exist.`,
    );
    err.statusCode = 500;
    throw err;
  }

  if (fs.existsSync(deploymentPath)) {
    fs.rmSync(deploymentPath, { recursive: true, force: true });
  }

  fs.mkdirSync(deploymentPath, { recursive: true });
  fs.cpSync(outputPath, deploymentPath, {
    recursive: true,
    force: true,
  });

  const deployedUrl = `http://${name}.${process.env.BASE_DOMAIN}`;
  console.log(`🚀 Project deployed at: ${deployedUrl}`);

  io.to(userId.toString()).emit("deploymentUpdate", {
    projectId,
    buildId,
    status: "live",
    url: deployedUrl,
  });

  const createDeployment = await db.insert(deploymentTable).values({
    status: "live",
    deployedUrl,
    buildId,
  });

  if (!createDeployment) {
    const err: CustomError = new Error(
      `[DEPLOYMENT ERROR]: Failed to create deployment record in DB.`,
    );
    err.statusCode = 500;
    throw err;
  }
};
