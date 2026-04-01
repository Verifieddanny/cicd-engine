import { expect } from "../setup.js";
import * as sinon from "sinon";
import type { NextFunction, Request, Response } from "express";
import { redirectToGithub, handleCallback } from "../../src/controller/auth.js";
import { GITHUB_ACCESS_TOKEN_URL, GITHUB_API } from "../../src/shared/types.js";
import { db } from "../../src/db/index.js";

describe("Auth Controller", () => {
  let fetchStub: sinon.SinonStub;
  let statusStub: sinon.SinonStub;
  let redirectStub: sinon.SinonStub;
  let jsonStub: sinon.SinonStub;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    fetchStub = sinon.stub(global, "fetch");
    statusStub = sinon.stub().returnsThis();
    redirectStub = sinon.stub();
    jsonStub = sinon.stub().returnsThis();
    res = {
      status: statusStub,
      redirect: redirectStub,
      json: jsonStub,
    } as unknown as Response;
    next = sinon.spy();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should redirect to GitHub with correct params", () => {
    const req = {} as Request;

    process.env.CLIENT_ID = "test-client-id";

    redirectToGithub(req, res, next);

    expect(statusStub.calledWith(302)).to.be.true;
    expect(redirectStub.firstCall.args[0]).to.contain(
      `client_id=${process.env.CLIENT_ID}`,
    );
    expect(redirectStub.firstCall.args[0]).to.contain(
      "scope=read:user,repo,read:org",
    );
  });

  it("should create a user and return a JWT on successful GitHub login", async () => {
    const req = { query: { code: "abc-123" } } as unknown as Request;

    fetchStub.withArgs(`${GITHUB_ACCESS_TOKEN_URL}`).resolves({
      ok: true,
      json: async () => ({
        access_token: "fake-access-token",
      }),
    });

    fetchStub.withArgs(`${GITHUB_API}/user`).resolves({
      ok: true,
      json: async () => ({
        login: "testuser",
        avatar_url: "https://example.com/avatar.png",
        id: 12345,
        email: "test@test.com",
      }),
    });

    sinon.stub(db, "insert").returns({
      values: sinon.stub().returns({
        onConflictDoUpdate: sinon.stub().returns({
          returning: sinon
            .stub()
            .resolves([
              { id: 1, email: "test@test.com", username: "testuser" },
            ]),
        }),
      }),
    } as any);

    await handleCallback(req, res, () => {});

    expect(statusStub.calledWith(200)).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.have.property("token");
  });
});
