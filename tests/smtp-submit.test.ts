import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { submitToMta, SmtpResponseError, SmtpSubmissionUncertainError } from "../src/lib/smtp-submit";

async function withServer(mode: "accept" | "close-before" | "close-after" | "reject" | "reject-permanent" | "no-id", run: (port: number) => Promise<void>) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    if (mode === "close-before") { socket.end(); return; }
    socket.write("220 test ESMTP\r\n");
    let buffer = "", body = false;
    socket.on("data", (data) => {
      buffer += data.toString();
      if (body) {
        if (!buffer.includes("\r\n.\r\n")) return;
        if (mode === "close-after") socket.end();
        else socket.write(mode === "reject-permanent" ? "550 permanent rejection\r\n" : mode === "reject" ? "451 temporary rejection\r\n" : mode === "no-id" ? "250 accepted\r\n" : "250 queued as ABC123\r\n");
        buffer = "";
        return;
      }
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"), line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line === "DATA") { body = true; socket.write("354 send data\r\n"); }
        else socket.write(line.startsWith("EHLO") ? "250-test\r\n250 OK\r\n" : "250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run((server.address() as net.AddressInfo).port); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
const submit = (port: number) => submitToMta("Subject: test\r\n\r\nHello\r\n.dot", "sender@example.com", "recipient@example.com", { host: "127.0.0.1", port, timeoutMs: 1000 });
test("SMTP accepts a multiline greeting and captures the queue id", async () => {
  await withServer("accept", async (port) => assert.equal((await submit(port)).queueId, "ABC123"));
});
test("SMTP close before DATA settles instead of hanging", { timeout: 2000 }, async () => {
  await withServer("close-before", async (port) => assert.rejects(submit(port), (error: Error) => !(error instanceof SmtpSubmissionUncertainError) && /closed/.test(error.message)));
});
test("SMTP lost final reply is uncertain and must not be retried", async () => {
  await withServer("close-after", async (port) => assert.rejects(submit(port), SmtpSubmissionUncertainError));
});
test("SMTP explicit DATA rejection remains safe to retry", async () => {
  await withServer("reject", async (port) => assert.rejects(submit(port), (error: Error) => !(error instanceof SmtpSubmissionUncertainError) && /451/.test(error.message)));
});
test("SMTP acceptance without queue id is still acceptance", async () => {
  await withServer("no-id", async (port) => assert.equal((await submit(port)).queueId, null));
});

test("SMTP permanent rejection exposes its code without uncertain delivery", async () => {
  await withServer("reject-permanent", async (port) => assert.rejects(submit(port), (error: Error) => error instanceof SmtpResponseError && error.code === 550));
});
