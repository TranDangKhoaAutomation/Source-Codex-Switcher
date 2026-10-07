import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TrayPopup } from "./components/TrayPopup";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { installVietnameseUi } from "./viRuntime";

installVietnameseUi();

const label = getCurrentWebviewWindow().label;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {label === "tray-popup" ? <TrayPopup /> : <App />}
  </React.StrictMode>,
);
