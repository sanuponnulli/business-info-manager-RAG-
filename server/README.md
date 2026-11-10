# Handbook RAG Server

Backend for the employee-handbook assistant. Admins upload handbook PDFs; employees ask questions by **text** (HTTP) or **voice** (WebSocket). Both paths answer only from the uploaded handbook.

```
React admin app ──POST /api/v1/admin/documents──► ingestion worker ──► Gemini embeddings ──► ChromaDB
                                                                                              ▲
Flutter app ──POST /api/v1/chat/ask──► retrieveContext() ──────────────────────────────────────┤
Flutter app ──WS /ws/voice-agent──► Gemini Live ──tool: search_handbook──► retrieveContext() ──┘
```

- **Stack:** Node 20+, TypeScript, Express 5, `ws`, `@google/genai`, ChromaDB (Docker).
- **Models:** `gemini-embedding-001` (3072-d vectors), `gemini-3.5-flash` for text chat with `gemini-3.8-flash` as a fallback, and `gemini-3.8-live` for voice. All of them can be changed in `.env`.

## Setup

You need Node 20+, Docker (or OrbStack), and a Gemini API key from https://aistudio.google.com/apikey.

```bash
# from the repo root: start ChromaDB on :8000 (data persists in a Docker volume)
docker compose up -d

cd server
npm install
cp .env.example .env      # then fill in GEMINI_API_KEY and ADMIN_API_KEY (16+ chars)
npm run dev               # http://localhost:3000, restarts on file changes
```

| Script | What it does |
|---|---|
| `npm run dev` | Starts the server and restarts it when files change |
| `npm test` | Unit tests. External services are mocked, so no keys or Docker are needed |
| `npm run typecheck` | Type-checks without building |
| `npm run build` then `npm start` | Compiles to `dist/` and runs the compiled build |

Every setting is listed and explained in [`.env.example`](.env.example). The server checks them at startup and refuses to start if one is missing or invalid.

### HR database

The server also holds the HR data of the fictional company **Acme** (people, leave, pay, benefits) in Postgres, through Prisma. The HR endpoints will be served by this same server under `/api/v1/...`; their contract is [`docs/hr-openapi.yaml`](docs/hr-openapi.yaml) (22 endpoints, not implemented yet).

```bash
docker compose up -d hr-db     # from the repo root: Postgres on localhost:5433
npx prisma migrate deploy      # create the tables (npm install already generated the client)
npm run db:seed                # ~130 employees with leave, payslips and benefits (safe to re-run)
```

| Script | What it does |
|---|---|
| `npm run db:seed` | Wipes and refills the HR tables. The same data every run |
| `npm run db:studio` | Browse the data in the browser |
| `npm run db:migrate` | After editing `prisma/schema.prisma`: create and apply a migration, then run `npm run db:generate` |
| `npm run contract:lint` | Checks the OpenAPI contract |

Demo logins, all with password `Password123!`: `employee@acme.test` (Sneha Nair, has a pending leave request), `manager@acme.test` (Arjun Menon, 8 reports, pending approvals), `hr@acme.test` (Fatima Al Mansoori, HR admin).

### Try it without a frontend

```bash
set -a; source .env; set +a                          # loads ADMIN_API_KEY into this shell
curl -H "x-admin-key: $ADMIN_API_KEY" -F file=@fixtures/sample-handbook.pdf localhost:3000/api/v1/admin/documents
curl -X POST localhost:3000/api/v1/chat/ask -H 'content-type: application/json' -d '{"question":"How many sick days do I get?"}'
npx tsx scripts/voice-test.ts fixtures/question-sick-days.wav && afplay reply.wav
```

The `scripts/` folder holds one `try-*.ts` script per pipeline stage (`try-embed`, `try-chunk`, `try-ingest`, `try-retrieve`, `try-chroma`) for checking each stage on its own. `ws-client.ts` is a small terminal client for the voice WebSocket.

---

## REST API

Errors always have this shape, with the matching HTTP status:

```json
{ "error": { "code": "not_a_pdf", "message": "Only PDF files are accepted" } }
```

### `GET /health`
`200 {"status":"ok","chroma":"ok"}`, or `503 {"status":"degraded","chroma":"down"}` when ChromaDB is unreachable.

### Admin endpoints
All admin endpoints require the header `x-admin-key: <ADMIN_API_KEY>`. A missing or wrong key returns `401 unauthorized`.

#### `POST /api/v1/admin/documents`: upload a handbook
`multipart/form-data` fields:

| Field | Required | Notes |
|---|---|---|
| `file` | yes | PDF, up to 20 MB, with real text (scanned PDFs are rejected) |
| `docId` | no | lowercase-and-dashes slug. Defaults to the file name (`Employee Handbook.pdf` → `employee-handbook`) |
| `title` | no | Display name. Defaults to the file name without `.pdf` |

