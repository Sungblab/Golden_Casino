import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";
import "./styles/table-baccarat.css";
import "./styles/table-bonus-baccarat.css";
import "./styles/table-dragontiger.css";
import "./styles/table-holdem.css";
import "./styles/table-sutda.css";
import "./styles/deck-shoe.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
