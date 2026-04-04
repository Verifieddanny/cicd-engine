import type { NextFunction, Response } from "express";
import {
  GITHUB_API,
  type AuthRequest,
  type CustomError,
  type OrganizationInterface,
} from "../shared/types.js";
import { db } from "../db/index.js";
import { buildTable, userTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import * as buildService from "../services/buildEngine.js";

export const fetchOrganization = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.userId;
    const currentPage = parseInt(req.query.page as string) || 1;

    const result = await db
      .selectDistinct({
        accessToken: userTable.githubToken,
      })
      .from(userTable)
      .where(eq(userTable.id, Number(userId)))
      .limit(1);

    const user = result[0];

    if (!user) {
      const error: CustomError = new Error("User not found");
      error.statusCode = 400;
      throw error;
    }

    const organizationResponse = await fetch(
      `${GITHUB_API}/user/orgs?per_page=30&page=${currentPage}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );

    const userResponse = await fetch(`${GITHUB_API}/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        Accept: "application/json",
        "User-Agent": "My-CICD-Runner-App",
      },
    });

    if (!organizationResponse.ok || !userResponse.ok) {
      const error: CustomError = new Error("Failed to fetch organizations");
      error.statusCode = organizationResponse.status;
      throw error;
    }

    const organizations = await organizationResponse.json();
    const userData = await userResponse.json();

    const organizationFeature = organizations.map(
      (org: OrganizationInterface) => {
        return { login: org.login, avatar_url: org.avatar_url };
      },
    );
    const organizationsWithUser = [
      { login: userData.login, avatar_url: userData.avatar_url },
      ...organizationFeature,
    ];

    res.status(200).json({
      organizations: organizationsWithUser,
    });
  } catch (err) {
    const error = err as CustomError;
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

export const fetchRepos = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.userId;
    const currentPage = parseInt(req.query.page as string) || 1;

    const result = await db
      .selectDistinct({
        accessToken: userTable.githubToken,
        username: userTable.username,
      })
      .from(userTable)
      .where(eq(userTable.id, Number(userId)))
      .limit(1);

    const user = result[0];

    if (!user) {
      const error: CustomError = new Error("User not found");
      error.statusCode = 400;
      throw error;
    }

    const organization = (req.query.org as string) || user.username;

    const url =
      organization.toLowerCase() === user.username?.toLowerCase()
        ? `${GITHUB_API}/user/repos?per_page=100&page=${currentPage}&sort=created&direction=desc&affiliation=owner`
        : `${GITHUB_API}/orgs/${organization}/repos?per_page=100&page=${currentPage}`;

    const reposResponse = await fetch(`${url}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
    });

    if (!reposResponse.ok) {
      const error: CustomError = new Error("Failed to fetch repositories");
      error.statusCode = reposResponse.status;
      throw error;
    }
    const repos = await reposResponse.json();

    const refinedRepos = repos.map((repo: any) => {
      return {
        name: repo.name,
        branch: repo.default_branch,
        repoUrl: repo.html_url,
        owner: repo.owner.login,
        updatedAt: repo.updated_at,
      };
    });

    res.status(200).json({
      repos: refinedRepos,
    });
  } catch (err) {
    const error = err as CustomError;
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};
