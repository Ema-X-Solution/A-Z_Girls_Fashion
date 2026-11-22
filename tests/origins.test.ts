import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedOrigin } from "../apps/api/src/config/origins.js";
afterEach(() => vi.unstubAllEnvs());
describe("CSRF origin policy", () => {
  function local() {
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:60515");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_LOOPBACK_ALIASES", "true");
  }
  it("accepts both configured local host names on the same port", () => {
    local();
    expect(isAllowedOrigin("http://localhost:60515")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:60515")).toBe(true);
  });
  it("rejects other ports, protocols, hosts, missing origins and malformed values", () => {
    local();
    for (const origin of [
      undefined,
      "null",
      "http://localhost:60516",
      "https://localhost:60515",
      "http://localhost.evil.test:60515",
      "http://evil.test:60515",
      "http://localhost:60515/path",
    ])
      expect(isAllowedOrigin(origin)).toBe(false);
  });
  it("requires explicit local opt-in", () => {
    local();
    vi.stubEnv("LOCAL_LOOPBACK_ALIASES", "false");
    expect(isAllowedOrigin("http://localhost:60515")).toBe(false);
  });
  it("keeps production restricted to the exact configured origin", () => {
    local();
    vi.stubEnv("NODE_ENV", "production");
    expect(isAllowedOrigin("http://localhost:60515")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:60515")).toBe(true);
  });
});
