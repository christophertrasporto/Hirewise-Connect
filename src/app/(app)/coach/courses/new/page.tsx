import { redirect } from "next/navigation";

export default function LegacyNewCoursePage() {
  redirect("/courses/manage/new");
}
