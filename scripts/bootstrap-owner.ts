import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { users } from "../src/db/schema";

async function main() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  const name = process.env.OWNER_NAME?.trim() || "NexiMail Owner";

  if (!email || !password) {
    throw new Error("OWNER_EMAIL and OWNER_PASSWORD are required");
  }
  if (password.length < 12) {
    throw new Error("OWNER_PASSWORD must be at least 12 characters");
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log(`Owner bootstrap skipped: ${email} already exists.`);
    return;
  }

  const passwordHash = await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });

  await db.insert(users).values({
    name,
    email,
    passwordHash,
    role: "owner",
    status: "active",
  });

  console.log(`Owner created: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
