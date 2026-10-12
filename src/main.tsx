import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/800.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./design/tokens.css";
import "./design/themes.css";
import "./design/base.css";
import "./design/app.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import * as act from "./app/actions";
import { store } from "./state/store";

// A handle for end-to-end scripts (scripts/e2e.mjs), present in development builds only.
if (import.meta.env.DEV) Object.assign(window, { emquad: { act, store } });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
