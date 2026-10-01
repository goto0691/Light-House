import { expect, test } from "@playwright/test";

test.describe("private cutover routing", () => {
  test("@capture-cutover blocks legacy writes while allowing the V2 route to reach authentication", async ({ page }) => {
    test.skip(
      process.env.FLAG_V2_LEGACY_READONLY !== "1" || process.env.FLAG_V2_WRITE !== "1",
      "Runs only in the explicit capture cutover fixture.",
    );
    await page.goto("/v2-lab");
    const result = await page.evaluate(async () => {
      const post = async (path: string) => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        return { status: response.status, body: (await response.json()) as { error?: { code?: string } } };
      };
      return { legacy: await post("/api/capture"), v2: await post("/api/v2/captures/commit") };
    });

    expect(result.legacy).toMatchObject({ status: 423, body: { error: { code: "legacy_readonly" } } });
    expect(result.v2).toMatchObject({ status: 401, body: { error: { code: "authentication_required" } } });
  });

  test("@library-cutover uses Library as the root only after the default flag", async ({ request }) => {
    test.skip(process.env.FLAG_V2_DEFAULT_LIBRARY !== "1", "Runs only in the explicit Library cutover fixture.");
    const response = await request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers().location).toBe("/v2/library");
  });
});
