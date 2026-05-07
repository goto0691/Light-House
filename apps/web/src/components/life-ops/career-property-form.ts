import type { CareerLog } from "@/lib/mock/life-ops";

export type CareerPropertyForm = {
  organization: string;
  role: string;
  category: string;
  startDate: string;
  endDate: string;
  description: string;
};

export function buildCareerPropertyForm(career?: Partial<CareerLog>): CareerPropertyForm {
  return {
    organization: career?.organization ?? "",
    role: career?.role ?? "",
    category: career?.category ?? "work",
    startDate: career?.startDate ?? dateFromPeriod(career?.period) ?? new Date().toISOString().slice(0, 10),
    endDate: career?.endDate ?? "",
    description: career?.description ?? "",
  };
}

export function careerPropertyPayload(form: CareerPropertyForm) {
  return {
    organization: form.organization.trim(),
    role: form.role.trim(),
    category: form.category || "work",
    startDate: form.startDate,
    endDate: form.endDate || null,
    description: form.description.trim(),
  };
}

function dateFromPeriod(period?: string) {
  const match = period?.match(/\d{4}/);
  return match ? `${match[0]}-01-01` : null;
}
