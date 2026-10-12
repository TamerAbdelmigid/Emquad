import { useEffect, useRef, useState } from "react";
import { Icon } from "../../design/ui";
import type { SearchResult } from "../../ipc/api";

interface Props {
  search: (query: string, matchCase: boolean) => Promise<SearchResult>;
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
}

/** Find text across every file of the project. */
export function Search(p: Props) {
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { search } = p;

  useEffect(() => input.current?.focus(), []);

  // Search as the user types, a moment after they pause.
  useEffect(() => {
    if (!query) return setResult(null);
    let stale = false;
    const timer = window.setTimeout(() => {
      search(query, matchCase)
        .then((r) => !stale && setResult(r))
        .catch(() => !stale && setResult({ hits: [], truncated: false }));
    }, 180);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query, matchCase, search]);

  const files = new Map<string, SearchResult["hits"]>();
  for (const hit of result?.hits ?? []) files.set(hit.path, [...(files.get(hit.path) ?? []), hit]);

  const marked = (preview: string) => {
    const at = matchCase ? preview.indexOf(query) : preview.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) return preview;
    return (
      <>
        {preview.slice(0, at)}
        <mark>{preview.slice(at, at + query.length)}</mark>
        {preview.slice(at + query.length)}
      </>
    );
  };

  return (
    <aside className="mod files search" aria-label="Search the project">
      <div className="fh">
        <span className="lab">Search project</span>
        <button className="ib" aria-label="Close search" title="Close search" onClick={p.onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="search-box">
        <label htmlFor="search-query" className="sr">
          Text to find
        </label>
        <input id="search-query" ref={input} type="text" value={query} placeholder="Find in all files" onChange={(e) => setQuery(e.target.value)} />
        <label className="search-opt">
          <input id="search-case" type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
          Match case
        </label>
      </div>
      <div className="flist grow" aria-live="polite">
        {!query && <p className="empty">Type to search every text file in the project.</p>}
        {query && result && result.hits.length === 0 && <p className="empty">Nothing found.</p>}
        {result && result.hits.length > 0 && (
          <p className="empty">
            {result.hits.length}
            {result.truncated ? "+" : ""} {result.hits.length === 1 ? "match" : "matches"} in {files.size} {files.size === 1 ? "file" : "files"}
            {result.truncated ? ". Showing the first ones; narrow the search to see the rest." : ""}
          </p>
        )}
        {[...files].map(([path, hits]) => (
          <div key={path} className="search-file">
            <div className="search-path">
              <Icon name="file" />
              <span className="file-name">{path}</span>
              <i className="badge">{hits.length}</i>
            </div>
            {hits.map((hit, i) => (
              <button key={i} className="search-hit" onClick={() => p.onOpen(hit.path, hit.line)}>
                <span className="dn">{hit.line}</span>
                <span className="search-text">{marked(hit.preview)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
