import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,141,0.18),_transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.16),_transparent_40%)]" />
      <RegisterForm />
    </main>
  );
}
