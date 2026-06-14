import { toast as sonnerToast } from "sonner";

export {
  scoreTier,
  scorePercent,
  sybilLabel,
} from "@/lib/score-tier";

export const toast = {
  success: (message: string, id?: string) =>
    sonnerToast.success(message, { id, duration: 5000 }),
  error: (message: string, id?: string) =>
    sonnerToast.error(message, { id, duration: 6000 }),
  warning: (message: string, id?: string) =>
    sonnerToast.warning(message, { id, duration: 5500 }),
  info: (message: string, id?: string) =>
    sonnerToast.info(message, { id, duration: 5000 }),
};
