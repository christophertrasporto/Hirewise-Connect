import { describe, expect, it } from "vitest";
import { S3Storage } from "@/server/adapters/storage";

/**
 * Browsers upload lesson media, documents, and submissions straight to presigned URLs. R2 rejects a presigned PUT
 * that demands a checksum the browser never sends, so the URL must carry only the host signature and the content type.
 */
describe("S3 presigned upload URLs", () => {
  const storage = new S3Storage("bucket", { endpoint: "https://example.r2.cloudflarestorage.com", region: "auto", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secretexample", forcePathStyle: true });

  it("carry no checksum requirements and sign only the host header", async () => {
    const up = await storage.createUploadUrl("courses/c1/lessons/audio/a.mp3", "audio/mpeg", 600);
    const u = new URL(up.url);
    expect(up.method).toBe("PUT");
    expect(up.headers).toEqual({ "Content-Type": "audio/mpeg" });
    expect(u.pathname).toBe("/bucket/courses/c1/lessons/audio/a.mp3");
    expect([...u.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("600");
  });

  it("download URLs are time-limited GETs on the same bucket path", async () => {
    const url = await storage.createDownloadUrl("courses/c1/lessons/audio/a.mp3", 300);
    const u = new URL(url);
    expect(u.pathname).toBe("/bucket/courses/c1/lessons/audio/a.mp3");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    expect([...u.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
  });
});
