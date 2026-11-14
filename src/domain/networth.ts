/**
 * Optional assets + liabilities -> estimated net worth.
 * Assets are NEVER part of the cash forecast; only a planned sale enters it,
 * on its chosen date (see `assetSaleMovements` in ledger.ts).
 */
import type { CashMovement, ISODate, NetWorth, UserProfile } from "./contracts";
import { addDays } from "./ledger";
import { spendableBalance } from "./ledger";

export function netWorthAsOf(
  profile: UserProfile,
  movements: CashMovement[],
  asOf: ISODate,
): NetWorth {
  const observed = movements.filter((movement) => movement.status === "actual" && movement.date <= asOf);

  // Cash: spendable accounts PLUS savings pots (a pot is still the user's cash).
  const liquid = spendableBalance(profile.accounts, observed, asOf, true);

  const assetLines = profile.assets
    .filter((asset) => asset.valuedOn <= asOf && (!asset.sale || asset.sale.plannedDate > asOf))
    .map((asset) => ({ label: asset.name, amount: Math.round(asset.estimatedValue), kind: "asset" as const }));

  const liabilities = profile.loans
    .filter((loan) => loan.status === "active")
    .map((loan) => {
      // Outstanding principal at asOf: reduce by EMIs actually paid since the fixture seed.
      const paidInstalments = observed.filter(
        (movement) =>
          movement.kind === "emi" &&
          movement.accountId === loan.accountId &&
          movement.label.includes(loan.lender) &&
          movement.date <= asOf,
      ).length;
      const principalPer = loan.emiSchedule?.principalPerInstalment ?? loan.emiSchedule?.amount ?? 0;
      const outstanding = Math.max(0, loan.outstanding - paidInstalments * principalPer);
      return { label: `${loan.lender} outstanding`, amount: Math.round(outstanding), kind: "liability" as const };
    });

  const creditCards = profile.accounts
    .filter((account) => account.kind === "credit_card")
    .map((account) => ({
      label: `${account.name} balance`,
      amount: Math.max(0, -spendableBalance([account], observed, addDays(asOf, 1), true)),
      kind: "liability" as const,
    }));

  const cash = Math.round(liquid);
  const assets = assetLines.reduce((sum, line) => sum + line.amount, 0);
  const liabilityTotal = [...liabilities, ...creditCards].reduce((sum, line) => sum + line.amount, 0);

  return {
    asOf,
    cash,
    assets,
    liabilities: liabilityTotal,
    netWorth: cash + assets - liabilityTotal,
    breakdown: [
      { label: "Cash and savings", amount: cash, kind: "cash" },
      ...assetLines,
      ...liabilities,
      ...creditCards,
    ],
  };
}
