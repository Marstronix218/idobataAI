import { AlertCircle, RefreshCw } from "lucide-react";

type StatusMessageProps = {
  message: string;
  tone?: "status" | "error";
  onRetry?: () => void;
  className?: string;
};

/**
 * Success and failure used to share one muted grey line with `aria-live`,
 * so a failed save read exactly like "Settings saved.": quiet, grey, and easy
 * to miss. Failures now announce as an alert and carry error styling, with an
 * optional retry where retrying is meaningful.
 *
 * The element is always rendered so the live region exists before the message
 * arrives; assistive technology does not reliably announce a region that is
 * inserted at the same moment its content is.
 */
export function StatusMessage({ message, tone = "status", onRetry, className = "" }: StatusMessageProps) {
  if (tone === "error" && message) {
    return (
      <div role="alert" className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm font-bold text-danger ${className}`}>
        <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 break-words">{message}</span>
        {onRetry && <button type="button" className="btn btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={onRetry}><RefreshCw size={14} /> Try again</button>}
      </div>
    );
  }
  return <p role="status" aria-live="polite" className={`mt-4 min-h-5 text-sm font-bold text-muted ${className}`}>{tone === "error" ? "" : message}</p>;
}
