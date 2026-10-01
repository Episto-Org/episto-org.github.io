// The expressions the logic builder knows: grouped menus, each formula with
// how it works. Groups run parallel to the taxonomy's categories, so trees in
// one category share the same icons and shapes. A line written by hand is
// recognised when it has a known formula's shape (see mathcheck.shape).

import { shape } from './mathcheck.js';

export const EXPRESSION_GROUPS = [
  {
    id: 'arithmetic', icon: 'Σ', label: 'Arithmetic',
    items: [
      { id: 'value', label: 'A reported value', expr: 'x = 0', how: 'A number as the paper reports it, with its page in "why".', known: false },
      { id: 'sum', label: 'Sum', expr: 'total = a + b', how: 'Adds the parts.', known: false },
      { id: 'difference', label: 'Difference', expr: 'diff = a - b', how: 'Subtracts one value from another.', known: false },
      { id: 'mean-from-total', label: 'Mean from a total', expr: 'mean = total / n', how: 'Divides the total by the number of observations.', known: false },
      { id: 'percentage', label: 'Percentage', expr: 'pct = part / whole * 100', how: 'The part as a share of the whole, times 100.' },
      { id: 'rounding', label: 'Rounding', expr: 'r = round(x, 2)', how: 'Rounds to the decimals the paper reports.' },
    ],
  },
  {
    id: 'descriptive', icon: 'x̄', label: 'Descriptive statistics',
    items: [
      { id: 'grim', label: 'GRIM: mean × n', expr: 'total = mean * n', how: 'For whole-number data, the mean times n must be a whole number; if not, the mean is impossible for that n.' },
      { id: 'se-from-sd', label: 'Standard error from SD', expr: 'se = sd / sqrt(n)', how: 'The standard error of a mean is the SD divided by the square root of n.' },
      { id: 'sd-from-se', label: 'SD from standard error', expr: 'sd = se * sqrt(n)', how: 'Undoes the standard error: SE times the square root of n.' },
      { id: 'variance', label: 'Variance from SD', expr: 'v = sd ^ 2', how: 'The variance is the SD squared.' },
      { id: 'cv', label: 'Coefficient of variation', expr: 'cv = sd / mean * 100', how: 'The SD as a percentage of the mean.' },
      { id: 'pooled-sd', label: 'Pooled SD', expr: 'sp = sqrt(((n1 - 1) * sd1 ^ 2 + (n2 - 1) * sd2 ^ 2) / (n1 + n2 - 2))', how: 'Combines two groups\' SDs, each weighted by its degrees of freedom.' },
    ],
  },
  {
    id: 'tests', icon: 't', label: 'Test statistics',
    items: [
      { id: 't-one', label: 't, one sample', expr: 't = (m - mu) / (sd / sqrt(n))', how: 'How many standard errors the mean lies from the tested value.' },
      { id: 't-welch', label: 't, two groups (Welch)', expr: 't = (m1 - m2) / sqrt(sd1 ^ 2 / n1 + sd2 ^ 2 / n2)', how: 'The difference of two means over its standard error, without assuming equal variances.' },
      { id: 'df-two', label: 'Degrees of freedom, two groups', expr: 'df = n1 + n2 - 2', how: 'Two groups lose one degree of freedom each.' },
      { id: 'p-from-t', label: 'p from t', expr: 'p = pt2(t, df)', how: 'The two-sided p-value of t with df degrees of freedom.' },
      { id: 'p-from-z', label: 'p from z', expr: 'p = p2(z)', how: 'The two-sided p-value of a z statistic.' },
      { id: 'p-from-chisq', label: 'p from χ²', expr: 'p = pchisq(x, df)', how: 'The p-value of a χ² statistic with df degrees of freedom.' },
      { id: 'p-from-f', label: 'p from F', expr: 'p = pf(f, d1, d2)', how: 'The p-value of an F statistic with d1 and d2 degrees of freedom.' },
      { id: 'f-from-t', label: 'F from t', expr: 'f = t ^ 2', how: 'With two groups, F is t squared.' },
    ],
  },
  {
    id: 'effects', icon: 'd', label: 'Effect sizes',
    items: [
      { id: 'cohen-d', label: "Cohen's d", expr: 'd = (m1 - m2) / sp', how: 'The difference of means in units of the pooled SD.' },
      { id: 'd-from-t', label: 'd from t', expr: 'd = 2 * t / sqrt(df)', how: 'Recovers d from a two-group t and its degrees of freedom.' },
      { id: 'r-from-t', label: 'r from t', expr: 'r = t / sqrt(t ^ 2 + df)', how: 'The correlation that matches a t with df degrees of freedom.' },
      { id: 'odds-ratio', label: 'Odds ratio', expr: 'or = (a * d) / (b * c)', how: 'From a 2×2 table: the odds in one group over the odds in the other.' },
      { id: 'risk-ratio', label: 'Risk ratio', expr: 'rr = (a / (a + b)) / (c / (c + d))', how: 'From a 2×2 table: the risk in one group over the risk in the other.' },
      { id: 'nnt', label: 'Number needed to treat', expr: 'nnt = 1 / (r1 - r2)', how: 'One over the difference in risk between the groups.' },
    ],
  },
  {
    id: 'intervals', icon: '±', label: 'Intervals',
    items: [
      { id: 'ci-lower', label: '95% CI, lower', expr: 'lower = mean - 1.96 * se', how: 'The estimate minus 1.96 standard errors.' },
      { id: 'ci-upper', label: '95% CI, upper', expr: 'upper = mean + 1.96 * se', how: 'The estimate plus 1.96 standard errors.' },
      { id: 'se-from-ci', label: 'SE from a 95% CI', expr: 'se = (upper - lower) / (2 * 1.96)', how: 'The width of a 95% interval is 2 × 1.96 standard errors.' },
      { id: 'z-from-ci', label: 'z from estimate and SE', expr: 'z = est / se', how: 'The estimate in units of its standard error.', known: false },
    ],
  },
  {
    id: 'samples', icon: 'n', label: 'Samples',
    items: [
      { id: 'total-n', label: 'Total sample', expr: 'n = n1 + n2', how: 'The groups add up to the whole sample.', known: false },
      { id: 'attrition', label: 'Attrition', expr: 'lost = (start - end) / start * 100', how: 'The share of participants lost between start and end.' },
      { id: 'response-rate', label: 'Response rate', expr: 'rate = responded / invited * 100', how: 'Those who took part, as a share of those invited.' },
    ],
  },
  {
    id: 'rates', icon: '%', label: 'Rates and units',
    items: [
      { id: 'per-thousand', label: 'Rate per 1,000', expr: 'rate = events / population * 1000', how: 'Events per 1,000 people.' },
      { id: 'change', label: 'Percentage change', expr: 'change = (new - old) / old * 100', how: 'The change as a share of the starting value.' },
      { id: 'lb-to-kg', label: 'Pounds to kilograms', expr: 'kg = lb * 0.4536', how: 'One pound is 0.4536 kilograms.' },
    ],
  },
];

