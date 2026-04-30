import { Database, FileSpreadsheet } from "lucide-react";

export function ExportMenu({ onCsv, onJson, align = "right" }: { onCsv: () => void; onJson: () => void; align?: "left" | "right" }) {
  return (
    <div className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-50 mt-2 w-44 rounded-lg border border-gray-700 bg-gray-950 p-1 shadow-2xl`}>
      <button onClick={onCsv} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800">
        <FileSpreadsheet className="h-4 w-4 text-cyan-300" />
        CSV
        <span className="ml-auto text-xs text-gray-500">flat</span>
      </button>
      <button onClick={onJson} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800">
        <Database className="h-4 w-4 text-indigo-300" />
        JSON
        <span className="ml-auto text-xs text-gray-500">API</span>
      </button>
    </div>
  );
}

