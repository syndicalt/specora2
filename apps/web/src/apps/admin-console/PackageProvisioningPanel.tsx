"use client";

import { Download } from "lucide-react";
import type { ProvisioningJob } from "./types";

export function PackageProvisioningPanel({ provisioningJobs }: { provisioningJobs: ProvisioningJob[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
          <Download className="h-4 w-4 text-cyan-300" />
          Package Provisioning
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Optional apps install and uninstall through server-side provisioning jobs. Install state is authoritative on the API, not local browser storage.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-2 font-medium">App</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Retention</th>
              <th className="px-4 py-2 font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {provisioningJobs.length ? provisioningJobs.map((job) => (
              <tr key={job.id} className="border-b border-gray-800/50 last:border-0">
                <td className="px-4 py-3 text-gray-200">{job.app_id}</td>
                <td className="px-4 py-3 text-gray-300">{job.action}</td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${job.status === "completed" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-200"}`}>
                    {job.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400">{job.data_retention_policy}</td>
                <td className="px-4 py-3 text-gray-500">{job.completed_at ? new Date(job.completed_at).toLocaleString() : "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No package provisioning jobs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
