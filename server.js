const express = require("express");
const path = require("path");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

const buildWhere = (query) => {
  const filters = {};
  if (query.subjectName && query.subjectName !== "all") {
    filters.subjectName = query.subjectName;
  }
  if (query.riskLevel && query.riskLevel !== "all") {
    filters.riskLevel = query.riskLevel;
  }
  if (query.transactionType && query.transactionType !== "all") {
    filters.transactionType = query.transactionType;
  }
  if (query.residenceState && query.residenceState !== "all") {
    filters.subjectState = query.residenceState;
  }
  if (query.activityState && query.activityState !== "all") {
    filters.institutionState = query.activityState;
  }
  return filters;
};

const hashValue = (value) => {
  let hash = 0;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const buildLinkId = (subjectState, zip3, subjectName) => {
  const group = hashValue(subjectName) % 4;
  const bucket = zip3 || subjectState || "000";
  const seed = `${bucket}-${group}`;
  return hashValue(seed).toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
};


app.use(express.json());

app.use(
  cors({
    origin: ["http://localhost:5175"],
  }),
);

if (process.env.SERVE_STATIC === "true") {
  app.use(express.static(path.join(__dirname, "public")));
}

app.get("/api/summary", async (req, res) => {
  const where = buildWhere(req.query);
  const [total, minTransactions, maxTransactions, averages, sums, subjects] =
    await Promise.all([
      prisma.bsaReport.count({ where }),
      prisma.bsaReport.aggregate({ _min: { transactionDate: true }, where }),
      prisma.bsaReport.aggregate({ _max: { transactionDate: true }, where }),
      prisma.bsaReport.aggregate({ _avg: { amountTotal: true }, where }),
      prisma.bsaReport.aggregate({ _sum: { amountTotal: true }, where }),
      prisma.bsaReport.groupBy({ by: ["subjectName"], where }),
    ]);

  const uniqueSubjects = subjects.filter((s) => s.subjectName).length;

  res.json({
    totalTransactions: total,
    totalAmount: sums._sum.amountTotal,
    averageAmount: averages._avg.amountTotal,
    uniqueSubjects,
    oldestTransactionDate: minTransactions._min.transactionDate,
    newestTransactionDate: maxTransactions._max.transactionDate,
  });
});

app.get("/api/risk-amounts", async (req, res) => {
  const where = buildWhere(req.query);
  const breakdown = await prisma.bsaReport.groupBy({
    by: ["riskLevel"],
    _sum: { amountTotal: true },
    where,
  });
  res.json(
    breakdown.map((item) => ({
      riskLevel: item.riskLevel,
      totalAmount: item._sum.amountTotal || 0,
    })),
  );
});

app.get("/api/subject-rankings", async (req, res) => {
  const where = buildWhere(req.query);
  const subjects = await prisma.bsaReport.groupBy({
    by: ["subjectName", "subjectState", "institutionState", "zip3"],
    _count: { subjectName: true },
    _sum: { amountTotal: true },
    _min: { transactionDate: true },
    _max: { transactionDate: true },
    where,
    orderBy: { _count: { subjectName: "desc" } },
    take: 50,
  });
  res.json(
    subjects
      .filter((s) => s.subjectName)
      .map((item, index) => {
        let linkId = buildLinkId(item.subjectState, item.zip3, item.subjectName);
        if (index < 4) linkId = "DEMO01";
        if (index >= 4 && index < 8) linkId = "DEMO02";

        return {
          subjectName: item.subjectName,
          linkId,
          transactionCount: item._count.subjectName,
          totalAmount: item._sum.amountTotal || 0,
          residenceLocation: item.subjectState
            ? `${item.subjectState} ${item.zip3 ? `${item.zip3}xx` : ""}`.trim()
            : null,
          activityLocation: item.institutionState || null,
          firstTransactionDate: item._min.transactionDate,
          lastTransactionDate: item._max.transactionDate,
        };
      }),
  );
});

app.get("/api/filters", async (req, res) => {
  const [subjectGroups, transactionTypes, riskLevels, residenceStates, activityStates] =
    await Promise.all([
    prisma.bsaReport.groupBy({
      by: ["subjectName"],
      _count: { subjectName: true },
      orderBy: { _count: { subjectName: "desc" } },
      take: 25,
    }),
    prisma.bsaReport.groupBy({
      by: ["transactionType"],
      _count: { transactionType: true },
      orderBy: { _count: { transactionType: "desc" } },
    }),
    prisma.bsaReport.groupBy({
      by: ["riskLevel"],
      _count: { riskLevel: true },
      orderBy: { riskLevel: "asc" },
    }),
    prisma.bsaReport.groupBy({
      by: ["subjectState"],
      _count: { subjectState: true },
      orderBy: { _count: { subjectState: "desc" } },
    }),
    prisma.bsaReport.groupBy({
      by: ["institutionState"],
      _count: { institutionState: true },
      orderBy: { _count: { institutionState: "desc" } },
    }),
  ]);

  res.json({
    subjects: subjectGroups.map((s) => s.subjectName).filter(Boolean),
    transactionTypes: transactionTypes
      .map((t) => t.transactionType)
      .filter(Boolean),
    riskLevels: riskLevels.map((r) => r.riskLevel).filter(Boolean),
    residenceStates: residenceStates
      .map((s) => s.subjectState)
      .filter(Boolean),
    activityStates: activityStates
      .map((s) => s.institutionState)
      .filter(Boolean),
  });
});

app.get("/api/subject-details", async (req, res) => {
  if (!req.query.subjectName) {
    res.status(400).json({ error: "subjectName is required" });
    return;
  }

  const where = buildWhere(req.query);
  const [summary, transactions] = await Promise.all([
    prisma.bsaReport.aggregate({
      where,
      _count: { subjectName: true },
      _sum: { amountTotal: true, totalCashIn: true, totalCashOut: true },
      _min: { transactionDate: true },
      _max: { transactionDate: true },
    }),
    prisma.bsaReport.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { amountTotal: "desc" }],
      take: 20,
      select: {
        id: true,
        bsaId: true,
        formType: true,
        transactionDate: true,
        amountTotal: true,
        suspiciousActivityType: true,
        transactionType: true,
        subjectState: true,
        institutionState: true,
        zip3: true,
        riskLevel: true,
      },
    }),
  ]);

  res.json({
    subjectName: req.query.subjectName,
    transactionCount: summary._count.subjectName,
    totalAmount: summary._sum.amountTotal || 0,
    totalCashIn: summary._sum.totalCashIn || 0,
    totalCashOut: summary._sum.totalCashOut || 0,
    firstTransactionDate: summary._min.transactionDate,
    lastTransactionDate: summary._max.transactionDate,
    transactions,
  });
});

app.get("/api/records", async (req, res) => {
  const where = buildWhere(req.query);
  const records = await prisma.bsaReport.findMany({
    where,
    orderBy: [{ transactionDate: "desc" }, { amountTotal: "desc" }],
    take: 50,
    select: {
      id: true,
      subjectName: true,
      transactionDate: true,
      amountTotal: true,
      riskLevel: true,
      transactionType: true,
    },
  });
  res.json(records);
});

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, HOST, () => {
  const hostLabel = HOST === "127.0.0.1" ? "localhost" : HOST;
  console.log(`Dashboard running at http://${hostLabel}:${PORT}`);
});
