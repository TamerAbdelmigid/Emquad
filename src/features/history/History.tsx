import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../design/ui";
import {
  type Block,
  type ChangedFile,
  type Decision,
  type FileDiff,
  type HistoryList,
  type Review,
  type ReviewItem,
  type Segment,
  type Version,
  WORKING,
} from "../../ipc/api";

interface Backend {
  list: () => Promise<HistoryList>;
  changedFiles: (version: string, against: string | null) => Promise<ChangedFile[]>;
  fileDiff: (version: string, against: string | null, path: string) => Promise<FileDiff>;
  review: (bundleId: string) => Promise<Review>;
  decide: (bundleId: string, itemId: string, decision: Decision) => Promise<Review>;
  edit: (bundleId: string, itemId: string, text: string) => Promise<Review>;
  finish: (bundleId: string) => Promise<string>;
  cancel: (bundleId: string) => Promise<void>;
}

interface Props {
  backend: Backend;
  myAuthorId: string;
  /** Bundle to select on arrival, set by an import. */
  focusBundle: string | null;
  /** File to show first, for "Show changes" from the editor. */
  focusFile: string | null;
  onError: (e: unknown) => void;
  onRestore: (version: string, label: string) => Promise<void>;
  onSnapshot: () => Promise<void>;
  /** The working copy was rewritten (merge finished): open files need re-reading. */
  onWorkingCopyChanged: () => Promise<void>;
  onRevertBlock: (path: string, text: string) => Promise<void>;
  onPendingChanged: () => void;
}

const KIND_NOTE: Record<string, string> = {
  snapshot: "Snapshot",
  export: "Exported bundle",
  automatic: "Saved automatically",
  merge: "Merge",
  restore: "Restore",
};

