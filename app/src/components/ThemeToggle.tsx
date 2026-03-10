import { useEffect, useState } from "react";

function detectLightTheme(): boolean {
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("light");
  }
  return false;
}

export default function ThemeToggle() {
  const [isLight, setIsLight] = useState<boolean>(detectLightTheme);

  useEffect(() => {
    const saved = localStorage.getItem("shadow-theme");
    const light = saved === "light";
    document.documentElement.classList.toggle("light", light);
    if (!saved) localStorage.setItem("shadow-theme", "dark");
    setIsLight(light);
  }, []);

  const toggle = () => {
    const nextLight = !isLight;
    if (nextLight) {
      document.documentElement.classList.add("light");
      localStorage.setItem("shadow-theme", "light");
    } else {
      document.documentElement.classList.remove("light");
      localStorage.setItem("shadow-theme", "dark");
    }
    setIsLight(nextLight);
  };

  return (
    <div className="theme-toggle-floating">
    <button
      onClick={toggle}
      className="theme-toggle-btn"
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      aria-label="Toggle theme"
    >
      <span className="theme-toggle-sun" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <circle cx="10" cy="10" r="4" />
          <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6l1.4 1.4M15 15l1.4 1.4M3.6 16.4 5 15M15 5l1.4-1.4" />
        </svg>
      </span>
      <span className="theme-toggle-moon" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path d="M13.8 2.1a7.2 7.2 0 1 0 4.1 11.7 8 8 0 1 1-4.1-11.7Z" />
        </svg>
      </span>
      <span className="theme-toggle-knob" />
    </button>
    </div>
  );
}
