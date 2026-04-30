import { config } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

for (const name of [".env.local", ".env"]) {
  const path = resolve(root, name);
  if (existsSync(path)) config({ path });
}
