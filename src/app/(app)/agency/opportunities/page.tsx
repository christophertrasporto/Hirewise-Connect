import type { Metadata } from "next";
import { Card, EmptyState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Opportunities" };

export default function AgencyPlaceholderPage() {
  return (
    <Card title="Opportunities">
      <EmptyState title="Coming in a later phase" description="Client opportunities shared with your agency, eligibility per agent, submissions, interviews, and placements. Arrives in phases A4 and A5." />
    </Card>
  );
}
