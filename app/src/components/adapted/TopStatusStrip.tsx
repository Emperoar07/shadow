import { useEffect, useState } from "react";
import { Clock3, ShieldCheck } from "lucide-react";

export default function TopStatusStrip() {
  const [utcTime, setUtcTime] = useState("--:--:-- UTC");

  useEffect(() => {
    const tick = () => {
      setUtcTime(
        `${new Date().toLocaleTimeString("en-GB", {
          hour12: false,
          timeZone: "UTC",
        })} UTC`
      );
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="mx-auto mt-3 mb-1 flex w-full max-w-[1600px] items-center justify-between rounded-lg border border-shadow-600 bg-[#0f1420]/80 px-4 py-2 text-[11px] text-gray-400">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-accent-purple" />
        <span>
          Private execution is always on. UI adaptation mode enabled.
        </span>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-gray-500">
        <Clock3 className="h-3.5 w-3.5" />
        <span>{utcTime}</span>
      </div>
    </div>
  );
}
