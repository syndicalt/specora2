import { useEffect, useState } from "react";
import { graphqlClient } from "@/lib/api";

export function useClassDisplayNames(className: string | undefined) {
  const [attributeNames, setAttributeNames] = useState<Record<string, string>>({});
  const [classDisplayName, setClassDisplayName] = useState<string>("");

  useEffect(() => {
    if (!className) {
      setAttributeNames({});
      setClassDisplayName("");
      return;
    }
    let cancelled = false;
    graphqlClient
      .request(
        `query($name: String!) {
          ciClass(name: $name) {
            displayName
            attributes { name displayName }
          }
        }`,
        { name: className }
      )
      .then((data) => {
        if (cancelled) return;
        const cls = (data as any).ciClass;
        const attrs = (cls?.attributes || []) as Array<{ name: string; displayName?: string }>;
        const m: Record<string, string> = {};
        for (const a of attrs) {
          m[a.name] = a.displayName || a.name;
        }
        setAttributeNames(m);
        setClassDisplayName(cls?.displayName || className);
      })
      .catch(() => {
        if (!cancelled) {
          setAttributeNames({});
          setClassDisplayName(className);
        }
      });
    return () => { cancelled = true; };
  }, [className]);

  return { attributeNames, classDisplayName };
}
