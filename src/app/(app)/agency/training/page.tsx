import type { Metadata } from "next";
import { Card, EmptyState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Training" };

export default function AgencyPlaceholderPage() {
  return (
    <Card title="Training">
      <EmptyState title="Coming in a later phase" description="Buy courses, bundles, and seat packages, assign them to your agents, and follow progress and certifications. Arrives in phase A3." />
    </Card>
  );
}
