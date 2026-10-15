import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../design/ui";
import { openPdf } from "../../shared/pdf";
import type { Highlight } from "../../state/store";

interface Props {
  /** Changes whenever there is a new PDF to load. */
  version: number;
  load: () => Promise<ArrayBuffer>;
  compiling: boolean;
  errors: number;
  warnings: number;
  highlight: Highlight | null;
  onCompile: () => void;
  onCancel: () => void;
  onLogs: () => void;
  onSavePdf: () => void;
  onJumpToSource: (page: number, x: number, y: number) => void;
  onJumpToPdf: () => void;
}

interface PageSize {
  width: number;
  height: number;
}

type Zoom = "fit" | number;

export function Preview(p: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const keepScroll = useRef(0);
  const { load, version } = p;

  // Load from bytes, never from a file URL, so the compiler can rewrite the PDF on disk.
  useEffect(() => {
    let stale = false;
    load()
      .then(async (bytes) => (await openPdf(new Uint8Array(bytes))).promise)
      .then(async (next) => {
        // Asked for all at once: one after another takes long on a long document.
        const pages = await Promise.all(Array.from({ length: next.numPages }, (_, i) => next.getPage(i + 1)));
        const dims: PageSize[] = pages.map((page) => {
          const view = page.getViewport({ scale: 1 });
          return { width: view.width, height: view.height };
        });
        if (stale) return void next.loadingTask.destroy();
        const el = stage.current;
        keepScroll.current = el && el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0;
        setSizes(dims);
        setDoc((previous) => {
          void previous?.loadingTask.destroy();
          return next;
        });
      })
      .catch(() => {
        // No PDF yet: the empty state below explains what to do.
      });
    return () => {
      stale = true;
    };
  }, [load, version]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const first = sizes[0];
  const fit = first ? Math.min((box.width - 56) / first.width, (box.height - 40) / first.height) : 1;
  const scale = Math.max(0.2, zoom === "fit" ? fit : zoom);

  // Put the reader back where they were after a recompile swaps the document.
  useLayoutEffect(() => {
    const el = stage.current;
    if (el) el.scrollTop = keepScroll.current * el.scrollHeight;
  }, [doc]);

  useEffect(() => {
    const h = p.highlight;
    const el = stage.current?.querySelector<HTMLElement>(`[data-page="${h?.page}"]`);
    if (h && el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [p.highlight]);

  const step = (by: number) => setZoom(Math.round(Math.min(4, Math.max(0.3, scale + by)) * 10) / 10);
  const goTo = (n: number) =>
    stage.current?.querySelector<HTMLElement>(`[data-page="${n}"]`)?.scrollIntoView({ block: "start" });

  const onScroll = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const middle = el.scrollTop + el.clientHeight / 2;
    const pages = Array.from(el.querySelectorAll<HTMLElement>("[data-page]"));
    const at = pages.find((pg) => pg.offsetTop + pg.offsetHeight >= middle);
    if (at) setCurrent(Number(at.dataset.page));
  }, []);

  return (
    <section className="mod pdf" aria-label="PDF preview">
      <div className="sync">
        <button aria-label="Go to this place in the PDF" title="Go to this place in the PDF (Ctrl+Alt+J)" onClick={p.onJumpToPdf}>
          <Icon name="right" />
        </button>
      </div>
      <div className="phead">
        {p.compiling ? (
          <button className="btn" onClick={p.onCancel}>
            Stop compiling
          </button>
        ) : (
          <button className="btn go" onClick={p.onCompile} title="Recompile (Ctrl+Enter)">
            <Icon name="play" />
            Recompile
          </button>
        )}
        <button className="ib" aria-label="Logs and messages" title="Logs and messages" onClick={p.onLogs}>
          <Icon name="log" />
        </button>
        {p.errors > 0 && <i className="badge">{p.errors}</i>}
        {p.errors === 0 && p.warnings > 0 && <span className="tag warn">{p.warnings} warnings</span>}
        <button className="ib" aria-label="Save a copy of the PDF" title="Save a copy of the PDF" disabled={!doc} onClick={p.onSavePdf}>
          <Icon name="down" />
        </button>
        <div className="r">
          <button className="ib" aria-label="Previous page" disabled={current <= 1} onClick={() => goTo(current - 1)}>
            <Icon name="chevup" />
          </button>
          <button className="ib" aria-label="Next page" disabled={current >= sizes.length} onClick={() => goTo(current + 1)}>
            <Icon name="chev" />
          </button>
          <span className="pgbox">{sizes.length ? current : 0}</span>/ {sizes.length}
          <button className="ib" aria-label="Zoom out" style={{ marginLeft: 8 }} onClick={() => step(-0.1)}>
            −
          </button>
          <button className="ib" aria-label="Zoom in" onClick={() => step(0.1)}>
            +
          </button>
          <button className="zoomv" title="Fit the page to the panel" onClick={() => setZoom("fit")}>
            {Math.round(scale * 100)}%
          </button>
        </div>
      </div>
      <div className="ruler" aria-hidden="true" />
      <div className="stage" ref={stage} onScroll={onScroll}>
        {!doc && (
          <div className="pdf-empty">
            <p>{p.compiling ? "Compiling…" : "No PDF yet."}</p>
            {!p.compiling && <p>Press Recompile to typeset the document.</p>}
          </div>
        )}
        {doc &&
          // Kept across a recompile, so each page is drawn over with the new one rather than
          // going blank first.
          sizes.map((size, i) => (
            <Page
              key={i}
              doc={doc}
              number={i + 1}
              size={size}
              scale={scale}
              highlight={p.highlight?.page === i + 1 ? p.highlight : null}
              onJump={p.onJumpToSource}
            />
          ))}
      </div>
    </section>
  );
}

function Page(p: {
  doc: PDFDocumentProxy;
  number: number;
  size: PageSize;
  scale: number;
  highlight: Highlight | null;
  onJump: (page: number, x: number, y: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    if (!visible) {
      // A page well out of view gives back the memory its picture took; it is drawn again
      // when it comes near.
      target.width = target.height = 0;
      return;
    }
    let task: RenderTask | null = null;
    let stale = false;
    void p.doc.getPage(p.number).then((page) => {
      if (stale) return;
      const viewport = page.getViewport({ scale: p.scale * window.devicePixelRatio });
      // Drawn aside and copied in when complete, so the page never shows blank in between.
      const aside = document.createElement("canvas");
      aside.width = Math.floor(viewport.width);
      aside.height = Math.floor(viewport.height);
      task = page.render({ canvas: aside, viewport });
      task.promise.then(
        () => {
          if (stale) return;
          target.width = aside.width;
          target.height = aside.height;
          target.getContext("2d")?.drawImage(aside, 0, 0);
          aside.width = aside.height = 0;
        },
        () => {
          // Cancelled by a newer render.
        },
      );
    });
    return () => {
      stale = true;
      task?.cancel();
    };
  }, [visible, p.doc, p.number, p.scale]);

  const h = p.highlight;
  return (
    <div
      ref={wrap}
      className="pdf-page"
      data-page={p.number}
      style={{ width: p.size.width * p.scale, height: p.size.height * p.scale }}
      title="Double-click to go to the source"
      onDoubleClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        p.onJump(p.number, (e.clientX - r.left) / p.scale, (e.clientY - r.top) / p.scale);
      }}
    >
      <canvas ref={canvas} />
      {h && (
        <div
          key={h.nonce}
          className="pdf-hl"
          style={{ left: h.x * p.scale - 3, top: h.y * p.scale - 2, width: h.width * p.scale + 6, height: h.height * p.scale + 4 }}
        />
      )}
    </div>
  );
}
