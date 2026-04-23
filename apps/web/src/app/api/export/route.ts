import { createExportArchive, assertFormat, parseExportDomains } from "@/lib/server/export";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = assertFormat(searchParams.get("format"));
  const domains = parseExportDomains(searchParams.get("domains"));
  const archive = await createExportArchive({ domains, format });

  return new Response(Buffer.from(archive.body), {
    headers: {
      "Content-Type": archive.contentType,
      "Content-Disposition": `attachment; filename="${archive.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
