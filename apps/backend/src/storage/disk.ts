import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { StorageBackend } from "./types.ts";
import { logger } from "../logger.ts";

/**
 * Disk-based storage backend that stores files on the local filesystem.
 * Each file is stored as binary content, with a .meta JSON sidecar file
 * containing the content type.
 */
export class DiskStorage implements StorageBackend {
  private basePath: string;

  /**
   * @param basePath - Directory where files will be stored (default: "./data/files")
   */
  constructor(
    basePath: string = process.env.STORAGE_DISK_PATH || "./data/files",
  ) {
    this.basePath = path.resolve(basePath);
  }

  /**
   * Safely resolves a key against the base path, preventing directory traversal.
   */
  private resolveKey(key: string, suffix: string = ""): string {
    const targetPath = path.resolve(this.basePath, key + suffix);
    // Ensure the resolved path strictly resides within the base directory.
    // Appending path.sep ensures we don't match sibling directories (e.g., /data/files_secret).
    if (!targetPath.startsWith(this.basePath + path.sep)) {
      throw new Error(`Invalid storage key (path traversal detected): ${key}`);
    }
    return targetPath;
  }

  /**
   * Get the full filesystem path for a storage key.
   */
  private getFilePath(key: string): string {
    return this.resolveKey(key);
  }

  /**
   * Get the path to the metadata sidecar file.
   */
  private getMetaPath(key: string): string {
    return this.resolveKey(key, ".meta");
  }

  /**
   * Ensure the directory for a file exists.
   */
  private async ensureDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    await this.ensureDir(filePath);

    // Write the binary file
    await fs.writeFile(filePath, data);

    // Write the metadata sidecar
    await fs.writeFile(metaPath, JSON.stringify({ contentType }));

    logger.debug(
      { key, contentType, size: data.length },
      "File stored to disk",
    );
  }

  async get(
    key: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    try {
      // Read both files in parallel
      const [data, metaContent] = await Promise.all([
        fs.readFile(filePath),
        fs.readFile(metaPath, "utf-8"),
      ]);

      const meta = JSON.parse(metaContent) as { contentType: string };
      return { data, contentType: meta.contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    // Delete both files, ignoring errors if they don't exist
    await Promise.all([
      fs.unlink(filePath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.warn({ error, key }, "Error deleting file from disk");
        }
      }),
      fs.unlink(metaPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.warn({ error, key }, "Error deleting meta file from disk");
        }
      }),
    ]);

    logger.debug({ key }, "File deleted from disk");
  }
}
