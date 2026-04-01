import { expect } from "../setup.js";
import * as sinon from "sinon";
import type { NextFunction, Request, Response } from "express";
import { handleWebhook } from "../../src/controller/project.js";
import { createHmac } from "node:crypto";
import { db } from "../../src/db/index.js";
import esmock from "esmock";

describe("Webhook Controller", () => {
  let statusStub: sinon.SinonStub;
  let jsonStub: sinon.SinonStub;
  let res: Response;
  let next: NextFunction;
  let secret: string;
  beforeEach(() => {
    statusStub = sinon.stub().returnsThis();
    jsonStub = sinon.stub().returnsThis();
    res = { status: statusStub, json: jsonStub } as unknown as Response;
    next = sinon.spy();
    secret = "test-secret";
    process.env.WEBHOOK_SECRET = secret;
  });

  afterEach(() => {
    sinon.restore();
  });
  it("should reject webhook if signature is invalid", () => {
    const req = {
      headers: {
        "x-hub-signature-256": "",
      },
      body: {},
    } as unknown as Request;

    handleWebhook(req, res, next);

    expect(statusStub.calledWith(401)).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.deep.equal({
      message: "No signature",
    });
  });

  it("should accept webhook if signature is valid", async () => {
    const body = {
      commits: [{ message: "fix", author: { name: "bot" } }],
      ref: "refs/heads/main",
      repository: { html_url: "https://github.com/user/repo" },
    };

    const hmac = createHmac("sha256", secret);
    const signature =
      "sha256=" + hmac.update(JSON.stringify(body)).digest("hex");
    const req = {
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "push",
      },
      body,
      app: {
        get: sinon
          .stub()
          .withArgs("io")
          .returns({
            to: sinon.stub().returns({ emit: sinon.stub() }),
          }),
      },
    } as unknown as Request;

    sinon.stub(db.query.projectTable, "findFirst").resolves({
      id: 1,
      repoUrl: "https://github.com/user/repo",
      branch: "main",
      user: { githubToken: "token" },
      secrets: [],
    } as any);

    sinon.stub(db, "insert").returns({
      values: sinon.stub().returns({
        returning: sinon.stub().resolves([{ id: 99, status: "queued" }]),
      }),
    } as any);

    const runBuildStub = sinon.stub().resolves();

    const { handleWebhook: mockedHandleWebhook } = await esmock(
      "../../src/controller/project.js",
      {
        "../../src/services/buildEngine.js": {
          runBuild: runBuildStub,
        },
      },
    );

    await mockedHandleWebhook(req, res, next);

    expect(statusStub.calledWith(201)).to.be.true;
    expect(runBuildStub.calledOnce).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.deep.equal({
      message: "Build Queued",
      build: {
        id: 99,
        status: "queued",
      },
    });

    const runBuildArgs = runBuildStub.firstCall.args;
    expect(runBuildArgs[0]).to.have.property("id", 1);
    expect(runBuildArgs[3]).to.have.property("id", 99);
  });

  it("should respond to ping events", async () => {
    const body = {
      commits: [{ message: "fix", author: { name: "bot" } }],
      ref: "refs/heads/main",
      repository: { html_url: "https://github.com/user/repo" },
    };

    const hmac = createHmac("sha256", secret);
    const signature =
      "sha256=" + hmac.update(JSON.stringify(body)).digest("hex");
    const req = {
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "ping",
      },
      body,
      app: {
        get: sinon
          .stub()
          .withArgs("io")
          .returns({
            to: sinon.stub().returns({ emit: sinon.stub() }),
          }),
      },
    } as unknown as Request;

    await handleWebhook(req, res, next);
    expect(statusStub.calledWith(200)).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.deep.equal({
      message: "Github pinged",
    });
  });
});
