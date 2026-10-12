import { useEffect, useRef, useState } from "react";
import { Icon } from "../../design/ui";
import type { Comment } from "../../ipc/api";

interface Props {
  comments: Comment[];
  /** The file open in the editor, whose comments are listed first. */
  active: string | null;
  /** The comment picked out. */
  picked: string | null;
  /** Some text is selected in the editor, so a comment can be put on it. */
  canAdd: boolean;
  onAdd: (text: string) => Promise<boolean>;
  onPick: (comment: Comment) => void;
  onReply: (id: string, text: string) => Promise<boolean>;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** "3 Oct, 14:05" in the reader's own time; the raw text if it is not a date. */
export function when(stamp: string): string {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The comments to list: the open file's first, in the order of their passages, then the rest by file. */
export function arrange(comments: Comment[], active: string | null, showResolved: boolean): Comment[] {
  return comments
    .filter((c) => showResolved || !c.resolved)
    .sort((a, b) => {
      if (a.path !== b.path) return a.path === active ? -1 : b.path === active ? 1 : a.path.localeCompare(b.path);
      return a.line - b.line || a.createdAt.localeCompare(b.createdAt);
    });
}

/** Comments on passages of the project: read, answer, resolve. */
export function Comments(p: Props) {
  const [draft, setDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const shown = arrange(p.comments, p.active, showResolved);
  const resolved = p.comments.filter((c) => c.resolved).length;

  // A comment picked in the text is brought into view here.
  useEffect(() => {
    if (p.picked) list.current?.querySelector(`[data-id="${CSS.escape(p.picked)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [p.picked]);

  let lastPath: string | null = null;
  return (
    <aside className="mod files comments" aria-label="Comments">
      <div className="fh">
        <span className="lab">Comments</span>
        <button className="ib" aria-label="Close comments" title="Close comments" onClick={p.onClose}>
          <Icon name="x" />
        </button>
      </div>
      <form
        className="comment-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && p.canAdd) void p.onAdd(draft).then((ok) => ok && setDraft(""));
        }}
      >
        <label htmlFor="comment-draft" className="sr">
          New comment on the selected text
        </label>
        <textarea
          id="comment-draft"
          rows={2}
          value={draft}
          placeholder={p.canAdd ? "Comment on the selected text" : "Select some text in the editor to comment on it"}
          disabled={!p.canAdd}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <button type="submit" className="btn go" disabled={!p.canAdd || !draft.trim()}>
          Add comment
        </button>
      </form>
      <div className="flist grow" ref={list} aria-live="polite">
        {shown.length === 0 && <p className="empty">{p.comments.length ? "Every comment is resolved." : "No comments yet."}</p>}
        {shown.map((c) => {
          const heading = c.path !== lastPath;
          lastPath = c.path;
          return (
            <div key={c.id}>
              {heading && (
                <div className="search-path">
                  <Icon name="file" />
                  <span className="file-name">{c.path}</span>
                </div>
              )}
              <article className={`comment${c.id === p.picked ? " on" : ""}${c.resolved ? " done" : ""}`} data-id={c.id}>
                <button className="comment-quote" title="Show this passage" onClick={() => p.onPick(c)}>
                  {c.quote.replace(/\s+/g, " ").slice(0, 140)}
                </button>
                <Entry author={c.authorName} at={c.createdAt} text={c.text} />
                {c.replies.map((r) => (
                  <Entry key={r.id} author={r.authorName} at={r.createdAt} text={r.text} />
                ))}
                {replyTo === c.id ? (
                  <form
                    className="comment-reply"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!reply.trim()) return;
                      void p.onReply(c.id, reply).then((ok) => {
                        if (!ok) return;
                        setReply("");
                        setReplyTo(null);
                      });
                    }}
                  >
                    <label htmlFor={`reply-${c.id}`} className="sr">
                      Reply
                    </label>
                    <textarea
                      id={`reply-${c.id}`}
                      rows={2}
                      autoFocus
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
                        if (e.key === "Escape") setReplyTo(null);
                      }}
                    />
                    <div className="comment-acts">
                      <button type="submit" className="btn go" disabled={!reply.trim()}>
                        Reply
                      </button>
                      <button type="button" className="btn" onClick={() => setReplyTo(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="comment-acts">
                    <button
                      className="btn"
                      onClick={() => {
                        setReply("");
                        setReplyTo(c.id);
                      }}
                    >
                      Reply
                    </button>
                    <button className="btn" onClick={() => p.onResolve(c.id, !c.resolved)}>
                      {c.resolved ? "Reopen" : "Resolve"}
                    </button>
                    <button className="ib" aria-label="Delete comment" title="Delete comment" onClick={() => p.onDelete(c.id)}>
                      <Icon name="trash" />
                    </button>
                  </div>
                )}
              </article>
            </div>
          );
        })}
      </div>
      {resolved > 0 && (
        <label className="search-opt comment-toggle">
          <input id="comments-resolved" type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved ({resolved})
        </label>
      )}
    </aside>
  );
}

function Entry({ author, at, text }: { author: string; at: string; text: string }) {
  return (
    <div className="comment-entry">
      <div className="comment-who">
        <b>{author}</b>
        <span>{when(at)}</span>
      </div>
      <p>{text}</p>
    </div>
  );
}
