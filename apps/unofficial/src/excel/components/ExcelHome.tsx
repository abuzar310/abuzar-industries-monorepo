"use client";
import { DEFAULT_FOLDER_ID } from "../lib/folder";
import { EXCEL_PRESETS } from "../lib/preset";
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
  onRenameBook: (book: BookMeta) => void;
  onMoveBook: (book: BookMeta, folderId: string) => void;
  onDeleteBook: (book: BookMeta) => void;
  onRenameFolder: (folder: FolderMeta) => void;
  onDeleteFolder: (folder: FolderMeta) => void;
  onToggleMore: () => void;
  onPreset: (id: string) => void;
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
  onRenameBook,
  onMoveBook,
  onDeleteBook,
  onRenameFolder,
  onDeleteFolder,
  onToggleMore,
  onPreset,
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
          <span>Teak · White Teak · Neem</span>
        </button>
        <button type="button" className="xl-act" onClick={onOpenFile}>
          <b>Open</b>
          <span>Purchase list → our sheet</span>
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
                <div className="xl-more xl-pop-preset">
                  {EXCEL_PRESETS.map((p) => (
                    <button key={p.id} type="button" className="xl-open" onClick={() => onPreset(p.id)}>
                      <strong>{p.label}</strong>
                      <em>{p.hint}</em>
                    </button>
                  ))}
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
              <FileRow
                key={b.id}
                book={b}
                folders={folders}
                onOpen={onOpenBook}
                onRename={onRenameBook}
                onMove={onMoveBook}
                onDelete={onDeleteBook}
              />
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
                  <FileRow
                    key={b.id}
                    book={b}
                    folders={folders}
                    showFolder
                    onOpen={onOpenBook}
                    onRename={onRenameBook}
                    onMove={onMoveBook}
                    onDelete={onDeleteBook}
                  />
                ))}
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function FileRow({
  book,
  folders,
  showFolder,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  book: BookMeta;
  folders: FolderMeta[];
  showFolder?: boolean;
  onOpen: (id: string) => void;
  onRename: (book: BookMeta) => void;
  onMove: (book: BookMeta, folderId: string) => void;
  onDelete: (book: BookMeta) => void;
}) {
  const folderName = folders.find((f) => f.id === book.folderId)?.name || "My sheets";
  return (
    <div className="xl-file">
      <button type="button" className="xl-file-open" onClick={() => onOpen(book.id)}>
        <strong>{book.name}</strong>
        <em>
          {showFolder ? folderName + " · " : ""}
          {dayText(book.savedAt)}
        </em>
      </button>
      <button type="button" className="xl-file-act" onClick={() => onRename(book)}>
        Rename
      </button>
      <label className="xl-file-move">
        <select
          aria-label={"Move " + book.name}
          value={book.folderId}
          onChange={(e) => {
            if (e.target.value !== book.folderId) onMove(book, e.target.value);
          }}
        >
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="xl-x" aria-label={"Delete " + book.name} onClick={() => onDelete(book)}>
        Delete
      </button>
    </div>
  );
}
