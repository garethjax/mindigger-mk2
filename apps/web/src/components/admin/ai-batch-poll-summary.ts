export interface BatchPollResult {
  status?: string;
}

function normalizeBatchPollStatus(status: string | undefined): "completed" | "processing" | "failed" | "cancelled" | "other" {
  if (!status) return "other";
  if (status === "completed") return "completed";
  if (
    status === "still_processing" ||
    status === "locked_by_other" ||
    status === "lock_failed" ||
    status === "in_progress" ||
    status === "validating" ||
    status === "finalizing"
  ) {
    return "processing";
  }
  if (status === "failed" || status === "api_error" || status === "no_output_file" || status === "expired") {
    return "failed";
  }
  if (status === "cancelled") return "cancelled";
  return "other";
}

export function buildBatchPollSummary(results: BatchPollResult[]): string {
  if (results.length === 0) {
    return "Controllo status completato: nessun batch attivo da verificare.";
  }

  const counts = {
    completed: 0,
    processing: 0,
    failed: 0,
    cancelled: 0,
    other: 0,
  };

  for (const result of results) {
    counts[normalizeBatchPollStatus(result.status)] += 1;
  }

  const parts: string[] = [];
  if (counts.completed > 0) parts.push(`${counts.completed} completati`);
  if (counts.processing > 0) parts.push(`${counts.processing} ancora in corso`);
  if (counts.failed > 0) parts.push(`${counts.failed} con errore`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancellati`);
  if (counts.other > 0) parts.push(`${counts.other} con stato non classificato`);

  return `Controllo status completato: ${parts.join(", ")}.`;
}
