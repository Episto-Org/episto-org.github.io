// Calculations in flags: a derivation written line by line, checked by
// machine. Shared by the steward, the site and the meta export.
//
// Each line is `name = expression` or an expression, using numbers, names
// defined on earlier lines, + - * / ^ ( ) and a few functions. A line may
// give the paper's own version, as a number ("0.12") or a formula ("sd / n").
// The checker computes both, rounds to the paper's precision, and marks
// where they part: the line where the paper's mistake happens.

export const MATH_MAX_LINES = 40;
export const MATH_MAX_CHARS = 160;

// Distributions, for re-computing reported p-values.
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
/** Regularised incomplete beta I_x(a, b) (continued fraction). */
function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (xx, aa, bb) => {
    let c = 1;
    let d = 1 - ((aa + bb) * xx) / (aa + 1);
    d = 1 / (Math.abs(d) < 1e-300 ? 1e-300 : d);
    let f = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let num = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2));
      d = 1 + num * d; d = 1 / (Math.abs(d) < 1e-300 ? 1e-300 : d);
      c = 1 + num / c; c = Math.abs(c) < 1e-300 ? 1e-300 : c;
      f *= d * c;
      num = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1));
      d = 1 + num * d; d = 1 / (Math.abs(d) < 1e-300 ? 1e-300 : d);
      c = 1 + num / c; c = Math.abs(c) < 1e-300 ? 1e-300 : c;
      const del = d * c;
      f *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return f;
  };
  return x < (a + 1) / (a + b + 2) ? (front * cf(x, a, b)) / a : 1 - (front * cf(1 - x, b, a)) / b;
}
/** Regularised lower incomplete gamma P(a, x). */
function igamma(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 500; n++) {
      del *= x / (a + n);
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; d = 1 / (Math.abs(d) < 1e-300 ? 1e-300 : d);
    c = b + an / c; c = Math.abs(c) < 1e-300 ? 1e-300 : c;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
// erf(x) = P(1/2, x²), so Φ(z) = (1 + sign(z) · P(1/2, z²/2)) / 2.
const pnorm = (z) => 0.5 * (1 + Math.sign(z) * igamma(0.5, (z * z) / 2));

const FUNCTIONS = {
  pnorm: [1, 1, pnorm], // P(Z ≤ z), standard normal
  p2: [1, 1, (z) => 2 * (1 - pnorm(Math.abs(z)))], // two-sided p from z
  pt2: [2, 2, (t, df) => ibeta(df / (df + t * t), df / 2, 0.5)], // two-sided p from t with df
  pchisq: [2, 2, (x, df) => 1 - igamma(df / 2, x / 2)], // upper-tail p from chi-square with df
  pf: [3, 3, (f, d1, d2) => ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2)], // upper-tail p from F(d1, d2)
  sqrt: [1, 1, Math.sqrt],
  abs: [1, 1, Math.abs],
  exp: [1, 1, Math.exp],
  ln: [1, 1, Math.log],
  log10: [1, 1, Math.log10],
  floor: [1, 1, Math.floor],
  ceil: [1, 1, Math.ceil],
  round: [1, 2, (x, d = 0) => roundTo(x, d)],
  min: [1, 20, Math.min],
  max: [1, 20, Math.max],
};

export function roundTo(x, d) {
  const f = 10 ** d;
  return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
}

/** Tokens: numbers, names, operators and brackets. Throws on anything else. */
function tokenize(text) {
  const out = [];
  const src = String(text).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/√/g, 'sqrt');
  const re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([\p{L}_][\p{L}\p{N}_]*)|(\*\*|[-+*/^(),=]))/uy;
  let i = 0;
  while (i < src.length) {
    if (/^\s+$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`cannot read "${src.slice(i, i + 12).trim()}"`);
    out.push(m[1] !== undefined ? { t: 'num', v: Number(m[1]) } : m[2] !== undefined ? { t: 'name', v: m[2] } : { t: 'op', v: m[3] === '**' ? '^' : m[3] });
    i = re.lastIndex;
  }
  return out;
}

