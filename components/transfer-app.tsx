"use client";

import { upload } from "@vercel/blob/client";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  FileArchive,
  FileIcon,
  Files,
  FolderOpen,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { EXPIRY_OPTIONS, MAX_FILE_BYTES, MAX_FILES, MAX_TRANSFER_BYTES } from "@/lib/constants";

type Mode = "send" | "receive";
type UploadStage = "select" | "uploading" | "complete";
type SelectedFile = { id: string; file: File; relativePath: string };
type CreatedTransfer = { id: string; code: string; ownerToken: string; expiresAt: string };
type ReceivedTransfer = {
  code: string;
  expiresAt: string;
  totalBytes: number;
  files: Array<{ name: string; relativePath: string; size: number; type: string; downloadUrl: string }>;
};

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

const timeLeft = (iso: string) => {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.ceil(hours / 24)} days`;
  if (hours >= 1) return `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  return `${Math.max(1, Math.ceil(ms / 60_000))} min`;
};

const fileKey = (file: File, index: number) => `${file.name}-${file.size}-${file.lastModified}-${index}`;
const safeFilename = (value: string) => value.normalize("NFKC").replace(/[\\/\0<>:"|?*\x00-\x1F]/g, "_").replace(/^\.+/, "").slice(0, 180) || "file";

export function TransferApp() {
  const [mode, setMode] = useState<Mode>("send");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [expiry, setExpiry] = useState(24 * 60 * 60);
  const [stage, setStage] = useState<UploadStage>("select");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [transfer, setTransfer] = useState<CreatedTransfer | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [received, setReceived] = useState<ReceivedTransfer | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  const totalBytes = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);
  const uploadedBytes = useMemo(
    () => files.reduce((sum, item) => sum + item.file.size * ((progress[item.id] || 0) / 100), 0),
    [files, progress],
  );
  const overallProgress = totalBytes ? Math.round((uploadedBytes / totalBytes) * 100) : 0;

  const addFiles = (incoming: File[]) => {
    setError("");
    const existing = new Set(files.map((item) => `${item.relativePath}:${item.file.size}:${item.file.lastModified}`));
    const next = incoming
      .filter((file) => file.size <= MAX_FILE_BYTES)
      .map((file, index) => ({
        id: fileKey(file, files.length + index),
        file,
        relativePath: file.webkitRelativePath || file.name,
      }))
      .filter((item) => !existing.has(`${item.relativePath}:${item.file.size}:${item.file.lastModified}`));
    const combined = [...files, ...next];
    const combinedSize = combined.reduce((sum, item) => sum + item.file.size, 0);
    if (combined.length > MAX_FILES) return setError(`A transfer can contain up to ${MAX_FILES} files.`);
    if (combinedSize > MAX_TRANSFER_BYTES) return setError("A transfer can be up to 50 GB.");
    if (incoming.some((file) => file.size > MAX_FILE_BYTES)) {
      setError("Files larger than 20 GB were not added.");
    }
    setFiles(combined);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  };

  const copyCode = async () => {
    if (!transfer) return;
    await navigator.clipboard.writeText(transfer.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const resetSend = () => {
    setFiles([]);
    setStage("select");
    setTransfer(null);
    setProgress({});
    setError("");
  };

  const startUpload = async () => {
    if (!files.length || stage === "uploading") return;
    setError("");
    setStage("uploading");
    const abortController = new AbortController();
    controller.current = abortController;

    try {
      const createResponse = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expirySeconds: expiry,
          files: files.map(({ file, relativePath }) => ({
            name: file.name,
            relativePath,
            size: file.size,
            type: file.type,
          })),
        }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) throw new Error(created.error || "Could not create the transfer.");
      setTransfer(created);

      const uploaded: Array<{
        name: string;
        relativePath: string;
        pathname: string;
        size: number;
        type: string;
      }> = [];

      let cursor = 0;
      const worker = async () => {
        while (cursor < files.length) {
          const index = cursor++;
          const item = files[index];
          const pathname = `files/${created.id}/${String(index).padStart(4, "0")}-${safeFilename(item.file.name)}`;
          const blob = await upload(pathname, item.file, {
            access: "private",
            handleUploadUrl: "/api/upload",
            clientPayload: JSON.stringify({ code: created.code, ownerToken: created.ownerToken }),
            multipart: item.file.size > 100 * 1024 * 1024,
            abortSignal: abortController.signal,
            onUploadProgress: ({ percentage }) => {
              setProgress((current) => ({ ...current, [item.id]: percentage }));
            },
          });
          uploaded[index] = {
            name: item.file.name,
            relativePath: item.relativePath,
            pathname: blob.pathname,
            size: item.file.size,
            type: item.file.type,
          };
        }
      };

      await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
      const finalizeResponse = await fetch("/api/transfers/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: created.code, ownerToken: created.ownerToken, files: uploaded }),
      });
      const finalized = await finalizeResponse.json();
      if (!finalizeResponse.ok) throw new Error(finalized.error || "Could not finalize the transfer.");
      setTransfer((current) => current ? { ...current, expiresAt: finalized.expiresAt } : current);
      setStage("complete");
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed.";
      setError(message === "This operation was aborted" ? "Upload cancelled." : message);
      setStage("select");
    } finally {
      controller.current = null;
    }
  };

  const deleteTransfer = async () => {
    if (!transfer) return;
    await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: transfer.code, ownerToken: transfer.ownerToken }),
    });
    resetSend();
  };

  const receiveTransfer = async () => {
    if (code.length !== 6) return;
    setReceiving(true);
    setError("");
    setReceived(null);
    try {
      const response = await fetch("/api/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Transfer not found.");
      setReceived(result);
    } catch (receiveError) {
      setError(receiveError instanceof Error ? receiveError.message : "Transfer not found.");
    } finally {
      setReceiving(false);
    }
  };

  const downloadAll = () => {
    if (!received) return;
    received.files.forEach((file, index) => {
      setTimeout(() => {
        const link = document.createElement("a");
        link.href = file.downloadUrl;
        link.download = file.name;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 350);
    });
  };

  return (
    <main className="site-shell">
      <nav className="nav-wrap">
        <a className="brand" href="#" aria-label="DropSix home">
          <span className="brand-mark"><ArrowDownToLine size={19} strokeWidth={2.6} /></span>
          <span>drop<span>six</span></span>
        </a>
        <div className="nav-note"><ShieldCheck size={16} /> Private by default</div>
      </nav>

      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> No sign-up. No clutter. Just send.</div>
        <h1>Big files.<br /><span>Six small digits.</span></h1>
        <p>Send files and folders up to 50 GB with one simple code. Your transfer disappears automatically when time is up.</p>
      </section>

      <section className="transfer-card" aria-label="File transfer">
        <div className="mode-switch">
          <button className={mode === "send" ? "active" : ""} onClick={() => { setMode("send"); setError(""); }}>
            <Send size={17} /> Send
          </button>
          <button className={mode === "receive" ? "active" : ""} onClick={() => { setMode("receive"); setError(""); }}>
            <Download size={17} /> Receive
          </button>
        </div>

        {mode === "send" ? (
          <div className="panel-body">
            {stage === "complete" && transfer ? (
              <div className="success-panel">
                <div className="success-icon"><Check size={32} /></div>
                <p className="overline">Transfer ready</p>
                <h2>Share this code</h2>
                <p className="muted">Anyone with the code can download your files until the transfer expires.</p>
                <button className="code-display" onClick={copyCode} aria-label="Copy transfer code">
                  {transfer.code.slice(0, 3)} <span>{transfer.code.slice(3)}</span>
                  <i>{copied ? <Check size={18} /> : <Copy size={18} />}</i>
                </button>
                <div className="expiry-badge"><Clock3 size={15} /> Expires in {timeLeft(transfer.expiresAt)}</div>
                <div className="success-actions">
                  <button className="primary-button" onClick={copyCode}>{copied ? "Copied" : "Copy code"}</button>
                  <button className="secondary-button" onClick={resetSend}><RefreshCw size={16} /> Send another</button>
                </div>
                <button className="delete-link" onClick={deleteTransfer}><Trash2 size={15} /> Delete this transfer now</button>
              </div>
            ) : (
              <>
                <div
                  className={`drop-zone ${stage === "uploading" ? "is-uploading" : ""}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={onDrop}
                >
                  {stage === "uploading" ? (
                    <div className="upload-state">
                      <div className="progress-orbit"><span>{overallProgress}%</span></div>
                      <h2>Sending your files</h2>
                      <p>{formatBytes(Math.round(uploadedBytes))} of {formatBytes(totalBytes)}</p>
                      <div className="progress-track"><span style={{ width: `${overallProgress}%` }} /></div>
                      <p className="tiny">You can keep this tab open while the upload completes.</p>
                    </div>
                  ) : (
                    <>
                      <div className="upload-icon"><UploadCloud size={30} /></div>
                      <h2>Drop anything here</h2>
                      <p>Files, folders, photos, videos—whatever you need to move.</p>
                      <div className="picker-actions">
                        <button className="primary-button" onClick={() => fileInput.current?.click()}><Files size={17} /> Choose files</button>
                        <button className="secondary-button" onClick={() => folderInput.current?.click()}><FolderOpen size={17} /> Choose folder</button>
                      </div>
                      <p className="tiny">Up to 20 GB per file · 50 GB per transfer</p>
                    </>
                  )}
                  <input ref={fileInput} hidden type="file" multiple onChange={onFileChange} />
                  <input ref={folderInput} hidden type="file" multiple onChange={onFileChange} {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} />
                </div>

                {files.length > 0 && (
                  <div className="selection-wrap">
                    <div className="selection-heading">
                      <div><strong>{files.length} {files.length === 1 ? "file" : "files"}</strong><span>{formatBytes(totalBytes)}</span></div>
                      {stage !== "uploading" && <button onClick={() => setFiles([])}>Clear all</button>}
                    </div>
                    <div className="file-list">
                      {files.slice(0, 5).map((item) => (
                        <div className="file-row" key={item.id}>
                          <span className="file-type"><FileIcon size={18} /></span>
                          <div><strong>{item.file.name}</strong><small>{item.relativePath !== item.file.name ? item.relativePath : formatBytes(item.file.size)}</small></div>
                          <span>{formatBytes(item.file.size)}</span>
                          {stage !== "uploading" && <button aria-label={`Remove ${item.file.name}`} onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))}><X size={17} /></button>}
                        </div>
                      ))}
                      {files.length > 5 && <div className="more-files">+ {files.length - 5} more files</div>}
                    </div>
                    <div className="send-options">
                      <label>
                        <span><Clock3 size={16} /> Keep files for</span>
                        <div className="select-wrap">
                          <select value={expiry} onChange={(event) => setExpiry(Number(event.target.value))} disabled={stage === "uploading"}>
                            {EXPIRY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          <ChevronDown size={16} />
                        </div>
                      </label>
                      {stage === "uploading" ? (
                        <button className="cancel-button" onClick={() => controller.current?.abort()}>Cancel upload</button>
                      ) : (
                        <button className="send-button" onClick={startUpload}>Create transfer <ArrowRight size={18} /></button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="panel-body receive-panel">
            {!received ? (
              <>
                <div className="receive-icon"><LockKeyhole size={29} /></div>
                <p className="overline">Collect a transfer</p>
                <h2>Enter your six-digit code</h2>
                <p className="muted">The code was created when the sender finished uploading.</p>
                <div className="code-input-wrap">
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(event) => event.key === "Enter" && receiveTransfer()}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label="Six-digit transfer code"
                    placeholder="000 000"
                  />
                  <span>{code.length}/6</span>
                </div>
                <button className="receive-button" onClick={receiveTransfer} disabled={code.length !== 6 || receiving}>
                  {receiving ? <><RefreshCw className="spin" size={18} /> Looking for files</> : <>Get files <ArrowRight size={18} /></>}
                </button>
              </>
            ) : (
              <div className="received-wrap">
                <div className="received-head">
                  <div className="success-icon small"><Check size={23} /></div>
                  <div><p className="overline">Transfer found</p><h2>{received.files.length} {received.files.length === 1 ? "file" : "files"} ready</h2></div>
                </div>
                <div className="transfer-meta">
                  <span><FileArchive size={16} /> {formatBytes(received.totalBytes)}</span>
                  <span><Clock3 size={16} /> {timeLeft(received.expiresAt)} left</span>
                </div>
                <div className="download-list">
                  {received.files.map((file, index) => (
                    <a href={file.downloadUrl} download={file.name} className="download-row" key={`${file.relativePath}-${index}`}>
                      <span className="file-type"><FileIcon size={18} /></span>
                      <div><strong>{file.name}</strong><small>{file.relativePath}</small></div>
                      <span>{formatBytes(file.size)}</span>
                      <Download size={17} />
                    </a>
                  ))}
                </div>
                <button className="receive-button" onClick={downloadAll}><Download size={18} /> Download all</button>
                <button className="delete-link" onClick={() => { setReceived(null); setCode(""); }}>Use another code</button>
              </div>
            )}
          </div>
        )}

        {error && <div className="error-banner"><span>!</span>{error}<button onClick={() => setError("")}><X size={16} /></button></div>}
      </section>

      <section className="trust-row">
        <div><Zap size={20} /><span><strong>Direct transfer</strong>Fast multipart uploads</span></div>
        <div><LockKeyhole size={20} /><span><strong>Private storage</strong>Signed download access</span></div>
        <div><Clock3 size={20} /><span><strong>Auto-delete</strong>Gone when time is up</span></div>
      </section>

      <footer><span>© {new Date().getFullYear()} DropSix</span><span>Files move. We don’t linger.</span></footer>
    </main>
  );
}
