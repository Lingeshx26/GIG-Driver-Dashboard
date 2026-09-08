const $ = (id) => document.getElementById(id);

let current = '0';       // what's currently being typed / the result
let previous = null;     // the operand before the operator
let operator = null;     // '+', '−', '×', '÷'
let justEvaluated = false; // true right after pressing "="

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.calc-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset));
  });
  render();
});

function handleAction(data) {
  switch (data.action) {
    case 'digit': inputDigit(data.digit); break;
    case 'decimal': inputDecimal(); break;
    case 'op': inputOperator(data.op); break;
    case 'equals': evaluate(); break;
    case 'clear': clearAll(); break;
    case 'backspace': backspace(); break;
    case 'percent': applyPercent(); break;
  }
  render();
}

function inputDigit(d) {
  if (justEvaluated) {
    current = d;
    justEvaluated = false;
    return;
  }
  current = current === '0' ? d : current + d;
}

function inputDecimal() {
  if (justEvaluated) {
    current = '0.';
    justEvaluated = false;
    return;
  }
  if (!current.includes('.')) current += '.';
}

function inputOperator(op) {
  if (operator && previous !== null && !justEvaluated) {
    // chain: evaluate what's pending first, then continue with the new operator
    evaluate();
  }
  previous = parseFloat(current);
  operator = op;
  current = '0';
  justEvaluated = false;
}

function evaluate() {
  if (operator == null || previous == null) return;
  const a = previous;
  const b = parseFloat(current);
  let result;
  switch (operator) {
    case '+': result = a + b; break;
    case '−': result = a - b; break;
    case '×': result = a * b; break;
    case '÷': result = b === 0 ? NaN : a / b; break;
    default: result = b;
  }
  current = formatResult(result);
  operator = null;
  previous = null;
  justEvaluated = true;
}

function applyPercent() {
  current = formatResult(parseFloat(current) / 100);
}

function clearAll() {
  current = '0';
  previous = null;
  operator = null;
  justEvaluated = false;
}

function backspace() {
  if (justEvaluated) { clearAll(); return; }
  current = current.length > 1 ? current.slice(0, -1) : '0';
}

function formatResult(n) {
  if (isNaN(n)) return 'Error';
  // Round away floating-point noise (e.g. 0.1 + 0.2), keep up to 6 decimals
  const rounded = Math.round(n * 1e6) / 1e6;
  return String(rounded);
}

function render() {
  $('calcCurrent').textContent = current;
  $('calcExpression').innerHTML = (previous !== null && operator)
    ? `${formatDisplayNumber(previous)} ${operator}`
    : '&nbsp;';
}

function formatDisplayNumber(n) {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 6 });
}
