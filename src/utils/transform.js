export function extractAnnual(data) {
  if (!data || !data.annualReports) return [];
  return data.annualReports.slice(0, 3).map(y => ({
    fiscal_year: Number(y.fiscalDateEnding.slice(0, 4)),
    revenue: Number(y.totalRevenue || 0),
    net_income: Number(y.netIncome || 0),
    total_assets: Number(y.totalAssets || 0),
    total_liabilities: Number(y.totalLiabilities || 0)
  }));
}

export function calcMetrics(records) {
  return records.map(r => ({
    ...r,
    gross_margin: r.revenue ? r.net_income / r.revenue : 0
  }));
}
