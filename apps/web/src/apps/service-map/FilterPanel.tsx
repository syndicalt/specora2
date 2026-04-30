import { relLabel, type RelationshipTypeOption } from "./layout";

function FilterCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-gray-100 select-none">
      <div className="relative flex items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="w-3.5 h-3.5 rounded border border-gray-600 bg-gray-800 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-colors" />
        <svg className="absolute left-0.5 top-0.5 w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 14 14" fill="none">
          <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {children}
    </label>
  );
}

export function FilterPanel({
  availableClasses,
  classDisplayNames,
  classFilters,
  environmentFilters,
  availableEnvironments,
  relationshipOptions,
  relationshipFilters,
  relationshipColor,
  onReset,
  setClassFilters,
  setEnvironmentFilters,
  setRelationshipFilters,
}: {
  availableClasses: string[];
  classDisplayNames: Record<string, string>;
  classFilters: string[];
  environmentFilters: string[];
  availableEnvironments: string[];
  relationshipOptions: RelationshipTypeOption[];
  relationshipFilters: string[];
  relationshipColor: (type: string) => { stroke: string };
  onReset: () => void;
  setClassFilters: React.Dispatch<React.SetStateAction<string[]>>;
  setEnvironmentFilters: React.Dispatch<React.SetStateAction<string[]>>;
  setRelationshipFilters: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-200">Filter Graph</h3>
        <button onClick={onReset} className="text-xs text-gray-400 hover:text-gray-200 transition-colors">Reset all</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <h4 className="text-xs text-gray-500 mb-2">Class</h4>
          <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
            {availableClasses.map((cls) => (
              <FilterCheckbox
                key={cls}
                checked={classFilters.includes(cls)}
                onChange={(checked) => setClassFilters((prev) => checked ? [...prev, cls] : prev.filter((item) => item !== cls))}
              >
                {classDisplayNames[cls] || cls}
              </FilterCheckbox>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs text-gray-500 mb-2">Environment</h4>
          <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
            {availableEnvironments.map((env) => (
              <FilterCheckbox
                key={env}
                checked={environmentFilters.includes(env)}
                onChange={(checked) => setEnvironmentFilters((prev) => checked ? [...prev, env] : prev.filter((item) => item !== env))}
              >
                {env}
              </FilterCheckbox>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs text-gray-500 mb-2">Relationship</h4>
          <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
            {relationshipOptions.map((rel) => (
              <FilterCheckbox
                key={rel.name}
                checked={relationshipFilters.includes(rel.name)}
                onChange={(checked) => setRelationshipFilters((prev) => checked ? [...prev, rel.name] : prev.filter((item) => item !== rel.name))}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: rel.color || relationshipColor(rel.name).stroke }} />
                {rel.displayName || relLabel(rel.name)}
              </FilterCheckbox>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
