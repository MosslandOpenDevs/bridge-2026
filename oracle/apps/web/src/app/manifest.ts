import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Same wording as the page metadata in layout.tsx; see the note there.
    name: "BRIDGE 2026 — Reality-signal governance lab",
    short_name: "BRIDGE",
    description:
      "An experimental Mossland Lab service that turns reality signals into non-binding, AI-drafted governance proposals.",
    start_url: "/",
    display: "standalone",
    background_color: "#052e16",
    theme_color: "#16a34a",
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
