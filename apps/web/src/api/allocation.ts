import { apiFetch } from "./client";

/** Client for the work-allocation portal: field staff and the allocation masters. */

export type FieldRole = "PASTER" | "HELPER" | "DRIVER";
export type AreaLocality = "LOCAL" | "NON_LOCAL";
export type CsmCodeKind = "CSM" | "TEAM" | "BRANCH" | "UNKNOWN";

export interface FieldStaff {
  id: number;
  name: string;
  username: string;
  role: FieldRole;
  phone: string | null;
  emp_code: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Area {
  id: number;
  name: string;
  locality: AreaLocality;
  district: string | null;
  needs_confirmation: boolean;
  is_active: boolean;
}

export interface Vehicle {
  id: number;
  reg_no: string;
  type: string;
  usual_driver_id: number | null;
  usualDriver: { id: number; name: string } | null;
  notes: string | null;
  is_active: boolean;
}

export interface CsmCode {
  id: number;
  code: string;
  kind: CsmCodeKind;
  label: string | null;
  user_id: number | null;
  user: { id: number; name: string; username: string } | null;
  is_active: boolean;
}

export const FIELD_ROLE_LABELS: Record<FieldRole, string> = {
  PASTER: "Paster",
  HELPER: "Helper",
  DRIVER: "Driver",
};

export const LOCALITY_LABELS: Record<AreaLocality, string> = {
  LOCAL: "Local",
  NON_LOCAL: "Non-local",
};

export const CSM_CODE_KIND_LABELS: Record<CsmCodeKind, string> = {
  CSM: "CSM",
  TEAM: "Team",
  BRANCH: "Branch",
  UNKNOWN: "Not confirmed",
};

// --- Field staff -----------------------------------------------------------

export const fetchFieldStaff = () => apiFetch<{ staff: FieldStaff[] }>("/field-staff");

export const createFieldStaff = (data: {
  name: string;
  username: string;
  password: string;
  role: FieldRole;
  phone?: string | null;
  emp_code?: string | null;
}) => apiFetch<FieldStaff>("/field-staff", { method: "POST", data });

export const updateFieldStaff = (
  id: number,
  data: { name?: string; role?: FieldRole; phone?: string | null; emp_code?: string | null },
) => apiFetch<FieldStaff>(`/field-staff/${id}`, { method: "PATCH", data });

export const setFieldStaffStatus = (id: number, is_active: boolean) =>
  apiFetch<FieldStaff>(`/field-staff/${id}/status`, { method: "PUT", data: { is_active } });

export const resetFieldStaffPassword = (id: number, new_password: string) =>
  apiFetch<{ message: string }>(`/field-staff/${id}/password`, { method: "PUT", data: { new_password } });

// --- Masters ---------------------------------------------------------------

export const fetchAreas = () => apiFetch<{ areas: Area[] }>("/masters/areas");
export const createArea = (data: Partial<Area>) => apiFetch<Area>("/masters/areas", { method: "POST", data });
export const updateArea = (id: number, data: Partial<Area>) =>
  apiFetch<Area>(`/masters/areas/${id}`, { method: "PATCH", data });

export const fetchVehicles = () => apiFetch<{ vehicles: Vehicle[] }>("/masters/vehicles");
export const createVehicle = (data: Partial<Vehicle>) => apiFetch<Vehicle>("/masters/vehicles", { method: "POST", data });
export const updateVehicle = (id: number, data: Partial<Vehicle>) =>
  apiFetch<Vehicle>(`/masters/vehicles/${id}`, { method: "PATCH", data });

export const fetchCsmCodes = () => apiFetch<{ codes: CsmCode[] }>("/masters/csm-codes");
export const createCsmCode = (data: Partial<CsmCode>) => apiFetch<CsmCode>("/masters/csm-codes", { method: "POST", data });
export const updateCsmCode = (id: number, data: Partial<CsmCode>) =>
  apiFetch<CsmCode>(`/masters/csm-codes/${id}`, { method: "PATCH", data });

/** The API answers validation failures as { message, errors: ["field: problem"] }. */
export function apiErrorMessage(err: any, fallback: string): string {
  const data = err?.response?.data;
  if (Array.isArray(data?.errors) && data.errors.length) return data.errors.join(", ");
  return data?.message || fallback;
}
