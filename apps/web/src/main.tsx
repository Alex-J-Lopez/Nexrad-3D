import React from "react";
import ReactDOM from "react-dom/client";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found");
}

const root = ReactDOM.createRoot(rootElement);

function renderFatalBootstrapError(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  root.render(
    <React.StrictMode>
      <div
        style={{
          minHeight: "100vh",
          background: "#0b1220",
          color: "#e5e7eb",
          padding: "24px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        <h1 style={{ marginBottom: "12px", fontSize: "20px" }}>App bootstrap failed</h1>
        <p style={{ marginBottom: "10px", color: "#93c5fd" }}>
          A module failed to load before React could mount.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "#111827",
            border: "1px solid #374151",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          {message}
        </pre>
      </div>
    </React.StrictMode>
  );
}

async function bootstrap(): Promise<void> {
  try {
    const module = await import("./App");
    const App = module.App;

    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error("Failed to bootstrap app", error);
    renderFatalBootstrapError(error);
  }
}

void bootstrap();
