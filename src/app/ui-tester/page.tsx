import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { UiTester } from "@/components/ui-tester";

export default async function UiTesterPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/dashboard");
  return <AppShell session={session}><UiTester /></AppShell>;
}
