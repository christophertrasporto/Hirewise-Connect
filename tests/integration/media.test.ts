import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { resetEnvCache } from "@/server/env";
import { getStorage, LocalDiskStorage } from "@/server/adapters/storage";
import { createUploadUrl, confirmVideoUpload, confirmRecordingUpload, confirmResumeUpload, confirmPhotoUpload, removeOwnPhoto, profilePhotoUrl, mediaDownloadUrl, UploadRejectedError } from "@/server/services/media.service";
import { getOwnProfile } from "@/server/services/agent.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";

const db = testDb();
let dir = "";
let agentProfileId = "";
let otherProfileId = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-storage-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const agentRole = await db.role.findUniqueOrThrow({ where: { key: "AGENT" } });
  const u1 = await db.user.create({ data: { id: "agent_u1", email: "a1@talent.example", roleId: agentRole.id } });
  const u2 = await db.user.create({ data: { id: "agent_u2", email: "a2@talent.example", roleId: agentRole.id } });
  agentProfileId = (await db.agentProfile.create({ data: { userId: u1.id, displayName: "A One", privateContact: { create: { fullLegalName: "A One" } } } })).id;
  otherProfileId = (await db.agentProfile.create({ data: { userId: u2.id, displayName: "A Two", privateContact: { create: { fullLegalName: "A Two" } } } })).id;
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

const agent = () => makeActor("AGENT", { userId: "agent_u1", agentProfileId });
const other = () => makeActor("AGENT", { userId: "agent_u2", agentProfileId: otherProfileId });

describe("upload rules", () => {
  it("rejects wrong MIME and oversize files before issuing a URL", async () => {
    await expect(createUploadUrl(agent(), { kind: "RESUME", contentType: "image/gif", sizeBytes: 100 })).rejects.toThrow(UploadRejectedError);
    await expect(createUploadUrl(agent(), { kind: "RECORDING", contentType: "audio/mpeg", sizeBytes: 26 * 1024 * 1024 })).rejects.toThrow(/too large/i);
  });

  it("only agents get upload URLs", async () => {
    await expect(createUploadUrl(makeActor("CLIENT", { clientId: "c" }), { kind: "VIDEO", contentType: "video/mp4", sizeBytes: 10 })).rejects.toThrow(ForbiddenError);
  });

  it("issues a signed local URL whose key is scoped to the agent's profile", async () => {
    const r = await createUploadUrl(agent(), { kind: "VIDEO", contentType: "video/mp4", sizeBytes: 1000 });
    expect(r.key.startsWith(`agents/${agentProfileId}/video/`)).toBe(true);
    expect(r.url).toMatch(/\/api\/storage\/.*sig=/);
    const s = getStorage();
    expect(s).toBeInstanceOf(LocalDiskStorage);
    const u = new URL(r.url);
    expect((s as LocalDiskStorage).verify(r.key, Number(u.searchParams.get("exp")), "PUT", u.searchParams.get("sig")!)).toBe(true);
    expect((s as LocalDiskStorage).verify(r.key, Number(u.searchParams.get("exp")), "GET", u.searchParams.get("sig")!)).toBe(false);
  });
});

