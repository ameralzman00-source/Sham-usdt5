import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./auth.jsx";
import { MetaProvider } from "./meta.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <MetaProvider>
          <App />
        </MetaProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
