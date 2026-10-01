const manifest = {
  id: "/v2/capture",
  name: "Light House — 자유 기록 보관함",
  short_name: "Light House",
  description: "글, 이미지, 링크를 먼저 보존하고 나중에 정리하는 개인 기록 보관함",
  start_url: "/v2/capture",
  scope: "/",
  display: "standalone",
  background_color: "#f6f0e5",
  theme_color: "#47584d",
  icons: [
    { src: "/v2-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/v2-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
  share_target: {
    action: "/share-target",
    method: "POST",
    enctype: "multipart/form-data",
    params: {
      title: "title",
      text: "text",
      url: "url",
      files: [
        {
          name: "files",
          accept: ["image/*", "text/plain", "application/pdf"],
        },
      ],
    },
  },
};

export function GET() {
  return Response.json(manifest, {
    headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "application/manifest+json" },
  });
}
