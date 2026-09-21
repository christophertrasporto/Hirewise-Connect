import { cn } from "@/lib/cn";
import { Eyebrow } from "./Badge";
import type { ReactNode } from "react";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  tone = "light",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  tone?: "light" | "dark";
  className?: string;
}) {
  const dark = tone === "dark";
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && (
        <Eyebrow tone={dark ? "light" : "brand"} className={cn(align === "center" && "justify-center")}>
          {eyebrow}
        </Eyebrow>
      )}
      <h2
        className={cn(
          "mt-4 text-[2rem] font-bold leading-[1.1] sm:text-[2.5rem] lg:text-[2.85rem]",
          dark && "text-white",
        )}
      >
        {title}
      </h2>
      {description && (
        <p className={cn("mt-5 text-[17px] leading-relaxed", dark ? "text-ink-300" : "text-ink-500")}>{description}</p>
      )}
    </div>
  );
}
