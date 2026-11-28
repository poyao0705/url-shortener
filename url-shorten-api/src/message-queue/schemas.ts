import { z } from "zod";

export const clickBufferItemSchema = z.object({
  shortUrl: z.string(),
  clickedAt: z.iso.datetime(),
  referrer: z.string().nullable().optional(),
});

export type ClickBufferItem = z.infer<typeof clickBufferItemSchema>;
