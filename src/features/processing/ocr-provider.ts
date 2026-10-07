/**
 * OCR provider contract (R12). This is architecture only: paper_pages.ocr_status
 * ('required' | 'pending' | 'completed' | 'failed') is populated by the
 * deterministic profiler (see profiler.ts) for every paper, regardless of
 * whether a provider is configured, so a page that needs OCR is always
 * identifiable and queryable.
 *
 * No OCR actually runs yet. Running it needs rendering a PDF page to an image
 * in the worker's Node process (a canvas/rasterizer dependency ResearchAI
 * does not currently have) and an OCR engine behind this interface. Neither
 * is wired in this change, on purpose: this repository has no OCR
 * credentials, and none should be invented. A future worker can:
 *   1. Render each paper_pages row with ocr_status = 'required' to an image.
 *   2. Call an OcrProvider implementation (local, e.g. tesseract.js, or a
 *      hosted API configured via environment variables already excluded
 *      from VITE_ scope - see worker/config.ts).
 *   3. Write the result back with completeOcr/failOcr-shaped RPCs mirroring
 *      complete_paper_processing/fail_paper_processing (claim -> write ->
 *      fence by attempt, same idempotency pattern).
 * Until then, NullOcrProvider is the only implementation, and it fails
 * loudly and explicitly rather than pretending to have recognized anything.
 */

export type OcrResult = {
  text: string
  /** 0-1 confidence as reported by the OCR engine, not inferred. */
  confidence: number
}

export class OcrUnavailableError extends Error {
  constructor(message = 'No OCR provider is configured.') {
    super(message)
    this.name = 'OcrUnavailableError'
  }
}

export interface OcrProvider {
  /** Recognizes text in a single rendered page image (e.g. PNG bytes). */
  recognizePage: (image: Uint8Array) => Promise<OcrResult>
}

/**
 * The default (and currently only) provider. It never fabricates a result:
 * every call rejects with OcrUnavailableError, so a page stays correctly
 * marked 'required' rather than being silently marked 'completed' with
 * empty or fake text.
 */
export class NullOcrProvider implements OcrProvider {
  async recognizePage(): Promise<OcrResult> {
    throw new OcrUnavailableError()
  }
}
