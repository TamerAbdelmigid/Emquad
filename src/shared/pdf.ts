// Opening PDFs, for the preview and for PDF figures in visual mode. pdf.js is large, so it is
// loaded only when the first PDF is opened, and all PDFs share one worker rather than starting
// one each.
import type { PDFDocumentLoadingTask, PDFWorker } from "pdfjs-dist";

let shared: Promise<{ pdfjs: typeof import("pdfjs-dist"); worker: PDFWorker }> | null = null;

function library() {
  shared ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([pdfjs, url]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = url.default;
    return { pdfjs, worker: new pdfjs.PDFWorker() };
  });
  return shared;
}

/** Start reading a PDF from its bytes. Destroy the task when done with the document. */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentLoadingTask> {
  const { pdfjs, worker } = await library();
  return pdfjs.getDocument({ data: bytes, worker });
}
