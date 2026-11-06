import { useCallback, useEffect, useState } from "react";
import { deleteDocument, listDocuments, type DocumentSummary } from "../api";
import { UploadPanel } from "../components/UploadPanel";

/**
 * Lists the handbook documents stored in ChromaDB, with upload and delete.
 * The list is reloaded after every upload that finishes and every delete.
 */
export function DocumentsPage({ adminKey }: { adminKey: string }) {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDocs(await listDocuments(adminKey));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [adminKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function remove(doc: DocumentSummary) {
    if (!confirm(`Delete "${doc.title}" and its ${doc.chunks} chunks? The assistant will stop using it.`)) return;
    setDeleting(doc.docId);
    try {
      await deleteDocument(adminKey, doc.docId);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="stack">
      <UploadPanel adminKey={adminKey} onDocumentReady={reload} />

      <section className="card">
        <div className="row">
          <h2>Documents</h2>
          <button className="link" onClick={() => void reload()}>
            Refresh
          </button>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {docs === null && !error && <p className="muted">Loading…</p>}
        {docs?.length === 0 && <p className="muted">No documents yet. Upload a handbook PDF above.</p>}

        {docs && docs.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>docId</th>
                  <th className="num">Chunks</th>
                  <th>Uploaded</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.docId}>
                    <td>{doc.title}</td>
                    <td>
                      <code>{doc.docId}</code>
                    </td>
                    <td className="num">{doc.chunks}</td>
                    <td>{new Date(doc.uploadedAt).toLocaleString()}</td>
                    <td className="actions">
                      <button className="danger" disabled={deleting === doc.docId} onClick={() => void remove(doc)}>
                        {deleting === doc.docId ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
