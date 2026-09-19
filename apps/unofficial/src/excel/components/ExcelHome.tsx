"use client";
import { DEFAULT_FOLDER_ID } from "../lib/folder";
import type { BookMeta, FolderMeta } from "../lib/store";

const dayText = (at: number) =>
  new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
  " " +
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

interface Props {
  folders: FolderMeta[];
  books: BookMeta[];
  folderId: string | null;
  moreOpen: boolean;
  onNew: () => void;
  onOpenFile: () => void;
  onNewFolder: () => void;
  onOpenFolder: (id: string | null) => void;
  onOpenBook: (id: string) => void;
  onDeleteBook: (book: BookMeta) => void;
  onRenameFolder: (folder: FolderMeta) => void;
  onDeleteFolder: (folder: FolderMeta) => void;
  onToggleMore: () => void;
}

export default function ExcelHome({
  folders,
  books,
  folderId,
  moreOpen,
  onNew,
  onOpenFile,
  onNewFolder,
  onOpenFolder,
  onOpenBook,
  onDeleteBook,
  onRenameFolder,
  onDeleteFolder,
  onToggleMore,
}: Props) {
  const folder = folderId ? folders.find((f) => f.id === folderId) : null;
  const files = folderId ? books.filter((b) => b.folderId === folderId) : [];
  const recent = books.slice(0, 4);

  return (
    <div className="xl-home">
      <header className="xl-home-top">
        {folder ? (
          <button type="button" className="xl-back" onClick={() => onOpenFolder(null)}>
            ← Folders
          </button>
        ) : null}
        <div>
          <h1>{folder ? folder.name : "Excel"}</h1>
          <p>
            {folder
              ? files.length === 1
                ? "1 file"
                : files.length + " files"
              : "New sheet, open a file, or a folder of saved work."}
          </p>
        </div>
      </header>

      <div className="xl-acts">
        <button type="button" className="xl-act" onClick={onNew}>
          <b>New Excel</b>
          <span>Blank workbook</span>
        </button>
        <button type="button" className="xl-act" onClick={onOpenFile}>
          <b>Open</b>
          <span>.xlsx or .csv</span>
        </button>
        {folder ? (
          <>
            <button type="button" className="xl-act" onClick={() => onRenameFolder(folder)}>
              <b>Rename</b>
              <span>This folder</span>
            </button>
            {folder.id !== DEFAULT_FOLDER_ID ? (
              <button type="button" className="xl-act" onClick={() => onDeleteFolder(folder)}>
                <b>Delete folder</b>
                <span>Files move to My sheets</span>
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button type="button" className="xl-act" onClick={onNewFolder}>
              <b>New folder</b>
              <span>Group saved files</span>
            </button>
            <div className="xl-more-wrap">
              <button type="button" className="xl-act" aria-expanded={moreOpen} onClick={onToggleMore}>
                <b>More</b>
                <span>Other actions</span>
              </button>
              {moreOpen ? (
                <div className="xl-more">
                  <p>Your sheet preset will land here when you send it.</p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {folder ? (
        <section className="xl-files">
          {files.length === 0 ? (
            <p className="xl-empty">Nothing in this folder yet. New Excel or Open puts a file here.</p>
          ) : (
            files.map((b) => (
              <div key={b.id} className="xl-file">
                <button type="button" className="xl-file-open" onClick={() => onOpenBook(b.id)}>
                  <strong>{b.name}</strong>
                  <em>{dayText(b.savedAt)}</em>
                </button>
                <button type="button" className="xl-x" aria-label={"Delete " + b.name} onClick={() => onDeleteBook(b)}>
                  Delete
                </button>
              </div>
            ))
          )}
        </section>
      ) : (
        <>
          <h2 className="xl-sec">Folders</h2>
          <div className="xl-folders">
            {folders.map((f) => {
              const n = books.filter((b) => b.folderId === f.id).length;
              return (
                <button key={f.id} type="button" className="xl-folder" onClick={() => onOpenFolder(f.id)}>
                  <i aria-hidden />
                  <strong>{f.name}</strong>
                  <em>{n === 1 ? "1 file" : n + " files"}</em>
                </button>
              );
            })}
          </div>
          {recent.length > 0 ? (
            <>
              <h2 className="xl-sec">Recent</h2>
              <section className="xl-files">
                {recent.map((b) => (
                  <div key={b.id} className="xl-file">
                    <button type="button" className="xl-file-open" onClick={() => onOpenBook(b.id)}>
                      <strong>{b.name}</strong>
                      <em>
                        {folders.find((f) => f.id === b.folderId)?.name || "My sheets"} · {dayText(b.savedAt)}
                      </em>
                    </button>
                    <button type="button" className="xl-x" aria-label={"Delete " + b.name} onClick={() => onDeleteBook(b)}>
                      Delete
                    </button>
                  </div>
                ))}
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