Uploading with an existing `docId` **replaces** that document. The old version stays searchable until the new one is fully processed.

Returns `202 Accepted` with a `Location` header pointing at the job:
```json
{ "jobId": "1d306d3d-…", "docId": "employee-handbook", "title": "Employee Handbook", "status": "queued" }
```
Errors: `400 missing_file | not_a_pdf | invalid_fields`, `413 file_too_large`.

#### `GET /api/v1/admin/documents/jobs/:jobId`: poll an upload
```json
{ "id": "1d306d3d-…", "docId": "employee-handbook", "title": "Employee Handbook",
  "status": "done", "chunks": 42, "createdAt": "…", "finishedAt": "…" }
```
`status` is `queued`, then `processing`, then `done` or `failed` (with an `error` message). Poll about every second until the status is `done` or `failed`. Jobs live in memory: they disappear after a server restart, and only the last 100 finished jobs are kept. Unknown jobs return `404 job_not_found`.

#### `GET /api/v1/admin/documents`: list documents
```json
{ "documents": [ { "docId": "employee-handbook", "title": "Employee Handbook", "chunks": 42, "uploadedAt": "…" } ] }
```

#### `DELETE /api/v1/admin/documents/:docId`: delete a document
`200 {"docId":"employee-handbook","deletedChunks":42}`, or `404 document_not_found`.

### Chat endpoint (sign-in optional)

#### `POST /api/v1/chat/ask`
```json
{
  "question": "And do I need a doctor's note?",
  "history": [
    { "role": "user",  "text": "How many sick days do I get?" },
    { "role": "model", "text": "You get ten days of fully paid sick leave per year [1]." }
  ]
}
```
- `Authorization: Bearer <accessToken>` (from `POST /api/v1/auth/login`): optional. Without it the assistant only searches the handbook. With it, it can also look up the user's own HR records, and managers and HR can see their team's leave (see **HR tools and access** below). A bad or expired token gets `401`, not a handbook-only answer.
- `question`: required, up to 2000 characters.
- `history`: optional, at most 20 turns of up to 4000 characters each. The server stores no conversation state, so the client sends the recent turns with each question.

Response:
```json
{
  "answer": "Yes, absences longer than three consecutive days require a medical certificate [1].",
  "sources": [
    { "n": 1, "cited": true,  "title": "Employee Handbook", "page": 2, "docId": "employee-handbook", "score": 0.69, "text": "…" },
    { "n": 2, "cited": false, "title": "Employee Handbook", "page": 2, "docId": "employee-handbook", "score": 0.68, "text": "…" }
  ],
  "toolsUsed": ["search_handbook"]
}
```
`[n]` in the answer refers to `sources[].n`. Answers from HR records carry no `[n]`; `toolsUsed` shows where an answer came from. Show the sources where `cited: true` as references (for example "Employee Handbook, p. 2"). If the handbook doesn't cover the question, the answer says so and suggests contacting HR. It doesn't guess.

### HR tools and access

