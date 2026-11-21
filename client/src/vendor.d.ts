declare module 'mammoth' {
  interface Image {
    contentType: string;
    read(encoding?: undefined): Promise<ArrayBuffer | Uint8Array>;
  }
  interface Result {
    value: string;
    messages: { type: string; message: string }[];
  }
  interface Options {
    convertImage?: unknown;
    styleMap?: string[];
  }
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Options): Promise<Result>;
    images: { imgElement(handler: (image: Image) => Promise<{ src: string; alt?: string }>): unknown };
  };
  export default mammoth;
}

declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
