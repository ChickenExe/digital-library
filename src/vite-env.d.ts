/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Preview another platform's window chrome in development: "windows" | "macos" | "linux". */
  readonly VITE_FORCE_PLATFORM?: string;
}
