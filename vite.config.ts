import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

export default defineConfig({
  base: "./",
  build: { outDir: "dist" },
  plugins: [
    {
      name: "serve-globe-intel-html",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split("?")[0];
          if (path !== "/intel.html") {
            next();
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(readFileSync("static/intel.html", "utf8"));
        });
      },
    },
  ],
});
