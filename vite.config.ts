import { defineConfig } from "vite";

const SERVER = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  root: "src/client",
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": SERVER,
      "/ws": { target: SERVER.replace("http", "ws"), ws: true },
    },
  },
});
