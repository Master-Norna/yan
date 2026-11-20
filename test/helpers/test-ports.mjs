import { createServer } from "node:net";

// 端口是否可监听与对方是否会说 HTTP 无关。试完即释放，这不是 runner 之间的锁。
export function probeTestPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(error => (error ? reject(error) : resolve(undefined)));
    });
  });
}
