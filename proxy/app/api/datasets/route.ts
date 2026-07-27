// GET /api/datasets — a free, unauthenticated pointer to popular public datasets
// an agent can query. This is intentionally a small curated list (not a live
// BigQuery scan) so it costs nothing and gives agents a starting point.

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireBetaSession } from "@/lib/beta";

const POPULAR = [
  { id: "bigquery-public-data.usa_names", description: "USA Social Security baby names by state/year." },
  { id: "bigquery-public-data.samples", description: "Classic sample tables (gsod weather, shakespeare, natality)." },
  { id: "bigquery-public-data.hacker_news", description: "Hacker News stories, comments, and users." },
  { id: "bigquery-public-data.github_repos", description: "GitHub Activity Data — commits, contents, languages (large!)." },
  { id: "bigquery-public-data.stackoverflow", description: "Stack Overflow posts, comments, votes, badges." },
  { id: "bigquery-public-data.covid19_open_data", description: "Global COVID-19 epidemiology and indicators." },
  { id: "bigquery-public-data.census_bureau_acs", description: "US Census American Community Survey." },
  { id: "bigquery-public-data.noaa_gsod", description: "NOAA Global Surface Summary of the Day weather." },
  { id: "bigquery-public-data.crypto_ethereum", description: "Ethereum blockchain blocks, transactions, logs." },
  { id: "bigquery-public-data.google_trends", description: "Google Search top/rising terms by US DMA." },
];

export function GET(req: NextRequest) {
  const locked = requireBetaSession(req);
  if (locked) return locked;
  return NextResponse.json({
    service: "gcp-x402",
    allowedProjects: config.allowedProjects,
    network: config.network.id,
    asset: "USDC",
    pricing: {
      usdPerTiB: config.usdPerByte * 2 ** 40,
      markup: config.markup,
      priceFloorUsd: config.priceFloorUsd,
      note: "Final price is computed per query from a BigQuery dry run.",
    },
    howTo: "POST /api/query { sql } — first call returns 402 with a price; pay via x402 and retry.",
    popularDatasets: POPULAR,
  });
}
