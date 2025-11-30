export function extractAnnual(data, type) {
  if (!data || !data.annualReports) return [];

  return data.annualReports.slice(0, 3).map(y => {
    const year = Number(y.fiscalDateEnding.slice(0, 4));

    if (type === "income") {
      return {
        fiscal_year: year,
        revenue: Number(y.grossProfit || 0),   // FIXED (totalRevenue does not exist)
        net_income: Number(y.netIncome || 0),
      };
    }

    if (type === "balance") {
      return {
        fiscal_year: year,
        total_assets: Number(y.totalAssets || 0),
        total_liabilities: Number(y.totalLiabilities || 0)
      };
    }

    return {};
  });
}

export function calcMetrics(records) {
  return records.map(r => ({
    ...r,
    gross_margin:
      r.revenue && r.revenue !== 0
        ? r.net_income / r.revenue
        : 0
  }));
}
