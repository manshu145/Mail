import { redirect } from "next/navigation";

export default function HiddenInternalPage() {
  redirect("/dashboard");
}
