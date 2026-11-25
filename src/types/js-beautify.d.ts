// js-beautify's package entry pulls in Node-only CLI code paths; the browser build is this UMD file, which @types/js-beautify does not describe.
declare module "js-beautify/js/lib/beautifier.js" {
  import type { CSSBeautifyOptions, HTMLBeautifyOptions, JSBeautifyOptions } from "js-beautify";

  const beautifier: {
    js(source: string, options?: JSBeautifyOptions): string;
    css(source: string, options?: CSSBeautifyOptions): string;
    html(source: string, options?: HTMLBeautifyOptions): string;
  };
  export default beautifier;
}