/** The menu that opens first for a flag category; it then stays on the last one chosen. */
export const GROUP_FOR_CATEGORY = {
  stats: 'tests', sample: 'samples', design: 'descriptive', evidence: 'descriptive', reasoning: 'arithmetic',
  transparency: 'tests', integrity: 'descriptive', sources: 'arithmetic', interests: 'arithmetic', notices: 'arithmetic',
};

const byShape = new Map();
for (const g of EXPRESSION_GROUPS) {
  for (const item of g.items) {
    if (item.known === false) continue;
    const s = shape(item.expr);
    if (s) byShape.set(s, [...(byShape.get(s) ?? []), { ...item, group: g.id, icon: g.icon }]);
  }
}

/**
 * The known expression a formula has the shape of, or null. Shapes two
 * expressions share (a percentage and a coefficient of variation are both
 * a / b × 100) are not named: the shape cannot tell which is meant.
 */
export function recognise(formula) {
  const s = shape(formula);
  const found = s ? byShape.get(s) : null;
  return found?.length === 1 ? found[0] : null;
}

/** Whether another known expression shares this formula's shape. */
export function ambiguous(formula) {
  const s = shape(formula);
  return (s ? byShape.get(s)?.length ?? 0 : 0) > 1;
}

export function expressionById(id) {
  for (const g of EXPRESSION_GROUPS) for (const item of g.items) if (item.id === id) return { ...item, group: g.id, icon: g.icon };
  return null;
}
