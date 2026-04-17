import Redis from "ioredis";
import { REDIS_URL } from "@/lib/env";
import type { StreamEventPayload } from "@nexrad-3d/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const subscriber = new Redis(REDIS_URL);
      let cleaned = false;

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
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

      // Register abort listener BEFORE the async subscribe call so cleanup
      // is always reachable even if subscribe() throws.
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });

      controller.enqueue(encoder.encode(": connected\n\n"));

      subscriber.on("message", (_channel: string, message: string) => {
        try {
          const event = JSON.parse(message) as StreamEventPayload;
          controller.enqueue(
            encoder.encode(`event: ${event.eventType}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        } catch {
          try {
            controller.enqueue(
              encoder.encode(
                `event: volume.error\ndata: ${JSON.stringify({ reason: "Invalid event payload" })}\n\n`
              )
            );
          } catch {}
        }
      });

      try {
        await subscriber.subscribe("radar:events");
      } catch (err) {
        cleanup();
        controller.error(err);
      }
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
