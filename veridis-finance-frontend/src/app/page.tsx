import { redirect } from "next/navigation";

import { getAuthTokenFromCookies } from "@/lib/auth";

export default function HomePage() {
  const token = getAuthTokenFromCookies();
  redirect(token ? "/dashboard" : "/login");
}
