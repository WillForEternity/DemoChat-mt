/**
 * Type declarations for pdfjs-dist legacy build
 * The legacy build doesn't ship with TypeScript declarations
 */
declare module "pdfjs-dist/legacy/build/pdf" {
  export const GlobalWorkerOptions: {
    workerSrc: string;
  };

  export function getDocument(options: { data: ArrayBuffer }): {
    promise: Promise<PDFDocumentProxy>;
  };

  interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
  }

  interface PDFPageProxy {
    getTextContent(): Promise<TextContent>;
  }

  interface TextContent {
    items: Array<{ str?: string } | object>;
  }
}
