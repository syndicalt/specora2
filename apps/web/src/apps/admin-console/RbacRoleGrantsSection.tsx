"use client";

import { Trash2 } from "lucide-react";
import type { Permission } from "./types";

type RbacRoleGrantsSectionProps = {
  roles: string[];
  permissions: Permission[];
  onDeletePermission: (id: string) => void;
};

export function RbacRoleGrantsSection({ roles, permissions, onDeletePermission }: RbacRoleGrantsSectionProps) {
  return (
    <>
      {roles.map((role) => (
        <div key={role} className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 bg-gray-800/50 px-4 py-3">
            <h3 className="text-sm font-medium capitalize text-gray-200">{role}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">Resource</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="w-16 px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {permissions.filter((permission) => permission.role === role).map((permission) => (
                <tr key={permission.id} className="border-b border-gray-800/50 last:border-0">
                  <td className="px-4 py-2 text-gray-300">{permission.resource}</td>
                  <td className="px-4 py-2 text-gray-300">{permission.action}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => onDeletePermission(permission.id)} className="text-gray-500 transition-colors hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
