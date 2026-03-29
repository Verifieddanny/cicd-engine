import type { Request } from "express";
import type { ValidationError } from "express-validator";
import type { JwtPayload } from "jsonwebtoken";
import type { Socket } from "socket.io";


export type CustomError = Error & {
  statusCode?: number;
  data?: ValidationError[];
};


export interface AuthRequest extends Request {
  userId?: string;
}


export interface UserPayload extends JwtPayload {
  email: string;
  userId: string;
}


export interface FetchedEmail {
    email: string;
    verified: boolean;
    primary: boolean;
    visibility: string;
}

export interface AuthSocket extends Socket {
  userId?: string;
}



export const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API = "https://api.github.com";
