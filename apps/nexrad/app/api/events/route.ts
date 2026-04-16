import Redis from "ioredis";
import { REDIS_URL } from "@/lib/env";
import type { StreamEventPayload } from "@nexrad-3d/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const subscriber = new Redis(REDIS_URL);

      const cleanup = () => {
        clearInterval(heartbeat);
        subscriber.unsubscribe("radar:events").catch(() => {});
        subscriber.quit().catch(() => {});
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, 20_000);

      controller.enqueue(encoder.encode(": connected\n\n"));

      subscriber.on("message", (_channel: string, message: string) => {
        try {
          const event = JSON.parse(message) as StreamEventPayload;
          controller.enqueue(
            encoder.encode(`event: ${event.eventType}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        } catch {
          controller.enqueue(
            encoder.encode(
              `event: volume.error\ndata: ${JSON.stringify({ reason: "Invalid event payload" })}\n\n`
            )
          );
        }
      });

      await subscriber.subscribe("radar:events");

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
