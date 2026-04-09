# Shipyard — CI/CD Engine

A CI/CD deployment pipeline built from scratch. Connect a GitHub repo, push code, and the system automatically clones, builds, tests, and deploys your project.

## How It Works

1. **Authenticate** with GitHub OAuth — your GitHub login is your account
2. **Browse repos** — view your personal repos and organization repos, select one to connect
3. **Connect a repo** — choose a branch and build command. The server registers a webhook on your repo via GitHub's API
4. **Push code** — GitHub fires a signed webhook to the server
5. **Build** — the server clones your repo, generates a Dockerfile if needed, builds a Docker image, and runs your build command inside an isolated container
6. **Deploy** — if the build passes and the project has no sensitive env variables, the output is deployed and served at a subdomain
7. **Rollback** — revert to a previous deployment by re-running the build from that deployment's commit

## Architecture

```
GitHub Push → Webhook (HMAC-SHA256 verified) → Clone Repo → Detect Framework
    → Generate Dockerfile → Docker Build → Run Tests in Container
    → Stream Logs via WebSocket → Pass? → Deploy to Subdomain
                                → Fail? → Report with Full Logs
```

## Features

**Authentication**
- GitHub OAuth flow with access token exchange
- Email fallback via `/user/emails` endpoint when primary email is hidden
- JWT session tokens
- Scopes: read:user, repo, read:org

**Repo Browsing**
- Fetch user's organizations and personal account
- List repos per organization or personal account
- Pagination support
- Sorted by creation date (descending), filtered to owned repos only
- Returns refined repo data (name, default branch, URL, owner)

**Project Management**
- Connect any GitHub repo (public or private)
- Automatic webhook registration via GitHub API
- Custom branch selection, build commands, and install commands
- Framework detection for automatic output directory resolution
- Duplicate project name validation
- Update and delete projects
- Rebuild from previous builds
- Rollback to previous deployments
- Delete individual secrets
- Encrypted secrets storage (AES-256-GCM) for environment variables
- Production URL stored on project level

**CI Engine**
- HMAC-SHA256 webhook signature verification with timing-safe comparison
- Git clone with authenticated URLs for private repo access
- Framework detection (Vite, Next.js) for automatic output directory resolution
- Dynamic Dockerfile generation for projects without one
- Docker image build and containerized test execution
- Real-time build log streaming via Socket.io
- Batch log persistence to PostgreSQL with line numbers
- Build status tracking: queued → running → passed/failed
- Docker volume mounts to persist build output
- User-level container permissions to prevent root ownership issues
- Automatic temp directory cleanup after builds

**CD Engine**
- Static site and SPA deployment for projects without sensitive env variables
- Build output copied to deployment directory
- Subdomain-based routing middleware
- SPA fallback to index.html
- Deployment records stored in database
- Rollback support — revert to previous deployment

**User Management**
- Profile updates (username, email)
- Username uniqueness validation

**Security**
- GitHub OAuth for authentication
- HMAC-SHA256 webhook verification to prevent unauthorized build triggers
- AES-256-GCM encryption for stored secrets (random IV per encryption, auth tag for tamper detection)
- Timing-safe comparison to prevent signature brute-forcing
- Secrets decrypted only at build time, never exposed in responses
- Project ownership verification on update, delete, rebuild, and rollback operations

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express 5
- **Database:** PostgreSQL (running in Docker)
- **ORM:** Drizzle ORM
- **Containerization:** Docker (programmatic via child_process.spawn)
- **Real-time:** Socket.io
- **Auth:** GitHub OAuth + JWT
- **Encryption:** Node crypto (AES-256-GCM, HMAC-SHA256)
- **Validation:** express-validator

## Project Structure

```
src/
├── controller/
│   ├── auth.ts              # GitHub OAuth + JWT issuance
│   ├── builds.ts            # Rebuild, fetch individual builds
│   ├── deployment.ts        # Fetch deployments, rollback
│   ├── project.ts           # Project CRUD, secrets management
│   ├── repos.ts             # Fetch organizations and repositories
│   └── user.ts              # Profile updates
├── db/
│   ├── index.ts             # PostgreSQL pool + Drizzle instance
│   └── schema.ts            # Tables, enums, and relations
├── lib/
│   └── encryption.ts        # AES-256-GCM encrypt/decrypt
├── middleware/
│   ├── is-auth.ts           # JWT verification for REST routes
│   └── socket-auth.ts       # JWT verification for WebSocket
├── routes/
│   ├── auth.ts              # OAuth routes
│   ├── builds.ts            # Build operations routes
│   ├── deployments.ts       # Deployment operations routes
│   ├── project.ts           # Project CRUD routes
│   ├── repo.ts              # Repo browsing routes
│   ├── user.ts              # User profile routes
│   └── webhook.ts           # GitHub webhook endpoint
├── services/
│   ├── buildEngine.ts       # Clone, build, test pipeline
│   └── deploymentEngine.ts  # Deploy and serve static output
├── shared/
│   └── types.ts             # Shared interfaces and constants
├── validation/
│   ├── project.ts           # Project request validation rules
│   └── user.ts              # Profile update validation rules
└── index.ts                 # Server entry point
```

