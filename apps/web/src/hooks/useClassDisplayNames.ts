import { useEffect, useState } from "react";
import { graphqlClient } from "@/lib/api";

export type ClassAttributeDisplay = {
  name: string;
  displayName?: string;
  attrType?: string;
  isMandatory?: boolean;
  isHealthRequired?: boolean;
  isKeyAttribute?: boolean;
  enumValues?: string[];
  referenceClass?: string;
  defaultValue?: string | null;
};

export function useClassDisplayNames(className: string | undefined) {
  const [attributeNames, setAttributeNames] = useState<Record<string, string>>({});
  const [attributes, setAttributes] = useState<ClassAttributeDisplay[]>([]);
  const [classDisplayName, setClassDisplayName] = useState<string>("");

  useEffect(() => {
    if (!className) {
      setAttributeNames({});
      setAttributes([]);
      setClassDisplayName("");
      return;
    }
    let cancelled = false;
    graphqlClient
      .request(
        `query($name: String!) {
          ciClass(name: $name) {
            displayName
            attributes {
              name
              displayName
              attrType
              isMandatory
              isHealthRequired
              isKeyAttribute
              enumValues
              referenceClass
              defaultValue
            }
          }
        }`,
        { name: className }
      )
      .then((data) => {
        if (cancelled) return;
        const cls = (data as any).ciClass;
        const attrs = (cls?.attributes || []) as ClassAttributeDisplay[];
        const m: Record<string, string> = {};
        for (const a of attrs) {
          m[a.name] = a.displayName || a.name;
        }
        setAttributeNames(m);
        setAttributes(attrs);
        setClassDisplayName(cls?.displayName || className);
      })
      .catch(() => {
        if (!cancelled) {
          setAttributeNames({});
          setAttributes([]);
          setClassDisplayName(className);
        }
      });
    return () => { cancelled = true; };
  }, [className]);

  return { attributeNames, attributes, classDisplayName };
}
