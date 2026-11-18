/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Google Maps JavaScript API key for the BROWSER only. Must be HTTP-referrer restricted. Never the server (Routes) key or the Android key. */
  readonly VITE_GOOGLE_MAPS_BROWSER_KEY?: string;
}
