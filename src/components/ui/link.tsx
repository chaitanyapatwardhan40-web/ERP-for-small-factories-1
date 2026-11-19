import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * next/link without prefetching. Business screens list dozens of links and
 * every one is a dynamic page, so prefetching them turns each page view into
 * a burst of server requests for nothing the user will necessarily open.
 */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