/** Parses an expression into a tree; names used are collected in `uses`. */
function parse(tokens, uses) {
  let p = 0;
  const peek = () => tokens[p];
  const take = (v) => (peek()?.v === v ? (p++, true) : false);
  const expect = (v) => {
    if (!take(v)) throw new Error(`expected "${v}"`);
  };
  const expr = () => {
    let left = term();
    for (;;) {
      if (take('+')) left = ['+', left, term()];
      else if (take('-')) left = ['-', left, term()];
      else return left;
    }
  };
  const term = () => {
    let left = unary();
    for (;;) {
      if (take('*')) left = ['*', left, unary()];
      else if (take('/')) left = ['/', left, unary()];
      else return left;
    }
  };
  const unary = () => {
    if (take('-')) return ['neg', unary()];
    if (take('+')) return unary();
    return power();
  };
  const power = () => {
    const base = primary();
    return take('^') ? ['^', base, unary()] : base;
  };
  const primary = () => {
    const tok = tokens[p++];
    if (!tok) throw new Error('the formula ends too soon');
    if (tok.t === 'num') return ['num', tok.v];
    if (tok.t === 'name') {
      if (take('(')) {
        const fn = FUNCTIONS[tok.v];
        if (!fn) throw new Error(`unknown function "${tok.v}"`);
        const args = [expr()];
        while (take(',')) args.push(expr());
        expect(')');
        if (args.length < fn[0] || args.length > fn[1]) throw new Error(`${tok.v} takes ${fn[0] === fn[1] ? fn[0] : `${fn[0]}-${fn[1]}`} values`);
        return ['call', tok.v, args];
      }
      uses.add(tok.v);
      return ['name', tok.v];
    }
    if (tok.v === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    throw new Error(`unexpected "${tok.v}"`);
  };
  const tree = expr();
  if (p < tokens.length) throw new Error(`unexpected "${tokens[p].v}"`);
  return tree;
}

function evaluate(node, scope) {
  switch (node[0]) {
    case 'num': return node[1];
    case 'name': return scope.get(node[1]);
    case 'neg': return -evaluate(node[1], scope);
    case 'call': return FUNCTIONS[node[1]][2](...node[2].map((a) => evaluate(a, scope)));
    case '^': return evaluate(node[1], scope) ** evaluate(node[2], scope);
    default: {
      const [a, b] = [evaluate(node[1], scope), evaluate(node[2], scope)];
      return node[0] === '+' ? a + b : node[0] === '-' ? a - b : node[0] === '*' ? a * b : a / b;
    }
  }
}

/** "name = formula" → {name, formula}; otherwise {name: null, formula}. */
function split(text) {
  const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*=(?!=)(.*)$/su.exec(String(text));
  return m ? { name: m[1], formula: m[2] } : { name: null, formula: String(text) };
}

/** Decimal places a reported number is given to ("3.47" → 2). */
function decimals(text) {
  const m = /^\s*[-+]?\d*\.(\d+)\s*$/.exec(String(text));
  return m ? m[1].length : 0;
}

/**
 * Checks a derivation.
 * @param lines [{expr, why?, paper?, error?}]
 * @returns {{rows: {name, value, uses: number[], paper?: number, parts: boolean}[], problems: string[], first: number|null}}
 *   uses: earlier line numbers this line depends on; parts: the paper's
 *   version differs here; first: the first line where they part
 */
export function checkDerivation(lines) {
  const problems = [];
  const rows = [];
  const scope = new Map();
  const definedAt = new Map();
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MATH_MAX_LINES) {
    return { rows, problems: [`a calculation has 1-${MATH_MAX_LINES} lines`], first: null };
  }
  lines.forEach((line, i) => {
    const at = `calculation line ${i + 1}`;
    const row = { name: null, value: null, uses: [], paper: null, parts: false };
    rows.push(row);
    if (!line || typeof line.expr !== 'string' || !line.expr.trim() || line.expr.length > MATH_MAX_CHARS) {
      problems.push(`${at}: "expr" must be a formula of at most ${MATH_MAX_CHARS} characters`);
      return;
    }
    const { name, formula } = split(line.expr);
    try {
      const uses = new Set();
      const tree = parse(tokenize(formula), uses);
      for (const u of uses) if (!scope.has(u)) throw new Error(`"${u}" is not defined on an earlier line`);
      if (name && scope.has(name)) throw new Error(`"${name}" is already defined on line ${definedAt.get(name)}`);
      if (name && FUNCTIONS[name]) throw new Error(`"${name}" is the name of a function`);
      const value = evaluate(tree, scope);
      if (!Number.isFinite(value)) throw new Error('the result is not a finite number (a division by zero?)');
      Object.assign(row, { name, value, uses: [...new Set([...uses].map((u) => definedAt.get(u)))].sort((a, b) => a - b) });
      if (line.paper !== undefined && line.paper !== null && String(line.paper).trim() !== '') {
        const text = String(line.paper);
        let paper;
        if (/^\s*[-+]?(\d+(\.\d*)?|\.\d+)\s*$/.test(text)) {
          paper = Number(text);
          row.parts = roundTo(value, decimals(text)) !== roundTo(paper, decimals(text));
        } else {
          const puses = new Set();
          const ptree = parse(tokenize(text), puses);
          for (const u of puses) if (!scope.has(u)) throw new Error(`the paper's version uses "${u}", which is not defined on an earlier line`);
          paper = evaluate(ptree, scope);
          row.parts = Math.abs(paper - value) > 1e-9 * Math.max(1, Math.abs(value));
        }
        row.paper = paper;
      }
      if (name) {
        scope.set(name, value);
        definedAt.set(name, i + 1);
      }
    } catch (e) {
      problems.push(`${at}: ${e.message}`);
    }
  });
  const first = rows.findIndex((r) => r.parts);
  return { rows, problems, first: first < 0 ? null : first + 1 };
}

/**
 * The shape of a formula: names replaced by a, b, c... in order of first
 * use, numbers and functions kept. "se = s / sqrt(N)" and "sd / sqrt(n)"
 * share the shape "a / sqrt(b)". Null when the formula cannot be read.
 */
export function shape(text) {
  try {
    const uses = new Set();
    const tree = parse(tokenize(split(text).formula), uses);
    const names = new Map();
    const walk = (n) => {
      switch (n[0]) {
        case 'num': return String(n[1]);
        case 'name':
          if (!names.has(n[1])) names.set(n[1], String.fromCharCode(97 + names.size));
          return names.get(n[1]);
        case 'neg': return `(-${walk(n[1])})`;
        case 'call': return `${n[1]}(${n[2].map(walk).join(',')})`;
        default: return `(${walk(n[1])}${n[0]}${walk(n[2])})`;
      }
    };
    return walk(tree);
  } catch {
    return null;
  }
}

/** A formula as it reads: × for *, √ for sqrt, superscript-free but tidy. */
export function pretty(text) {
  return String(text).replace(/\*\*/g, '^').replace(/\s*\*\s*/g, ' × ').replace(/\s*\/\s*/g, ' / ').replace(/sqrt\(/g, '√(').replace(/\s+/g, ' ').trim();
}
