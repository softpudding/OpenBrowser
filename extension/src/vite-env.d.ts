declare module '*?raw' {
  const content: string;
  export default content;
}

/** Injected by Vite `define` — true in dev builds, false in production. */
declare const __DEV__: boolean;
