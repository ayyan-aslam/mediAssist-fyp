import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { consultationsApi } from "@/lib/api/consultations";

// Starts the consultation and opens the recording page. The button stays busy until the page changes.
export function useStartConsultation() {
  const router = useRouter();
  return useMutation({
    mutationFn: consultationsApi.start,
    onSuccess: ({ consultationId }) => router.push(`/doctor/consultations/${consultationId}/record`),
    onError: (err) => toast.error(`The recording could not be started. ${err.message}`),
  });
}
