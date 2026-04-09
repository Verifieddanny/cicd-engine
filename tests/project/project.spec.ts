import { expect } from "../setup.js";
import * as sinon from "sinon";
import type { NextFunction, Request, Response } from "express";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/controller/project.js";
import { fetchOrganization, fetchRepos } from "../../src/controller/repos.js";

describe("Project Controller", () => {
  let statusStub: sinon.SinonStub;
  let jsonStub: sinon.SinonStub;
  let res: Response;
  let next: NextFunction;
  beforeEach(() => {
    statusStub = sinon.stub().returnsThis();
    jsonStub = sinon.stub().returnsThis();
    res = { status: statusStub, json: jsonStub } as unknown as Response;
    next = sinon.spy();
  });

  afterEach(() => {
    sinon.restore();
  });
  it("should create a project", async () => {
    const req = {
      body: {
        name: "Test Project",
        repoUrl: "https://github.com/test/repo",
        branch: "main",
        buildCommand: "npm run build",
        installCommand: "npm install",
        secrets: [{ key: "SECRET_KEY", value: "secret_value" }],
      },
      userId: 1,
    } as unknown as Request;

    sinon.stub(db, "selectDistinct").returns({
      from: sinon.stub().returns({
        where: sinon.stub().returns({
          limit: sinon.stub().resolves([{ accessToken: "fake-token" }]),
        }),
      }),
    } as any);

    sinon.stub(global, "fetch").resolves({
      ok: true,
      json: async () => ({ id: 12345 }),
    } as any);

    sinon.stub(db, "insert").returns({
      values: sinon.stub().returns({
        returning: sinon.stub().resolves([
          {
            id: 1,
            name: "Test Project",
            repoUrl: "https://github.com/test/repo",
            branch: "main",
            buildCommand: "npm run build",
            installCommand: "npm install",
            webhookId: "12345",
          },
        ]),
      }),
    } as any);

    await createProject(req, res, next);

    expect(statusStub.calledWith(201)).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.deep.include({
      message: "project created",
    });
    expect(jsonStub.firstCall.args[0].project).to.have.property(
      "webhookId",
      "12345",
    );
  });

  it("should fetch organizations", async () => {
    const req = {
      query: {
        page: "1",
      },
      userId: 1,
    } as unknown as Request;

    sinon.stub(db, "selectDistinct").returns({
      from: sinon.stub().returns({
        where: sinon.stub().returns({
          limit: sinon
            .stub()
            .resolves([{ accessToken: "fake-token", username: "testuser" }]),
        }),
      }),
    } as any);

    const fetchStub = sinon.stub(global, "fetch");

    fetchStub.withArgs(sinon.match(/user\/orgs/), sinon.match.any).resolves({
      ok: true,
      json: async () => [{ login: "org1" }, { login: "org2" }],
    } as any);

    fetchStub.withArgs(sinon.match(/\/user$/), sinon.match.any).resolves({
      ok: true,
      json: async () => ({
        login: "testuser",
        avatar_url: "https://example.com/avatar.png",
        id: 12345,
        email: "test@test.com",
      }),
    } as any);

    await fetchOrganization(req, res, next);

    expect(statusStub.calledWith(200)).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.deep.include({
      organizations: [
        { login: "testuser", avatar_url: "https://example.com/avatar.png" },
        { login: "org1", avatar_url: undefined },
        { login: "org2", avatar_url: undefined },
      ],
    });
  });

  it("should fetch repositories", async () => {
    const req = {
      query: {
        page: "1",
      },
      userId: 1,
    } as unknown as Request;
    const updatedAt = new Date().toISOString();

    sinon.stub(db, "selectDistinct").returns({
      from: sinon.stub().returns({
        where: sinon.stub().returns({
          limit: sinon
            .stub()
            .resolves([{ accessToken: "fake-token", username: "testuser" }]),
        }),
      }),
    } as any);

    sinon.stub(global, "fetch").resolves({
      ok: true,
      json: async () => [
        {
          name: "repo1",
          default_branch: "main",
          html_url: "https://github.com/testuser/repo1",
          owner: { login: "testuser" },
          updated_at: updatedAt,
        },
      ],
    } as any);

    await fetchRepos(req, res, next);

    expect(statusStub.calledWith(200)).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.deep.include({
      repos: [
        {
          name: "repo1",
          branch: "main",
          repoUrl: "https://github.com/testuser/repo1",
          owner: "testuser",
          updatedAt,
        },
      ],
    });
  });
});
