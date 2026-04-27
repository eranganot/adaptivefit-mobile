// Re-export Auth.js route handlers separately so we can import the auth() helper
// from @/lib/auth without dragging route handler types into client components.
import { handlers } from "./index";
export const { GET, POST } = handlers;
