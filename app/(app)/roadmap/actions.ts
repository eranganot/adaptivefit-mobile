"use server";

import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";

export async function regenerateRoadmap(userId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("Unauthorized");
  }

  await regenerateRoadmapForUser(userId);
  revalidatePath("/roadmap");
}