The assistant (text and voice) answers from two places: the handbook in ChromaDB (policies) and the HR database (the user's own records). The tools live in [`src/tools/registry.ts`](src/tools/registry.ts), and the role rules in [`src/auth/permissions.ts`](src/auth/permissions.ts).

| Tool | Not signed in | Employee | Manager | HR admin |
|---|---|---|---|---|
| `search_handbook` | ✓ | ✓ | ✓ | ✓ |
| `get_my_profile`, `get_my_leave_balances`, `list_my_leave_requests`, `get_my_holidays`, `get_my_pay`, `get_my_benefits` | | own | own | own |
| `find_colleagues` | | colleagues (no terminated; hire date and status only for own reports) | same, plus details of direct reports | everyone, with details |
| `get_team_leave` | | | direct reports | everyone |

How it's enforced: the model is only offered the tools the role allows. Each call re-reads the user's role from the database before running. Every query is filtered by role (for example `manager_id = <me>`). No tool takes an employee id: who the user is comes only from the token. Check it against the real database with `npx tsx --env-file=.env scripts/try-hr-tools.ts`.

---

## Voice WebSocket: `ws://<host>/ws/voice-agent`

Optional sign-in: connect to `ws://<host>/ws/voice-agent?token=<accessToken>` (browsers can't set headers on a WebSocket). Without a token the agent only searches the handbook. An invalid token gets `401` before the connection opens.

One connection is one voice conversation, and the agent remembers what was said earlier in it. Every frame is a **JSON text frame** with a `type` field. Binary frames are rejected. The authoritative definitions are in [`src/ws/protocol.ts`](src/ws/protocol.ts).

### Audio format
| Direction | Format |
|---|---|
| App → server (microphone) | raw PCM, 16-bit little-endian, **16 kHz**, mono, base64-encoded, no WAV header |
| Server → app (speaker) | raw PCM, 16-bit little-endian, **24 kHz**, mono, base64-encoded, no WAV header |

Send the microphone audio in small slices, around 100 ms each (3200 bytes before base64), as it's recorded.

### App → server
| Message | Meaning |
|---|---|
| `{"type":"audio","data":"<base64>"}` | A slice of microphone audio |
| `{"type":"text","text":"…"}` | A typed message, instead of speaking |
| `{"type":"end"}` | The user stopped talking (mic button released). The agent answers right away |

### Server → app
| Message | What the app should do |
|---|---|
| `{"type":"ready"}` | Session open: start sending. Messages sent before this get `not_ready` |
| `{"type":"audio","data":"<base64>"}` | Queue the slice for playback, in order |
| `{"type":"transcript","role":"user"\|"model","text":"…"}` | Captions. They arrive in **fragments**: append them per role until `turn_complete` |
| `{"type":"tool","name":"search_handbook","query":"…"}` | The agent is searching the handbook. Show "Searching…" |
| `{"type":"interrupted"}` | The user spoke over the agent. **Stop playback and clear queued audio** |
| `{"type":"turn_complete"}` | The agent finished its answer. The user can speak again |
| `{"type":"error","code":"…","message":"…"}` | See below |

### Error codes and close codes
| `code` | When | Connection |
|---|---|---|
| `bad_message` | A frame isn't valid JSON or doesn't match the protocol | stays open |
| `not_ready` | Sent before `ready` | stays open |
| `server_busy` | More than `VOICE_MAX_SESSIONS` calls at once | closed with **1013**: retry later |
| `idle_timeout` | No traffic in either direction for `VOICE_IDLE_TIMEOUT_MS` | closed with **1000** |
| `upstream_unavailable` | Gemini Live couldn't be reached | closed with **1011** |
| `session_closed` | Gemini ended the session (for example its session time limit) | closed with **1011**: reconnect to continue |

The server also closes with **1001** when it shuts down, and pings every 30 s to detect dead connections.

### A typical exchange
```
→ connect                                  ← {"type":"ready"}
→ {"type":"audio",...} × N  (user speaks)
→ {"type":"end"}                           ← {"type":"transcript","role":"user","text":"How many sick"} …
                                           ← {"type":"tool","name":"search_handbook","query":"sick days per year"}
                                           ← {"type":"audio",...} × N        (play these)
                                           ← {"type":"transcript","role":"model","text":"Employees are…"} …
                                           ← {"type":"turn_complete"}
```

---

## How it works

| Stage | File | Notes |
|---|---|---|
| Settings | `src/config/env.ts` | Checked once at startup with zod. Nothing else reads `process.env` |
| PDF → pages | `src/ingestion/pdf.ts` | `pdf-parse`. Spacing is cleaned up and scanned PDFs are rejected |
| Pages → chunks | `src/ingestion/chunker.ts` | 1000 characters with a 200-character overlap, split page by page so each chunk keeps its page number |
| Chunks → vectors | `src/services/embedding.service.ts` | Batches of 100, retried on 429/5xx. `RETRIEVAL_DOCUMENT` for stored chunks, `RETRIEVAL_QUERY` for questions |
| Ingestion | `src/services/ingestion.service.ts` | In-memory queue, one job at a time. **Embeds first, then deletes the old version and adds the new one**, so a failed upload never empties a document |
| Retrieval | `src/services/rag.service.ts` | `retrieveContext(query, k=3)`: cosine search, then numbered `[n]` passages. Shared by text and voice |
| Text answers | `src/services/answer.service.ts` | Grounding prompt, then `CHAT_MODEL` (one try, 12 s limit), falling back to `CHAT_FALLBACK_MODEL` on 5xx/429/timeout |
| Voice | `src/ws/voiceAgent.ts`, `liveSession.ts`, `tools.ts` | One Gemini Live session per client. Gemini calls `search_handbook` → `retrieveContext` |

### Known limitations
- **No user authentication** on `/chat/ask` or the voice WebSocket yet.
- **Jobs are in memory**: an upload still processing when the server stops is lost, and the previous version of that document stays. Run a single server instance.
- **Follow-up questions in text chat** are searched as typed. A very vague follow-up ("what about part-timers?") may retrieve poorly. Rewriting the question with the history before searching would fix this.
- **Text-only PDFs**: scanned documents (images of pages) would need OCR.
