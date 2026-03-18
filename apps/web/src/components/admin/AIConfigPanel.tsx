import { useState } from "preact/hooks";
import type { AIConfig, TokenUsageRow, Batch, PricingRow, CreditBalance } from "./ai-config-types";
import ProviderConfigTab from "./ProviderConfigTab";
import TokenUsageTab from "./TokenUsageTab";
import CostsTab from "./CostsTab";
import BatchManagementTab from "./BatchManagementTab";

interface Props {
  configs: AIConfig[];
  tokenUsage: TokenUsageRow[];
  batches: Batch[];
  pricing: PricingRow[];
  creditBalance: CreditBalance | null;
}


export default function AIConfigPanel({ configs, tokenUsage, batches, pricing, creditBalance }: Props) {
  const [tab, setTab] = useState<"config" | "tokens" | "batches" | "costs">("config");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const TABS = [
    { key: "config" as const, label: "Provider" },
    { key: "tokens" as const, label: "Token Usage" },
    { key: "costs" as const, label: "Costi" },
    { key: "batches" as const, label: "Batch AI" },
  ];

  return (
    <div class="space-y-4">
      {/* Tabs */}
      <div class="flex gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            class={`px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div
          class={`rounded-lg p-3 text-sm ${
            message.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Config tab */}
      {tab === "config" && (
        <ProviderConfigTab configs={configs} pricing={pricing} setMessage={setMessage} />
      )}

      {/* Token Usage tab */}
      {tab === "tokens" && <TokenUsageTab tokenUsage={tokenUsage} />}

      {/* Costs tab */}
      {tab === "costs" && (
        <CostsTab tokenUsage={tokenUsage} pricing={pricing} creditBalance={creditBalance} />
      )}

      {/* Batches tab */}
      {tab === "batches" && (
        <BatchManagementTab initialBatches={batches} setMessage={setMessage} />
      )}
    </div>
  );
}