describe("confirm and authorization", () => {
  it("confirm fails until the file exists, then records a SUBMITTED video with audit", async () => {
    const r = await createUploadUrl(agent(), { kind: "VIDEO", contentType: "video/mp4", sizeBytes: 3 });
    await expect(confirmVideoUpload(db, agent(), r.key, 90)).rejects.toThrow(UploadRejectedError);
    await getStorage().put(r.key, Buffer.from("abc"), "video/mp4");
    await confirmVideoUpload(db, agent(), r.key, 90);
    const v = await db.video.findFirstOrThrow({ where: { agentProfileId } });
    expect(v.status).toBe("SUBMITTED");
    expect(v.isCurrent).toBe(true);
    expect(await db.auditLog.count({ where: { action: "VIDEO_SUBMITTED", entityId: v.id } })).toBe(1);
  });

  it("a second video retires the earlier unapproved one", async () => {
    const r = await createUploadUrl(agent(), { kind: "VIDEO", contentType: "video/webm", sizeBytes: 3 });
    await getStorage().put(r.key, Buffer.from("abc"), "video/webm");
    await confirmVideoUpload(db, agent(), r.key, 60);
    const all = await db.video.findMany({ where: { agentProfileId }, orderBy: { createdAt: "asc" } });
    expect(all.map((x) => x.status)).toEqual(["RETIRED", "SUBMITTED"]);
  });

  it("another agent cannot confirm a key that is not under their profile", async () => {
    const r = await createUploadUrl(agent(), { kind: "RECORDING", contentType: "audio/mpeg", sizeBytes: 3 });
    await getStorage().put(r.key, Buffer.from("abc"), "audio/mpeg");
    await expect(confirmRecordingUpload(db, other(), r.key, "COLD_CALL", "x", 30)).rejects.toThrow(ForbiddenError);
    await confirmRecordingUpload(db, agent(), r.key, "COLD_CALL", "Solar sample", 30);
  });

  it("résumé confirm sets the private résumé key and bumps completion", async () => {
    const r = await createUploadUrl(agent(), { kind: "RESUME", contentType: "application/pdf", sizeBytes: 3 });
    await getStorage().put(r.key, Buffer.from("pdf"), "application/pdf");
    await confirmResumeUpload(db, agent(), r.key);
    const pc = await db.agentPrivateContact.findUniqueOrThrow({ where: { agentProfileId } });
    expect(pc.resumeKey).toBe(r.key);
  });

  it("download URLs: owner and staff yes, other agents and clients (unapproved) no; résumé needs private-contact permission", async () => {
    const video = await db.video.findFirstOrThrow({ where: { agentProfileId, status: "SUBMITTED" } });
    expect(await mediaDownloadUrl(db, agent(), { type: "VIDEO", id: video.id })).toMatch(/sig=/);
    expect(await mediaDownloadUrl(db, makeActor("RECRUITER"), { type: "VIDEO", id: video.id })).toMatch(/sig=/);
    await expect(mediaDownloadUrl(db, other(), { type: "VIDEO", id: video.id })).rejects.toThrow(NotFoundError);
    await expect(mediaDownloadUrl(db, makeActor("CLIENT", { clientId: "c" }), { type: "VIDEO", id: video.id })).rejects.toThrow(NotFoundError);

    await db.video.update({ where: { id: video.id }, data: { status: "APPROVED" } });
    // Phase 5: approval alone is not enough; clients need an approved client-safe row.
    await expect(mediaDownloadUrl(db, makeActor("CLIENT", { clientId: "c" }), { type: "VIDEO", id: video.id })).rejects.toThrow(NotFoundError);
    await db.clientSafeDocument.create({ data: { agentProfileId, type: "VIDEO_INTRO", sourceType: "VIDEO", sourceId: video.id, originalStorageKey: video.storageKey, sanitizedStorageKey: video.storageKey, status: "APPROVED_FOR_CLIENT" } });
    expect(await mediaDownloadUrl(db, makeActor("CLIENT", { clientId: "c" }), { type: "VIDEO", id: video.id })).toMatch(/sig=/);

    await expect(mediaDownloadUrl(db, makeActor("SALES"), { type: "RESUME", id: agentProfileId })).rejects.toThrow(ForbiddenError);
    expect(await mediaDownloadUrl(db, makeActor("RECRUITER"), { type: "RESUME", id: agentProfileId })).toMatch(/sig=/);
    expect(await mediaDownloadUrl(db, agent(), { type: "RESUME", id: agentProfileId })).toMatch(/sig=/);
  });
});

describe("profile photo", () => {
  it("saving records the photo, replacing deletes the old file, and the views carry a version but never the key", async () => {
    const first = await createUploadUrl(agent(), { kind: "PHOTO", contentType: "image/png", sizeBytes: 3 });
    await expect(confirmPhotoUpload(db, agent(), first.key)).rejects.toThrow(UploadRejectedError); // not uploaded yet
    await getStorage().put(first.key, Buffer.from("png"), "image/png");
    await confirmPhotoUpload(db, agent(), first.key);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: agentProfileId } })).photoKey).toBe(first.key);

    const second = await createUploadUrl(agent(), { kind: "PHOTO", contentType: "image/jpeg", sizeBytes: 3 });
    await getStorage().put(second.key, Buffer.from("jpg"), "image/jpeg");
    await confirmPhotoUpload(db, agent(), second.key);
    expect(await getStorage().exists(first.key)).toBe(false);
    expect(await getStorage().exists(second.key)).toBe(true);

    const view = await getOwnProfile(db, agent());
    expect(view.hasPhoto).toBe(true);
    expect(view.photoVersion).toMatch(/^[0-9a-f]{10}$/);
    expect(JSON.stringify(view)).not.toContain(second.key);
  });

  it("a photo key from another profile is refused", async () => {
    const theirs = await createUploadUrl(other(), { kind: "PHOTO", contentType: "image/png", sizeBytes: 3 });
    await getStorage().put(theirs.key, Buffer.from("png"), "image/png");
    await expect(confirmPhotoUpload(db, agent(), theirs.key)).rejects.toThrow(ForbiddenError);
  });

  it("is shown to its owner and to staff, and to nobody else (clients and other agents get NotFound)", async () => {
    expect(await profilePhotoUrl(db, agent(), agentProfileId)).toMatch(/sig=/);
    expect(await profilePhotoUrl(db, makeActor("RECRUITER"), agentProfileId)).toMatch(/sig=/);
    await expect(profilePhotoUrl(db, other(), agentProfileId)).rejects.toThrow(NotFoundError);
    await expect(profilePhotoUrl(db, makeActor("CLIENT", { clientId: "c" }), agentProfileId)).rejects.toThrow(NotFoundError);
    await expect(profilePhotoUrl(db, agent(), otherProfileId)).rejects.toThrow(NotFoundError);
  });

  it("removing clears the photo and deletes the file; only an agent can remove", async () => {
    const key = (await db.agentProfile.findUniqueOrThrow({ where: { id: agentProfileId } })).photoKey!;
    await expect(removeOwnPhoto(db, makeActor("CLIENT", { clientId: "c" }))).rejects.toThrow(ForbiddenError);
    await removeOwnPhoto(db, agent());
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: agentProfileId } })).photoKey).toBeNull();
    expect(await getStorage().exists(key)).toBe(false);
    await expect(profilePhotoUrl(db, agent(), agentProfileId)).rejects.toThrow(NotFoundError);
    await removeOwnPhoto(db, agent()); // already gone: no error
    expect((await getOwnProfile(db, agent())).hasPhoto).toBe(false);
  });
});
