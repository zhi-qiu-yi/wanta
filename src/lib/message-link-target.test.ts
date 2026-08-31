import { describe, expect, it } from "vitest"
import { localFilePathFromMessageLink, localFileTargetFromMessageLink } from "./message-link-target.ts"

describe("localFilePathFromMessageLink", () => {
  it("recognizes and safely decodes POSIX paths", () => {
    expect(localFilePathFromMessageLink("/Users/me/Application%20Support/report.html")).toBe(
      "/Users/me/Application Support/report.html",
    )
  })

  it("recognizes file URLs and Windows paths", () => {
    expect(localFilePathFromMessageLink("file:///Users/me/report%20final.html")).toBe("/Users/me/report final.html")
    expect(localFilePathFromMessageLink("file:///C:/Users/me/report.html")).toBe("C:/Users/me/report.html")
    expect(localFilePathFromMessageLink("C:\\Users\\me\\report.html")).toBe("C:\\Users\\me\\report.html")
  })

  it("does not decode escaped path separators", () => {
    expect(localFilePathFromMessageLink("/tmp/report%2Farchive/file.html")).toBe("/tmp/report%2Farchive/file.html")
    expect(localFilePathFromMessageLink("C:\\tmp\\report%5Carchive.html")).toBe("C:\\tmp\\report%5Carchive.html")
  })

  it("does not classify external or home-relative URLs as local files", () => {
    expect(localFilePathFromMessageLink("https://example.com/report.html")).toBeNull()
    expect(localFilePathFromMessageLink("mailto:hello@example.com")).toBeNull()
    expect(localFilePathFromMessageLink("~/report.html")).toBeNull()
    expect(localFilePathFromMessageLink("file://server/share/report.html")).toBeNull()
  })

  it("strips line and column reference suffixes from code paths", () => {
    expect(localFilePathFromMessageLink("/Volumes/LEE/wanta/src/routes/Chat/AssistantTurnRenderer.tsx:362")).toBe(
      "/Volumes/LEE/wanta/src/routes/Chat/AssistantTurnRenderer.tsx",
    )
    expect(localFilePathFromMessageLink("/Users/me/report.html:12:34")).toBe("/Users/me/report.html")
    expect(localFilePathFromMessageLink("file:///Users/me/report%20final.html:99")).toBe("/Users/me/report final.html")
    expect(localFilePathFromMessageLink("C:\\Users\\me\\report.html:7")).toBe("C:\\Users\\me\\report.html")
  })

  it("keeps colon suffixes that are part of the file name", () => {
    expect(localFilePathFromMessageLink("/tmp/report:2024")).toBe("/tmp/report:2024")
    expect(localFilePathFromMessageLink("/Users/me/report.html")).toBe("/Users/me/report.html")
  })

  it("extracts the line number from code reference links", () => {
    expect(localFileTargetFromMessageLink("/Volumes/LEE/wanta/src/AssistantTurnRenderer.tsx:362")).toEqual({
      line: 362,
      path: "/Volumes/LEE/wanta/src/AssistantTurnRenderer.tsx",
    })
    expect(localFileTargetFromMessageLink("/Users/me/report.html:12:34")).toEqual({
      line: 12,
      path: "/Users/me/report.html",
    })
  })

  it("returns a null line for plain paths and colon-named files", () => {
    expect(localFileTargetFromMessageLink("/Users/me/report.html")).toEqual({
      line: null,
      path: "/Users/me/report.html",
    })
    expect(localFileTargetFromMessageLink("/tmp/report:2024")).toEqual({ line: null, path: "/tmp/report:2024" })
  })
})
