import { signIn, auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/home");
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6">
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-primary">
            <path
              d="M3 12h3l3-9 6 18 3-9h3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
        <p className="text-sm text-muted-foreground">{t("app.tagline")}</p>
      </div>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/home" });
        }}
        className="w-full"
      >
        <button
          type="submit"
          className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground transition hover:opacity-90"
        >
          {t("auth.signIn")}
        </button>
      </form>
      <p className="mt-8 text-xs text-muted-foreground">{t("auth.personalApp")}</p>
    </main>
  );
}
