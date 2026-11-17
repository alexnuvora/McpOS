import server from "../../server.mjs";

export const config = {
  path: ["/health", "/internal/*", "/relay/*"],
};

export default server;
