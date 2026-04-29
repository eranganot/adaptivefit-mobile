"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setLocale(locale: "en" | "he") {
  try {
    const session = await auth();
    
    if (!session?.user?.email) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user from DB by email
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, session.user.email))
      .limit(1);

    if (!user || user.length === 0) {
      return { success: false, error: "User not found" };
    }

    const userId = user[0].id;

    // Update user locale in database
    await db
      .update(users)
      .set({ locale })
      .where(eq(users.id, userId));

    // Set locale cookie
    const cookieStore = await cookies();
    cookieStore.set("locale", locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    // Revalidate to reflect changes
    revalidatePath("/");

    return { success: true };
  } catch (error) {
    console.error("Error setting locale:", error);
    return { success: false, error: "Failed to update locale" };
  }
}
