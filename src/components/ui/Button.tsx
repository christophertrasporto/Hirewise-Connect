import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "dark" | "outline" | "ghost" | "white";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-all duration-200 select-none disabled:opacity-60 disabled:pointer-events-none active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_8px_20px_-8px_rgb(14_164_122/0.7)] hover:bg-brand-600 hover:shadow-[0_12px_28px_-8px_rgb(14_164_122/0.8)]",
  dark: "bg-ink-900 text-white hover:bg-ink-800 shadow-soft",
  outline: "border border-ink-200 bg-white text-ink-800 hover:border-ink-300 hover:bg-ink-50",
  ghost: "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
  white: "bg-white text-ink-900 hover:bg-ink-50 shadow-soft",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-7 text-[15px]",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

type ButtonProps = CommonProps & ComponentProps<"button"> & { href?: undefined };
type LinkProps = CommonProps & Omit<ComponentProps<typeof Link>, "className"> & { href: string };

export function Button(props: ButtonProps | LinkProps) {
  const { variant = "primary", size = "md", className, children } = props;
  const cls = cn(base, variants[variant], sizes[size], className);
  if ("href" in props && props.href) {
    const { variant: _v, size: _s, className: _c, children: _ch, ...rest } = props as LinkProps;
    return (
      <Link className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  const { variant: _v, size: _s, className: _c, children: _ch, ...rest } = props as ButtonProps;
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