function when(seconds: number) {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function History(p: Props) {
  const { backend, onError } = p;
  const [list, setList] = useState<HistoryList | null>(null);
  const [selected, setSelected] = useState<string>(WORKING);
  const [compareWorking, setCompareWorking] = useState(false);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [file, setFile] = useState<string | null>(p.focusFile);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [onlySnapshots, setOnlySnapshots] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const next = await backend.list();
    setList(next);
    return next;
  }, [backend]);

  useEffect(() => {
    reload()
      .then((next) => {
        const focus = next.versions.find((v) => v.bundleId === p.focusBundle && v.pending);
        const pending = next.versions.find((v) => v.pending);
        if (focus ?? (p.focusFile ? null : pending)) setSelected((focus ?? pending)!.id);
      })
      .catch(onError);
    // Only on arrival: later selections belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const version: Version | null = useMemo(
    () => list?.versions.find((v) => v.id === selected) ?? null,
    [list, selected],
  );
  const pendingBundle = version?.pending ? version.bundleId : null;

  // "Compare with working copy" turns the comparison round: what the working copy has that the
  // selected version does not.
  const [shown, against] = compareWorking && selected !== WORKING ? [WORKING, selected] : [selected, null];

  useEffect(() => {
    let stale = false;
    backend
      .changedFiles(shown, against)
      .then((next) => {
        if (stale) return;
        setFiles(next);
        setFile((current) => (current && next.some((f) => f.path === current) ? current : (next[0]?.path ?? null)));
      })
      .catch(onError);
    return () => {
      stale = true;
    };
  }, [backend, shown, against, onError, list]);

  useEffect(() => {
    let stale = false;
    if (!file) return setDiff(null);
    backend
      .fileDiff(shown, against, file)
      .then((next) => !stale && setDiff(next))
      .catch(onError);
    return () => {
      stale = true;
    };
  }, [backend, shown, against, file, onError, list]);

  useEffect(() => {
    let stale = false;
    if (!pendingBundle) return setReview(null);
    backend
      .review(pendingBundle)
      .then((next) => !stale && setReview(next))
      .catch(onError);
    return () => {
      stale = true;
    };
  }, [backend, pendingBundle, onError]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const select = (id: string) => {
    setSelected(id);
    setCompareWorking(false);
  };

  const changes = diff?.blocks.filter((b) => b.kind === "change").length ?? 0;
  const versions = (list?.versions ?? []).filter((v) => !onlySnapshots || v.kind === "snapshot" || v.kind === "export");
  const label =
    selected === WORKING ? "Working copy" : version?.pending ? `Bundle from ${version.author}` : (version?.label ?? "");
  const canRevert = shown === WORKING && against === null;

  return (
    <div className={`hist${review ? "" : " plain"}`}>
      <aside className="mod files" aria-label="Files in this version">
        <div className="fh">
          <span className="lab">Changed files</span>
        </div>
        <div className="flist grow">
          {files.length === 0 && <p className="empty">No files differ.</p>}
          {files.map((f) => (
            <button key={f.path} className={`file${f.path === file ? " on" : ""}`} onClick={() => setFile(f.path)}>
              <Icon name="file" />
              <span className="file-name">{f.path}</span>
              <span className={`tag${f.status === "deleted" ? " warn" : ""}`}>
                {f.status === "added" ? "Added" : f.status === "deleted" ? "Removed" : "Edited"}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="screen">
        <div className="hbar">
          <span>
            Viewing <b>{compareWorking && selected !== WORKING ? `Working copy against ${label}` : label}</b>
          </span>
          <span>{file ? <><b>{changes} {changes === 1 ? "change" : "changes"}</b> in {file}</> : "Nothing to show"}</span>
        </div>
        <div className="code diff">
          {diff?.binary && <p className="screen-note">This file is not text, so its changes cannot be shown.</p>}
          {diff && !diff.binary && (
            <DiffView
              blocks={diff.blocks}
              onRevert={
                canRevert && file
                  ? (index) => act(() => p.onRevertBlock(file, revertBlock(diff.blocks, index)).then(async () => void (await reload())))
                  : undefined
              }
            />
          )}
        </div>
      </main>

      {review && pendingBundle && (
        <ReviewPanel
          review={review}
          busy={busy}
          onDecide={(item, decision) => act(async () => setReview(await backend.decide(pendingBundle, item, decision)))}
          onEdit={(item, text) => act(async () => setReview(await backend.edit(pendingBundle, item, text)))}
          onFinish={() =>
            act(async () => {
              await backend.finish(pendingBundle);
              await p.onWorkingCopyChanged();
              const next = await reload();
              select(next.head ?? WORKING);
              p.onPendingChanged();
            })
          }
          onCancel={() =>
            act(async () => {
              await backend.cancel(pendingBundle);
              setReview(await backend.review(pendingBundle));
            })
          }
        />
      )}

      <aside className="mod hside" aria-label="Versions">
        <div className="hseg">
          <button className={onlySnapshots ? "" : "on"} aria-pressed={!onlySnapshots} onClick={() => setOnlySnapshots(false)}>
            All history
          </button>
          <button className={onlySnapshots ? "on" : ""} aria-pressed={onlySnapshots} onClick={() => setOnlySnapshots(true)}>
            Snapshots
          </button>
        </div>
        <div className="hlist">
          <button className="hent" aria-pressed={selected === WORKING} onClick={() => select(WORKING)}>
            <b>Working copy</b>
            <time>now</time>
            <span>{list?.dirty ? "Has changes since the last version" : "Same as the last version"}</span>
            <span className="by">You</span>
          </button>
          {versions.map((v) => (
            <button key={v.id} className="hent" aria-pressed={selected === v.id} onClick={() => select(v.id)}>
              <b>{v.pending ? `Bundle from ${v.author}` : v.label}</b>
              <time>{when(v.time)}</time>
              <span>{v.pending ? "Waiting for your review" : (KIND_NOTE[v.kind] ?? v.kind)}</span>
              <span className={`by${v.authorId === p.myAuthorId ? "" : " lina"}`}>{v.authorId === p.myAuthorId ? "You" : v.author}</span>
            </button>
          ))}
        </div>
        <div className="hacts">
          <button className="btn dark" disabled={busy} onClick={() => act(async () => { await p.onSnapshot(); await reload(); })}>
            Save snapshot
          </button>
          <button
            className="btn"
            disabled={busy || selected === WORKING || !!pendingBundle}
            onClick={() => act(async () => { await p.onRestore(selected, label); select((await reload()).head ?? WORKING); })}
          >
            Restore this version
          </button>
          <button className="btn" aria-pressed={compareWorking} disabled={selected === WORKING} onClick={() => setCompareWorking(!compareWorking)}>
            Compare with working copy
          </button>
        </div>
      </aside>
    </div>
  );
}

/** The file's text with one changed block put back to how it was. */
export function revertBlock(blocks: Block[], index: number): string {
  let seen = -1;
  return blocks
    .map((b) => {
      if (b.kind === "equal") return b.text;
      seen += 1;
      return seen === index ? b.oldText : b.newText;
    })
    .join("");
}

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.tag === "insert" ? <ins key={i}>{s.text}</ins> : s.tag === "delete" ? <del key={i}>{s.text}</del> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}

function DiffView({ blocks, onRevert }: { blocks: Block[]; onRevert?: (changeIndex: number) => void }) {
  let change = -1;
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "equal") {
          const lines = b.text.replace(/\n$/, "").split("\n");
          return lines.map((text, n) => (
            <div className="dl" key={`${i}:${n}`}>
              <span className="dn">{b.newStart + n}</span>
              <span className="dt">{text || " "}</span>
            </div>
          ));
        }
        change += 1;
        const mine = change;
        return (
          <div className="dl cur" key={i}>
            <span className="dn">{b.newStart}</span>
            <span className="dt">
              <Segments segments={b.segments.map((s, n) => (n === b.segments.length - 1 ? { ...s, text: s.text.replace(/\n$/, "") } : s))} />
              {onRevert && (
                <button className="revert" onClick={() => onRevert(mine)}>
                  Undo this change
                </button>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}

function ReviewPanel(p: {
  review: Review;
  busy: boolean;
  onDecide: (itemId: string, decision: Decision) => void;
  onEdit: (itemId: string, text: string) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const conflicts = p.review.items.filter((i) => i.kind === "conflict");
  const autos = p.review.items.filter((i) => i.kind === "auto");
  const resolved = conflicts.length - p.review.unresolved;
  const where = (i: ReviewItem) => (i.wholeFile ? i.path : `${i.path}, line ${i.line}`);
  const side = (i: ReviewItem, keep: "delete" | "insert") =>
    i.segments.filter((s) => s.tag === "equal" || s.tag === keep);
  /** The conflict being rewritten by hand, and the text so far. */
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);

  return (
    <aside className="mod changes" aria-label="Review this bundle">
      <div className="chg-full">
        <div className="chg-top">
          <b>Review this bundle</b>
        </div>
        <div className="chg-head">
          <div className="cap">Incoming bundle from {p.review.from}</div>
          <div className="bmeta">Based on your version “{p.review.baseLabel}”</div>
        </div>

        <div className="sec">
          <span>Conflicts</span>
          <span className="n">{conflicts.length ? `${resolved} of ${conflicts.length} resolved` : "none"}</span>
        </div>
        {conflicts.length === 0 && <p className="empty">Nothing you changed overlaps with what {p.review.from} changed.</p>}
        {conflicts.map((item) => (
          <div className="conf" key={item.id}>
            <div className="loc">{where(item)}</div>
            {(["mine", "theirs"] as const).map((who) => (
              <button
                key={who}
                className={`opt ${who}`}
                aria-pressed={item.decision === who && item.custom === null}
                disabled={p.busy}
                onClick={() => p.onDecide(item.id, who)}
              >
                <span className="who">{who === "mine" ? "Yours" : "Theirs"}</span>
                <span className="txt">
                  {item.wholeFile ? (
                    who === "mine" ? "Keep the file as you have it" : item.note
                  ) : (
                    side(item, who === "mine" ? "delete" : "insert").map((s, n) =>
                      s.tag === "equal" ? <span key={n}>{s.text}</span> : <b key={n}>{s.text}</b>,
                    )
                  )}
                </span>
              </button>
            ))}
            {!item.wholeFile && draft?.id !== item.id && item.custom !== null && (
              <div className="opt custom" aria-current="true">
                <span className="who">Your edit</span>
                <span className="txt">{item.custom || "(passage removed)"}</span>
              </div>
            )}
            {!item.wholeFile && draft?.id === item.id && (
              <form
                className="hand"
                onSubmit={(e) => {
                  e.preventDefault();
                  p.onEdit(item.id, draft.text);
                  setDraft(null);
                }}
              >
                <label htmlFor={`hand-${item.id}`}>Write what this passage should say</label>
                <textarea id={`hand-${item.id}`} rows={5} autoFocus value={draft.text} onChange={(e) => setDraft({ id: item.id, text: e.target.value })} />
                <div className="hand-acts">
                  <button type="button" className="btn sm" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn sm dark">
                    Use this text
                  </button>
                </div>
              </form>
            )}
            {!item.wholeFile && draft?.id !== item.id && (
              <button className="btn sm hand-open" disabled={p.busy} onClick={() => setDraft({ id: item.id, text: item.custom ?? `${item.mine}${item.theirs}` })}>
                <Icon name="edit" size={12} />
                {item.custom === null ? "Edit by hand" : "Edit again"}
              </button>
            )}
          </div>
        ))}

        <div className="sec">
          <span>Merged automatically</span>
          <span>{autos.length}</span>
        </div>
        {autos.map((item) => {
          const rejected = item.decision === "mine";
          return (
            <div className={`mrg${rejected ? " off" : ""}`} key={item.id}>
              <div className="body2">
                <small>{where(item)}</small>
                {item.wholeFile ? item.note : <Segments segments={item.segments} />}
              </div>
              <div className="acts2">
                <button className="btn sm" aria-label="Accept this change" aria-pressed={!rejected} disabled={p.busy} onClick={() => p.onDecide(item.id, "theirs")}>
                  <Icon name="check" size={12} />
                </button>
                <button className="btn sm" aria-label="Reject this change" aria-pressed={rejected} disabled={p.busy} onClick={() => p.onDecide(item.id, "mine")}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            </div>
          );
        })}

        <button className="btn dark finish" disabled={p.busy || p.review.unresolved > 0} onClick={p.onFinish}>
          Finish merge
        </button>
        <button className="btn finish" disabled={p.busy} onClick={p.onCancel}>
          Start this review over
        </button>
      </div>
    </aside>
  );
}
