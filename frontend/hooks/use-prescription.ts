import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { prescriptionQueryKey, prescriptionsApi } from "@/lib/api/prescriptions";

// The consultation's final prescription, or null while it is not finalized (404 PRESCRIPTION_NOT_FOUND).
export function usePrescription(consultationId: number, { enabled = true } = {}) {
  return useQuery({
    queryKey: prescriptionQueryKey(consultationId),
    queryFn: async () => {
      try {
        return await prescriptionsApi.getByConsultation(consultationId);
      } catch (err) {
        if (err instanceof ApiError && err.code === "PRESCRIPTION_NOT_FOUND") return null;
        throw err;
      }
    },
    enabled,
  });
}
