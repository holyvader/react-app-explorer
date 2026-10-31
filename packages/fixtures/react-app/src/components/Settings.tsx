import { useEffect, useState } from "react";

export default function Settings() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.body.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return <label><input type="checkbox" checked={dark} onChange={() => setDark(!dark)} /> Dark</label>;
}
