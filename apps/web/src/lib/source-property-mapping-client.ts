"use client";

import { useEffect, useState } from "react";

import type { SourcePropertyMappingRule } from "@/lib/source-workbench-types";

let cachedRules: SourcePropertyMappingRule[] | null = null;
let pendingRules: Promise<SourcePropertyMappingRule[]> | null = null;

export async function listSourcePropertyMappingsClient() {
  if (cachedRules) return cachedRules;
  pendingRules ??= fetch("/api/source-property-mappings", { cache: "no-store" })
    .then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as { rules?: SourcePropertyMappingRule[]; error?: string };
      if (!response.ok || !payload.rules) {
        throw new Error(payload.error ?? "원본 컬럼 매핑 규칙을 불러오지 못했습니다.");
      }
      cachedRules = payload.rules;
      return payload.rules;
    })
    .catch(() => {
      cachedRules = [];
      return [];
    })
    .finally(() => {
      pendingRules = null;
    });

  return pendingRules;
}

export function useSourcePropertyMappingRules(enabled = true) {
  const [rules, setRules] = useState<SourcePropertyMappingRule[]>(() => cachedRules ?? []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void listSourcePropertyMappingsClient().then((items) => {
      if (!cancelled) setRules(items);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return rules;
}
