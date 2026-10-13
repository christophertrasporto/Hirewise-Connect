import type { Metadata } from "next";
import { Card, EmptyState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Reports" };

export default function AgencyPlaceholderPage() {
  return (
    <Card title="Reports">
      <EmptyState title="Coming in a later phase" description="Agents, submissions, interviews, placements, course completion, certifications, and quality. Arrives in phase A6." />
    </Card>
  );
}
