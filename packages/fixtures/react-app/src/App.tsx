import { lazy, Suspense, useState } from "react";
import { Button } from "./components/Button";

const Settings = lazy(() => import("./components/Settings"));

export function App() {
  const [view, setView] = useState<"home" | "settings">("home");
  let body;
  switch (view) {
    case "home":
      body = <p>Home</p>;
      break;
    case "settings":
      body = (
        <Suspense fallback={null}>
          <Settings />
        </Suspense>
      );
      break;
  }
  return (
    <div>
      <Button label="Toggle" onClick={() => setView(view === "home" ? "settings" : "home")} />
      {body}
    </div>
  );
}
