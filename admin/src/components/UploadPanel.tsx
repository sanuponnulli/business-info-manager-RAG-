import { useEffect, useRef, useState, type FormEvent } from "react";
import { getJob, uploadDocument, type Job } from "../api";

const POLL_MS = 1000;

/**
 * "Embedding 300 / 700 chunks" with a bar. Large documents on Gemini's free
 * tier (100 embeddings a minute) take a few minutes; the bar shows it's moving.
 */
function JobProgress({ job }: { job: Job }) {
  if (!job.progress) return <>Reading and chunking the PDF…</>;
  const { embedded, total } = job.progress;
  if (embedded === total) return <>Saving {total} chunks…</>;
  return (
    <span className="job-progress">
      <progress value={embedded} max={total} /> Embedding {embedded} / {total} chunks
      {total > 100 && <span className="muted"> (free tier: about 100 per minute)</span>}
    </span>
  );
}

/**
 * Upload form plus a list of this session's uploads with live status.
 *
 * Uploading is two steps on the server: the POST returns at once with a
 * job id (202), then the PDF is parsed, chunked and embedded in the
 * background. We poll each unfinished job every second until it's done.
 */
export function UploadPanel({ adminKey, onDocumentReady }: { adminKey: string; onDocumentReady: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [docId, setDocId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSending(true);
    setError(null);
    try {
      const res = await uploadDocument(adminKey, file, { title: title.trim(), docId: docId.trim() });
      // Show the job immediately as "queued"; polling fills in the rest.
      setJobs((prev) => [
        { id: res.jobId, docId: res.docId, title: res.title, status: res.status, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      setFile(null);
      setTitle("");
      setDocId("");
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  // Poll every unfinished job. Re-runs whenever the job list changes.
  const pending = jobs.filter((j) => j.status === "queued" || j.status === "processing");
  useEffect(() => {
    if (pending.length === 0) return;
    const timer = setTimeout(async () => {
      const updates = await Promise.all(pending.map((j) => getJob(adminKey, j.id).catch(() => null)));
      setJobs((prev) => prev.map((j) => updates.find((u) => u?.id === j.id) ?? j));
      if (updates.some((u) => u?.status === "done")) onDocumentReady();
    }, POLL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pending` is derived from `jobs`
  }, [jobs, adminKey, onDocumentReady]);

  return (
    <section className="card">
      <h2>Upload a handbook</h2>
      <p className="muted">
        PDF with real text, up to 20 MB. Uploading a document with an existing docId replaces it; the old version stays
        searchable until the new one is ready.
      </p>

      <form onSubmit={submit}>
        <label htmlFor="pdf">PDF file</label>
        <input
          id="pdf"
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <div className="grid-2">
          <div>
            <label htmlFor="title">
              Title <span className="muted">(optional)</span>
            </label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="From the file name" />
          </div>
          <div>
            <label htmlFor="docId">
              docId <span className="muted">(optional)</span>
            </label>
            <input
              id="docId"
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              placeholder="e.g. employee-handbook"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="Lowercase letters, digits and single dashes"
            />
          </div>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={!file || sending} className="mt">
          {sending ? "Uploading…" : "Upload"}
        </button>
      </form>

      {jobs.length > 0 && (
        <ul className="jobs" aria-live="polite">
          {jobs.map((job) => (
            <li key={job.id}>
              <span className={`status status-${job.status}`}>{job.status}</span>
              <span>
                <strong>{job.title}</strong> <code>{job.docId}</code>
              </span>
              <span className="muted">
                {job.status === "done" && `${job.chunks} chunks stored`}
                {job.status === "failed" && <span className="error">{job.error}</span>}
                {job.status === "queued" && "Waiting for the previous upload to finish…"}
                {job.status === "processing" && <JobProgress job={job} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
