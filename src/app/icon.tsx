import { ImageResponse } from "next/og";
import { Mark } from "@/lib/brand/Mark";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<Mark size="small" px={64} />, size);
}
