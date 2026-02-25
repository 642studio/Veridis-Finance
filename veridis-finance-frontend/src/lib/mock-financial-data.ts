export interface MockMonthlyIncomeExpenseDatum {
  label: string;
  income: number;
  expense: number;
}

export interface MockCashflowDatum extends MockMonthlyIncomeExpenseDatum {
  net: number;
}

export interface MockCategoryDatum {
  label: string;
  value: number;
}

export const mockMonthlyIncomeExpenseData: MockMonthlyIncomeExpenseDatum[] = [
  { label: "Sep", income: 148000, expense: 90400 },
  { label: "Oct", income: 161500, expense: 97200 },
  { label: "Nov", income: 173900, expense: 101850 },
  { label: "Dec", income: 182300, expense: 109640 },
  { label: "Jan", income: 169450, expense: 99870 },
  { label: "Feb", income: 177120, expense: 106430 },
];

export const mockCashflowData: MockCashflowDatum[] = mockMonthlyIncomeExpenseData.map(
  (entry) => ({
    ...entry,
    net: entry.income - entry.expense,
  })
);

export const mockCategoryData: MockCategoryDatum[] = [
  { label: "Operations", value: 94200 },
  { label: "Sales", value: 77400 },
  { label: "Marketing", value: 52800 },
  { label: "Payroll", value: 113900 },
  { label: "Tools", value: 38600 },
];
