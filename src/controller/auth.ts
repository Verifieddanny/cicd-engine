import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { GITHUB_ACCESS_TOKEN_URL, GITHUB_API, GITHUB_AUTH_URL, type CustomError, type FetchedEmail, type UserPayload } from "../shared/types.js";
import { userTable } from "../db/schema.js";
import type { SignOptions } from "jsonwebtoken";
import { db } from "../db/index.js";

export const redirectToGithub = (
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const scopes = "read:user,repo,read:org";

  res
    .status(302)
    .redirect(
      `${GITHUB_AUTH_URL}?client_id=${process.env.CLIENT_ID}&scope=${scopes}&prompt=consent`,
    );

};

export const handleCallback = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const code = req.query.code || "";

  if (!code) {
    return res.status(400).send("No code provided from GitHub");
  }

  try {
    const response = await fetch(`${GITHUB_ACCESS_TOKEN_URL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code: code,
      }),
    });

    const data = await response.json();

    if (!data.access_token) {
      const error: CustomError = new Error("Failed to get access token");
      error.statusCode = 500;
      throw error;
    }

    const access_token = data.access_token;

    const userResponse = await fetch(`${GITHUB_API}/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/json",
        "User-Agent": "My-CICD-Runner-App",
      },
    });

    const userData = await userResponse.json();

    if (!userData) {
      const error: CustomError = new Error("Failed to login");
      error.statusCode = 500;
      throw error;
    }

    let email = userData.email;

    if (!email) {
      const fetchEmailResponse = await fetch(`${GITHUB_API}/user/emails`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: "application/json",
          "User-Agent": "My-CICD-Runner-App",
        },
      });

      let fetchEmailData = await fetchEmailResponse.json();

      if (!fetchEmailData) {
        {
          const error: CustomError = new Error("Failed to get email");
          error.statusCode = 500;
          throw error;
        }
      }

      const primaryEmail = fetchEmailData.find(
        (e: FetchedEmail) => e.primary && e.verified,
      );
      email = primaryEmail?.email || fetchEmailData[0]?.email;
    }

    const newUser = await db
      .insert(userTable)
      .values({
        username: userData.login,
        email: email,
        avatar: userData.avatar_url,
        githubToken: access_token,
        githubId: userData.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userTable.githubId,
        set: {
          username: userData.login,
          email: email,
          avatar: userData.avatar_url,
          githubToken: access_token,
          updatedAt: new Date(),
        },
      })
      .returning();

    const payload: UserPayload = {
      email: newUser[0]!.email,
      userId: newUser[0]!.id.toString(),
    };

    const signOptions: SignOptions = {
      expiresIn: "1h",
    };

    const token = jwt.sign(payload, process.env.SECRET!, signOptions);

    res.status(302).redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}&username=${newUser[0]!.username}&avatar=${newUser[0]!.avatar}&email=${newUser[0]!.email}&createdAt=${newUser[0]!.createdAt}`);
  } catch (err) {
    const error = err as CustomError;

    if (!error.statusCode) {
      error.statusCode = 500;
    }

    next(error);
  }
};
