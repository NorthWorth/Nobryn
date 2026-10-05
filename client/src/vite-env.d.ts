/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Production backend origin for API requests, e.g. "https://nobryn.onrender.com".
   *  Leave unset for local development, where the Vite `/api` proxy is used instead. */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