## Database Schema

**User** — GitHub OAuth profile and access token

**Project** — Connected repo with branch, build/install commands, output directory, production URL, and webhook ID

**Build** — Individual build record with status, commit info, exit code, and timestamps

**Build Logs** — Line-by-line build output with line numbers, linked to a build

**Deployment** — Deployment record with status, linked to a build

**Secrets** — Encrypted environment variables linked to a project

## Setup

### Prerequisites
- Node.js 20+
- Docker
- A GitHub OAuth App (Settings → Developer Settings → OAuth Apps)

### Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/pipeline
CLIENT_ID=your_github_oauth_client_id
CLIENT_SECRET=your_github_oauth_client_secret
SECRET=your_jwt_secret
ENCRYPTION_KEY=your_32_byte_hex_key
WEBHOOK_SECRET=your_webhook_secret
BASE_DOMAIN=lvh.me:8080
WEBHOOK_CALLBACK=<your server URL or tunnel>
FRONTEND_URL=http://localhost:3000
```

Generate the encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Run PostgreSQL in Docker

```bash
docker run --name pipeline-db -e POSTGRES_USER=<username> -e POSTGRES_PASSWORD=<password> -e POSTGRES_DB=<database> -p 5432:5432 -d postgres:alpine
```

### Install and Start

```bash
npm install
npx drizzle-kit push
npm run dev
```

### Testing Webhooks Locally

GitHub can't reach localhost. Use a tunneling tool to expose your server:

```bash
ngrok http 8080
```
or

```bash
outray 8080
```

Update the `WEBHOOK_CALLBACK` in your `.env` to use the tunnel URL.

### Deploying to VPS

```bash
ssh root@<your-server-ip>
cd /root/cicd-engine
git pull
npx drizzle-kit push
pm2 restart cicd-engine
```

## API Endpoints

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/auth/github` | No | Redirect to GitHub OAuth |
| GET | `/api/auth/github/callback` | No | Handle OAuth callback, redirect to frontend |

### Repos
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/repo/orgs` | JWT | Fetch user's organizations + personal account |
| GET | `/api/repo/repos` | JWT | Fetch repos for an org or personal account |

### Projects
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/project` | JWT | Create project + register webhook |
| GET | `/api/project/projects` | JWT | Fetch all user projects with builds and deployments |
| PUT | `/api/project/projects/:projectId` | JWT | Update project settings |
| DELETE | `/api/project/projects/:projectId` | JWT | Delete a project |
| DELETE | `/api/project/secret/:secretId` | JWT | Delete a secret |

### Builds
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/build/rebuild/:buildId` | JWT | Re-run a build |
| GET | `/api/build/:buildId` | JWT | Fetch a specific build |

### Deployments
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/deploy/:deploymentId` | JWT | Fetch a specific deployment |
| PUT | `/api/deploy/rollback?latest=<lastestId>&prev=<prevId>` | JWT | Rollback to a previous deployment |

### Users
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PUT | `/api/user` | JWT | Update user profile |

### Webhooks
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/webhook` | HMAC | Receive GitHub push events |

### Health
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/api` | No | API welcome |

## WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `build_logs` | Server → Client | Real-time build output |
| `build_errors` | Server → Client | Build error output |
| `run_logs` | Server → Client | Test/run output |
| `run_error` | Server → Client | Test/run errors |
| `deploymentUpdate` | Server → Client | Deployment status + URL |

### Testing Deployed Projects Locally

Deployed projects are served via subdomain routing. To test locally, use `lvh.me` which resolves to 127.0.0.1:
```
http://<project-name>.lvh.me:8080
```

For example, a project named "test-repo" would be accessible at:
```
http://test-repo.lvh.me:8080
```

### Running Tests
```bash
npm test
```

8 tests covering authentication, project creation, repo browsing, and webhook handling.

## License

MIT