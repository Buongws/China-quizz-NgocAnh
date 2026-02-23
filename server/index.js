import express from "express";
import cors from "cors";
import { assertServerConfig, config } from "./config.js";
import { connectToDatabase } from "./lib/db.js";
import { ensureSeedData } from "./seed/ensureSeedData.js";
import { ensureAdminUsers } from "./seed/ensureAdminUsers.js";
import { authRoutes } from "./routes/authRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { categoryRoutes } from "./routes/categoryRoutes.js";
import { quizRoutes } from "./routes/quizRoutes.js";
import { scoreRoutes } from "./routes/scoreRoutes.js";
import { adminDashboardRoutes } from "./routes/adminDashboardRoutes.js";

const app = express();

const allowedOrigins = new Set(
  (config.clientOrigins.length
    ? config.clientOrigins
    : ["http://localhost:5173"]
  ).map((origin) => origin.replace(/\/+$/, "")),
);

app.disable("x-powered-by");

// ✅ Tạo corsOptions để dùng lại cho cả middleware + preflight
const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser requests (curl, server-to-server, uptime checks).
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/+$/, "");
    if (allowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false, // đổi true chỉ khi bạn dùng cookie/session
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

// ✅ CORS middleware
app.use(cors(corsOptions));

// ✅ QUAN TRỌNG: handle preflight cho mọi route
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "quiz-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/scores", scoreRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);

app.use((req, res) => {
  res.status(404).json({ message: `Not found: ${req.method} ${req.path}` });
});

// ✅ Nếu là lỗi do CORS bạn đang trả 500, nên đổi thành 403 cho đúng
app.use((error, _req, res, _next) => {
  const isCors =
    typeof error?.message === "string" &&
    error.message.startsWith("CORS blocked");
  const status = Number(error?.statusCode || (isCors ? 403 : 500));

  const message =
    typeof error?.message === "string" && error.message
      ? error.message
      : "Internal server error";

  if (status >= 500) {
    console.error("[server error]", error);
  } else {
    console.warn("[request blocked]", message);
  }

  res.status(status).json({ message });
});

async function start() {
  assertServerConfig();
  await connectToDatabase(config.mongoUri);
  await ensureAdminUsers();
  await ensureSeedData();

  app.listen(config.port, () => {
    console.log(`[quiz-api] listening at http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("[startup error]", error);
  process.exit(1);
});
