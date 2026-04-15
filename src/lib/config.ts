import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const profileSchema = z.object({
  bucket: z.string().optional(),
  imsToken: z.string().optional(),
});

export type ProfileConfig = z.infer<typeof profileSchema>;

export function resolveConfigPath(env: NodeJS.ProcessEnv): string {
  if (env.AEMDM_CONFIG_PATH) {
    return env.AEMDM_CONFIG_PATH;
  }

  const home = env.HOME;
  const xdgConfigHome = env.XDG_CONFIG_HOME;

  if (xdgConfigHome) {
    return path.join(xdgConfigHome, "aemdm", "config.json");
  }

  if (home) {
    return path.join(home, ".config", "aemdm", "config.json");
  }

  return path.join(process.cwd(), ".aemdm.config.json");
}

export async function readProfileConfig(env: NodeJS.ProcessEnv): Promise<ProfileConfig> {
  const configPath = resolveConfigPath(env);

  try {
    const raw = await readFile(configPath, "utf8");
    return profileSchema.parse(JSON.parse(raw));
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError?.code === "ENOENT") {
      return {};
    }

    if (error instanceof z.ZodError) {
      throw new Error(`Invalid aemdm profile config at ${configPath}: ${error.message}`, {
        cause: error,
      });
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Unable to parse aemdm profile config at ${configPath}: ${error.message}`, {
        cause: error,
      });
    }

    throw error;
  }
}

export async function writeProfileConfig(
  env: NodeJS.ProcessEnv,
  profile: ProfileConfig,
): Promise<string> {
  const configPath = resolveConfigPath(env);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return configPath;
}
