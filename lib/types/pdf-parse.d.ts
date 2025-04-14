declare module 'pdf-parse' {
  interface PDFParseOptions {
    // Max number of pages to parse
    max?: number;
    // PDF version
    version?: string;
    // Page render options
    pagerender?: (pageData: any) => Promise<string>;
    // Whether to render text
    text?: boolean;
  }

  interface PDFParseResult {
    // The extracted text
    text: string;
    // Number of pages
    numpages: number;
    // Metadata
    info: {
      Title?: string;
      Author?: string;
      Subject?: string;
      Keywords?: string;
      Creator?: string;
      Producer?: string;
      CreationDate?: string;
      ModDate?: string;
      [key: string]: any;
    };
    // PDF version
    version: string;
    // Metadata map
    metadata: any;
  }

  /**
   * Parse PDF data from Buffer
   */
  function PDFParse(dataBuffer: Buffer, options?: PDFParseOptions): Promise<PDFParseResult>;

  export = PDFParse;
} 