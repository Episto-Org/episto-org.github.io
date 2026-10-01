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

const FUNCTIONS = {
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

/** A formula as it reads: × for *, √ for sqrt, superscript-free but tidy. */
export function pretty(text) {
  return String(text).replace(/\*\*/g, '^').replace(/\s*\*\s*/g, ' × ').replace(/\s*\/\s*/g, ' / ').replace(/sqrt\(/g, '√(').replace(/\s+/g, ' ').trim();
}
