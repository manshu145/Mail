import { notFound, redirect } from "next/navigation";

const aliases: Record<string, string> = {
  "gmail-validation": "/validation",
  "team-access": "/users",
  "analytics": "/reports",
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const destination = aliases[section];
  if (destination) redirect(destination);
  notFound();
}
