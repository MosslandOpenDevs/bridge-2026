import { ImageResponse } from "next/og";

// Apple touch icon (home-screen bookmark on iOS).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 120,
          fontWeight: 800,
          color: "#ffffff",
          background: "linear-gradient(135deg, #16a34a 0%, #052e16 100%)",
        }}
      >
        B
      </div>
    ),
    { ...size },
  );
}
