"use client";

import { PropertyPanel } from "@/components/shared/properties/property-panel";
import type { ZettelFormState } from "@/components/vault/zettel-form";
import { ZETTEL_PROPERTY_DEFINITIONS, ZETTEL_PROPERTY_GROUPS } from "@/lib/properties/zettel";

type ZettelPropertiesPanelProps = {
  form: ZettelFormState;
  onChange: (patch: Partial<ZettelFormState>) => void;
  categoryOptions?: string[];
  className?: string;
};

export function ZettelPropertiesPanel({ form, onChange, categoryOptions = [], className }: ZettelPropertiesPanelProps) {
  return (
    <PropertyPanel
      className={className}
      definitions={ZETTEL_PROPERTY_DEFINITIONS}
      fieldOptions={{
        category: { suggestions: categoryOptions },
        tags: { chipPrefix: "#", stripHash: true },
      }}
      form={form}
      groups={ZETTEL_PROPERTY_GROUPS}
      onChange={onChange}
    />
  );
}
