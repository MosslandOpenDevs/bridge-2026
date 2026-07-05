import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BRIDGE 2026 — Physical AI Governance OS",
    short_name: "BRIDGE",
    description:
      "Where agents propose, people decide, reality updates. Mossland's reality-driven governance system.",
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
