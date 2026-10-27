import { describe, expect, it } from "vitest";
import { acceptFor, checkUploadFile, describeUploadFailure, LESSON_UPLOAD_RULES, uploadMimeFor } from "@/lib/lesson-upload";

const MB = 1024 * 1024;
const file = (name: string, type: string, size = 5 * MB) => ({ name, type, size });

describe("which MIME type is sent for a chosen file", () => {
  it("keeps an allowed type the browser reports", () => {
    expect(uploadMimeFor(file("welcome.mp4", "video/mp4"), "VIDEO")).toBe("video/mp4");
    expect(uploadMimeFor(file("clip.mov", "video/quicktime"), "VIDEO")).toBe("video/quicktime");
    expect(uploadMimeFor(file("clip.webm", "video/webm"), "VIDEO")).toBe("video/webm");
  });

  it("takes it from the extension when the browser leaves it empty or reports something else", () => {
    expect(uploadMimeFor(file("Welcome Video.MP4", ""), "VIDEO")).toBe("video/mp4");
    expect(uploadMimeFor(file("phone.m4v", "video/x-m4v"), "VIDEO")).toBe("video/mp4");
    expect(uploadMimeFor(file("screen.mov", "application/octet-stream"), "VIDEO")).toBe("video/quicktime");
    expect(uploadMimeFor(file("talk.m4a", ""), "AUDIO")).toBe("audio/mp4");
    expect(uploadMimeFor(file("script.PDF", ""), "DOCUMENT")).toBe("application/pdf");
  });

  it("returns null for a type that is not allowed for the lesson", () => {
    expect(uploadMimeFor(file("clip.avi", "video/x-msvideo"), "VIDEO")).toBeNull();
    expect(uploadMimeFor(file("movie.mkv", ""), "VIDEO")).toBeNull();
    expect(uploadMimeFor(file("noextension", ""), "VIDEO")).toBeNull();
    expect(uploadMimeFor(file("song.mp3", "audio/mpeg"), "VIDEO")).toBeNull();
  });

  it("every type it can return is one the server accepts, so the two sides never disagree", () => {
    const names: Record<string, string[]> = { VIDEO: ["a.mp4", "a.m4v", "a.mov", "a.qt", "a.webm"], AUDIO: ["a.mp3", "a.wav", "a.m4a", "a.ogg", "a.oga", "a.webm"], DOCUMENT: ["a.pdf", "a.doc", "a.docx", "a.ppt", "a.pptx", "a.xls", "a.xlsx", "a.txt", "a.csv"] };
    for (const kind of Object.keys(names) as Array<keyof typeof LESSON_UPLOAD_RULES>) {
      for (const n of names[kind]) {
        const mime = uploadMimeFor(file(n, ""), kind);
        expect(mime, n).not.toBeNull();
        expect(Object.keys(LESSON_UPLOAD_RULES[kind].mimes), n).toContain(mime);
      }
    }
  });
});

describe("checking a file before it is sent", () => {
  it("passes a normal MP4, including one with a blank type", () => {
    expect(checkUploadFile(file("welcome.mp4", "video/mp4", 120 * MB), "VIDEO")).toBeNull();
    expect(checkUploadFile(file("welcome.mp4", "", 120 * MB), "VIDEO")).toBeNull();
    expect(checkUploadFile(file("big.mp4", "video/mp4", 500 * MB), "VIDEO")).toBeNull(); // exactly the limit is fine
  });

  it("explains a file that is too large, with its size and the limit", () => {
    const msg = checkUploadFile(file("big.mp4", "video/mp4", 801 * MB), "VIDEO")!;
    expect(msg).toContain("801 MB");
    expect(msg).toContain("500 MB");
  });

  it("explains an unsupported type and an empty file", () => {
    expect(checkUploadFile(file("movie.mkv", ""), "VIDEO")).toMatch(/not supported for a video lesson\. Use MP4, WEBM, MOV/);
    expect(checkUploadFile(file("empty.mp4", "video/mp4", 0), "VIDEO")).toBe("That file is empty.");
  });

  it("the file picker offers the extensions as well as the types, so a file with a blank type is still selectable", () => {
    const accept = acceptFor("VIDEO").split(",");
    for (const x of ["video/mp4", "video/quicktime", "video/webm", ".mp4", ".mov", ".m4v", ".webm"]) expect(accept).toContain(x);
  });
});

describe("what the editor is told when storage refuses", () => {
  it("separates a blocked or unreachable storage from a refusal and from other errors", () => {
    expect(describeUploadFailure(0)).toMatch(/CORS/);
    expect(describeUploadFailure(0)).toMatch(/runbook/);
    expect(describeUploadFailure(403)).toMatch(/refused the upload \(403\)/);
    expect(describeUploadFailure(413)).toMatch(/too large/);
    expect(describeUploadFailure(500)).toContain("(500)");
  });
});
